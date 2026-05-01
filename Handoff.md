# Anthology Realtime — Handoff

_Last updated: 2026-05-01 (session 2). User: ogo@media.mit.edu (MIT Media Lab)_

---

## What This Is

A data visualization tool for Cortico conversation catalogs. Currently displays 516 audio highlights from catalog **1208** ("AMS 2025-26 Student Assembly" — school phone-policy discussion) as interactive dots on a 2-axis compass. Users hover to read transcripts and click to play audio.

Research/presentation tool for MIT Media Lab.

---

## Running Locally

```bash
# Terminal 1 — API server (port 3001)
cd server && node server.js

# Terminal 2 — Vite dev server (port 5173, proxies /api → 3001)
cd client && npm run dev
```

Open `http://localhost:5173`, enter catalog ID `1208`, hit LOAD.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + D3 v7, Vite |
| Backend | Node.js, Express, Anthropic SDK |
| Data | Cortico Researcher API (`/v1/catalogs/:id`) |
| AI | Claude Sonnet — headline generation + compass scoring |

---

## Environment (`server/.env`)

```
ANTHROPIC_API_KEY=...
CORTICO_API_KEY=...   # current key: allow:*:* scope, only catalog 1208 accessible
```

---

## File Structure

```
client/src/
  App.jsx         All UI + D3 — single component (~880 lines)
  data.js         SPEAKER_PALETTE (unused in compass view)

server/
  server.js       Express — Cortico fetch, Claude headline batching, catalog cache
  rescore-compass.js  Re-scores compassX/Y for all tiles via Claude. Run: node rescore-compass.js [--dry-run]
  cache/1208.json Pre-baked catalog cache (516 tiles). DO NOT DELETE — rebaking costs ~$0.25.
  cache/1208.backup-*.json  Backups from rescore runs (safe to delete).
  .env
```

---

## Cache Schema (`server/cache/1208.json`)

```js
{
  catalogId, title, questions, speakers,
  tiles: [{
    id,               // "h{highlight_id}"
    speakerName,
    speakerColor,
    text,             // full transcript
    questionId,       // "q{code_id}"
    headline,         // Claude-generated verbatim quote or tight descriptive
    themeCode,
    themeCodes,
    themeCluster,     // "Learning" | "Safety" | "Wellbeing" | "Autonomy" | "Community" | "Policy" | "Other"
    themeColor,       // stored but NOT used — frontend derives color from CLUSTER_COLORS[themeCluster]
    compassX,         // float in [-1, 1] — Phone as distraction ↔ lifeline
    compassY,         // float in [-1, 1] — Experience ↔ Claim
    audioStartOffset,
    conversationId,
  }]
}
```

### Compass axes
- **X**: Phone as distraction (−1) ↔ Phone as lifeline (+1)
- **Y**: Experience (−1) ↔ Claim (+1)
  - Experience = speaker narrates a specific event / felt state
  - Claim = speaker makes a general assertion about what should be true
- Scored by `rescore-compass.js` using Claude with calibration anchors. Never re-score without it.

---

## Cluster Colors (canonical — CLUSTER_COLORS in App.jsx)

```
Learning:  #65ABF0
Safety:    #FF5F1F
Wellbeing: #F392D1
Autonomy:  #B167CD
Community: #54A96D
Policy:    #E3A023
Other:     #BFA99F
```

Color is always derived client-side from `CLUSTER_COLORS[t.themeCluster]`. The `themeColor` field in the cache is ignored.

---

## Current UI State

**Only the compass view is active.** Flowers, Bubbles, and Cards views have preserved code but are hidden (`view` is hardcoded to `"compass"`).

### Compass view
- Pure white background (`#ffffff`), **Libre Baskerville** throughout (Google Fonts, loaded in `client/index.html`)
- 516 dots, r=6px, colored by `themeCluster`, forceCollide layout. Flat colors, no stroke.
- **Axis lines**: 1px, `vector-effect: non-scaling-stroke` (stays 1px at all zoom levels)
- **Axis pills**: React `<div>` elements tracking zoom transform (clamped to viewport), 20px margins, 13px black
- **Quadrant exemplars**: Fixed in viewport corners, 20px margins, 15px italic Libre Baskerville, 50% opacity
  - Fade to 0 opacity (0.35s ease-out) as soon as zoom > 1 (k > 1). Fade back in when returning to default.
  - NW: "Rules help / everyone focus"
  - NE: "Phones are / structurally essential"
  - SW: "Honestly, I / get pulled by it"
  - SE: "My family / needed me"
- **Zoom**: scaleExtent [1, 6] — cannot zoom out past default. translateExtent locks to data bounds.
- **P key**: smooth animated reset to default zoom/pan (700ms cubic ease).
- **Quote modal**: Fixed bottom-center (`bottom: 68px`), always mounted, opacity-transitions in/out. Shows on hover. 16px quote text, 13px speaker name.

### Interaction model
| Action | Effect |
|---|---|
| Hover node | Scale up (r → 10), show quote modal — no opacity change, no audio |
| Mouse off | Scale back (r → 6), hide quote modal |
| Click node | Fade all other nodes to 12% opacity (no blur) + play audio / pause toggle |
| Click different node | Shift fade to new selection, play new audio |
| Click background | Stop audio, unfade all nodes |
| Press P | Smooth animated zoom reset to default view |

### Audio
- Proxied server-side: `GET /api/audio/highlight/:id` → Cortico audio
- Functions in App.jsx: `startAudio`, `stopAudio`, `clickAudio`
- `playingIdRef` tracks current audio id synchronously; `playingId` state drives renders

---

## Known Issues

1. **~20 tiles (batch 18)** have raw transcript text as headline instead of a generated headline — artifact of a Claude batch failure during the original bake. Low priority.
2. **All changes are uncommitted.** Last commit (`b5b4eff`) predates the compass view, rescore script, and all UI work from this session.

---

## Potential Next Steps

- **Commit current work** — everything since b5b4eff is uncommitted
- **Re-enable other views** (Flowers, Bubbles, Cards) with the current light theme + Libre Baskerville
- **Speaker Portraits view** — group dots by speaker
- **Conversation Timeline view** — dots arranged by time in conversation
- **Search / filter** by speaker or theme cluster
- **Re-bake batch 18** — fix the ~20 tiles with bad headlines
- **Catalog title / session metadata** — surface in the compass UI
- **Tab bar** — currently hidden; may return when multiple views are ready

---

## Design Decisions (do not revert without user input)

- No legends, no tab bar currently
- Speaker name only in hover card — not on tile
- Dots colored by thematic cluster, not speaker
- No re-generation of clusters with Claude — Cortico human coding is authoritative
- Re-baking costs ~$0.25. Don't delete cache.
- Compass scoring must use `rescore-compass.js` with calibration anchors
