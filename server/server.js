require("dotenv").config();
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CORTICO_BASE = "https://api.cortico.ai";
const SPEAKER_PALETTE = [
    "#f4b8c1", "#c3aed6", "#f9e4b7", "#b5ead7",
    "#f8c8dc", "#c7ceea", "#ffd3b6", "#a8d8ea",
];

// ── Cortico API helpers ────────────────────────────────────────────────────

async function corticoGet(path) {
    const res = await fetch(`${CORTICO_BASE}${path}`, {
        headers: { Authorization: `Bearer ${process.env.CORTICO_API_KEY}` },
    });
    if (!res.ok) throw new Error(`Cortico ${path} → ${res.status}`);
    return res.json();
}

function reconstructText(snippet) {
    return (snippet.words || []).map(w => w.word).join(" ").trim();
}

// ── Catalog processing ─────────────────────────────────────────────────────

function extractQuestionsAndTiles(entries) {
    const questionsMap = {};   // code_id → question
    const speakerColors = {};
    let colorIdx = 0;

    const rawTiles = entries.map(entry => {
        const h = entry.highlight;
        const speaker = entry.primary_participant_name || "Unknown";
        const text = (h.snippets || []).map(reconstructText).join(" ").trim();

        // Structural code → which question this belongs to
        const structCode = (entry.codes || []).find(c => c.code_type === "structural");
        if (structCode && !questionsMap[structCode.id]) {
            questionsMap[structCode.id] = {
                id: `q${structCode.id}`,
                text: structCode.name,
                fullText: structCode.description || structCode.name,
            };
        }

        if (!speakerColors[speaker]) {
            speakerColors[speaker] = SPEAKER_PALETTE[colorIdx++ % SPEAKER_PALETTE.length];
        }

        return {
            id: `h${h.id}`,
            speakerName: speaker,
            speakerColor: speakerColors[speaker],
            text,
            questionId: structCode ? `q${structCode.id}` : null,
            audioStartOffset: h.audio_start_offset,
            conversationId: h.conversation_id,
        };
    }).filter(t => t.text.length > 0);

    return {
        questions: Object.values(questionsMap),
        rawTiles,
        speakers: Object.entries(speakerColors).map(([name, color]) => ({ name, color })),
    };
}

// ── Claude headline generation ─────────────────────────────────────────────

const HEADLINE_PROMPT = `Generate a short, vivid headline for each speaker excerpt.

Rules:
- VERBATIM QUOTE (strongly preferred): lift the most vivid, specific phrase exactly as spoken. Wrap in quotation marks. 4–10 words. Preserve "I", "you", pronouns, personal detail.
- DESCRIPTIVE (last resort only): 4–7 clean words, no quotes, no first-person pronouns, capitalize first word.
- Headlines must be SPECIFIC to this exact excerpt — never a generic topic label.
- Never repeat the same headline.

Excerpts:
{{EXCERPTS}}

Return a JSON array of strings, one per excerpt in order. No other text.`;

async function generateHeadlinesBatch(tiles) {
    const excerpts = tiles
        .map((t, i) => `[${i}] ${t.speakerName}: "${t.text.slice(0, 350)}"`)
        .join("\n\n");

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1200,
        messages: [{ role: "user", content: HEADLINE_PROMPT.replace("{{EXCERPTS}}", excerpts) }],
    });

    const raw = response.content[0].text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(raw);
}

// Run batches with limited concurrency to respect rate limits
async function generateAllHeadlines(rawTiles, batchSize = 20, concurrency = 3) {
    const batches = [];
    for (let i = 0; i < rawTiles.length; i += batchSize) {
        batches.push(rawTiles.slice(i, i + batchSize));
    }

    const results = new Array(rawTiles.length);
    let batchIdx = 0;

    async function runNext() {
        while (batchIdx < batches.length) {
            const idx = batchIdx++;
            const batch = batches[idx];
            const startPos = idx * batchSize;
            console.log(`[Claude] Batch ${idx + 1}/${batches.length} (${batch.length} tiles)`);
            try {
                const headlines = await generateHeadlinesBatch(batch);
                batch.forEach((tile, j) => {
                    results[startPos + j] = { ...tile, headline: headlines[j] || tile.text.slice(0, 50) };
                });
            } catch (err) {
                console.error(`Batch ${idx + 1} failed:`, err.message);
                batch.forEach((tile, j) => {
                    results[startPos + j] = { ...tile, headline: tile.text.slice(0, 50) };
                });
            }
        }
    }

    await Promise.all(Array.from({ length: concurrency }, runNext));
    return results;
}

// ── Routes ─────────────────────────────────────────────────────────────────

app.get("/health", (_, res) => res.json({ ok: true }));

// Proxy highlight audio — keeps the Cortico API key server-side
app.get("/api/audio/highlight/:id", async (req, res) => {
    try {
        const audioRes = await fetch(`${CORTICO_BASE}/v1/highlights/${req.params.id}/audio`, {
            headers: { Authorization: `Bearer ${process.env.CORTICO_API_KEY}` },
        });
        if (!audioRes.ok) return res.status(audioRes.status).json({ error: "Audio unavailable" });
        const buffer = await audioRes.arrayBuffer();
        res.set("Content-Type", audioRes.headers.get("content-type") || "audio/mpeg");
        res.set("Cache-Control", "public, max-age=3600");
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get("/api/catalog/:id", async (req, res) => {
    const catalogId = req.params.id;
    const limit = parseInt(req.query.limit) || 120;  // cap for PoC performance

    try {
        console.log(`[Cortico] Fetching catalog ${catalogId}…`);
        const catalog = await corticoGet(`/v1/catalogs/${catalogId}`);
        const entries = (catalog.catalog_entries || []).slice(0, limit);
        console.log(`[Cortico] ${entries.length} entries (capped at ${limit})`);

        const { questions, rawTiles, speakers } = extractQuestionsAndTiles(entries);
        console.log(`[Claude] Generating headlines for ${rawTiles.length} tiles…`);

        const tiles = await generateAllHeadlines(rawTiles);

        res.json({
            catalogId: catalog.id,
            title: catalog.title,
            questions,
            tiles,
            speakers,
        });
    } catch (err) {
        console.error("[Error]", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ── Start ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`\nConversation Bloom server on http://localhost:${PORT}`);
    console.log(`  Cortico key:   ${process.env.CORTICO_API_KEY ? "✓" : "✗ missing"}`);
    console.log(`  Anthropic key: ${process.env.ANTHROPIC_API_KEY ? "✓" : "✗ missing"}\n`);
});
