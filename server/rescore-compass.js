/**
 * rescore-compass.js
 *
 * Re-scores compassX and compassY for all tiles in the cache using a prompt
 * that produces a well-distributed, continuous range instead of snapping to extremes.
 *
 * Usage: node rescore-compass.js [--dry-run]
 *
 * Axes:
 *   X: Phone as distraction (-1) ↔ Phone as lifeline (+1)
 *   Y: Experience (-1) ↔ Claim (+1)
 */

require("dotenv").config();
const fs   = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");

const DRY_RUN   = process.argv.includes("--dry-run");
const CACHE     = path.join(__dirname, "cache", "1208.json");
const BATCH_SZ  = 25;
const CONCUR    = 3;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Calibration anchors ───────────────────────────────────────────────────────
// Shown to Claude in every batch so it can calibrate against the full range.
const ANCHORS = `
Calibration examples (do NOT output scores for these — they are only for scale reference):

  X = -0.85, Y = -0.70 | "phone completely off so I can focus — I actually get my work done now"
    → strong distraction framing; personal experience/state, no general claim being made

  X = -0.55, Y = +0.75 | "teaching kids responsibility means trusting them to self-regulate"
    → phone as hindrance to growth; strong general principle, no personal anecdote

  X =  0.00, Y =  0.00 | "I agree about using phones during lunch"
    → neutral on phone framing; neither narrating an event nor making a general claim

  X = +0.80, Y = -0.80 | "my mom was in the hospital and I couldn't reach her all day"
    → phone urgently needed (lifeline); pure event narration, no policy claim attached

  X = +0.65, Y = +0.70 | "emergency access should be guaranteed — the school can't be the only contact in a crisis"
    → phone as lifeline; explicit policy claim about what should be true for everyone
`.trim();

const SYSTEM = `You score student and teacher quotes from a school phone-policy discussion on two axes.

Axis X — Phone framing:
  -1.0 = phone is purely a distraction / obstacle / problem
  +1.0 = phone is essential / a lifeline / critical resource
  0.0  = neutral / doesn't frame the phone either way

Axis Y — Mode of speaking:
  -1.0 = Experience: the speaker narrates a specific event that happened to them, OR describes an ongoing felt state ("I feel", "I need", "this happened to me"). No general claim is being made — the statement is grounded in personal lived reality.
  +1.0 = Claim: the speaker makes a general assertion about what is true or should be true ("students should…", "the policy needs to…", "when you enforce X, Y happens"). The statement applies beyond the speaker's own situation.
  0.0  = Mixed: a personal story offered as evidence for a general point, or a general claim illustrated with a specific anecdote — neither pole clearly dominates.

KEY DISTINCTIONS for Y:
- A vivid personal story (even one that implies a structural problem) scores negative — the speaker is testifying, not arguing.
- A general prescription or observation scores positive — the speaker is making a claim that should hold for others too.
- Felt states ("my phone is my comfort space", "I feel anxious without it") score negative — they describe experience, not a claim.
- "Students should be trusted" or "the law affects everyone" score positive — they assert something general.

IMPORTANT scoring rules:
- Use the full range. Reserve ±0.80–1.00 only for clear extremes. Most quotes sit in ±0.30–0.70.
- Score to 2 decimal places (e.g. 0.35, -0.62).
- Do NOT snap to round numbers (0.0, ±0.5, ±1.0) unless truly warranted.
- Each quote in a batch should have a distinct score — avoid assigning the same value twice.
- X and Y are independent; don't let one pull the other.

${ANCHORS}`;

const USER_TMPL = (excerpts) =>
`Score the following ${excerpts.length} quotes. Return ONLY a JSON array of objects:
[{"id":"h12345","x":-0.43,"y":0.67}, ...]

Quotes:
${excerpts.map((t, i) => `[${i}] id=${t.id} | "${t.text.slice(0, 300)}"`).join("\n\n")}`;

// ── Scoring ───────────────────────────────────────────────────────────────────

async function scoreBatch(tiles) {
    const msg = await anthropic.messages.create({
        model:      "claude-sonnet-4-6",
        max_tokens: 1800,
        system:     SYSTEM,
        messages:   [{ role: "user", content: USER_TMPL(tiles) }],
    });

    const raw = msg.content[0].text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(raw);
}

async function rescoreAll(tiles) {
    const batches = [];
    for (let i = 0; i < tiles.length; i += BATCH_SZ)
        batches.push(tiles.slice(i, i + BATCH_SZ));

    const results = {};
    let idx = 0;

    async function worker() {
        while (idx < batches.length) {
            const bi = idx++;
            const batch = batches[bi];
            console.log(`  Batch ${bi + 1}/${batches.length} (${batch.length} tiles)…`);
            try {
                const scored = await scoreBatch(batch);
                scored.forEach(s => { results[s.id] = { x: s.x, y: s.y }; });
            } catch (err) {
                console.error(`  Batch ${bi + 1} failed: ${err.message} — keeping original scores`);
                batch.forEach(t => { results[t.id] = { x: t.compassX, y: t.compassY }; });
            }
        }
    }

    await Promise.all(Array.from({ length: CONCUR }, worker));
    return results;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
    const data  = JSON.parse(fs.readFileSync(CACHE, "utf8"));
    const tiles = data.tiles;
    console.log(`Loaded ${tiles.length} tiles from cache.`);

    if (DRY_RUN) {
        // Score just the first batch and print distribution stats
        console.log("DRY RUN — scoring first 25 tiles only…");
        const sample = await scoreBatch(tiles.slice(0, 25));
        console.log("Sample scores:");
        sample.forEach(s => {
            const t = tiles.find(t => t.id === s.id);
            console.log(`  ${s.x.toFixed(2)}, ${s.y.toFixed(2)}  |  ${t?.headline?.slice(0,60)}`);
        });
        const xs = sample.map(s => s.x), ys = sample.map(s => s.y);
        console.log(`\nX range: ${Math.min(...xs).toFixed(2)} → ${Math.max(...xs).toFixed(2)}  mean: ${(xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(2)}`);
        console.log(`Y range: ${Math.min(...ys).toFixed(2)} → ${Math.max(...ys).toFixed(2)}  mean: ${(ys.reduce((a,b)=>a+b,0)/ys.length).toFixed(2)}`);
        return;
    }

    console.log(`Scoring all ${tiles.length} tiles in batches of ${BATCH_SZ}…`);
    const scores = await rescoreAll(tiles);

    let updated = 0;
    data.tiles = tiles.map(t => {
        const s = scores[t.id];
        if (!s) return t;
        updated++;
        return { ...t, compassX: s.x, compassY: s.y };
    });

    // Write backup first
    const backup = CACHE.replace(".json", `.backup-${Date.now()}.json`);
    fs.copyFileSync(CACHE, backup);
    console.log(`Backed up original cache to ${path.basename(backup)}`);

    fs.writeFileSync(CACHE, JSON.stringify(data));
    console.log(`Updated ${updated}/${tiles.length} tiles. Cache written.`);

    // Print new distribution stats
    const xs = data.tiles.map(t => t.compassX);
    const ys = data.tiles.map(t => t.compassY);
    const atZeroX = data.tiles.filter(t => t.compassX === 0).length;
    const extremeX = data.tiles.filter(t => Math.abs(t.compassX) > 0.85).length;
    console.log(`\nNew compassX — min: ${Math.min(...xs).toFixed(2)}, max: ${Math.max(...xs).toFixed(2)}, mean: ${(xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(3)}, at 0: ${atZeroX}, extreme: ${extremeX}`);
    console.log(`New compassY — min: ${Math.min(...ys).toFixed(2)}, max: ${Math.max(...ys).toFixed(2)}, mean: ${(ys.reduce((a,b)=>a+b,0)/ys.length).toFixed(3)}`);
})();
