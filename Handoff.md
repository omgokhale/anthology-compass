# Conversation Bloom — Handoff (v2)

## What This Is

A conversation visualization tool. Given a Cortico catalog ID, the app fetches pre-curated speaker highlights, generates evocative tile headlines via Claude, and renders a blooming D3 network graph.

Two visualization modes are planned:
- **Flowers** — radial question-cluster layout (built)
- **2×2** — scatter plot on user-defined axes (stub only, axes TBD)

---

## Architecture

```
[Browser]
  → enters Catalog ID on setup screen
  → GET /api/catalog/:id

[Node.js Server]
  → fetches catalog from Cortico API (GET /v1/catalogs/:id)
  → extracts structural codes → questions
  → reconstructs speaker text from word arrays
  → sends batches of 20 highlights to Claude Sonnet for headline generation
  → returns { catalogId, title, questions, tiles, speakers }

[React Frontend]
  → renders Flowers view (D3 radial SVG, zoom, drag, hover overlay)
  → stub: 2×2 view toggle exists but renders placeholder
```

### Tech Stack
- **Frontend**: React 19 + D3 v7, Vite (no Socket.io, no audio)
- **Backend**: Node.js, Express 5, Anthropic SDK
- **Data source**: Cortico Researcher API (`/v1/catalogs/:id`)
- **AI**: Claude Sonnet (`claude-sonnet-4-20250514`) — headline generation only

---

## Running Locally

```bash
# Terminal 1 — server
cd server && node server.js

# Terminal 2 — client
cd client && npm run dev
```

Open `http://localhost:5173`, enter a catalog ID (e.g. `1208`), hit LOAD.

---

## Environment Variables (`server/.env`)

```
ANTHROPIC_API_KEY=...
CORTICO_API_KEY=...   # JWT token from Cortico Researcher API
```

---

## Cortico API

**Base URL**: `https://api.cortico.ai`
**Auth**: Bearer token (JWT)
**Rate limit**: 120 req/min

### Key endpoint used
```
GET /v1/catalogs/:id
```
Returns a catalog object with `catalog_entries` embedded (up to 660+ entries).

### Catalog entry shape
```js
{
  id: number,
  primary_participant_name: string,   // speaker
  highlight: {
    id: number,
    conversation_id: number,
    audio_start_offset: number,
    snippets: [{
      speaker_name: string,
      words: [{ word, start, end, confidence }],  // reconstruct text by joining words
    }]
  },
  codes: [
    { code_type: "structural", id, name, description },  // → which question
    { code_type: "thematic",   id, name, description },  // → topic tags (NOT used as headlines)
  ]
}
```

### Important: structural codes = questions
`code_type: "structural"` entries map each highlight to a facilitator question. `name` is the short form, `description` is the full question text. These become the question nodes.

### Thematic codes are NOT tile headlines
Thematic codes (e.g. "Better focus & grades") are broad repeated tags, not specific to individual excerpts. Claude generates tile headlines from the raw spoken text instead.

---

## Data Model (server → client)

```js
// Server response shape
{
  catalogId: number,
  title: string,
  questions: [{ id: "q{code_id}", text: string, fullText: string }],
  tiles: [{
    id: "h{highlight_id}",
    speakerName: string,
    speakerColor: string,    // from SPEAKER_PALETTE, assigned in order of first appearance
    headline: string,        // Claude-generated verbatim quote or tight descriptive
    text: string,            // full reconstructed spoken text (for hover overlay)
    questionId: string,      // which question node this belongs to
    audioStartOffset: number,
    conversationId: number,
  }],
  speakers: [{ name, color }]
}

// Client maps tiles to D3 shape:
{ id, qId, sp, color, sum (=headline), transcript (=text) }
```

---

## Claude Prompt (headline generation)

Batches of 20 highlights sent per request. Key rules:
- **Verbatim quote** (strongly preferred): most vivid phrase, exactly as spoken, in quotation marks, 4–10 words
- **Descriptive** (last resort): 4–7 words, no quotes, no first-person pronouns
- Must be specific to the excerpt — never a generic topic label
- Returns JSON array of strings

---

## Visualization Design

### Flowers layout
- Questions on a ring (radius 950px from world origin)
- Responses orbit each question in full 360° rings (6 per ring, overflow to outer ring)
- Positions are deterministic — no force simulation
- D3 zoom on inner `<g>`, world origin = (0,0), initial transform centers it
- Clicking a question button in the nav bar triggers a smooth zoom-to-focus (3.8s ease)
- Nodes: blur-dissolve in over 3.2s, edges draw in over 2.4s
- Nodes are draggable; edges update live

### Visual style
- Background: `#050508`
- Question nodes: dark fill, "QUESTION" label, serif body text (Hedvig Letters Serif)
- Response nodes: pastel fill derived from speaker color, sans-serif text (Hedvig Letters Sans)
- Text color on tiles: `richDark()` — derives a dark hue-matched color from the pastel
- Hover: transcript overlay, semi-transparent dark bg, speaker-colored border

---

## File Structure

```
client/
  src/
    App.jsx       Main component — all D3 rendering and UI (~330 lines)
    data.js       SPEAKER_PALETTE constant only
    main.jsx      React entry point
    index.css     Minimal global styles
  public/
    audio-worklet-processor.js  (vestige — safe to delete)
  index.html

server/
  server.js       Express server — Cortico fetch + Claude batch (~120 lines)
  package.json
  .env            ANTHROPIC_API_KEY, CORTICO_API_KEY

scripts/          (vestige of real-time era — safe to delete)
```

---

## What's Built vs. What's Next

### Built ✅
- Cortico catalog ingestion (`GET /v1/catalogs/:id`)
- Claude headline generation (batched, parallel, with fallback)
- Flowers visualization (questions + tiles, zoom, drag, hover)
- Speaker color assignment
- Question nav bar (click to zoom-focus)
- View toggle (Flowers / 2×2)

### Next 🔨
- **2×2 view**: axes TBD by user. The data is already loaded in `tiles` — just needs a scatter layout renderer in `App.jsx` when `mode === "2x2"`. Each axis will be a scored dimension per tile (score generation via Claude or manual coding).
- **Animation bug**: mock playback ticked nodes in one at a time (now irrelevant since mock mode is removed). The Flowers view currently reveals all tiles at once on load — could add a staged reveal if desired.
- **Catalog access**: conversation 8596 (AI ethics, CCNY/FRONTLINE) returns 404 from the current API key. The key's org scope covers catalogs like 1208. A new key with access to the target org/collection would unlock it.
- **Vestige cleanup**: `client/public/audio-worklet-processor.js` and `scripts/` can be deleted.
- **Persistent caching**: server re-fetches and re-runs Claude on every load. A simple file-based or SQLite cache of `catalogId → processed result` would make repeat loads instant.

---

## Known Issues / Decisions

1. **Catalog limit capped at 120**: `server.js` slices to 120 entries by default (`?limit=N` overrides). Full 660-entry catalogs work but take ~30–45s due to Claude batching. Tune as needed.
2. **Speaker names may be pseudonymous**: Cortico anonymizes some participants (e.g. "T", "Student A"). Headlines and hover text still work fine.
3. **No question-to-question ordering**: Questions are displayed in the order they appear in structural codes, not the order they were asked. The Cortico API doesn't expose question sequence directly.
4. **`cors` was previously an undeclared dep**: now explicit in `server/package.json`.
