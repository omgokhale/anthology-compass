# Conversation Bloom — Full Project Handoff

## What This Is

A real-time conversation visualization tool. A facilitator leads a 30-60 minute conversation with 3-8 speakers. The app listens via microphone, transcribes and diarizes with AssemblyAI, uses Claude to classify and summarize each speaker turn, and renders a blooming D3 network graph projected on a shared screen.

The visualization is a set of "question flowers" — pre-loaded facilitator questions at the center, with speaker responses radiating outward. Response-to-response connections (when someone explicitly builds on another's point) create lateral edges within each flower.

The aesthetic is immersive and poetic. Black background, pastel-colored tiles, blur dissolve-in animations, edges that draw themselves. Lilypads on still water.

---

## Architecture Overview

```
[Browser Mic / Audio Input]
    → getUserMedia captures audio
    → Streams PCM audio to server via WebSocket

[Node.js Server]
    → Receives audio stream
    → Forwards to AssemblyAI Real-Time Streaming API
    → Receives transcripts with speaker diarization labels
    → Filters out filler utterances (heuristic: <8 words or matches stoplist)
    → Sends substantive turns to Claude Sonnet for classification
    → Claude returns: question match, parent node, summary, speaker
    → Server creates Node + Edge, pushes to frontend via WebSocket

[React Frontend]
    → Receives node/edge events via WebSocket
    → D3 renders radial graph in SVG
    → viewBox auto-zooms to fit all nodes smoothly
    → Nodes blur-dissolve in, edges draw in
    → Hover reveals full transcript overlay
```

### Tech Stack
- **Frontend**: React + D3 (custom radial layout, SVG, no force simulation)
- **Backend**: Node.js with Socket.io (WebSocket)
- **Audio**: AssemblyAI Real-Time Streaming API
- **AI**: Claude Sonnet (claude-sonnet-4-20250514) via Anthropic API
- **State**: In-memory on server, periodic JSON snapshots

### Latency Budget (target: 2-4 seconds end-to-end)
- AssemblyAI transcription: ~300-500ms
- Pause detection / end-of-turn: ~1000-1500ms
- Claude Sonnet API (streaming, tight prompt, JSON output): ~800-1500ms
- Frontend render + animation: ~100ms

---

## Demo Context

- This is for a live demo. Audio will be played from a phone into a Mac microphone (or via BlackHole virtual audio routing for better quality).
- The visualization is projected on a shared screen visible to all participants.
- There is no separate operator — it's set-and-forget after uploading questions and hitting start.
- A pre-recorded transcript exists for testing (included below).
- If the audio pipeline fails, the app should be able to fall back to mock data playback mode.

---

## Data Model

```javascript
// Session
{
  id: string,
  title: string,
  questions: Question[],     // pre-loaded by facilitator
  speakers: Speaker[],       // built during conversation
  nodes: Node[],             // all graph nodes
  edges: Edge[],             // all connections
}

// Question (pre-loaded)
{
  id: string,                // "q1", "q2", etc.
  text: string,              // short display text for the node
  fullText: string,          // original full question text for AI matching
}

// Speaker
{
  id: string,
  name: string,              // "Nia", "Tyriz", etc.
  diarizationLabel: string,  // AssemblyAI's "Speaker A", "Speaker B"
  color: string,             // assigned pastel hex
}

// Node
{
  id: string,
  type: "question" | "response",
  questionId: string,        // which question cluster this belongs to
  speakerId: string,
  summary: string,           // short evocative title (AI-generated)
  transcript: string,        // full speaker turn text (for hover overlay)
  parentId: string,          // question node ID, or another response node ID
  timestamp: number,
}

// Edge
{
  source: string,            // node ID
  target: string,            // node ID
  type: "question_response" | "response_response",
}
```

Future-proofing: This model supports async post-session responses (add `type: "async_response"` and a `parentId`), manual editing of summaries/edges/speaker assignments, and persistent storage (swap in-memory for SQLite/Postgres later).

---

## Pre-loaded Questions

These are the actual questions from the conversation. The `text` field is the short version displayed as a node. The `fullText` is what Claude uses for fuzzy matching against the facilitator's actual speech.

```javascript
const QUESTIONS = [
  {
    id: "q1",
    text: "A value important to you — and how it connects to AI",
    fullText: "Ok, to begin, we want to do a quick round of introductions. Please share just your first name (or a pseudonym). In addition to your first name, please share: a value that's really important to you – like fairness, creativity, or curiosity – and how that connects to your feelings about AI."
  },
  {
    id: "q2",
    text: "A time AI was used in a way that didn't feel right",
    fullText: "The next thing we would like to do is invite you to share a little bit about your background and how you interact with AI. Take a moment to think about a time when you or someone you know used AI in a way that didn't feel right to you. What happened, and how did that experience impact you?"
  },
  {
    id: "q3",
    text: "Five years from now — AI in society and the ethical questions that will matter",
    fullText: "We would like to move on to a conversation about your hopes and concerns regarding the ethical implications of integrating AI into our society. Imagine it is five years from now. How do you see AI being part of society, and what ethical questions or challenges do you think will matter most? Optional follow up: If you could establish one rule or regulation regarding the use of AI, what would it be and why?"
  },
  {
    id: "q4",
    text: "One thing you're taking away from this conversation",
    fullText: "What is one thing you heard today that you'll be taking away from this conversation and that you'd like other people to hear?"
  },
];
```

### Facilitator Preamble (IGNORE — do not visualize)

The facilitator reads a consent/guidelines preamble before the real conversation starts. The AI pipeline should ignore everything before the first round of introductions begins. The preamble includes phrases like "Welcome to this conversation", "providing consent", "guidelines for our conversation", "Is everyone on board with these guidelines?"

Once the facilitator says something that matches Q1 (introductions), visualization begins.

---

## Speaker Palette

```javascript
const SPEAKER_COLORS = {
  "Soliel": "#a8d8ea",      // facilitator — light blue
  "Ebube": "#f4b8c1",       // soft pink
  "Tyriz": "#c3aed6",       // lavender
  "Emmanuella": "#f9e4b7",  // butter
  "Nia": "#b5ead7",         // mint
  "Tayler B.D": "#f8c8dc",  // blush
  "Al-Amin": "#c7ceea",     // periwinkle
  "Sidney": "#ffd3b6",      // peach
};
```

For future conversations with unknown speakers, assign colors from this palette in order of first appearance.

---

## Visualization Design Spec

### Layout
- Questions placed on a ring (radius ~280px) around center, evenly spaced like a clock
- Responses fan out radially from their parent question, spread ~0.32 radians apart
- Response-to-response edges connect laterally within a question cluster
- No force simulation — positions are calculated deterministically
- viewBox auto-zooms smoothly to fit all visible nodes (lerp at ~0.08-0.15 per frame, 50ms interval)

### Animations
- **Nodes**: Blur dissolve-in. Start at `opacity: 0, filter: blur(16px)`, transition to `opacity: 1, filter: blur(0px)` over 1.4s with ease-out. Nodes appear in place — NO position animation, no flying.
- **Edges**: Draw-in. Use SVG `stroke-dasharray` / `stroke-dashoffset`. Edge draws itself from source to target over 900ms, with ~300ms delay after node appears. Slightly curved (quadratic bezier with subtle offset).
- **Camera**: Continuous smooth zoom-out as conversation grows. No jumps.

### Visual Style
- Background: `#050508` (near-black)
- Question nodes: rounded rect, `fill-opacity: 0.07`, subtle border, light gray text
- Response nodes: rounded rect, speaker's pastel color at `fill-opacity: 0.13`, subtle border
- Edges: very thin, semi-transparent white, slight curve
- Response-to-response edges: slightly brighter than question-response edges
- Speaker legend: bottom-left corner, minimal, semi-transparent background

### Tile Styling (Response Nodes)
<!-- USER: ADD YOUR SPECIFIC TILE STYLING GUIDANCE HERE -->
<!-- This section is a placeholder for detailed tile design specs -->
<!-- (typography, padding, border treatment, glow effects, etc.) -->

### Response Summaries
- Short, evocative titles — NOT sentences, NOT fake quotes
- Think chapter titles or newspaper headlines
- Examples from this conversation:
  - "Years of work stolen in two seconds"
  - "A conversation without risk is just a demo"
  - "The chatbot texts you if you stop talking to it"
  - "Echo chambers amplified for 30 years"
  - "AI bunnies I almost believed were real"
- Claude should generate these as part of the classification step

### Hover Overlay
- Appears to the right of the hovered node
- Shows speaker name (in speaker color) + full transcript of that turn
- Semi-transparent dark background, subtle speaker-colored border
- Fades in with a short animation
- Pointer events disabled (doesn't block mouse)

---

## Mock Data (from real transcript)

This is used for: (a) the mock playback / demo fallback mode, (b) testing the visualization without the audio pipeline.

```javascript
const MOCK = [
  // Q1: Values & AI
  { id:"r1", qId:"q1", sp:"Ebube", sum:"AI lowers your creativity" },
  { id:"r2", qId:"q1", sp:"Tayler B.D", sum:"Quick flashcards, faster learning" },
  { id:"r3", qId:"q1", sp:"Al-Amin", sum:"What can you bring that AI can't" },
  { id:"r4", qId:"q1", sp:"Tyriz", sum:"Art with no soul or reason to exist" },
  { id:"r5", qId:"q1", sp:"Nia", sum:"Years of work stolen in two seconds" },
  { id:"r6", qId:"q1", sp:"Emmanuella", sum:"Breaking down what professors can't" },
  { id:"r7", qId:"q1", sp:"Sidney", sum:"AI bunnies I almost believed were real" },

  // Q2: AI that didn't feel right
  { id:"r8", qId:"q2", sp:"Tayler B.D", sum:"An AI grandma selling fake products" },
  { id:"r9", qId:"q2", sp:"Tyriz", sum:"Ozzy Osbourne deepfaked after death", pid:"r8" },
  { id:"r10", qId:"q2", sp:"Ebube", sum:"Echo chambers amplified for 30 years" },
  { id:"r11", qId:"q2", sp:"Nia", sum:"A ransomware call in her husband's voice", pid:"r10" },
  { id:"r12", qId:"q2", sp:"Soliel", sum:"They used my crying voice to scam my mom", pid:"r11" },
  { id:"r13", qId:"q2", sp:"Al-Amin", sum:"Mandate labels — but power benefits too much" },

  // Q3: Five years from now / regulation
  { id:"r14", qId:"q3", sp:"Al-Amin", sum:"The line isn't as different as it seems" },
  { id:"r15", qId:"q3", sp:"Emmanuella", sum:"What even is authentic conversation" },
  { id:"r16", qId:"q3", sp:"Al-Amin", sum:"A conversation without risk is just a demo", pid:"r15" },
  { id:"r17", qId:"q3", sp:"Tayler B.D", sum:"Making us less human, less authentic" },
  { id:"r18", qId:"q3", sp:"Sidney", sum:"Apple auto-replies — you don't even tap", pid:"r17" },
  { id:"r19", qId:"q3", sp:"Ebube", sum:"No in-person skills left when you need them" },
  { id:"r20", qId:"q3", sp:"Tyriz", sum:"To kids, AI is as natural as phones were to us", pid:"r19" },
  { id:"r21", qId:"q3", sp:"Nia", sum:"Wanting answers now, not the beauty of learning" },
  { id:"r22", qId:"q3", sp:"Tayler B.D", sum:"Enhance what you say, don't replace it" },
  { id:"r23", qId:"q3", sp:"Sidney", sum:"That tiny orange label should be everywhere" },
  { id:"r24", qId:"q3", sp:"Al-Amin", sum:"Make companies claim what their bots create" },

  // Q4: Takeaways
  { id:"r25", qId:"q4", sp:"Tyriz", sum:"I finally understand why people talk to character AI" },
  { id:"r26", qId:"q4", sp:"Tayler B.D", sum:"A tool, not a substitute for humanity" },
  { id:"r27", qId:"q4", sp:"Nia", sum:"The chatbot texts you if you stop talking to it" },
  { id:"r28", qId:"q4", sp:"Sidney", sum:"Lazy, disconnected, and unlabeled" },
  { id:"r29", qId:"q4", sp:"Al-Amin", sum:"Either way, you still have to put in the work" },
  { id:"r30", qId:"q4", sp:"Emmanuella", sum:"What is authentic conversation, really" },
];

const TRANSCRIPTS = {
  r1: "My name is Ebube Mbaku and I'm a second year at CCNY. The value I'd say about AI is creativity — when you think about AI, it kind of dumbs you down, I feel like it just lowers it.",
  r2: "My name is Taylor and in terms of a value with AI, I think it helps with personal growth. It's pretty helpful when it comes to giving you quick answers, tools, ideas so that you could learn a little faster.",
  r3: "I'd say about AI would probably be value, especially self value. Seeing how you can get human-ish results from non-human systems makes you think back on what can you bring to the table as a non-AI entity.",
  r4: "One thing I have a big connection to when it comes to AI is creativity. AI's biggest fault is its depth of creativity of the human mind — the more AI grows, the easier it is for the average person to make something that has no soul or reason to exist.",
  r5: "Coming from someone who has spent years of video editing, animation — there are parts of AI that help brainstorm, but I've seen people spend hours creating something, then two seconds later someone takes that content and adds AI onto it, losing the original purpose.",
  r6: "I think a value I hold closely is creativity — the clarity aspect. As a bio major you get really complex concepts and AI has a way of breaking down material which makes it clearer.",
  r7: "I find myself putting my PowerPoints in AI for flashcards and practice questions. But I saw this video of bunnies jumping on a trampoline and it took a lot in me to realize it was AI.",
  r8: "Sydney's point reminded me of an Instagram scam — a grandma with a grandson begging, selling a product, saying they're closing down. Whole time it was just AI.",
  r9: "Companies are willing to cross lines with AI, they just keep pushing further. Like using AI videos of Ozzy Osbourne after he passed away — 'remember this concert.' People get away with anything until people complain.",
  r10: "AI is going to force people to believe their own beliefs even stronger. In 30 years people will just talk to AI to feed into their beliefs and get advice. It's an unsafer environment.",
  r11: "As a cybersecurity major, AI is making it hard. A lady got a call from what looked like her husband's number, they used his voice to make it seem like he had an emergency and asked for money.",
  r12: "My mom got a call where they had used my voice — the sound of me hysterically crying. They said they kidnapped me. She swears to this day it was really my voice.",
  r13: "It should be fairly easy to mandate AI labeling, kind of like trademarks. But the people who have a say benefit too much to want to regulate it.",
  r14: "At first giving a chatbot the same validity as actual connection seems hysterical. But if AI is so good at mimicking humans, it wouldn't be crazy to say someone can feel a genuine connection.",
  r15: "AI lacks physical embodiment. But AI is always polite, always engaging. What do you consider authentic conversation to begin with? Writing your thoughts on paper is technically introspection.",
  r16: "Dealing with social anxiety is part of having a genuine conversation. Being able to go about it without any of the risks is nothing short of a demo, and you can't call a demo the full thing.",
  r17: "Simply put, AI is making us less human and less authentic. When we let it do thinking for us, we risk losing our voice and our own thought process.",
  r18: "AI is making us lazy. Apple has this new thing where instead of typing your response, AI automatically responds. A message requires someone to think and type.",
  r19: "If you're always relying on AI to generate your responses, when it comes time to interact with people in person, you won't have those skills.",
  r20: "Younger people are growing up with AI like we had phones — it's natural to them. They might not have the self-restraint to use AI sparingly.",
  r21: "People choose convenience without thinking about the aftermath. People want answers now, not wanting to be patient with learning or appreciating the beauty of learning things over time.",
  r22: "AI should enhance what you have to say, not replace it. Use it as a tool and not a replacement. Especially for math, because ChatGPT can't do math.",
  r23: "There should be labeling of AI generated things. On TikTok sometimes there's a little orange sign. That should be implemented everywhere.",
  r24: "AI companies should claim what their bots are making. People will be more hesitant because they'll be attributing their work to that company.",
  r25: "We talked about people talking to AI and the subtleties behind why. I never understood but people try to connect so they don't feel alone. I still feel it's the wrong way though.",
  r26: "AI should be a tool, not a substitute for humanity. Life should revert to how it was before the pandemic — that's where the AI downfall really came from.",
  r27: "With chatbot apps, if you don't message for a certain amount of time, they send you: 'hey, why haven't you been talking to me?' That's kind of insane.",
  r28: "AI is making people very lazy. It can't replace human connection. If someone uses AI they shouldn't abuse it, and it should be labeled.",
  r29: "If you use AI, you still have to put in considerable work. If you don't use it, you still have to put in work to stand out among the slurry of AI things.",
  r30: "The most interesting topic was about authentic conversation with AI — how far it has come. What are humanistic characteristics versus just a computer machine?",
};
```

---

## Current Frontend Code (React + D3)

This is the working visualization. It currently runs in mock-data playback mode. It needs to be adapted to also accept WebSocket events from the server.

Save as `src/App.jsx` (or equivalent):

```jsx
import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

const SPEAKER_COLORS = {
  "Soliel": "#a8d8ea", "Ebube": "#f4b8c1", "Tyriz": "#c3aed6",
  "Emmanuella": "#f9e4b7", "Nia": "#b5ead7", "Tayler B.D": "#f8c8dc",
  "Al-Amin": "#c7ceea", "Sidney": "#ffd3b6",
};
const Q_COLOR = "#e0e0e0";
const BG = "#050508";

const QUESTIONS = [
  { id: "q1", text: "A value important to you — and how it connects to AI" },
  { id: "q2", text: "A time AI was used in a way that didn't feel right" },
  { id: "q3", text: "Five years from now — AI in society and the ethical questions that will matter" },
  { id: "q4", text: "One thing you're taking away from this conversation" },
];

// MOCK and TRANSCRIPTS data goes here (see Mock Data section above)

const NW = 180, NH = 60, QW = 240, QH = 44;
const RING_R = 280, RESP_D = 195;
const PAD = 80;

function layout(qs, rs, cx, cy) {
  const qp = {}, n = qs.length;
  qs.forEach((q, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    qp[q.id] = { x: cx + Math.cos(a) * RING_R, y: cy + Math.sin(a) * RING_R };
  });
  const grp = {};
  rs.forEach(r => { (grp[r.qId] = grp[r.qId] || []).push(r); });
  const rp = {};
  Object.entries(grp).forEach(([qId, arr]) => {
    const qPos = qp[qId]; if (!qPos) return;
    const qa = Math.atan2(qPos.y - cy, qPos.x - cx);
    const spread = Math.min(Math.PI * 1.5, (arr.length - 1) * 0.32 + 0.5);
    const sa = qa - spread / 2;
    arr.forEach((r, i) => {
      const a = arr.length === 1 ? qa : sa + (i / (arr.length - 1)) * spread;
      const d = RESP_D + (i % 3) * 22;
      rp[r.id] = { x: qPos.x + Math.cos(a) * d, y: qPos.y + Math.sin(a) * d };
    });
  });
  return { qp, rp };
}

function fitViewBox(qp, rp, w, h) {
  const pts = [...Object.values(qp), ...Object.values(rp)];
  if (!pts.length) return { x: 0, y: 0, w, h };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach(p => {
    x0 = Math.min(x0, p.x - NW); y0 = Math.min(y0, p.y - NH);
    x1 = Math.max(x1, p.x + NW); y1 = Math.max(y1, p.y + NH);
  });
  x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
  const bw = x1 - x0, bh = y1 - y0;
  const scale = Math.min(w / bw, h / bh, 1.2);
  const vw = w / scale, vh = h / scale;
  const vx = (x0 + x1) / 2 - vw / 2, vy = (y0 + y1) / 2 - vh / 2;
  return { x: vx, y: vy, w: vw, h: vh };
}

export default function ConversationBloom() {
  const svgRef = useRef(null);
  const cRef = useRef(null);
  const [dims, setDims] = useState({ w: 1200, h: 800 });
  const [vc, setVc] = useState(0);
  const [hov, setHov] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [setup, setSetup] = useState(true);
  const timer = useRef(null);
  const seq = useRef([]);
  const edges = useRef([]);
  const vbRef = useRef({ x: 0, y: 0, w: 1200, h: 800 });

  useEffect(() => {
    const s = [], e = [];
    let cq = null;
    MOCK.forEach(r => {
      if (r.qId !== cq) { cq = r.qId; s.push({ t: "q", id: r.qId, d: QUESTIONS.find(q => q.id === r.qId) }); }
      s.push({ t: "r", id: r.id, d: r });
      e.push({ src: r.qId, tgt: r.id, tp: "qr" });
      if (r.pid) e.push({ src: r.pid, tgt: r.id, tp: "rr" });
    });
    seq.current = s;
    edges.current = e;
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver(entries => {
      for (let en of entries) setDims({ w: en.contentRect.width, h: en.contentRect.height });
    });
    if (cRef.current) ro.observe(cRef.current);
    return () => ro.disconnect();
  }, []);

  const start = useCallback(() => { setSetup(false); setPlaying(true); setVc(0); }, []);

  useEffect(() => {
    if (!playing) return;
    if (vc >= seq.current.length) { setPlaying(false); return; }
    timer.current = setTimeout(() => setVc(c => c + 1), vc === 0 ? 600 : 1400 + Math.random() * 1600);
    return () => clearTimeout(timer.current);
  }, [playing, vc]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const { w, h } = dims;
    const cx = w / 2, cy = h / 2;

    const vis = seq.current.slice(0, vc);
    const vqs = vis.filter(n => n.t === "q").map(n => n.d);
    const vrs = vis.filter(n => n.t === "r").map(n => n.d);
    const ids = new Set(vis.map(n => n.id));
    const ve = edges.current.filter(e => ids.has(e.src) && ids.has(e.tgt));

    const { qp, rp } = layout(QUESTIONS, vrs, cx, cy);

    // viewBox
    const target = fitViewBox(qp, rp, w, h);
    const prev = vbRef.current;
    const lerpAmt = 0.15;
    const nv = {
      x: prev.x + (target.x - prev.x) * lerpAmt,
      y: prev.y + (target.y - prev.y) * lerpAmt,
      w: prev.w + (target.w - prev.w) * lerpAmt,
      h: prev.h + (target.h - prev.h) * lerpAmt,
    };
    vbRef.current = nv;
    svg.transition().duration(1200).ease(d3.easeCubicInOut)
      .attr("viewBox", `${nv.x} ${nv.y} ${nv.w} ${nv.h}`);

    // Edges
    const eG = svg.select(".edges");
    const eSel = eG.selectAll("path").data(ve, d => d.src + "-" + d.tgt);
    eSel.exit().transition().duration(400).style("opacity", 0).remove();
    const eEnt = eSel.enter().append("path")
      .attr("fill", "none")
      .attr("stroke", d => d.tp === "rr" ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.08)")
      .attr("stroke-width", d => d.tp === "rr" ? 1.2 : 0.8)
      .style("opacity", 0);

    eEnt.merge(eSel)
      .attr("d", d => {
        const s = qp[d.src] || rp[d.src];
        const t = rp[d.tgt] || qp[d.tgt];
        if (!s || !t) return "";
        const dx = t.x - s.x, dy = t.y - s.y;
        const mx = (s.x + t.x) / 2 - dy * 0.1, my = (s.y + t.y) / 2 + dx * 0.1;
        return `M${s.x},${s.y} Q${mx},${my} ${t.x},${t.y}`;
      })
      .each(function(d) {
        const path = d3.select(this);
        const len = this.getTotalLength ? this.getTotalLength() : 200;
        if (path.style("opacity") == 0) {
          path.attr("stroke-dasharray", len).attr("stroke-dashoffset", len)
            .transition().delay(300).duration(900).ease(d3.easeQuadOut)
            .style("opacity", 1).attr("stroke-dashoffset", 0);
        }
      });

    // Question Nodes
    const qG = svg.select(".questions");
    const qSel = qG.selectAll("g.qn").data(vqs, d => d.id);
    qSel.exit().transition().duration(400).style("opacity", 0).remove();
    const qE = qSel.enter().append("g").attr("class", "qn")
      .style("opacity", 0).style("filter", "blur(12px)");
    qE.append("rect").attr("rx", 22).attr("ry", 22)
      .attr("width", QW).attr("height", QH)
      .attr("x", -QW / 2).attr("y", -QH / 2)
      .attr("fill", Q_COLOR).attr("fill-opacity", 0.07)
      .attr("stroke", Q_COLOR).attr("stroke-opacity", 0.2).attr("stroke-width", 0.5);
    qE.append("text")
      .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
      .attr("fill", Q_COLOR).attr("fill-opacity", 0.7)
      .attr("font-size", "11px").attr("font-weight", 400)
      .attr("font-family", "'Inter',system-ui,sans-serif")
      .text(d => d.text);

    qE.merge(qSel)
      .attr("transform", d => { const p = qp[d.id]; return p ? `translate(${p.x},${p.y})` : ""; })
      .transition().duration(1400).ease(d3.easeCubicOut)
      .style("opacity", 1).style("filter", "blur(0px)");

    // Response Nodes
    const rG = svg.select(".responses");
    const rSel = rG.selectAll("g.rn").data(vrs, d => d.id);
    rSel.exit().transition().duration(400).style("opacity", 0).remove();
    const rE = rSel.enter().append("g").attr("class", "rn")
      .style("opacity", 0).style("filter", "blur(16px)")
      .attr("cursor", "pointer");
    rE.append("rect").attr("rx", 10).attr("ry", 10)
      .attr("width", NW).attr("height", NH)
      .attr("x", -NW / 2).attr("y", -NH / 2)
      .attr("fill", d => SPEAKER_COLORS[d.sp] || "#888")
      .attr("fill-opacity", 0.13)
      .attr("stroke", d => SPEAKER_COLORS[d.sp] || "#888")
      .attr("stroke-opacity", 0.3).attr("stroke-width", 0.7);
    rE.append("text").attr("class", "spk")
      .attr("x", -NW / 2 + 10).attr("y", -NH / 2 + 16)
      .attr("fill", d => SPEAKER_COLORS[d.sp] || "#ccc")
      .attr("fill-opacity", 0.8)
      .attr("font-size", "9px").attr("font-weight", 600)
      .attr("font-family", "'Inter',system-ui,sans-serif")
      .attr("letter-spacing", "0.6px")
      .text(d => d.sp.toUpperCase());
    rE.append("text").attr("class", "stx")
      .attr("x", -NW / 2 + 10).attr("y", -NH / 2 + 31)
      .attr("fill", "rgba(255,255,255,0.72)")
      .attr("font-size", "10px")
      .attr("font-family", "'Inter',system-ui,sans-serif")
      .each(function(d) {
        const el = d3.select(this);
        const words = d.sum.split(/\s+/);
        let line = "", ln = 0;
        words.forEach(w => {
          const test = line ? line + " " + w : w;
          if (test.length > 26 && line && ln < 2) {
            el.append("tspan").attr("x", -NW / 2 + 10).attr("dy", ln === 0 ? 0 : 13).text(line);
            ln++; line = w;
          } else { line = test; }
        });
        if (ln < 3 && line) el.append("tspan").attr("x", -NW / 2 + 10).attr("dy", ln === 0 ? 0 : 13).text(line);
      });

    rE.on("mouseenter", (_, d) => setHov(d)).on("mouseleave", () => setHov(null));

    rE.merge(rSel)
      .attr("transform", d => { const p = rp[d.id]; return p ? `translate(${p.x},${p.y})` : ""; })
      .transition().duration(1400).ease(d3.easeCubicOut)
      .style("opacity", 1).style("filter", "blur(0px)");

  }, [vc, dims]);

  // Smooth viewBox animation between node arrivals
  useEffect(() => {
    if (setup || vc === 0) return;
    const interval = setInterval(() => {
      if (!svgRef.current) return;
      const svg = d3.select(svgRef.current);
      const { w, h } = dims;
      const cx = w / 2, cy = h / 2;
      const vrs = seq.current.slice(0, vc).filter(n => n.t === "r").map(n => n.d);
      const { qp, rp } = layout(QUESTIONS, vrs, cx, cy);
      const target = fitViewBox(qp, rp, w, h);
      const prev = vbRef.current;
      const l = 0.08;
      const nv = {
        x: prev.x + (target.x - prev.x) * l,
        y: prev.y + (target.y - prev.y) * l,
        w: prev.w + (target.w - prev.w) * l,
        h: prev.h + (target.h - prev.h) * l,
      };
      vbRef.current = nv;
      svg.attr("viewBox", `${nv.x} ${nv.y} ${nv.w} ${nv.h}`);
    }, 50);
    return () => clearInterval(interval);
  }, [vc, dims, setup]);

  const hovScreen = hov ? (() => {
    if (!svgRef.current) return null;
    const { w, h } = dims;
    const cx = w / 2, cy = h / 2;
    const vrs = seq.current.slice(0, vc).filter(n => n.t === "r").map(n => n.d);
    const { rp } = layout(QUESTIONS, vrs, cx, cy);
    const p = rp[hov.id];
    if (!p) return null;
    const vb = vbRef.current;
    const sx = ((p.x - vb.x) / vb.w) * dims.w;
    const sy = ((p.y - vb.y) / vb.h) * dims.h;
    return { x: sx, y: sy };
  })() : null;

  return (
    <div ref={cRef} style={{ width:"100%", height:"100vh", background:BG, position:"relative", overflow:"hidden", fontFamily:"'Inter',system-ui,sans-serif" }}>
      {setup && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", zIndex:100, background:BG }}>
          <div style={{ color:"rgba(255,255,255,0.25)", fontSize:12, letterSpacing:5, textTransform:"uppercase", marginBottom:36 }}>Conversation Bloom</div>
          <div style={{ color:"rgba(255,255,255,0.45)", fontSize:14, marginBottom:52 }}>{QUESTIONS.length} questions · {Object.keys(SPEAKER_COLORS).length} speakers</div>
          <button onClick={start} style={{
            background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)",
            color:"rgba(255,255,255,0.6)", padding:"13px 52px", borderRadius:28,
            fontSize:13, cursor:"pointer", letterSpacing:2, transition:"all 0.4s"
          }}
            onMouseEnter={e => { e.target.style.background="rgba(255,255,255,0.12)"; e.target.style.color="#fff"; }}
            onMouseLeave={e => { e.target.style.background="rgba(255,255,255,0.06)"; e.target.style.color="rgba(255,255,255,0.6)"; }}
          >BEGIN</button>
        </div>
      )}

      <svg ref={svgRef} width={dims.w} height={dims.h} viewBox={`0 0 ${dims.w} ${dims.h}`} style={{ position:"absolute", top:0, left:0 }}>
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g className="edges" />
        <g className="questions" />
        <g className="responses" />
      </svg>

      {!setup && (
        <div style={{
          position:"absolute", bottom:20, left:20, display:"flex", gap:14,
          background:"rgba(255,255,255,0.03)", padding:"8px 18px", borderRadius:16,
          border:"1px solid rgba(255,255,255,0.05)"
        }}>
          {Object.entries(SPEAKER_COLORS).filter(([n]) => n !== "Soliel").map(([n, c]) => (
            <div key={n} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <div style={{ width:7, height:7, borderRadius:4, background:c, opacity:0.6 }} />
              <span style={{ color:"rgba(255,255,255,0.35)", fontSize:10 }}>{n}</span>
            </div>
          ))}
        </div>
      )}

      {!setup && (
        <div style={{ position:"absolute", top:20, right:20, color:"rgba(255,255,255,0.18)", fontSize:10, letterSpacing:1.5 }}>
          {playing ? "● LIVE" : "COMPLETE"} · {Math.max(0, vc - QUESTIONS.filter((_, i) => vc > 0).length)} responses
        </div>
      )}

      {hov && hovScreen && (
        <div style={{
          position:"absolute",
          left: Math.min(hovScreen.x + NW / 2 + 12, dims.w - 300),
          top: Math.max(hovScreen.y - 50, 12),
          width:280, maxHeight:260, overflow:"auto",
          background:"rgba(10,10,15,0.94)",
          border:`1px solid ${SPEAKER_COLORS[hov.sp] || "#555"}33`,
          borderRadius:10, padding:"14px 16px",
          pointerEvents:"none", zIndex:200,
          animation:"fadeIn 0.25s ease-out"
        }}>
          <div style={{ color:SPEAKER_COLORS[hov.sp], fontSize:10, fontWeight:600, marginBottom:7, letterSpacing:0.5 }}>{hov.sp}</div>
          <div style={{ color:"rgba(255,255,255,0.68)", fontSize:11.5, lineHeight:1.6 }}>{TRANSCRIPTS[hov.id] || ""}</div>
        </div>
      )}

      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  );
}
```

---

## Server Draft (server.js)

This is the Node.js backend. It handles audio streaming, AssemblyAI integration, Claude classification, and WebSocket communication with the frontend.

### Dependencies

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "socket.io": "^4.7.0",
    "assemblyai": "^4.0.0",
    "@anthropic-ai/sdk": "^0.24.0",
    "dotenv": "^16.0.0"
  }
}
```

### .env

```
ASSEMBLYAI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

### server.js

```javascript
require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { AssemblyAI } = require("assemblyai");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const aai = new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Session State ──
let session = {
  questions: [],
  speakers: {},          // diarizationLabel -> { name, color }
  nodes: [],
  edges: [],
  recentTurns: [],       // last N turns for context
  nodeCounter: 0,
  currentQuestionId: null,
};

const SPEAKER_PALETTE = [
  "#f4b8c1", "#c3aed6", "#f9e4b7", "#b5ead7",
  "#f8c8dc", "#c7ceea", "#ffd3b6", "#a8d8ea"
];
let colorIndex = 0;

// Filler filter
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

// ── Claude Classification ──
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

  const prompt = `You are classifying a speaker turn from a live conversation.

PRE-LOADED QUESTIONS:
${questionsContext}

RECENT CONVERSATION:
${recentContext}

EXISTING NODES:
${existingNodes}

CURRENT ACTIVE QUESTION: ${session.currentQuestionId || "none yet"}

NEW SPEAKER TURN:
Speaker: ${speakerLabel}
Text: "${transcript}"

Classify this turn. Respond with ONLY a JSON object:
{
  "isQuestion": false,
  "matchedQuestionId": "q1",
  "parentNodeId": "q1",
  "summary": "short evocative title, max 6 words",
  "speakerName": "best guess at speaker name or null"
}

Rules:
- isQuestion: true only if the facilitator is asking one of the pre-loaded questions
- matchedQuestionId: which question this responds to (or IS, if isQuestion)
- parentNodeId: the node this most directly responds to. Usually the current question. If the speaker explicitly references another speaker's point, name, or builds directly on what they said, use that response node's ID instead.
- summary: a SHORT evocative title (3-7 words). Not a sentence. Not a quote. Like a chapter title or headline. Captures the essence.
- speakerName: if the speaker introduces themselves by name in this turn, extract it. Otherwise null.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content[0].text;
    const cleaned = text.replace(/```json\n?|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Claude classification error:", err);
    // Fallback: attach to current question with raw transcript
    return {
      isQuestion: false,
      matchedQuestionId: session.currentQuestionId || "q1",
      parentNodeId: session.currentQuestionId || "q1",
      summary: transcript.slice(0, 40) + "…",
      speakerName: null,
    };
  }
}

// ── Process a completed speaker turn ──
async function processTurn(transcript, speakerLabel) {
  if (!isSubstantive(transcript)) {
    console.log(`[FILTERED] "${transcript.slice(0, 50)}"`);
    return;
  }

  // Track recent turns for context
  session.recentTurns.push({ speaker: speakerLabel, text: transcript });
  if (session.recentTurns.length > 15) session.recentTurns.shift();

  const result = await classifyTurn(transcript, speakerLabel);

  // Update speaker mapping
  if (result.speakerName && !session.speakers[speakerLabel]) {
    session.speakers[speakerLabel] = {
      name: result.speakerName,
      color: SPEAKER_PALETTE[colorIndex++ % SPEAKER_PALETTE.length],
    };
    io.emit("speaker_identified", {
      label: speakerLabel,
      ...session.speakers[speakerLabel],
    });
  }

  const speakerInfo = session.speakers[speakerLabel] || {
    name: speakerLabel,
    color: SPEAKER_PALETTE[colorIndex++ % SPEAKER_PALETTE.length],
  };

  if (result.isQuestion) {
    // Facilitator is asking a pre-loaded question
    session.currentQuestionId = result.matchedQuestionId;
    const qNode = {
      id: result.matchedQuestionId,
      type: "question",
      questionId: result.matchedQuestionId,
    };
    // Only emit if we haven't already emitted this question
    if (!session.nodes.find(n => n.id === result.matchedQuestionId)) {
      session.nodes.push(qNode);
      io.emit("new_node", { type: "question", id: result.matchedQuestionId });
    }
  } else {
    // Regular response
    const nodeId = `r${++session.nodeCounter}`;
    const node = {
      id: nodeId,
      type: "response",
      questionId: result.matchedQuestionId,
      speakerId: speakerLabel,
      speakerName: speakerInfo.name,
      speakerColor: speakerInfo.color,
      summary: result.summary,
      transcript: transcript,
      parentId: result.parentNodeId,
      timestamp: Date.now(),
    };
    session.nodes.push(node);

    const edge = {
      source: result.parentNodeId,
      target: nodeId,
      type: result.parentNodeId.startsWith("q") ? "qr" : "rr",
    };
    session.edges.push(edge);

    io.emit("new_node", {
      type: "response",
      id: nodeId,
      qId: result.matchedQuestionId,
      sp: speakerInfo.name,
      sum: result.summary,
      transcript: transcript,
      pid: result.parentNodeId.startsWith("r") ? result.parentNodeId : undefined,
    });
    io.emit("new_edge", edge);

    console.log(`[NODE] ${speakerInfo.name}: "${result.summary}"`);
  }
}

// ── AssemblyAI Real-Time Streaming ──
let transcriber = null;

async function startTranscription() {
  transcriber = aai.realtime.transcriber({
    sampleRate: 16000,
    wordBoost: session.questions.map(q => q.text.split(" ")).flat(),
    // Enable speaker diarization
    // Note: check AssemblyAI docs for current real-time diarization support
  });

  transcriber.on("transcript", async (transcript) => {
    // Only process "final" transcripts (not partials)
    if (transcript.message_type === "FinalTranscript" && transcript.text) {
      const speakerLabel = transcript.speaker || "Unknown";
      await processTurn(transcript.text, speakerLabel);
    }
  });

  transcriber.on("error", (err) => {
    console.error("AssemblyAI error:", err);
    io.emit("pipeline_status", { status: "error", message: err.message });
  });

  transcriber.on("close", (code, reason) => {
    console.log("AssemblyAI connection closed:", code, reason);
    io.emit("pipeline_status", { status: "disconnected" });
  });

  await transcriber.connect();
  console.log("AssemblyAI real-time connected");
  io.emit("pipeline_status", { status: "connected" });
}

// ── WebSocket: handle audio from browser ──
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("configure_session", (data) => {
    session.questions = data.questions;
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
    try {
      await startTranscription();
    } catch (err) {
      console.error("Failed to start transcription:", err);
      io.emit("pipeline_status", { status: "error", message: err.message });
    }
  });

  socket.on("audio_data", (data) => {
    // Forward raw audio to AssemblyAI
    if (transcriber) {
      transcriber.sendAudio(data);
    }
  });

  socket.on("stop_listening", async () => {
    if (transcriber) {
      await transcriber.close();
      transcriber = null;
    }
    io.emit("pipeline_status", { status: "stopped" });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

// ── Static file serving ──
app.use(express.static("public"));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
```

---

## Frontend WebSocket Integration (to add to App.jsx)

The current frontend runs in mock playback mode. To connect to the live server, add this to the component:

```javascript
import { io } from "socket.io-client";

// Inside the component, add a WebSocket mode:
const [mode, setMode] = useState("setup"); // "setup" | "live" | "mock"
const socketRef = useRef(null);

// Connect to server
const startLive = useCallback(() => {
  const socket = io("http://localhost:3001");
  socketRef.current = socket;

  // Send question config
  socket.emit("configure_session", { questions: QUESTIONS_FULL });

  // Listen for new nodes
  socket.on("new_node", (node) => {
    if (node.type === "question") {
      // Add question to sequence
      seq.current.push({ t: "q", id: node.id, d: QUESTIONS.find(q => q.id === node.id) });
    } else {
      // Add response to sequence
      seq.current.push({ t: "r", id: node.id, d: node });
      TRANSCRIPTS[node.id] = node.transcript;
    }
    setVc(c => c + 1);
  });

  socket.on("new_edge", (edge) => {
    edges.current.push({ src: edge.source, tgt: edge.target, tp: edge.type });
  });

  // Start audio capture
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(ctx.destination);
    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
      }
      socket.emit("audio_data", int16.buffer);
    };
  });

  socket.emit("start_listening");
  setMode("live");
  setSetup(false);
}, []);
```

---

## Build Checklist

### Done ✅
- [x] D3 radial layout with question flowers
- [x] Blur dissolve-in animations for nodes
- [x] Edge draw-in animations
- [x] Auto-zoom viewBox that smoothly expands
- [x] Hover overlay showing full transcript
- [x] Speaker color palette and legend
- [x] Mock data from real transcript (30 responses, 4 questions)
- [x] Mock playback mode (auto-plays conversation)
- [x] Short evocative summary titles (not sentences or fake quotes)
- [x] Response-to-response edges for explicit references

### Next 🔨
- [ ] **Tile styling** — apply user's specific design guidance (placeholder section above)
- [ ] Wire up WebSocket mode in frontend (code drafted above)
- [ ] Test AssemblyAI real-time streaming with actual audio
- [ ] Tune Claude prompt for classification accuracy
- [ ] Tune filler filter thresholds
- [ ] Add speaker name entry UI to setup screen
- [ ] Add question upload/paste to setup screen
- [ ] Emergency fallback: hidden keyboard shortcut to switch to mock playback if pipeline fails
- [ ] Test end-to-end with the recorded conversation audio
- [ ] Projector testing: text legibility, color contrast at distance

### Deferred to v2
- [ ] Async post-session response nodes
- [ ] Manual editing of summaries, edges, speaker assignments
- [ ] Persistent database storage
- [ ] Session export / replay mode
- [ ] User authentication
- [ ] Automatic speaker name identification from introductions

---

## Full Transcript (for testing / reference)

The complete transcript is in a separate file: `Transcript.md`
(Copy the transcript provided during our planning session into this file.)

---

## Key Design Decisions (for context)

1. **No force simulation.** Positions are calculated deterministically. Nodes don't jiggle or rearrange. This keeps the projected display calm and intentional.

2. **Responses attach to nearest question when off-script.** If the conversation drifts from the pre-loaded questions, responses still attach to the most recent/nearest question rather than creating new topic clusters.

3. **Response-to-response edges only for explicit references.** Claude looks for speakers mentioning other speakers by name, saying "to add on", "building off that", etc. Implicit topical similarity is NOT enough — only explicit conversational references create lateral edges.

4. **Facilitator turns that match pre-loaded questions create Question nodes.** Other facilitator turns (synthesis, follow-ups, transitions) are either filtered as short or treated as responses.

5. **The visualization IS the product.** If the audio pipeline fails, falling back to gorgeous mock playback is better than showing a broken live pipeline. Always have mock mode as a safety net.
```