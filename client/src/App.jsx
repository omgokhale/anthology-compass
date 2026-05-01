import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import { SPEAKER_PALETTE } from "./data";

// ── Constants ────────────────────────────────────────────────────────────────
const BG = "#050508";
const Q_COLOR = "#e0e0e0";
const NW = 200, NH = 96;       // response node width / base height
const QW = 300;                 // question node width
const RING_R = 950;             // center → question ring radius
const RESP_D = 340;             // question → first response ring
const RESP_STEP = 200;          // additional radius per overflow ring
const PAD = 100;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

// ── Edge helpers ──────────────────────────────────────────────────────────────
function nodeSize(id) {
    return id.startsWith("q") ? { w: QW, h: 88 } : { w: NW, h: NH };
}

function edgePoint(cx, cy, tx, ty, w, h, gap = 16) {
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const hw = w / 2 + gap, hh = h / 2 + gap;
    const t = Math.min(hw / Math.abs(dx || Infinity), hh / Math.abs(dy || Infinity));
    return [cx + dx * t, cy + dy * t];
}

function edgePath(sPos, tPos, srcId, tgtId) {
    const ss = nodeSize(srcId), ts = nodeSize(tgtId);
    const [sx, sy] = edgePoint(sPos.x, sPos.y, tPos.x, tPos.y, ss.w, ss.h);
    const [ex, ey] = edgePoint(tPos.x, tPos.y, sPos.x, sPos.y, ts.w, ts.h);
    const mx = (sx + ex) / 2 - (ey - sy) * 0.12;
    const my = (sy + ey) / 2 + (ex - sx) * 0.12;
    return `M${sx},${sy} Q${mx},${my} ${ex},${ey}`;
}

// ── Layout ────────────────────────────────────────────────────────────────────
function layout(questions, responses, cx, cy) {
    const n = questions.length;
    const qp = {};
    questions.forEach((q, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        qp[q.id] = { x: cx + Math.cos(angle) * RING_R, y: cy + Math.sin(angle) * RING_R };
    });

    const grp = {};
    responses.forEach(r => { (grp[r.qId] = grp[r.qId] || []).push(r); });

    const rp = {};
    Object.entries(grp).forEach(([qId, arr]) => {
        const qPos = qp[qId];
        if (!qPos) return;
        const qa = Math.atan2(qPos.y - cy, qPos.x - cx);
        const PER_RING = 6;
        arr.forEach((r, i) => {
            const ring = Math.floor(i / PER_RING);
            const pos = i % PER_RING;
            const angle = qa + ring * (Math.PI / PER_RING) + (pos / PER_RING) * Math.PI * 2;
            rp[r.id] = {
                x: qPos.x + Math.cos(angle) * (RESP_D + ring * RESP_STEP),
                y: qPos.y + Math.sin(angle) * (RESP_D + ring * RESP_STEP),
            };
        });
    });

    return { qp, rp };
}

function computeFocusedViewBox(qId, qp, rp, responseMap, w, h) {
    const qPos = qp[qId];
    if (!qPos) return { x: -w / 2, y: -h / 2, w, h };
    const pts = [qPos, ...(responseMap[qId] || []).map(r => rp[r.id]).filter(Boolean)];
    if (pts.length < 2) return { x: qPos.x - w * 0.3, y: qPos.y - h * 0.3, w: w * 0.6, h: h * 0.6 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach(p => {
        x0 = Math.min(x0, p.x - NW); y0 = Math.min(y0, p.y - NH);
        x1 = Math.max(x1, p.x + NW); y1 = Math.max(y1, p.y + NH);
    });
    x0 -= PAD * 1.5; y0 -= PAD * 1.5; x1 += PAD * 1.5; y1 += PAD * 1.5;
    const scale = Math.min(w / (x1 - x0), h / (y1 - y0), 1.8);
    return { x: (x0 + x1) / 2 - w / scale / 2, y: (y0 + y1) / 2 - h / scale / 2, w: w / scale, h: h / scale };
}

// ── Node sizing helpers ───────────────────────────────────────────────────────
const R_MAX_CHARS = 24, R_LINE_H = 17, R_TOP_PAD = 24, R_BOT_PAD = 30;
const Q_MAX_CHARS = 34, Q_LINE_H = 18, Q_LABEL_Y = 16, Q_TEXT_GAP = 16, Q_BOT_PAD = 16;

function wrapLines(text, maxChars) {
    const words = (text || "").split(/\s+/);
    const lines = [];
    let cur = "";
    words.forEach(w => {
        const test = cur ? cur + " " + w : w;
        if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
        else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
}

function nodeNH(lineCount) { return R_TOP_PAD + lineCount * R_LINE_H + R_BOT_PAD; }
function nodeQH(lineCount) { return Q_LABEL_Y + Q_TEXT_GAP + lineCount * Q_LINE_H + Q_BOT_PAD; }

// ── Color: derive rich dark from pastel ───────────────────────────────────────
function richDark(hex) {
    const h = (hex || "#888888").replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2, d = max - min;
    let hDeg = 0, s = 0;
    if (d) {
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

// ── Main component ────────────────────────────────────────────────────────────
export default function ConversationBloom() {
    const containerRef = useRef(null);
    const svgRef = useRef(null);
    const gRef = useRef(null);
    const zoomRef = useRef(null);
    const posRef = useRef({});
    const audioRef = useRef(null);       // current Audio instance
    const playingIdRef = useRef(null);   // ref mirror of playingId for D3 closures

    const [dims, setDims] = useState({ w: 1200, h: 800 });
    const [mode, setMode] = useState("setup");   // "setup" | "loading" | "flowers" | "2x2"
    const [catalogId, setCatalogId] = useState("1208");
    const [loadError, setLoadError] = useState(null);

    // Loaded data
    const [questions, setQuestions] = useState([]);
    const [tiles, setTiles] = useState([]);
    const [speakers, setSpeakers] = useState([]);
    const [catalogTitle, setCatalogTitle] = useState("");
    const [activeQId, setActiveQId] = useState(null);
    const [hov, setHov] = useState(null);
    const [playingId, setPlayingId] = useState(null);

    // ── Resize observer ───────────────────────────────────────────────────────
    useEffect(() => {
        const ro = new ResizeObserver(entries => {
            for (const en of entries) setDims({ w: en.contentRect.width, h: en.contentRect.height });
        });
        if (containerRef.current) ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    // Keep ref in sync for D3 closures; clean up audio on unmount
    useEffect(() => { playingIdRef.current = playingId; }, [playingId]);
    useEffect(() => () => { audioRef.current?.pause(); }, []);

    // ── D3 zoom setup ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!svgRef.current || mode === "setup" || mode === "loading") return;
        const svg = d3.select(svgRef.current);
        const zoom = d3.zoom().scaleExtent([0.1, 6])
            .on("zoom", e => d3.select(gRef.current).attr("transform", e.transform));
        zoomRef.current = zoom;
        svg.call(zoom);
        svg.call(zoom.transform, d3.zoomIdentity.translate(dims.w / 2, dims.h / 2));
        return () => svg.on(".zoom", null);
    }, [mode, dims.w, dims.h]);

    // ── Load catalog from server ──────────────────────────────────────────────
    const loadCatalog = useCallback(async () => {
        setLoadError(null);
        setMode("loading");
        try {
            const res = await fetch(`${SERVER_URL}/api/catalog/${catalogId}`);
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();

            // Map server tiles to the shape D3 rendering expects
            const mapped = data.tiles.map(t => ({
                id: t.id,
                qId: t.questionId,
                sp: t.speakerName,
                color: t.speakerColor,
                sum: t.headline,
                transcript: t.text,
            }));

            setQuestions(data.questions.map(q => ({ id: q.id, text: q.text, fullText: q.fullText })));
            setTiles(mapped);
            setSpeakers(data.speakers);
            setCatalogTitle(data.title);
            posRef.current = {};
            setActiveQId(data.questions[0]?.id || null);
            setMode("flowers");
        } catch (err) {
            setLoadError(err.message);
            setMode("setup");
        }
    }, [catalogId]);

    // ── Focused zoom on active question ──────────────────────────────────────
    useEffect(() => {
        if (mode !== "flowers" || !activeQId || !zoomRef.current || !svgRef.current) return;
        const { w, h } = dims;
        const responseMap = {};
        tiles.forEach(t => { (responseMap[t.qId] = responseMap[t.qId] || []).push(t); });
        const { qp, rp } = layout(questions, tiles, 0, 0);
        const tvb = computeFocusedViewBox(activeQId, qp, rp, responseMap, w, h);
        const scale = w / tvb.w;
        d3.select(svgRef.current)
            .transition().duration(3800).ease(d3.easeSinInOut)
            .call(zoomRef.current.transform, d3.zoomIdentity.scale(scale).translate(-tvb.x, -tvb.y));
    }, [activeQId, mode, dims, questions, tiles]);

    // ── D3 render (Flowers) ───────────────────────────────────────────────────
    useEffect(() => {
        if (mode !== "flowers" || !svgRef.current || !gRef.current) return;

        const g = d3.select(gRef.current);
        const { qp, rp } = layout(questions, tiles, 0, 0);

        // Initialise positions for new nodes only
        questions.forEach(q => { if (!posRef.current[q.id]) posRef.current[q.id] = { ...qp[q.id] }; });
        tiles.forEach(t => { if (!posRef.current[t.id]) posRef.current[t.id] = { ...(rp[t.id] || { x: 0, y: 0 }) }; });

        const edges = tiles.map(t => ({ src: t.qId, tgt: t.id, tp: "qr" }));

        // ── Edges ─────────────────────────────────────────────────────────────
        const eG = g.select(".edges");
        const eSel = eG.selectAll("path").data(edges, d => d.src + "-" + d.tgt);
        eSel.exit().remove();
        const eEnt = eSel.enter().append("path")
            .attr("fill", "none")
            .attr("stroke", "rgba(255,255,255,0.14)")
            .attr("stroke-width", 0.9)
            .style("opacity", 0);

        eEnt.merge(eSel)
            .attr("d", d => {
                const s = posRef.current[d.src];
                const t = posRef.current[d.tgt];
                return s && t ? edgePath(s, t, d.src, d.tgt) : "";
            })
            .each(function () {
                const p = d3.select(this);
                if (+p.style("opacity") === 0) {
                    const len = this.getTotalLength?.() || 200;
                    p.attr("stroke-dasharray", len).attr("stroke-dashoffset", len)
                        .transition().delay(600).duration(2400).ease(d3.easeCubicOut)
                        .style("opacity", 1).attr("stroke-dashoffset", 0)
                        .on("end", function () { d3.select(this).attr("stroke-dasharray", null).attr("stroke-dashoffset", null); });
                }
            });

        // ── Question nodes ────────────────────────────────────────────────────
        const qG = g.select(".questions");
        const qSel = qG.selectAll("g.qn").data(questions, d => d.id);
        qSel.exit().remove();
        const qEnt = qSel.enter().append("g").attr("class", "qn").style("opacity", 0).style("filter", "blur(14px)");

        qEnt.append("rect").attr("rx", 24).attr("ry", 24).attr("width", QW)
            .attr("fill", "#050508").attr("fill-opacity", 1).attr("stroke", "none")
            .each(function (d) {
                const qh = nodeQH(wrapLines(d.text, Q_MAX_CHARS).length);
                d3.select(this).attr("height", qh).attr("x", -QW / 2).attr("y", -qh / 2);
            });

        qEnt.append("text").attr("text-anchor", "middle").attr("x", 0)
            .attr("fill", Q_COLOR).attr("fill-opacity", 0.32).attr("font-size", "8px")
            .attr("font-family", "'Hedvig Letters Sans', sans-serif").attr("letter-spacing", "2px")
            .text("QUESTION")
            .each(function (d) {
                const qh = nodeQH(wrapLines(d.text, Q_MAX_CHARS).length);
                d3.select(this).attr("y", -qh / 2 + Q_LABEL_Y);
            });

        qEnt.append("text").attr("text-anchor", "middle")
            .attr("fill", Q_COLOR).attr("fill-opacity", 0.88).attr("font-size", "13px")
            .attr("font-family", "'Hedvig Letters Serif', serif")
            .each(function (d) {
                const el = d3.select(this);
                const lines = wrapLines(d.text, Q_MAX_CHARS);
                const qh = nodeQH(lines.length);
                const startY = -qh / 2 + Q_LABEL_Y + Q_TEXT_GAP;
                lines.forEach((l, i) => el.append("tspan").attr("x", 0).attr("y", startY + i * Q_LINE_H).text(l));
            });

        qEnt.attr("transform", d => {
            const p = posRef.current[d.id];
            return p ? `translate(${p.x},${p.y})` : "translate(0,0)";
        }).transition().duration(3200).ease(d3.easeCubicOut)
            .style("opacity", 1).style("filter", "blur(0px)");

        // ── Response nodes ────────────────────────────────────────────────────
        const rG = g.select(".responses");
        const rSel = rG.selectAll("g.rn").data(tiles, d => d.id);
        rSel.exit().remove();
        const rEnt = rSel.enter().append("g").attr("class", "rn")
            .style("opacity", 0).style("filter", "blur(18px)").attr("cursor", "grab");

        rEnt.append("rect").attr("rx", 6).attr("ry", 6).attr("width", NW)
            .attr("fill", d => d.color || "#c0c0c0").attr("fill-opacity", 1).attr("stroke", "none")
            .each(function (d) {
                const nh = nodeNH(wrapLines(d.sum, R_MAX_CHARS).length);
                d3.select(this).attr("height", nh).attr("x", -NW / 2).attr("y", -nh / 2);
            });

        rEnt.append("text").attr("class", "stx").attr("font-size", "13px")
            .attr("font-family", "'Hedvig Letters Sans', sans-serif").attr("font-weight", 400)
            .each(function (d) {
                const el = d3.select(this);
                const lines = wrapLines(d.sum, R_MAX_CHARS);
                const nh = nodeNH(lines.length);
                el.attr("fill", richDark(d.color || "#888888"));
                lines.forEach((l, i) => el.append("tspan").attr("x", -NW / 2 + 14).attr("y", -nh / 2 + R_TOP_PAD + i * R_LINE_H).text(l));
            });

        rEnt.append("circle").attr("class", "spk-dot").attr("r", 3.5)
            .attr("fill", d => richDark(d.color || "#888888")).attr("fill-opacity", 0.6)
            .each(function (d) {
                const nh = nodeNH(wrapLines(d.sum, R_MAX_CHARS).length);
                d3.select(this).attr("cx", -NW / 2 + 14).attr("cy", nh / 2 - 15);
            });

        rEnt.append("text").attr("class", "spk")
            .attr("fill", d => richDark(d.color || "#888888")).attr("fill-opacity", 0.7)
            .attr("font-size", "9px").attr("font-family", "'Hedvig Letters Sans', sans-serif")
            .attr("letter-spacing", "0.5px").text(d => d.sp)
            .each(function (d) {
                const nh = nodeNH(wrapLines(d.sum, R_MAX_CHARS).length);
                d3.select(this).attr("x", -NW / 2 + 24).attr("y", nh / 2 - 11);
            });

        rEnt.on("mouseenter", (_, d) => setHov(d)).on("mouseleave", () => setHov(null));

        rEnt.on("click", (event, d) => {
            event.stopPropagation();
            const highlightId = d.id.slice(1);  // strip "h" prefix
            if (playingIdRef.current === d.id) {
                audioRef.current?.pause();
                setPlayingId(null);
            } else {
                if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
                const audio = new Audio(`${SERVER_URL}/api/audio/highlight/${highlightId}`);
                audioRef.current = audio;
                audio.play().catch(() => {});
                audio.onended = () => setPlayingId(null);
                setPlayingId(d.id);
            }
        });

        // Drag
        const drag = d3.drag()
            .on("start", function () { d3.select(this).attr("cursor", "grabbing"); })
            .on("drag", function (event, d) {
                const p = posRef.current[d.id];
                if (!p) return;
                p.x = event.x; p.y = event.y;
                d3.select(this).attr("transform", `translate(${p.x},${p.y})`);
                g.select(".edges").selectAll("path").attr("d", ed => {
                    const s = posRef.current[ed.src], t = posRef.current[ed.tgt];
                    return s && t ? edgePath(s, t, ed.src, ed.tgt) : "";
                });
            })
            .on("end", function () { d3.select(this).attr("cursor", "grab"); });

        rEnt.call(drag);
        rEnt.merge(rSel).call(drag);

        rEnt.attr("transform", d => {
            const p = posRef.current[d.id];
            return p ? `translate(${p.x},${p.y})` : "translate(0,0)";
        }).transition().duration(3200).ease(d3.easeCubicOut)
            .style("opacity", 1).style("filter", "blur(0px)");

    }, [mode, questions, tiles, dims]);

    // ── Playing indicator — update tile border without full D3 re-render ────────
    useEffect(() => {
        if (!gRef.current) return;
        d3.select(gRef.current).selectAll("g.rn").each(function (d) {
            const isPlaying = d.id === playingId;
            d3.select(this).select("rect")
                .attr("stroke", isPlaying ? (d.color || "#fff") : "none")
                .attr("stroke-width", isPlaying ? 2 : 0)
                .attr("stroke-opacity", isPlaying ? 0.9 : 0);
        });
    }, [playingId]);

    // ── Hover screen position ─────────────────────────────────────────────────
    const hovScreen = (() => {
        if (!hov || !svgRef.current) return null;
        const p = posRef.current[hov.id];
        if (!p) return null;
        const [sx, sy] = d3.zoomTransform(svgRef.current).apply([p.x, p.y]);
        return { x: sx, y: sy };
    })();

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div ref={containerRef} style={{ width: "100%", height: "100vh", background: BG, position: "relative", overflow: "hidden", fontFamily: "'Inter',system-ui,sans-serif" }}>

            {/* Setup screen */}
            {mode === "setup" && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
                    <div style={{ color: "rgba(255,255,255,0.18)", fontSize: 11, letterSpacing: 6, textTransform: "uppercase", marginBottom: 32 }}>Conversation Bloom</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16 }}>
                        <input
                            value={catalogId}
                            onChange={e => setCatalogId(e.target.value)}
                            placeholder="Catalog ID"
                            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 8, color: "rgba(255,255,255,0.7)", fontSize: 13, padding: "10px 14px", width: 180, outline: "none", fontFamily: "'Inter',system-ui,sans-serif" }}
                        />
                        <button onClick={loadCatalog} style={btnStyle}>LOAD</button>
                    </div>
                    {loadError && (
                        <div style={{ color: "#f4b8c1", fontSize: 11, marginTop: 8, opacity: 0.8 }}>{loadError}</div>
                    )}
                </div>
            )}

            {/* Loading screen */}
            {mode === "loading" && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
                    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 11, letterSpacing: 4, textTransform: "uppercase" }}>Loading catalog {catalogId}…</div>
                    <div style={{ color: "rgba(255,255,255,0.12)", fontSize: 10, marginTop: 12 }}>Fetching + generating headlines with Claude</div>
                </div>
            )}

            {/* SVG visualization */}
            <svg ref={svgRef} width={dims.w} height={dims.h}
                style={{ position: "absolute", top: 0, left: 0, display: mode === "setup" || mode === "loading" ? "none" : "block" }}>
                <defs>
                    <marker id="arrow-qr" markerWidth="10" markerHeight="11" refX="9" refY="5.5" orient="auto" markerUnits="userSpaceOnUse">
                        <path d="M1,0.5 L9,5.5 L1,10.5" fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" />
                    </marker>
                </defs>
                <g ref={gRef}>
                    <g className="edges" />
                    <g className="questions" />
                    <g className="responses" />
                </g>
            </svg>

            {/* Top bar: title + view toggle */}
            {(mode === "flowers" || mode === "2x2") && (
                <div style={{ position: "absolute", top: 18, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", maxWidth: 320, textAlign: "center" }}>{catalogTitle}</div>
                    <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => setMode("flowers")} style={{ ...toggleBtn, borderColor: mode === "flowers" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.1)", color: mode === "flowers" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)" }}>Flowers</button>
                        <button onClick={() => setMode("2x2")} style={{ ...toggleBtn, borderColor: mode === "2x2" ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.1)", color: mode === "2x2" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)" }}>2×2</button>
                    </div>
                </div>
            )}

            {/* 2x2 placeholder */}
            {mode === "2x2" && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ color: "rgba(255,255,255,0.15)", fontSize: 13, letterSpacing: 1 }}>2×2 view — coming soon</div>
                </div>
            )}

            {/* Speaker legend */}
            {(mode === "flowers" || mode === "2x2") && speakers.length > 0 && (
                <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 680, background: "rgba(0,0,0,0.35)", padding: "6px 16px", borderRadius: 12 }}>
                    {speakers.map(({ name, color }) => (
                        <div key={name} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, opacity: 0.8 }} />
                            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 9.5, letterSpacing: 0.3 }}>{name}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Question nav */}
            {mode === "flowers" && questions.length > 0 && (
                <div style={{ position: "absolute", top: 60, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 8 }}>
                    {questions.map(q => (
                        <button key={q.id} onClick={() => setActiveQId(q.id)} style={{ ...toggleBtn, borderColor: activeQId === q.id ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.08)", color: activeQId === q.id ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {q.text.slice(0, 28)}{q.text.length > 28 ? "…" : ""}
                        </button>
                    ))}
                </div>
            )}

            {/* Hint */}
            {mode === "flowers" && (
                <div style={{ position: "absolute", bottom: 52, right: 20, color: "rgba(255,255,255,0.1)", fontSize: 9, letterSpacing: 0.5 }}>
                    scroll to zoom · drag nodes
                </div>
            )}

            {/* Hover overlay */}
            {hov && hovScreen && (
                <div style={{
                    position: "absolute",
                    left: Math.min(hovScreen.x + 14, dims.w - 310),
                    top: Math.min(hovScreen.y + 14, dims.h - 220),
                    maxWidth: 290,
                    background: "rgba(8,8,14,0.95)",
                    border: `1px solid ${hov.color || "#555"}33`,
                    borderRadius: 11, padding: "14px 16px",
                    pointerEvents: "none", zIndex: 200,
                    animation: "fadeIn 0.22s ease-out",
                    backdropFilter: "blur(12px)",
                }}>
                    <div style={{ color: hov.color, fontSize: 9.5, fontWeight: 600, marginBottom: 8, letterSpacing: 0.7 }}>{hov.sp.toUpperCase()}</div>
                    <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11.5, lineHeight: 1.65 }}>{hov.transcript}</div>
                </div>
            )}

            <style>{`
                @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
                button { transition: all 0.3s; }
                button:hover { opacity: 0.85; }
            `}</style>
        </div>
    );
}

const btnStyle = {
    background: "rgba(255,255,255,0.055)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "rgba(255,255,255,0.55)",
    padding: "12px 36px",
    borderRadius: 28,
    fontSize: 11,
    cursor: "pointer",
    letterSpacing: 2,
    fontFamily: "'Inter',system-ui,sans-serif",
};

const toggleBtn = {
    background: "none",
    border: "1px solid",
    padding: "5px 14px",
    borderRadius: 20,
    fontSize: 10,
    cursor: "pointer",
    letterSpacing: 1.5,
    fontFamily: "'Inter',system-ui,sans-serif",
    textTransform: "uppercase",
};
