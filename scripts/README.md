# Demo Mode Preprocessing

This directory contains scripts to preprocess a conversation transcript for instant 10-second demo playback.

## Quick Start (Easiest — Drag & Drop)

1. Start the server: `cd server && node server.js`
2. Start the client: `cd client && npm run dev`
3. Open the app and click **DEMO PLAYBACK**
4. Drag in your `.md` transcript file
5. Wait 2-5 minutes while it processes (shows loading indicator)
6. Watch the 10-second flower bloom animation

The app will automatically:
- Parse the markdown
- Run Claude classification on each turn
- Generate the complete graph
- Play the compressed animation

## Alternative: Offline Preprocessing

If you prefer to preprocess offline (to avoid waiting during demos):

```bash
# 1. Parse the markdown transcript into JSON turns
node scripts/parse-transcript.js "Erin Transcript.md" > parsed-turns.json

# 2. Run Claude classification on all turns (takes 2-5 minutes, costs ~$0.50-2)
node scripts/preprocess.js parsed-turns.json

# 3. Demo file is now ready at: client/public/demo-data.json
```

Then drag in the `.json` file for instant playback (no processing delay).

## What Each Script Does

### `parse-transcript.js`
- **Input**: Markdown file with speaker turns (format: speaker name on its own line, followed by their text)
- **Output**: JSON array of `{speaker, text}` objects
- **Fast**: Runs instantly, no API calls

### `preprocess.js`
- **Input**: Parsed turns JSON
- **Output**: `client/public/demo-data.json` (complete graph: nodes, edges, transcripts, questions)
- **Slow**: Runs each turn through Claude classification (~200ms per turn + API time)
- **Cost**: ~$0.50-2 for a 50-minute conversation (80-150 turns)

The preprocessing script uses the exact same classification logic as the live server, so demo mode output is identical to what you'd get from a real session.

## Configuration

Edit these constants in `preprocess.js` to match your session:

```javascript
const QUESTIONS = [
  { id: "q1", fullText: "Your question..." },
  // ...
];

const PARTICIPANTS = ["Erin", "Taylor", "Eva", ...];

const PREAMBLE = "Your facilitator intro text...";
```

## Future: Audio Input with AssemblyAI

To add support for dragging raw audio files:

1. Install AssemblyAI SDK: `npm install assemblyai`
2. Add an audio transcription step before parse-transcript.js
3. AssemblyAI batch API will transcribe + diarize → output markdown
4. Then continue with existing parse → preprocess flow

This would let you skip manual transcription entirely.
