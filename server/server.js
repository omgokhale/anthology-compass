require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
app.use(cors()); // Enable CORS for all routes
app.use(express.json({ limit: "10mb" })); // for markdown upload
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Session State ──────────────────────────────────────────────────────────
let session = {
    questions: [],
    participants: [],     // expected participant names for speaker identification
    facilitatorName: "",  // participants[0] — the person running the session
    speakers: {},         // diarizationLabel -> { name, color }
    nodes: [],
    edges: [],
    recentTurns: [],      // last N turns for context
    nodeCounter: 0,
    currentQuestionId: null,
    preamble: "",         // facilitator intro text to exclude from visualization
};

const SPEAKER_PALETTE = [
    "#f4b8c1", "#c3aed6", "#f9e4b7", "#b5ead7",
    "#f8c8dc", "#c7ceea", "#ffd3b6", "#a8d8ea",
];
let colorIndex = 0;

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

// ── Preamble / intro filter ─────────────────────────────────────────────────
// Common words that appear in both preamble and normal conversation — excluded
// from the overlap calculation to avoid false positives.
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
    if (!session.preamble || !transcript) return false;
    const sig = w => w.length > 3 && !PREAMBLE_STOP.has(w);
    const preambleWords = new Set(session.preamble.toLowerCase().split(/\W+/).filter(sig));
    const txWords = transcript.toLowerCase().split(/\W+/).filter(sig);
    if (txWords.length < 4) return false;
    const overlap = txWords.filter(w => preambleWords.has(w)).length;
    const ratio = overlap / txWords.length;
    if (ratio > 0.35) {
        console.log(`[PREAMBLE] Filtered (${Math.round(ratio * 100)}% overlap): "${transcript.slice(0, 60)}…"`);
        return true;
    }
    return false;
}

// ── Claude Classification ──────────────────────────────────────────────────
async function classifyTurn(transcript, speakerLabel) {
    const questionsContext = session.questions
        .map(q => `${q.id}: ${q.fullText}`)
        .join("\n");

    const recentContext = session.recentTurns.slice(-8)
        .map(t => `[${t.speaker}] ${t.text.slice(0, 150)}`)
        .join("\n");

    const existingNodes = session.nodes.slice(-15)
        .map(n => `${n.id} (${n.type}, q:${n.questionId}, speaker:${n.speakerId}): ${n.summary}`)
        .join("\n");

    const identifiedSpeakers = Object.entries(session.speakers)
        .map(([label, info]) => `${label} = ${info.name}`)
        .join("\n") || "none yet";

    const prompt = `You are classifying a speaker turn from a live conversation.

PRE-LOADED QUESTIONS:
${questionsContext}

RECENT CONVERSATION:
${recentContext}

EXISTING NODES:
${existingNodes}

CURRENT ACTIVE QUESTION: ${session.currentQuestionId || "none yet"}

EXPECTED PARTICIPANTS: ${session.participants.length ? session.participants.join(", ") : "unknown"}

ALREADY IDENTIFIED SPEAKERS:
${identifiedSpeakers}

FACILITATOR: ${session.facilitatorName || "unknown (first listed participant)"}

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
- isQuestion: true only if the FACILITATOR (${session.facilitatorName || "first listed participant"}) is asking one of the pre-loaded questions — never true for other participants
- matchedQuestionId: which question this responds to (or IS, if isQuestion)
- questionSummary: If isQuestion is true, rewrite the facilitator's question as a SHORT, DIRECT question (ideally 6-12 words max) that captures ONLY the core ask. Strip ALL preamble, filler, context-setting, and explanatory language. Always phrase it as a direct question ending with "?". Prioritize brevity and clarity. If isQuestion is false, return null.
- speakerName: Only attempt if ${speakerLabel} is NOT in ALREADY IDENTIFIED SPEAKERS. If the speaker introduces themselves, fuzzy-match against EXPECTED PARTICIPANTS (handle transcription errors: "Tyrese"→"Tyriz", "Emmanuel"→"Emmanuella", "Sydney"→"Sidney", "Taylor"→"Tayler B.D"). Return the matched name, or null if already identified or no introduction found.
- nodes: array of 1–3 objects, one per distinct substantive idea in this turn. Only split when each fragment is rich enough to stand alone as its own tile — aim for 2–3 genuinely different ideas, not many small ones. If the turn expresses one idea, return a single-element array.
  - parentNodeId: DEFAULT to the current question node (e.g. "q1") unless there is an EXPLICIT verbal reference. Use "prev" ONLY if this idea is a direct continuation of the previous node in this same array (same speaker, same thought). Reference another speaker's response node ID (like "r5") ONLY if the speaker says their name ("like Taylor said...") or explicitly refers to their specific point ("I agree with that robotics example..."). Thematic similarity, general agreement, or building on the same topic is NOT enough — stick to the question.
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
        // Fallback: attach to current question with raw transcript
        return {
            isOffTopic: false,
            isQuestion: false,
            matchedQuestionId: session.currentQuestionId || "q1",
            questionSummary: null,
            speakerName: null,
            nodes: [{
                parentNodeId: session.currentQuestionId || "q1",
                summary: transcript.slice(0, 40) + "…",
            }],
        };
    }
}

// ── Process a completed speaker turn ──────────────────────────────────────
async function processTurn(transcript, speakerLabel) {
    if (!isSubstantive(transcript)) {
        console.log(`[FILTERED] "${transcript.slice(0, 50)}"`);
        return;
    }
    if (isPreamble(transcript)) return;

    // Track recent turns for context
    session.recentTurns.push({ speaker: speakerLabel, text: transcript });
    if (session.recentTurns.length > 15) session.recentTurns.shift();

    const result = await classifyTurn(transcript, speakerLabel);

    // Ensure every speaker gets assigned exactly one color (do this first)
    if (!session.speakers[speakerLabel]) {
        session.speakers[speakerLabel] = {
            name: speakerLabel,
            color: SPEAKER_PALETTE[colorIndex++ % SPEAKER_PALETTE.length],
        };
    }

    // Map diarization label (e.g. "Speaker 0") to a named speaker once identified.
    // Deepgram gives stable labels per session, so the same label = same physical person.
    if (result.speakerName && session.speakers[speakerLabel].name === speakerLabel) {
        // Update the generic label with the identified name
        session.speakers[speakerLabel].name = result.speakerName;
        io.emit("speaker_identified", {
            label: speakerLabel,
            ...session.speakers[speakerLabel],
        });
    }

    const speakerInfo = session.speakers[speakerLabel];

    if (result.isQuestion) {
        // The facilitator is the only one who asks questions — use this turn to identify their label
        if (session.facilitatorName && session.speakers[speakerLabel].name === speakerLabel) {
            // Update the generic label with the actual facilitator name
            session.speakers[speakerLabel].name = session.facilitatorName;
            io.emit("speaker_identified", {
                label: speakerLabel,
                ...session.speakers[speakerLabel],
            });
            console.log(`[FACILITATOR] Identified ${speakerLabel} as "${session.facilitatorName}" via question detection`);
        }

        // Facilitator is asking a pre-loaded question
        session.currentQuestionId = result.matchedQuestionId;
        // Only emit if we haven't already emitted this question
        if (!session.nodes.find(n => n.id === result.matchedQuestionId)) {
            session.nodes.push({
                id: result.matchedQuestionId,
                type: "question",
                questionId: result.matchedQuestionId,
            });
            io.emit("new_node", { type: "question", id: result.matchedQuestionId, text: result.questionSummary || null });
        }
    }

    // Emit response nodes (skip if off-topic or empty nodes array)
    if (!result.isOffTopic && Array.isArray(result.nodes) && result.nodes.length > 0) {
        const qId = result.matchedQuestionId || session.currentQuestionId || "q1";
        let prevNodeId = null;

        for (const nodeSpec of result.nodes) {
            // Resolve "prev" → the most recently created node in this turn
            let parentId = nodeSpec.parentNodeId === "prev"
                ? (prevNodeId || qId)
                : (nodeSpec.parentNodeId || qId);

            // Safety: if the referenced parent doesn't exist in session, fall back to question
            if (!parentId.startsWith("q") && !session.nodes.find(n => n.id === parentId)) {
                parentId = qId;
            }

            const nodeId = `r${++session.nodeCounter}`;
            // Clean up any unicode escapes or actual curly quotes
            const cleanSummary = nodeSpec.summary
                .replace(/\\u201c/g, '"')
                .replace(/\\u201d/g, '"')
                .replace(/\\u2018/g, "'")
                .replace(/\\u2019/g, "'")
                .replace(/"/g, '"')  // actual curly quotes
                .replace(/"/g, '"')
                .replace(/'/g, "'")
                .replace(/'/g, "'");
            const node = {
                id: nodeId,
                type: "response",
                questionId: qId,
                speakerId: speakerLabel,
                speakerName: speakerInfo.name,
                speakerColor: speakerInfo.color,
                summary: cleanSummary,
                transcript: transcript,
                parentId,
                timestamp: Date.now(),
            };
            session.nodes.push(node);

            // Primary edge: to direct parent
            const primaryEdge = {
                source: parentId,
                target: nodeId,
                type: parentId.startsWith("q") ? "qr" : "rr",
            };
            session.edges.push(primaryEdge);

            io.emit("new_node", {
                type: "response",
                id: nodeId,
                qId,
                sp: speakerInfo.name,
                color: speakerInfo.color,
                sum: nodeSpec.summary,
                transcript: transcript,
                pid: parentId.startsWith("r") ? parentId : undefined,
            });
            io.emit("new_edge", primaryEdge);

            // Secondary qr edge: chained nodes (parent is a response) also anchor to the question cluster
            if (!parentId.startsWith("q")) {
                const secondaryEdge = { source: qId, target: nodeId, type: "qr", secondary: true };
                session.edges.push(secondaryEdge);
                io.emit("new_edge", secondaryEdge);
            }

            prevNodeId = nodeId;
            console.log(`[NODE] ${speakerInfo.name}: "${nodeSpec.summary}"`);
        }
    } else if (result.isOffTopic) {
        console.log(`[OFF-TOPIC] "${transcript.slice(0, 60)}"`);
    }
}

// ── Deepgram Real-Time Streaming ───────────────────────────────────────────
let transcriber = null;

async function startTranscription() {
    return new Promise((resolve, reject) => {
        const conn = deepgram.listen.live({
            model: "nova-2",  // nova-2 has better diarization support
            language: "en-US",
            encoding: "linear16",
            sample_rate: 16000,
            smart_format: true,
            diarize: true,
            punctuate: true,
            interim_results: true,
            endpointing: 1000,        // ms of silence before speech_final — reduces over-splitting
            utterance_end_ms: 3000,   // ms of silence to fire UtteranceEnd (full turn boundary)
            keep_alive: true,         // Keep connection alive
        });

        // Per-utterance buffers — flushed on UtteranceEnd
        let utteranceText = "";
        let utteranceWords = [];

        // Reset synchronously before any await so double-flush is a no-op
        async function flushUtterance() {
            if (!utteranceText.trim()) return;
            const text = utteranceText.trim();
            const words = utteranceWords.slice();
            utteranceText = "";
            utteranceWords = [];

            // Count speakers from word-level labels
            const counts = {};
            words.forEach(w => {
                const s = `Speaker ${w.speaker ?? 0}`;
                counts[s] = (counts[s] || 0) + 1;
            });
            const speakerLabel = Object.entries(counts)
                .sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Speaker 0";

            await processTurn(text, speakerLabel);
        }

        conn.on(LiveTranscriptionEvents.Open, () => {
            transcriber = conn;

            conn.on(LiveTranscriptionEvents.Transcript, (data) => {
                const alt = data.channel?.alternatives?.[0];
                if (!alt) return;

                if (data.is_final && alt.transcript) {
                    const words = alt.words || [];

                    // Debug: log full word structure to understand what Deepgram returns
                    if (words.length > 0 && words.length < 3) {
                        console.log(`[DIARIZATION DEBUG] Word object:`, JSON.stringify(words[0], null, 2));
                    }

                    utteranceText += (utteranceText ? " " : "") + alt.transcript;
                    utteranceWords.push(...words);
                }

                // Stream live captions: committed text + current interim
                const interim = !data.is_final ? alt.transcript : "";
                const captionText = [utteranceText, interim].filter(Boolean).join(" ").trim();
                io.emit("caption", { text: captionText });
            });

            // UtteranceEnd fires after utterance_end_ms of silence — a full speaker turn
            conn.on(LiveTranscriptionEvents.UtteranceEnd, async () => {
                io.emit("caption", { text: "" });
                try {
                    await flushUtterance();
                } catch (err) {
                    console.error("flushUtterance error:", err);
                }
            });

            conn.on(LiveTranscriptionEvents.Error, (err) => {
                console.error("Deepgram error:", err);
                io.emit("pipeline_status", { status: "error", message: err.message });
            });

            conn.on(LiveTranscriptionEvents.Warning, (warning) => {
                console.warn("Deepgram warning:", warning);
            });

            conn.on(LiveTranscriptionEvents.Close, (event) => {
                console.log("Deepgram connection closed. Code:", event?.code, "Reason:", event?.reason);
                io.emit("pipeline_status", { status: "disconnected" });
            });

            console.log("Deepgram real-time connected");
            io.emit("pipeline_status", { status: "connected" });
            resolve();
        });

        conn.on(LiveTranscriptionEvents.Error, (err) => {
            if (!transcriber) reject(err);
        });
    });
}

// ── WebSocket: handle clients ──────────────────────────────────────────────
io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Send current session state to newly connected client
    socket.emit("session_state", {
        nodes: session.nodes,
        edges: session.edges,
        currentQuestionId: session.currentQuestionId,
    });

    socket.on("configure_session", (data) => {
        if (transcriber) {
            try { transcriber.finish(); } catch (_) {}
            transcriber = null;
        }
        session.questions = data.questions;
        session.participants = data.participants || [];
        session.facilitatorName = session.participants[0] || "";
        session.preamble = data.preamble || "";
        session.speakers = {};
        session.nodes = [];
        session.edges = [];
        session.recentTurns = [];
        session.nodeCounter = 0;
        session.currentQuestionId = null;
        colorIndex = 0;
        console.log(`Session configured: ${data.questions.length} questions`);
    });

    socket.on("start_listening", async () => {
        // Clean up any existing connection before starting a new one
        if (transcriber) {
            try { transcriber.finish(); } catch (_) {}
            transcriber = null;
        }
        try {
            await startTranscription();
        } catch (err) {
            console.error("Failed to start transcription:", err);
            io.emit("pipeline_status", { status: "error", message: err.message });
        }
    });

    socket.on("audio_data", (data) => {
        if (transcriber) {
            try {
                transcriber.send(data);
            } catch (_) {
                // Drop frames that arrive before the WebSocket is fully open
            }
        }
    });

    socket.on("stop_listening", async () => {
        if (transcriber) {
            transcriber.finish();
            transcriber = null;
        }
        io.emit("pipeline_status", { status: "stopped" });
    });

    socket.on("update_speaker", (data) => {
        const { nodeId, newSpeaker } = data;

        // Find the node in session and update its speaker
        const node = session.nodes.find(n => n.id === nodeId);
        if (node) {
            const speakerInfo = Object.values(session.speakers).find(s => s.name === newSpeaker);
            if (speakerInfo) {
                node.sp = newSpeaker;
                node.color = speakerInfo.color;

                // Broadcast the update to all clients
                io.emit("speaker_updated", { nodeId, speaker: newSpeaker, color: speakerInfo.color });
                console.log(`Updated node ${nodeId} speaker to ${newSpeaker}`);
            }
        }
    });

    socket.on("disconnect", () => {
        console.log("Client disconnected:", socket.id);
    });
});

// ── Health check ───────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true, nodes: session.nodes.length }));

// ── Demo preprocessing endpoint ────────────────────────────────────────────
app.post("/preprocess-demo", async (req, res) => {
    const { markdown, questions, participants, preamble } = req.body;

    if (!markdown) {
        return res.status(400).json({ error: "markdown is required" });
    }

    try {
        // Parse markdown into turns
        const lines = markdown.split("\n");
        const turns = [];
        let currentSpeaker = null;
        let currentText = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                if (currentSpeaker && currentText.length > 0) {
                    turns.push({ speaker: currentSpeaker, text: currentText.join(" ").trim() });
                    currentSpeaker = null;
                    currentText = [];
                }
                continue;
            }
            if (trimmed.match(/^(Fascilitator|Facilitator):/i)) continue;

            const isSpeakerName = trimmed.length < 25 && !trimmed.match(/[.!?]$/) && !currentText.length;
            if (isSpeakerName) {
                if (currentSpeaker && currentText.length > 0) {
                    turns.push({ speaker: currentSpeaker, text: currentText.join(" ").trim() });
                    currentText = [];
                }
                currentSpeaker = trimmed;
            } else {
                currentText.push(trimmed);
            }
        }
        if (currentSpeaker && currentText.length > 0) {
            turns.push({ speaker: currentSpeaker, text: currentText.join(" ").trim() });
        }

        console.log(`[DEMO] Processing ${turns.length} turns...`);

        // Preprocess with Claude classification
        const context = {
            questions,
            participants: participants || [],
            facilitatorName: (participants || [])[0] || "",
            preamble: preamble || "",
            speakers: {},
            nodes: [],
            edges: [],
            recentTurns: [],
            currentQuestionId: null,
            nodeCounter: 0,
        };

        const transcripts = {};
        let localColorIndex = 0;

        for (let i = 0; i < turns.length; i++) {
            const turn = turns[i];

            if (!isSubstantive(turn.text)) continue;
            if (isPreamble(turn.text)) continue;

            context.recentTurns.push({ speaker: turn.speaker, text: turn.text });
            if (context.recentTurns.length > 15) context.recentTurns.shift();

            // Build classification context matching live mode structure
            const classifyContext = {
                questions,
                participants: context.participants,
                facilitatorName: context.facilitatorName,
                preamble: context.preamble,
                speakers: context.speakers,
                nodes: context.nodes,
                recentTurns: context.recentTurns,
                currentQuestionId: context.currentQuestionId,
            };

            // Note: classifyTurn uses session global, so temporarily override it
            const savedSession = { ...session };
            Object.assign(session, classifyContext);
            const result = await classifyTurn(turn.text, turn.speaker);
            Object.assign(session, savedSession);

            // Ensure every speaker gets assigned exactly one color (do this first)
            if (!context.speakers[turn.speaker]) {
                context.speakers[turn.speaker] = {
                    name: turn.speaker,
                    color: SPEAKER_PALETTE[localColorIndex++ % SPEAKER_PALETTE.length],
                };
            }

            // Update with identified name if found
            if (result.speakerName && context.speakers[turn.speaker].name === turn.speaker) {
                context.speakers[turn.speaker].name = result.speakerName;
            }

            // Facilitator identification via question detection
            if (result.isQuestion && context.facilitatorName && context.speakers[turn.speaker].name === turn.speaker) {
                context.speakers[turn.speaker].name = context.facilitatorName;
            }

            const speakerInfo = context.speakers[turn.speaker];

            if (result.isQuestion) {
                context.currentQuestionId = result.matchedQuestionId;
                if (!context.nodes.find(n => n.id === result.matchedQuestionId)) {
                    context.nodes.push({
                        id: result.matchedQuestionId,
                        type: "question",
                        questionId: result.matchedQuestionId,
                    });
                }
            }

            if (!result.isOffTopic && Array.isArray(result.nodes) && result.nodes.length > 0) {
                const qId = result.matchedQuestionId || context.currentQuestionId || "q1";
                let prevNodeId = null;

                for (const nodeSpec of result.nodes) {
                    let parentId = nodeSpec.parentNodeId === "prev"
                        ? (prevNodeId || qId)
                        : (nodeSpec.parentNodeId || qId);

                    // Safety: if the referenced parent doesn't exist, fall back to question
                    if (!parentId.startsWith("q") && !context.nodes.find(n => n.id === parentId)) {
                        parentId = qId;
                    }

                    const nodeId = `r${++context.nodeCounter}`;
                    // Clean up any unicode escapes that Claude might return literally
                    const cleanSummary = nodeSpec.summary
                        .replace(/\\u201c/g, '"')
                        .replace(/\\u201d/g, '"')
                        .replace(/\\u2018/g, "'")
                        .replace(/\\u2019/g, "'");
                    const node = {
                        id: nodeId,
                        type: "response",
                        questionId: qId,
                        speakerId: turn.speaker,
                        speakerName: speakerInfo.name,
                        speakerColor: speakerInfo.color,
                        summary: cleanSummary,
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
                }
            }

            // Rate limit
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`[DEMO] Generated ${context.nodes.length} nodes`);

        res.json({
            nodes: context.nodes,
            edges: context.edges,
            transcripts,
            questions,
        });
    } catch (err) {
        console.error("[DEMO] Preprocessing error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ── Static file serving (for production builds) ────────────────────────────
app.use(express.static("../client/dist"));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`\nConversation Bloom server running on http://localhost:${PORT}`);
    console.log(`Deepgram key:   ${process.env.DEEPGRAM_API_KEY ? "✓ set" : "✗ missing"}`);
    console.log(`Anthropic key:  ${process.env.ANTHROPIC_API_KEY ? "✓ set" : "✗ missing"}\n`);
});
