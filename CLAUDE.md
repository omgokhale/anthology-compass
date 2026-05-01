# Anthology Realtime

Cortico conversation catalog visualizer. MIT Media Lab research tool.

## Run

```bash
cd server && node server.js        # port 3001
cd client && npm run dev           # port 5173 (proxies /api → 3001)
```
Load at `http://localhost:5173` with catalog ID `1208`.

## Stack

- **Frontend**: React 19 + D3 v7, Vite — all UI in `client/src/App.jsx`
- **Backend**: Express + Anthropic SDK — `server/server.js`
- **Cache**: `server/cache/1208.json` — 516 pre-baked tiles. **Do not delete** (rebake ~$0.25)
- **Relevance filter**: `server/filter-relevance.js` — adds `relevant: true/false` to each tile via Claude Haiku. Run: `node filter-relevance.js [--dry-run]`. Client skips `relevant: false` tiles at load.

## Active View

Compass only. Flowers/Bubbles/Cards code is preserved but hidden.

- Dots colored by `CLUSTER_COLORS[t.themeCluster]` — never use `t.themeColor` from cache
- Font: Libre Baskerville (Google Fonts, loaded in `client/index.html`)
- Hover → scale up + quote modal. Click → fade others + play audio. P key → reset zoom.

## Do Not

- Delete or overwrite `server/cache/1208.json` without a backup
- Re-score compass without `server/rescore-compass.js` (has calibration anchors)
- Re-generate theme clusters with Claude — Cortico human coding is authoritative
- Add tab bar / legends without user direction
