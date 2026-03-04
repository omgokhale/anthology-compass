import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import { io } from "socket.io-client";
import {
  SPEAKER_COLORS, QUESTIONS, QUESTIONS_FULL, PARTICIPANTS,
  MOCK, TRANSCRIPTS as MOCK_TRANSCRIPTS,
} from "./data";

// ── Constants ────────────────────────────────────────────────────────────────
const Q_COLOR = "#e0e0e0";
const BG = "#050508";
const NW = 200, NH = 96;   // response node width/height
const QW = 300, QH = 88;   // question node width/height (QH = typical dynamic height)
const RING_R = 950;       // distance from center to question nodes — flowers well separated
const RESP_D = 340;       // base distance from question node to response ring
const RESP_STEP = 200;    // additional distance per overflow ring
// No ANG_STEP — responses now distribute in a full 360° around each question
const PAD = 100;
const SERVER_URL = "http://localhost:3001";

// Live transcripts accumulate here (mock ones come from data.js)
const liveTranscripts = {};

// ── Edge helpers ─────────────────────────────────────────────────────────────
// Returns the {w,h} of a node given its id ("q*" = question, else response)
function nodeSize(id) {
  return id.startsWith("q") ? { w: QW, h: QH } : { w: NW, h: NH };
}

// Returns the point on the rect boundary of (cx,cy,w,h) along the direction
// toward (tx,ty), offset outward by `gap` pixels so lines don't touch the tile.
function edgePoint(cx, cy, tx, ty, w, h, gap = 16) {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const hw = w / 2 + gap, hh = h / 2 + gap;
  const tX = hw / Math.abs(dx || Infinity);
  const tY = hh / Math.abs(dy || Infinity);
  const t = Math.min(tX, tY);
  return [cx + dx * t, cy + dy * t];
}

// Build a curved SVG path between two positioned nodes
function edgePath(sPos, tPos, srcId, tgtId) {
  const ss = nodeSize(srcId), ts = nodeSize(tgtId);
  const [sx, sy] = edgePoint(sPos.x, sPos.y, tPos.x, tPos.y, ss.w, ss.h);
  const [ex, ey] = edgePoint(tPos.x, tPos.y, sPos.x, sPos.y, ts.w, ts.h);
  const mx = (sx + ex) / 2 - (ey - sy) * 0.12;
  const my = (sy + ey) / 2 + (ex - sx) * 0.12;
  return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
}

// ── Layout ───────────────────────────────────────────────────────────────────
// Returns positions for all question nodes (qp) and all response nodes (rp)
// cx/cy is world origin (center of canvas)
function layout(allQuestions, responses, cx, cy) {
  const n = allQuestions.length;

  // Question positions in a ring
  const qp = {};
  allQuestions.forEach((q, i) => {
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    qp[q.id] = {
      x: cx + Math.cos(angle) * RING_R,
      y: cy + Math.sin(angle) * RING_R,
    };
  });

  // Group responses per question
  const grp = {};
  responses.forEach(r => {
    (grp[r.qId] = grp[r.qId] || []).push(r);
  });

  const rp = {};
  Object.entries(grp).forEach(([qId, arr]) => {
    const qPos = qp[qId];
    if (!qPos) return;

    // Angle from world center → question node (used as starting angle for ring 0)
    const qa = Math.atan2(qPos.y - cy, qPos.x - cx);

    // Distribute responses in a full 360° around the question node.
    // Ring 0: up to 6 nodes evenly spaced in a full circle, starting from qa.
    // Ring 1+: overflow nodes at a larger radius, rotated by half a step to interleave.
    const PER_RING = 6;
    arr.forEach((r, i) => {
      const ringLevel = Math.floor(i / PER_RING);
      const posInRing = i % PER_RING;
      // Fixed slot count — angles depend only on index, not total count,
      // so existing nodes never redistribute when new siblings arrive.
      const ringOffset = ringLevel * (Math.PI / PER_RING);
      const angle = qa + ringOffset + (posInRing / PER_RING) * Math.PI * 2;
      const dist = RESP_D + ringLevel * RESP_STEP;

      rp[r.id] = {
        x: qPos.x + Math.cos(angle) * dist,
        y: qPos.y + Math.sin(angle) * dist,
      };
    });
  });

  return { qp, rp };
}

// Compute an ideal viewBox that frames the given visible nodes
function computeViewBox(qp, rp, w, h) {
  const pts = [...Object.values(qp), ...Object.values(rp)];
  if (!pts.length) return { x: -w / 2, y: -h / 2, w, h };

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  pts.forEach(p => {
    x0 = Math.min(x0, p.x - NW); y0 = Math.min(y0, p.y - NH);
    x1 = Math.max(x1, p.x + NW); y1 = Math.max(y1, p.y + NH);
  });
  x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;

  const bw = x1 - x0, bh = y1 - y0;
  const scale = Math.min(w / bw, h / bh, 1.4);
  const vw = w / scale, vh = h / scale;
  const vx = (x0 + x1) / 2 - vw / 2;
  const vy = (y0 + y1) / 2 - vh / 2;
  return { x: vx, y: vy, w: vw, h: vh };
}

// Per-question focused viewBox (fits just the active question + its responses)
function computeFocusedViewBox(activeQId, qp, rp, responseMap, w, h) {
  const qPos = qp[activeQId];
  if (!qPos) return computeViewBox(qp, rp, w, h);

  const focusPts = [qPos];
  (responseMap[activeQId] || []).forEach(r => {
    const p = rp[r.id];
    if (p) focusPts.push(p);
  });

  if (focusPts.length < 2) {
    // Just the question node — tight frame
    return {
      x: qPos.x - w * 0.3,
      y: qPos.y - h * 0.3,
      w: w * 0.6,
      h: h * 0.6,
    };
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  focusPts.forEach(p => {
    x0 = Math.min(x0, p.x - NW); y0 = Math.min(y0, p.y - NH);
    x1 = Math.max(x1, p.x + NW); y1 = Math.max(y1, p.y + NH);
  });
  x0 -= PAD * 1.5; y0 -= PAD * 1.5; x1 += PAD * 1.5; y1 += PAD * 1.5;

  const bw = x1 - x0, bh = y1 - y0;
  const scale = Math.min(w / bw, h / bh, 1.8);
  const vw = w / scale, vh = h / scale;
  const vx = (x0 + x1) / 2 - vw / 2;
  const vy = (y0 + y1) / 2 - vh / 2;
  return { x: vx, y: vy, w: vw, h: vh };
}

// ── Response node sizing helpers ──────────────────────────────────────────────
const RESP_MAX_CHARS = 24;
const RESP_LINE_H = 17;
const RESP_TOP_PAD = 24;   // px from top edge to first text baseline
const RESP_BOT_PAD = 30;   // px from last text baseline to bottom edge

function wrapLines(text) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  words.forEach(w => {
    const test = cur ? cur + " " + w : w;
    if (test.length > RESP_MAX_CHARS && cur) { lines.push(cur); cur = w; }
    else { cur = test; }
  });
  if (cur) lines.push(cur);
  return lines;
}

function nodeNH(lineCount) {
  return RESP_TOP_PAD + lineCount * RESP_LINE_H + RESP_BOT_PAD;
}

// ── Question node sizing helpers ──────────────────────────────────────────────
const Q_MAX_CHARS = 34;
const Q_LINE_H = 18;
const Q_LABEL_Y_FROM_TOP = 16;  // "QUESTION" label baseline distance from top edge
const Q_TEXT_GAP = 16;          // gap from label baseline to first text line (stays fixed)
const Q_BOT_PAD = 16;

function wrapQLines(text) {
  const words = (text || "").split(/\s+/);
  const lines = [];
  let cur = "";
  words.forEach(w => {
    const test = cur ? cur + " " + w : w;
    if (test.length > Q_MAX_CHARS && cur) { lines.push(cur); cur = w; }
    else { cur = test; }
  });
  if (cur) lines.push(cur);
  return lines;
}

function nodeQH(lineCount) {
  return Q_LABEL_Y_FROM_TOP + Q_TEXT_GAP + lineCount * Q_LINE_H + Q_BOT_PAD;
}

function ensureQuestion(text) {
  if (!text) return text;
  return text.replace(/[.!,;:?]+$/, "").trim() + "?";
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function richDark(hex) {
  const h = (hex || "#888888").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let hDeg = 0, s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) hDeg = ((g - b) / d) % 6;
    else if (max === g) hDeg = (b - r) / d + 2;
    else hDeg = (r - g) / d + 4;
    hDeg = hDeg * 60;
    if (hDeg < 0) hDeg += 360;
  }
  const newL = 0.28, newS = Math.min(1, s * 1.1);
  const c = (1 - Math.abs(2 * newL - 1)) * newS;
  const x = c * (1 - Math.abs((hDeg / 60) % 2 - 1));
  const m = newL - c / 2;
  let r2, g2, b2;
  if (hDeg < 60) { r2 = c; g2 = x; b2 = 0; }
  else if (hDeg < 120) { r2 = x; g2 = c; b2 = 0; }
  else if (hDeg < 180) { r2 = 0; g2 = c; b2 = x; }
  else if (hDeg < 240) { r2 = 0; g2 = x; b2 = c; }
  else if (hDeg < 300) { r2 = x; g2 = 0; b2 = c; }
  else { r2 = c; g2 = 0; b2 = x; }
  const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ConversationBloom() {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const gRef = useRef(null);   // main <g> inside SVG (zoom target)
  const zoomRef = useRef(null);   // d3.zoom instance
  const [dims, setDims] = useState({ w: 1200, h: 800 });

  // Playback state
  const [mode, setMode] = useState("setup");
  const [vc, setVc] = useState(0);   // visible count (index into seq)
  const [hov, setHov] = useState(null);
  const [pipelineStatus, setPipelineStatus] = useState(null);
  const [activeQId, setActiveQId] = useState(null);
  const [caption, setCaption] = useState("");
  const [captionWords, setCaptionWords] = useState([]);
  const captionKeyRef = useRef(0);
  const prevCaptionRef = useRef("");
  const [configOpen, setConfigOpen] = useState(false);
  const [questionsText, setQuestionsText] = useState(QUESTIONS_FULL.map(q => q.fullText).join("\n"));
  const [participantsText, setParticipantsText] = useState("");
  const [preambleText, setPreambleText] = useState(`I have begun recording at this time, and I need to share a little information with you before we begin our conversation.

Welcome to this conversation, part of the Youth Civic Voices Initiative led by Cortico, the MIT Center for Constructive Communication and FRONTLINE with the goal of engaging young people in civic dialogue through journalistic storytelling, emerging technologies, and public conversations. We also want to surface what kind of media content will resonate with you as we are exploring our hopes and concerns in the age of artificial intelligence (AI).

Today we are inviting you to have a different type of conversation. These conversations are focused on sharing our personal stories from our lived experience, rather than beginning the conversation with our positions on issues. We are doing this in order to help build connections and to foster conversations that improve our understanding of one another.

As a participant in this conversation, you are providing consent to FRONTLINE to use the recording in accordance with its mission. You also understand that the conversation will be part of a collection of Cortico's Platform, whose mission is to foster conversations in communities and in the media that improve our understanding of one another. Cortico will collect, retain, and analyze these conversations in keeping with that mission.

If you understand and agree to this, please say "I agree". We want to make sure that everyone gets a chance both to share and to learn from others in this conversation, and to support those goals we have a few guidelines for our conversation.

Speak for yourself and out of your own experiences. Allow others to speak for themselves. Share the time. Stay curious. Pause. Listen generously. When possible, close unnecessary programs and put your phone on silent.

Is everyone on board with these guidelines? For the ease of this conversation, we are going to use a modified circle process where each person will take a turn. Does anyone have any questions about this process?`);
  const [identifiedSpeakers, setIdentifiedSpeakers] = useState({}); // name → color

  // Refs for mutable state that D3 reads
  const seqRef = useRef([]);   // ordered sequence of {t, id, d}
  const edgesRef = useRef([]);   // list of {src, tgt, tp}
  const posRef = useRef({});   // id → {x, y, vx, vy, pinned}
  const vcRef = useRef(0);
  const activeQRef = useRef(null);

  const timerRef = useRef(null);
  const socketRef = useRef(null);
  const physicsRef = useRef(null);
  const configuredQsRef = useRef(QUESTIONS); // updated on GO LIVE with user-configured questions

  // Keep vcRef in sync
  useEffect(() => { vcRef.current = vc; }, [vc]);
  useEffect(() => { activeQRef.current = activeQId; }, [activeQId]);

  // Diff incoming caption text into word-keyed array for per-word fade-in
  useEffect(() => {
    if (!caption) {
      setCaptionWords([]);
      prevCaptionRef.current = "";
      return;
    }
    const newWords = caption.trim().split(/\s+/).filter(Boolean);
    const prevWords = prevCaptionRef.current.trim().split(/\s+/).filter(Boolean);
    prevCaptionRef.current = caption;

    setCaptionWords(prev => {
      // Find the length of the stable common prefix
      let commonLen = 0;
      while (
        commonLen < prevWords.length &&
        commonLen < newWords.length &&
        prevWords[commonLen] === newWords[commonLen]
      ) {
        commonLen++;
      }
      // Keep existing word objects for the prefix; mint fresh ones for new/changed words
      const kept = prev.slice(0, commonLen);
      const added = newWords.slice(commonLen).map(text => ({
        text,
        key: captionKeyRef.current++,
      }));
      const all = [...kept, ...added];
      // Keep last 28 words — roughly 2 lines at this font size
      return all.slice(Math.max(0, all.length - 28));
    });
  }, [caption]);

  // ── Resize observer ─────────────────────────────────────────────────────
  useEffect(() => {
    const ro = new ResizeObserver(entries => {
      for (const en of entries) {
        setDims({ w: en.contentRect.width, h: en.contentRect.height });
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // ── D3 zoom setup ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || mode === "setup") return;

    const svg = d3.select(svgRef.current);
    const zoom = d3.zoom()
      .scaleExtent([0.15, 6])
      .on("zoom", event => {
        d3.select(gRef.current).attr("transform", event.transform);
      });

    zoomRef.current = zoom;
    svg.call(zoom);

    // Set initial transform so world origin (0,0) is at svg center
    const init = d3.zoomIdentity.translate(dims.w / 2, dims.h / 2);
    svg.call(zoom.transform, init);

    return () => svg.on(".zoom", null);
  }, [mode, dims.w, dims.h]);

  // ── Build mock sequence ─────────────────────────────────────────────────
  const buildMockSequence = useCallback(() => {
    const s = [], e = [];
    // Track which question each response belongs to, for cross-cluster filtering
    const nodeQMap = {};
    let curQ = null;
    MOCK.forEach(r => {
      nodeQMap[r.id] = r.qId;
      if (r.qId !== curQ) {
        curQ = r.qId;
        const qData = QUESTIONS.find(q => q.id === r.qId);
        s.push({ t: "q", id: r.qId, d: qData });
      }
      s.push({ t: "r", id: r.id, d: r });
      e.push({ src: r.qId, tgt: r.id, tp: "qr" });
      // Only draw rr edges within the same question cluster — cross-cluster
      // edges trail off into blackness when the view is focused on the active Q
      if (r.pid && nodeQMap[r.pid] === r.qId) {
        e.push({ src: r.pid, tgt: r.id, tp: "rr" });
      }
    });
    seqRef.current = s;
    edgesRef.current = e;
  }, []);

  // ── Mock playback ───────────────────────────────────────────────────────
  const startMock = useCallback(() => {
    clearTimeout(timerRef.current);
    posRef.current = {};
    buildMockSequence();
    setVc(0);
    setActiveQId(null);
    setMode("mock");

    let i = 0;
    const tick = () => {
      i++;
      const item = seqRef.current[i - 1];
      if (item?.t === "q") setActiveQId(item.id);
      setVc(i);
      if (i < seqRef.current.length) {
        timerRef.current = setTimeout(tick, 1600);
      }
    };
    timerRef.current = setTimeout(tick, 700);
  }, [buildMockSequence]);

  // ── Live Socket.io mode ─────────────────────────────────────────────────
  const startLive = useCallback(() => {
    // Parse user-configured questions and participants
    const parsedQs = questionsText.trim().split("\n").filter(Boolean).map((line, i) => ({
      id: `q${i + 1}`,
      text: line.length > 80 ? line.slice(0, 77) + "…" : line,
      fullText: line,
    }));
    const parsedParticipants = participantsText.split(",").map(p => p.trim()).filter(Boolean);
    configuredQsRef.current = parsedQs;

    seqRef.current = [];
    edgesRef.current = [];
    posRef.current = {};
    setVc(0);
    setActiveQId(null);
    setConfigOpen(false);
    setMode("live");

    const socket = io(SERVER_URL);
    socketRef.current = socket;
    socket.emit("configure_session", { questions: parsedQs, participants: parsedParticipants, preamble: preambleText });

    socket.on("new_node", node => {
      if (node.type === "question") {
        const qData = configuredQsRef.current.find(q => q.id === node.id);
        const text = ensureQuestion(node.text || qData?.text || node.id);
        seqRef.current.push({ t: "q", id: node.id, d: { ...qData, id: node.id, text } });
        setActiveQId(node.id);
      } else {
        seqRef.current.push({ t: "r", id: node.id, d: node });
        liveTranscripts[node.id] = node.transcript;
        if (node.pid) edgesRef.current.push({ src: node.pid, tgt: node.id, tp: "rr" });
        if (node.qId) edgesRef.current.push({ src: node.qId, tgt: node.id, tp: "qr" });
      }
      setVc(c => c + 1);
    });

    socket.on("new_edge", edge => {
      const exists = edgesRef.current.find(e => e.src === edge.source && e.tgt === edge.target);
      if (!exists) edgesRef.current.push({ src: edge.source, tgt: edge.target, tp: edge.type });
    });

    socket.on("pipeline_status", d => setPipelineStatus(d.status));
    socket.on("caption", d => setCaption(d.text));
    socket.on("speaker_identified", d => setIdentifiedSpeakers(prev => ({ ...prev, [d.name]: d.color })));

    navigator.mediaDevices.getUserMedia({ audio: true }).then(async stream => {
      const ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule("/audio-worklet-processor.js");
      const source = ctx.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(ctx, "pcm-processor");
      worklet.port.onmessage = e => socket.emit("audio_data", e.data);
      source.connect(worklet);
      socket.emit("start_listening");
    }).catch(err => { console.error("Mic error:", err); setPipelineStatus("mic_error"); });
  }, [questionsText, participantsText, preambleText]);

  // Emergency mock fallback: press 'm' during live
  const emergencyMock = useCallback(() => {
    if (socketRef.current) socketRef.current.disconnect();
    clearTimeout(timerRef.current);
    cancelAnimationFrame(physicsRef.current);
    startMock();
  }, [startMock]);

  useEffect(() => {
    const h = e => { if (e.key === "m" && mode === "live") emergencyMock(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [mode, emergencyMock]);

  useEffect(() => () => {
    clearTimeout(timerRef.current);
    cancelAnimationFrame(physicsRef.current);
    if (socketRef.current) socketRef.current.disconnect();
  }, []);

  // ── D3 Render ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode === "setup" || !svgRef.current || !gRef.current) return;

    const transcripts = mode === "mock" ? MOCK_TRANSCRIPTS : liveTranscripts;
    const { w, h } = dims;

    const visible = seqRef.current.slice(0, vc);
    const visQs = visible.filter(n => n.t === "q").map(n => n.d).filter(Boolean);
    const visRs = visible.filter(n => n.t === "r").map(n => n.d);
    const visIds = new Set([...visQs.map(n => n.id), ...visRs.map(n => n.id)]);
    const visEs = edgesRef.current.filter(e => visIds.has(e.src) && visIds.has(e.tgt));

    // Compute target layout positions (world coords, origin 0,0)
    const allQs = mode === "live" ? configuredQsRef.current : QUESTIONS;
    const { qp: rawQp, rp: rawRp } = layout(allQs, visRs, 0, 0);

    // Initialise posRef for new nodes only — existing nodes keep their positions
    visQs.forEach(q => {
      if (!posRef.current[q.id]) posRef.current[q.id] = { ...rawQp[q.id] };
    });
    visRs.forEach(r => {
      if (!posRef.current[r.id]) {
        const target = rawRp[r.id] || { x: 0, y: 0 };
        posRef.current[r.id] = { x: target.x, y: target.y };
      }
    });

    // Build response map for focus viewbox
    const responseMap = {};
    visRs.forEach(r => { (responseMap[r.qId] = responseMap[r.qId] || []).push(r); });

    // ── Per-question focused viewBox ──────────────────────────────────────
    const activeQ = activeQRef.current;
    if (activeQ && zoomRef.current && svgRef.current) {
      const tvb = computeFocusedViewBox(activeQ, rawQp, rawRp, responseMap, w, h);
      // Convert viewBox coords to zoom transform
      const scale = w / tvb.w;
      const tx = -tvb.x * scale + (w - w) / 2;
      const ty = -tvb.y * scale + 0;
      const targetTransform = d3.zoomIdentity.scale(scale).translate(-tvb.x, -tvb.y);

      d3.select(svgRef.current)
        .transition()
        .duration(3800)
        .ease(d3.easeSinInOut)
        .call(zoomRef.current.transform, targetTransform);
    }

    const g = d3.select(gRef.current);

    // ── Edges ─────────────────────────────────────────────────────────────
    const eG = g.select(".edges");
    const eKey = d => d.src + "-" + d.tgt;
    const eSel = eG.selectAll("path").data(visEs, eKey);
    eSel.exit().transition().duration(500).style("opacity", 0).remove();

    const eEnt = eSel.enter().append("path")
      .attr("fill", "none")
      .attr("stroke", d => d.tp === "rr" ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.18)")
      .attr("stroke-width", d => d.tp === "rr" ? 1.4 : 0.9)
      .attr("stroke-dasharray", d => d.tp === "rr" ? "5,6" : null)
      .attr("marker-end", d => d.tp === "rr" ? "url(#arrow-rr)" : "url(#arrow-qr)")
      .style("opacity", 0);

    eEnt.merge(eSel)
      .attr("d", d => {
        const s = posRef.current[d.src] || rawQp[d.src];
        const t = posRef.current[d.tgt] || rawRp[d.tgt];
        if (!s || !t) return "";
        return edgePath(s, t, d.src, d.tgt);
      })
      .each(function (d) {
        const p = d3.select(this);
        if (+p.style("opacity") === 0) {
          if (d.tp === "rr") {
            // rr edges: simple fade-in
            p.transition().delay(600).duration(2400).ease(d3.easeCubicOut)
              .style("opacity", 1);
          } else {
            // qr edges: path-trace draw-in, then clear dasharray so path stays solid
            const len = this.getTotalLength ? this.getTotalLength() : 200;
            p.attr("stroke-dasharray", len).attr("stroke-dashoffset", len)
              .transition().delay(600).duration(2400).ease(d3.easeCubicOut)
              .style("opacity", 1).attr("stroke-dashoffset", 0)
              .on("end", function () {
                d3.select(this).attr("stroke-dasharray", null).attr("stroke-dashoffset", null);
              });
          }
        }
      });

    // ── Question Nodes ────────────────────────────────────────────────────
    const qG = g.select(".questions");
    const qSel = qG.selectAll("g.qn").data(visQs, d => d.id);
    qSel.exit().transition().duration(500).style("opacity", 0).remove();

    const qEnt = qSel.enter().append("g").attr("class", "qn")
      .style("opacity", 0).style("filter", "blur(14px)");

    qEnt.append("rect")
      .attr("rx", 24).attr("ry", 24)
      .attr("width", QW)
      .attr("fill", "#050508").attr("fill-opacity", 1)
      .attr("stroke", "none")
      .each(function (d) {
        const qh = nodeQH(wrapQLines(d.text).length);
        d3.select(this).attr("height", qh).attr("x", -QW / 2).attr("y", -qh / 2);
      });

    // "QUESTION" label — anchored fixed distance from top edge regardless of height
    qEnt.append("text")
      .attr("text-anchor", "middle")
      .attr("x", 0)
      .attr("fill", Q_COLOR).attr("fill-opacity", 0.32)
      .attr("font-size", "8px").attr("font-weight", 400)
      .attr("font-family", "'Hedvig Letters Sans', sans-serif")
      .attr("letter-spacing", "2px")
      .text("QUESTION")
      .each(function (d) {
        const qh = nodeQH(wrapQLines(d.text).length);
        d3.select(this).attr("y", -qh / 2 + Q_LABEL_Y_FROM_TOP);
      });

    // Question body — starts fixed gap below the label, grows downward
    qEnt.append("text")
      .attr("text-anchor", "middle")
      .attr("fill", Q_COLOR).attr("fill-opacity", 0.88)
      .attr("font-size", "13px").attr("font-weight", 400)
      .attr("font-family", "'Hedvig Letters Serif', serif")
      .style("font-optical-sizing", "auto")
      .each(function (d) {
        const el = d3.select(this);
        const lines = wrapQLines(d.text);
        const qh = nodeQH(lines.length);
        const startY = -qh / 2 + Q_LABEL_Y_FROM_TOP + Q_TEXT_GAP;
        lines.forEach((l, i) => {
          el.append("tspan").attr("x", 0).attr("y", startY + i * Q_LINE_H).text(l);
        });
      });

    qEnt
      .attr("transform", d => {
        const p = posRef.current[d.id] || rawQp[d.id];
        return p ? `translate(${p.x},${p.y})` : "translate(0,0)";
      })
      .transition().duration(3200).ease(d3.easeCubicOut)
      .style("opacity", 1).style("filter", "blur(0px)");

    // ── Response Nodes ────────────────────────────────────────────────────
    const rG = g.select(".responses");
    const rSel = rG.selectAll("g.rn").data(visRs, d => d.id);
    rSel.exit().transition().duration(500).style("opacity", 0).remove();

    const rEnt = rSel.enter().append("g").attr("class", "rn")
      .style("opacity", 0).style("filter", "blur(18px)")
      .attr("cursor", "grab");

    rEnt.append("rect")
      .attr("rx", 6).attr("ry", 6)
      .attr("width", NW)
      .attr("fill", d => d.color || SPEAKER_COLORS[d.sp] || "#c0c0c0")
      .attr("fill-opacity", 1)
      .attr("stroke", "none")
      .each(function (d) {
        const nh = nodeNH(wrapLines(d.sum).length);
        d3.select(this).attr("height", nh).attr("x", -NW / 2).attr("y", -nh / 2);
      });

    rEnt.append("text").attr("class", "stx")
      .attr("font-size", "13px")
      .attr("font-family", "'Hedvig Letters Sans', sans-serif")
      .attr("font-weight", 400)
      .each(function (d) {
        const el = d3.select(this);
        const lines = wrapLines(d.sum);
        const nh = nodeNH(lines.length);
        el.attr("fill", richDark(d.color || SPEAKER_COLORS[d.sp] || "#888888"));
        const startY = -nh / 2 + RESP_TOP_PAD;
        lines.forEach((l, i) => {
          el.append("tspan").attr("x", -NW / 2 + 14).attr("y", startY + i * RESP_LINE_H).text(l);
        });
      });

    rEnt.append("circle").attr("class", "spk-dot")
      .attr("r", 3.5)
      .attr("fill", d => richDark(d.color || SPEAKER_COLORS[d.sp] || "#888888"))
      .attr("fill-opacity", 0.6)
      .each(function (d) {
        const nh = nodeNH(wrapLines(d.sum).length);
        d3.select(this).attr("cx", -NW / 2 + 14).attr("cy", nh / 2 - 15);
      });

    rEnt.append("text").attr("class", "spk")
      .attr("fill", d => richDark(d.color || SPEAKER_COLORS[d.sp] || "#888888"))
      .attr("fill-opacity", 0.7)
      .attr("font-size", "9px").attr("font-weight", 400)
      .attr("font-family", "'Hedvig Letters Sans', sans-serif")
      .attr("letter-spacing", "0.5px")
      .text(d => d.sp)
      .each(function (d) {
        const nh = nodeNH(wrapLines(d.sum).length);
        d3.select(this).attr("x", -NW / 2 + 24).attr("y", nh / 2 - 11);
      });

    // Hover events
    rEnt.on("mouseenter", (_, d) => setHov({ ...d, _transcripts: transcripts }))
      .on("mouseleave", () => setHov(null));

    // ── Drag behavior ─────────────────────────────────────────────────────
    const drag = d3.drag()
      .on("start", function () {
        d3.select(this).attr("cursor", "grabbing");
      })
      .on("drag", function (event, d) {
        const p = posRef.current[d.id];
        if (!p) return;
        p.x = event.x; p.y = event.y;
        d3.select(this).attr("transform", `translate(${p.x},${p.y})`);
        g.select(".edges").selectAll("path").attr("d", ed => {
          const s = posRef.current[ed.src] || rawQp[ed.src];
          const t = posRef.current[ed.tgt] || rawRp[ed.tgt];
          if (!s || !t) return "";
          return edgePath(s, t, ed.src, ed.tgt);
        });
      })
      .on("end", function () {
        d3.select(this).attr("cursor", "grab");
      });

    rEnt.call(drag);
    rEnt.merge(rSel).call(drag);

    rEnt
      .attr("transform", d => {
        const p = posRef.current[d.id] || rawRp[d.id];
        return p ? `translate(${p.x},${p.y})` : "translate(0,0)";
      })
      .transition().duration(3200).ease(d3.easeCubicOut)
      .style("opacity", 1).style("filter", "blur(0px)");

  }, [vc, dims, mode, activeQId]);



  // ── Hover overlay screen position ────────────────────────────────────────
  // Convert world coords → screen coords via d3 zoom transform
  const hovScreen = (() => {
    if (!hov || !svgRef.current) return null;
    const p = posRef.current[hov.id];
    if (!p) return null;

    // Get current zoom transform
    const transform = d3.zoomTransform(svgRef.current);
    const [sx, sy] = transform.apply([p.x, p.y]);
    return { x: sx, y: sy };
  })();

  // Live nodes carry transcript directly on the datum; mock nodes use the lookup map
  const transcriptText = hov ? (hov.transcript || hov._transcripts?.[hov.id] || "") : "";

  // ── Setup screen ─────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100vh", background: BG, position: "relative", overflow: "hidden", fontFamily: "'Inter',system-ui,sans-serif" }}
    >
      {mode === "setup" && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ color: "rgba(255,255,255,0.18)", fontSize: 11, letterSpacing: 6, textTransform: "uppercase", marginBottom: 18 }}>Conversation Bloom</div>

          {!configOpen ? (
            <>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, marginBottom: 6 }}>
                {questionsText.trim().split("\n").filter(Boolean).length} questions · {participantsText.split(",").filter(s => s.trim()).length} participants
              </div>
              <div style={{ color: "rgba(255,255,255,0.18)", fontSize: 11, marginBottom: 52 }}>
                {participantsText.split(",").map(p => p.trim()).filter(Boolean).join(" · ") || "no participants configured"}
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <button id="btn-mock" onClick={startMock} style={btnStyle}>MOCK PLAYBACK</button>
                <button id="btn-live" onClick={startLive} style={{ ...btnStyle, borderColor: "rgba(168,216,234,0.3)", color: "rgba(168,216,234,0.6)" }}>GO LIVE</button>
              </div>
              <button onClick={() => setConfigOpen(true)} style={{ marginTop: 24, background: "none", border: "none", color: "rgba(255,255,255,0.18)", fontSize: 10, cursor: "pointer", letterSpacing: 1.5, textTransform: "uppercase" }}>
                Configure ›
              </button>
            </>
          ) : (
            <div style={{ width: 480, display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 9.5, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Questions — one per line</div>
                <textarea
                  value={questionsText}
                  onChange={e => setQuestionsText(e.target.value)}
                  rows={7}
                  style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(255,255,255,0.65)", fontSize: 11.5, padding: "10px 12px", resize: "vertical", fontFamily: "'Inter',system-ui,sans-serif", lineHeight: 1.6, boxSizing: "border-box", outline: "none" }}
                />
              </div>
              <div>
                <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 9.5, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Participants — comma separated</div>
                <input
                  value={participantsText}
                  onChange={e => setParticipantsText(e.target.value)}
                  placeholder="e.g. Jerome, Ida, Norbert"
                  style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(255,255,255,0.65)", fontSize: 11.5, padding: "10px 12px", fontFamily: "'Inter',system-ui,sans-serif", boxSizing: "border-box", outline: "none" }}
                />
              </div>
              <div>
                <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 9.5, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Preamble to exclude</div>
                <textarea
                  value={preambleText}
                  onChange={e => setPreambleText(e.target.value)}
                  rows={4}
                  style={{ width: "100%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "rgba(255,255,255,0.4)", fontSize: 10.5, padding: "10px 12px", resize: "vertical", fontFamily: "'Inter',system-ui,sans-serif", lineHeight: 1.5, boxSizing: "border-box", outline: "none" }}
                />
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button onClick={() => setConfigOpen(false)} style={{ ...btnStyle, padding: "10px 28px", fontSize: 10 }}>Back</button>
                <button onClick={startLive} style={{ ...btnStyle, padding: "10px 28px", fontSize: 10, borderColor: "rgba(168,216,234,0.3)", color: "rgba(168,216,234,0.6)" }}>GO LIVE</button>
              </div>
            </div>
          )}

          {!configOpen && (
            <div style={{ position: "absolute", bottom: 40, display: "flex", gap: 20, flexWrap: "wrap", justifyContent: "center", maxWidth: 600 }}>
              {participantsText.split(",").map(p => p.trim()).filter(Boolean).map((name, i) => (
                <div key={name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: SPEAKER_COLORS[name] || "#888" }} />
                  <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>{name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SVG — zoom applied to inner <g> */}
      <svg
        ref={svgRef}
        width={dims.w}
        height={dims.h}
        style={{ position: "absolute", top: 0, left: 0, display: mode === "setup" ? "none" : "block" }}
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Arrowhead for question→response edges */}
          <marker id="arrow-qr" markerWidth="10" markerHeight="11" refX="9" refY="5.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M1,0.5 L9,5.5 L1,10.5" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          {/* Arrowhead for response→response edges */}
          <marker id="arrow-rr" markerWidth="10" markerHeight="11" refX="9" refY="5.5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M1,0.5 L9,5.5 L1,10.5" fill="none" stroke="rgba(255,255,255,0.42)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        </defs>
        {/* World space origin is 0,0; zoom transform translates this to screen center */}
        <g ref={gRef}>
          <g className="edges" />
          <g className="questions" />
          <g className="responses" />
        </g>
      </svg>

      {/* Participant legend */}
      {mode !== "setup" && (
        <div style={{ position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 620 }}>
          {(mode === "live"
            ? participantsText.split(",").map(p => p.trim()).filter(Boolean)
            : Object.keys(SPEAKER_COLORS)
          ).map(name => {
            const color = mode === "live"
              ? (identifiedSpeakers[name] || "rgba(255,255,255,0.18)")
              : SPEAKER_COLORS[name];
            return (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, opacity: 0.7 }} />
                <span style={{ color: "rgba(255,255,255,0.28)", fontSize: 9.5, letterSpacing: 0.3 }}>{name}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Live captions */}
      {mode === "live" && captionWords.length > 0 && (
        <div style={{
          position: "absolute",
          bottom: 52,
          left: "50%",
          transform: "translateX(-50%)",
          maxWidth: 760,
          width: "calc(100% - 80px)",
          background: "rgba(0,0,0,0.72)",
          padding: "9px 22px",
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.55,
          fontFamily: "'Hedvig Letters Sans', sans-serif",
          textAlign: "center",
          backdropFilter: "blur(10px)",
          zIndex: 150,
          letterSpacing: 0.2,
          pointerEvents: "none",
        }}>
          {captionWords.map(w => (
            <span key={w.key} className="caption-word">{w.text} </span>
          ))}
        </div>
      )}

      {/* Zoom hint */}
      {mode !== "setup" && (
        <div style={{ position: "absolute", bottom: 20, right: 20, color: "rgba(255,255,255,0.1)", fontSize: 9, letterSpacing: 0.5, textAlign: "right" }}>
          scroll to zoom · drag nodes · {mode === "live" ? "m = mock fallback" : ""}
        </div>
      )}

      {/* Pipeline status */}
      {mode === "live" && pipelineStatus && (
        <div style={{ position: "absolute", top: 18, right: 22, color: pipelineStatus === "connected" ? "#b5ead7" : "#f4b8c1", fontSize: 10, letterSpacing: 1, opacity: 0.6 }}>
          ● {pipelineStatus.toUpperCase().replace("_", " ")}
        </div>
      )}

      {/* Hover transcript overlay */}
      {hov && hovScreen && (
        <div style={{
          position: "absolute",
          left: Math.min(hovScreen.x + 14, dims.w - 310),
          top: Math.min(hovScreen.y + 14, dims.h - 220),
          maxWidth: 290,
          background: "rgba(8,8,14,0.95)",
          border: `1px solid ${(hov.color || SPEAKER_COLORS[hov.sp] || "#555")}33`,
          borderRadius: 11, padding: "14px 16px",
          pointerEvents: "none", zIndex: 200,
          animation: "fadeIn 0.22s ease-out",
          backdropFilter: "blur(12px)",
        }}>
          <div style={{ color: hov.color || SPEAKER_COLORS[hov.sp], fontSize: 9.5, fontWeight: 600, marginBottom: 8, letterSpacing: 0.7 }}>{hov.sp.toUpperCase()}</div>
          <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11.5, lineHeight: 1.65 }}>{transcriptText}</div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes wordFadeIn { from { opacity:0; } to { opacity:1; } }
        .caption-word { display:inline; color:rgba(255,255,255,0.92); animation:wordFadeIn 0.45s ease-out both; }
        button { transition: all 0.35s; }
        button:hover { opacity: 0.85; transform: scale(1.02); }
      `}</style>
    </div>
  );
}

const btnStyle = {
  background: "rgba(255,255,255,0.055)",
  border: "1px solid rgba(255,255,255,0.11)",
  color: "rgba(255,255,255,0.52)",
  padding: "13px 44px",
  borderRadius: 28,
  fontSize: 11.5,
  cursor: "pointer",
  letterSpacing: 2,
  fontFamily: "'Inter',system-ui,sans-serif",
};
