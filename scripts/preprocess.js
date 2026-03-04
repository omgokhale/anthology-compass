#!/usr/bin/env node
/**
 * preprocess.js
 *
 * Offline preprocessing script that takes parsed speaker turns and runs them
 * through the same Claude classification pipeline as the live server, then
 * outputs a complete demo-data.json file for instant playback.
 *
 * Usage:
 *   node scripts/preprocess.js parsed-turns.json
 *
 * Output:
 *   client/public/demo-data.json
 */

require("dotenv").config({ path: require("path").join(__dirname, "../server/.env") });
const fs = require("fs");
const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Configuration ──────────────────────────────────────────────────────────
// Update these to match your session configuration
const QUESTIONS = [
  {
    id: "q1",
    fullText: "Please share your first name or a pseudonym and a value that's really important to you, like fairness, creativity, or curiosity and how that connects to your feelings about AI.",
  },
  {
    id: "q2",
    fullText: "Take a moment to think about a time when you or someone you know used AI in a way that did not feel right to you. What happened and how did this experience impact you?",
  },
  {
    id: "q3",
    fullText: "Imagine it is five years from now. How do you see AI being part of society? And what ethical questions or challenges do you think will matter most?",
  },
  {
    id: "q4",
    fullText: "What is a question that you wish more people were asking about AI?",
  },
];

const PARTICIPANTS = [
  "Erin", "Taylor", "Meribel", "Eva", "Aleks", "Asha", "Ian", "Lydia",
];

const PREAMBLE = `I have begun recording at this time and I'm going to share some information before we begin our conversation. Welcome to this conversation, part of the Youth Civic Voices Initiative led by Cortico, the MIT center for Constructive Communication, and Frontline, with the goal of engaging, emerging with goal of engaging young people in civic dialogue through journalistic storytelling, emerging technologies, and public conversations.`;

const SPEAKER_PALETTE = [
  "#f4b8c1", "#c3aed6", "#f9e4b7", "#b5ead7",
  "#f8c8dc", "#c7ceea", "#ffd3b6", "#a8d8ea",
];

// ── Filler filter ──────────────────────────────────────────────────────────
const FILLER = new Set([
  "yeah", "yes", "yep", "no", "nope", "okay", "ok", "oh",
  "um", "uh", "hmm", "mm", "mhm", "right", "sure",
  "thanks", "thank you", "hello", "hi", "hey",
  "i agree", "i guess", "you know", "like",
]);

function isSubstantive(text) {
  const clean = text.trim().toLowerCase().replace(/[.,!?]/g, "");
  if (clean.split(/\s+/).length < 6) return false;
  if (FILLER.has(clean)) return false;
  return true;
}

// ── Preamble filter ────────────────────────────────────────────────────────
const PREAMBLE_STOP = new Set([
  "about", "after", "agree", "also", "always", "before", "being", "between",
  "change", "could", "during", "every", "first", "going", "have", "help",
  "into", "just", "know", "like", "make", "more", "need", "okay", "other",
  "people", "please", "right", "share", "some", "speak", "take", "that",
  "their", "there", "these", "they", "think", "this", "time", "today",
  "understand", "want", "well", "what", "when", "where", "which", "while",
  "with", "would", "your",
]);

function isPreamble(transcript) {
  if (!PREAMBLE || !transcript) return false;
  const sig = w => w.length > 3 && !PREAMBLE_STOP.has(w);
  const preambleWords = new Set(PREAMBLE.toLowerCase().split(/\W+/).filter(sig));
  const txWords = transcript.toLowerCase().split(/\W+/).filter(sig);
  if (txWords.length < 4) return false;
  const overlap = txWords.filter(w => preambleWords.has(w)).length;
  const ratio = overlap / txWords.length;
  return ratio > 0.35;
}

// ── Claude Classification ──────────────────────────────────────────────────
async function classifyTurn(transcript, speakerLabel, context) {
  const questionsContext = QUESTIONS.map(q => `${q.id}: ${q.fullText}`).join("\n");
  const recentContext = context.recentTurns.slice(-8)
    .map(t => `[${t.speaker}] ${t.text.slice(0, 150)}`)
    .join("\n");
  const existingNodes = context.nodes.slice(-15)
    .map(n => `${n.id} (${n.type}, q:${n.questionId}, speaker:${n.speakerId}): ${n.summary}`)
    .join("\n");
  const identifiedSpeakers = Object.entries(context.speakers)
    .map(([label, info]) => `${label} = ${info.name}`)
    .join("\n") || "none yet";

  const prompt = `You are classifying a speaker turn from a live conversation.

PRE-LOADED QUESTIONS:
${questionsContext}

RECENT CONVERSATION:
${recentContext}

EXISTING NODES:
${existingNodes}

CURRENT ACTIVE QUESTION: ${context.currentQuestionId || "none yet"}

EXPECTED PARTICIPANTS: ${PARTICIPANTS.join(", ")}

ALREADY IDENTIFIED SPEAKERS:
${identifiedSpeakers}

FACILITATOR: ${PARTICIPANTS[0]} (first listed participant)

NEW SPEAKER TURN:
Speaker: ${speakerLabel}
Text: "${transcript}"

Classify this turn. Respond with ONLY a JSON object:
{
  "isOffTopic": false,
  "isQuestion": false,
  "matchedQuestionId": "q1",
  "questionSummary": null,
  "speakerName": null,
  "nodes": [
    { "parentNodeId": "q1", "summary": "first rich idea" },
    { "parentNodeId": "prev", "summary": "second rich idea" }
  ]
}

Rules:
- isOffTopic: true if the turn is genuinely off-topic — personal logistics, jet-lag, side chatter, or anything unrelated to the discussion questions. No visualization nodes will be created. If true, set nodes to [].
- isQuestion: true only if the FACILITATOR (${PARTICIPANTS[0]}) is asking one of the pre-loaded questions — never true for other participants
- matchedQuestionId: which question this responds to (or IS, if isQuestion)
- questionSummary: If isQuestion is true, rewrite the facilitator's question as a single concise sentence that accurately captures the core ask — remove preamble, filler, and context-setting. Always phrase it as a direct question ending with "?". If isQuestion is false, return null.
- speakerName: Only attempt if ${speakerLabel} is NOT in ALREADY IDENTIFIED SPEAKERS. If the speaker introduces themselves, fuzzy-match against EXPECTED PARTICIPANTS (handle transcription errors). Return the matched name, or null if already identified or no introduction found.
- nodes: array of 1–3 objects, one per distinct substantive idea in this turn. Only split when each fragment is rich enough to stand alone as its own tile — aim for 2–3 genuinely different ideas, not many small ones. If the turn expresses one idea, return a single-element array.
  - parentNodeId: which node this idea most directly responds to. Usually the current question node (e.g. "q1"). Use "prev" if this idea builds on or continues the previous node in this same array. Can reference another speaker's response node ID if the speaker explicitly builds on their point.
  - summary: 4–10 words per the two-mode rule:
    (A) VERBATIM QUOTE (strongly preferred): Lift the most vivid, telling phrase exactly as spoken and wrap it in quotation marks. Preserve all pronouns ("I", "you", "it just") and personal detail. A longer quote with emotional texture beats a shorter sanitized one. Example: "I fully used AI to cheat on a paper" or "it just feels weird to have working code you didn't write".
    (B) DESCRIPTIVE TITLE (last resort only): Write a clean 4–7 word descriptive phrase. NO quotation marks. NO first-person pronouns (not "I", not "you", not "my"). Capitalize the first word. No punctuation at the end.
- Facilitator self-answer: if isQuestion is true AND the facilitator immediately begins answering their own question, also include their answer as a node in the nodes array with parentNodeId set to matchedQuestionId.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const cleaned = text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Claude classification error:", err);
    return {
      isOffTopic: false,
      isQuestion: false,
      matchedQuestionId: context.currentQuestionId || "q1",
      questionSummary: null,
      speakerName: null,
      nodes: [{
        parentNodeId: context.currentQuestionId || "q1",
        summary: transcript.slice(0, 40) + "…",
      }],
    };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node preprocess.js <parsed-turns.json>");
    process.exit(1);
  }

  const turns = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
  console.log(`Processing ${turns.length} turns...`);

  const context = {
    speakers: {},
    nodes: [],
    edges: [],
    recentTurns: [],
    currentQuestionId: null,
    nodeCounter: 0,
  };

  const transcripts = {};
  let colorIndex = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    console.log(`[${i + 1}/${turns.length}] ${turn.speaker}: "${turn.text.slice(0, 60)}..."`);

    // Filter non-substantive and preamble
    if (!isSubstantive(turn.text)) {
      console.log("  → filtered (non-substantive)");
      continue;
    }
    if (isPreamble(turn.text)) {
      console.log("  → filtered (preamble)");
      continue;
    }

    // Track recent turns
    context.recentTurns.push({ speaker: turn.speaker, text: turn.text });
    if (context.recentTurns.length > 15) context.recentTurns.shift();

    // Classify
    const result = await classifyTurn(turn.text, turn.speaker, context);

    // Identify speaker
    if (result.speakerName && !context.speakers[turn.speaker]) {
      context.speakers[turn.speaker] = {
        name: result.speakerName,
        color: SPEAKER_PALETTE[colorIndex++ % SPEAKER_PALETTE.length],
      };
      console.log(`  → identified: ${turn.speaker} = ${result.speakerName}`);
    }

    // Handle facilitator identification via question detection
    if (result.isQuestion && PARTICIPANTS[0] && !context.speakers[turn.speaker]) {
      context.speakers[turn.speaker] = {
        name: PARTICIPANTS[0],
        color: SPEAKER_PALETTE[colorIndex++ % SPEAKER_PALETTE.length],
      };
      console.log(`  → facilitator identified: ${turn.speaker} = ${PARTICIPANTS[0]}`);
    }

    const speakerInfo = context.speakers[turn.speaker] || {
      name: turn.speaker,
      color: SPEAKER_PALETTE[colorIndex++ % SPEAKER_PALETTE.length],
    };

    if (result.isQuestion) {
      context.currentQuestionId = result.matchedQuestionId;
      if (!context.nodes.find(n => n.id === result.matchedQuestionId)) {
        context.nodes.push({
          id: result.matchedQuestionId,
          type: "question",
          questionId: result.matchedQuestionId,
        });
        console.log(`  → question node: ${result.matchedQuestionId}`);
      }
    }

    // Emit response nodes
    if (!result.isOffTopic && Array.isArray(result.nodes) && result.nodes.length > 0) {
      const qId = result.matchedQuestionId || context.currentQuestionId || "q1";
      let prevNodeId = null;

      for (const nodeSpec of result.nodes) {
        let parentId = nodeSpec.parentNodeId === "prev"
          ? (prevNodeId || qId)
          : (nodeSpec.parentNodeId || qId);

        if (!parentId.startsWith("q") && !context.nodes.find(n => n.id === parentId)) {
          parentId = qId;
        }

        const nodeId = `r${++context.nodeCounter}`;
        const node = {
          id: nodeId,
          type: "response",
          questionId: qId,
          speakerId: turn.speaker,
          speakerName: speakerInfo.name,
          speakerColor: speakerInfo.color,
          summary: nodeSpec.summary,
          timestamp: Date.now() + i * 1000,
        };
        context.nodes.push(node);
        transcripts[nodeId] = turn.text;

        const primaryEdge = {
          source: parentId,
          target: nodeId,
          type: parentId.startsWith("q") ? "qr" : "rr",
        };
        context.edges.push(primaryEdge);

        if (!parentId.startsWith("q")) {
          const secondaryEdge = { source: qId, target: nodeId, type: "qr", secondary: true };
          context.edges.push(secondaryEdge);
        }

        prevNodeId = nodeId;
        console.log(`  → node: ${nodeId} "${nodeSpec.summary}"`);
      }
    } else if (result.isOffTopic) {
      console.log("  → off-topic (no nodes)");
    }

    // Rate limit to avoid hitting Claude API too hard
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  // Build output
  const output = {
    nodes: context.nodes,
    edges: context.edges,
    transcripts,
    questions: QUESTIONS,
  };

  const outPath = require("path").join(__dirname, "../client/public/demo-data.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\n✓ Wrote ${context.nodes.length} nodes to ${outPath}`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
