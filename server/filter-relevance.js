/**
 * filter-relevance.js
 *
 * Uses Claude to flag tiles with relevant:false if they are unrelated to
 * the phone-policy discussion (e.g. off-topic remarks, pure questions, filler).
 *
 * Usage: node filter-relevance.js [--dry-run]
 *
 * Adds/updates a `relevant` boolean field on every tile in the cache.
 * Client filters out relevant:false tiles at load time.
 */

require("dotenv").config();
const fs      = require("fs");
const path    = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const DRY_RUN  = process.argv.includes("--dry-run");
const CACHE    = path.join(__dirname, "cache", "1208.json");
const BATCH_SZ = 30;
const CONCUR   = 3;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `You are reviewing short quotes from a recorded school discussion about phone policy.
Mark each quote as relevant (true) or irrelevant (false).

A quote is IRRELEVANT if it:
- Is a facilitator/moderator question or prompt with no personal stance
- Is pure logistics or filler ("okay", "let's move on", "can you repeat that")
- Has no discernible connection to phones, phone policy, student life, safety, learning, or wellbeing
- Is too short or fragmentary to contain any meaning (<5 words of substance)

A quote is RELEVANT if it:
- Expresses any view, experience, or feeling about phones, phone bans, or related topics
- Discusses learning, distraction, safety, family contact, mental health, or school rules
- Is a student or teacher voice with any content relating to the discussion

When in doubt, mark as relevant (true). Only flag clear non-starters as false.`;

async function scoreBatch(tiles) {
    const excerpts = tiles
        .map((t, i) => `[${i}] id=${t.id} | "${t.text.slice(0, 250)}"`)
        .join("\n\n");

    const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: SYSTEM,
        messages: [{
            role: "user",
            content: `For each quote below, return ONLY a JSON array: [{"id":"h123","relevant":true}, ...]

${excerpts}`,
        }],
    });

    const raw = msg.content[0].text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(raw);
}

(async () => {
    const data  = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    const tiles = data.tiles;
    console.log(`Loaded ${tiles.length} tiles.`);

    if (DRY_RUN) {
        console.log("DRY RUN — scoring first batch only…");
        const sample = await scoreBatch(tiles.slice(0, BATCH_SZ));
        const irrelevant = sample.filter(s => !s.relevant);
        console.log(`\nIrrelevant in sample: ${irrelevant.length}/${sample.length}`);
        irrelevant.forEach(s => {
            const t = tiles.find(t => t.id === s.id);
            console.log(`  ${s.id}: "${t?.text?.slice(0, 80)}"`);
        });
        return;
    }

    const batches = [];
    for (let i = 0; i < tiles.length; i += BATCH_SZ)
        batches.push(tiles.slice(i, i + BATCH_SZ));

    const results = {};
    let idx = 0;

    async function worker() {
        while (idx < batches.length) {
            const bi = idx++;
            console.log(`  Batch ${bi + 1}/${batches.length}…`);
            try {
                const scored = await scoreBatch(batches[bi]);
                scored.forEach(s => { results[s.id] = s.relevant; });
            } catch (err) {
                console.error(`  Batch ${bi + 1} failed: ${err.message} — defaulting to relevant`);
                batches[bi].forEach(t => { results[t.id] = true; });
            }
        }
    }

    await Promise.all(Array.from({ length: CONCUR }, worker));

    const backup = CACHE.replace(".json", `.backup-${Date.now()}.json`);
    fs.copyFileSync(CACHE, backup);
    console.log(`Backed up to ${path.basename(backup)}`);

    let flagged = 0;
    data.tiles = tiles.map(t => {
        const relevant = results[t.id] ?? true;
        if (!relevant) flagged++;
        return { ...t, relevant };
    });

    fs.writeFileSync(CACHE, JSON.stringify(data));
    console.log(`Done. Flagged ${flagged}/${tiles.length} tiles as irrelevant.`);
})();
