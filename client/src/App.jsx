import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

// ── Theme clusters ────────────────────────────────────────────────────────────
const CLUSTER_COLORS = {
    Learning:  "#65ABF0",
    Safety:    "#FF5F1F",
    Wellbeing: "#F392D1",
    Autonomy:  "#B167CD",
    Community: "#54A96D",
    Policy:    "#E3A023",
    Other:     "#BFA99F",
};
const CLUSTER_LABELS = {
    Learning:  "Learning & Focus",
    Safety:    "Safety & Access",
    Wellbeing: "Wellbeing",
    Autonomy:  "Autonomy & Rights",
    Community: "Community",
    Policy:    "Policy Design",
    Other:     "Other",
};
const CLUSTER_ORDER = ["Learning", "Safety", "Wellbeing", "Autonomy", "Community", "Policy"];

// ── Quadrant exemplars ────────────────────────────────────────────────────────
// Fixed in viewport corners at 20px margins
const EXEMPLARS = [
    { lines: ["Rules help",  "everyone focus"],        corner: { top: 20,    left: 20  }, align: "left"  },
    { lines: ["Phones are",  "structurally essential"], corner: { top: 20,    right: 20 }, align: "right" },
    { lines: ["Honestly, I", "get pulled by it"],       corner: { bottom: 20, left: 20  }, align: "left"  },
    { lines: ["My family",   "needed me"],              corner: { bottom: 20, right: 20 }, align: "right" },
];

// ── Compass color — bilinear blend across 4 quadrant corners ─────────────────
const COMPASS_CORNERS = {
    NW: [101, 171, 240],  // #65ABF0 soft blue      (distraction + claim)
    NE: [177, 103, 205],  // #B167CD soft purple    (lifeline + claim)
    SW: [243, 146, 209],  // #F392D1 soft pink      (distraction + experience)
    SE: [ 84, 169, 109],  // #54A96D sage green     (lifeline + experience)
};

function compassColor(cx, cy) {
    const nx = Math.max(0, Math.min(1, (cx + 1) / 2));
    const ny = Math.max(0, Math.min(1, (cy + 1) / 2));
    const [r, g, b] = [0, 1, 2].map(i =>
        COMPASS_CORNERS.NW[i] * (1 - nx) * (1 - ny) +
        COMPASS_CORNERS.NE[i] *      nx  * (1 - ny) +
        COMPASS_CORNERS.SW[i] * (1 - nx) *      ny  +
        COMPASS_CORNERS.SE[i] *      nx  *      ny
    );
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

// ── Constants ────────────────────────────────────────────────────────────────
const BG = "#ffffff";
const Q_COLOR = "#1a1a1a";
const NW = 200, NH = 96;
const QW = 300;
const RING_R = 4800;
const RESP_D = 360;
const RESP_STEP = 180;
const PAD = 100;
const SERVER_URL = "";

// ── Edge helpers ──────────────────────────────────────────────────────────────
function nodeSize(id) { return id.startsWith("q") ? { w: QW, h: 88 } : { w: NW, h: NH }; }

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

// ── Flowers layout ────────────────────────────────────────────────────────────
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
        const PER_RING = 16;
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

// ── Node sizing ───────────────────────────────────────────────────────────────
const R_MAX_CHARS = 24, R_LINE_H = 17, R_TOP_PAD = 24, R_BOT_PAD = 30;
const Q_MAX_CHARS = 34, Q_LINE_H = 18, Q_LABEL_Y = 16, Q_TEXT_GAP = 16, Q_BOT_PAD = 16;

function wrapLines(text, maxChars) {
    const words = (text || "").split(/\s+/);
    const lines = []; let cur = "";
    words.forEach(w => {
        const test = cur ? cur + " " + w : w;
        if (test.length > maxChars && cur) { lines.push(cur); cur = w; } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
}

function nodeNH(lc) { return R_TOP_PAD + lc * R_LINE_H + R_BOT_PAD; }
function nodeQH(lc) { return Q_LABEL_Y + Q_TEXT_GAP + lc * Q_LINE_H + Q_BOT_PAD; }

function richDark(hex) {
    const h = (hex || "#888888").replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let hDeg = 0, s = 0;
    if (d) {
        s = d / (1 - Math.abs(2 * l - 1));
        if (max === r) hDeg = ((g - b) / d) % 6;
        else if (max === g) hDeg = (b - r) / d + 2;
        else hDeg = (r - g) / d + 4;
        hDeg = hDeg * 60; if (hDeg < 0) hDeg += 360;
    }
    const newL = 0.28, newS = Math.min(1, s * 1.1);
    const c = (1 - Math.abs(2 * newL - 1)) * newS, x = c * (1 - Math.abs((hDeg / 60) % 2 - 1)), m = newL - c / 2;
    let r2, g2, b2;
    if (hDeg < 60) { r2 = c; g2 = x; b2 = 0; } else if (hDeg < 120) { r2 = x; g2 = c; b2 = 0; }
    else if (hDeg < 180) { r2 = 0; g2 = c; b2 = x; } else if (hDeg < 240) { r2 = 0; g2 = x; b2 = c; }
    else if (hDeg < 300) { r2 = x; g2 = 0; b2 = c; } else { r2 = c; g2 = 0; b2 = x; }
    const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
}

// ── Audio helpers ─────────────────────────────────────────────────────────────
function startAudio(id, audioRef, playingIdRef, setPlayingId) {
    if (playingIdRef.current === id) {
        if (audioRef.current && audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
            setPlayingId(id);
        }
        return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    const audio = new Audio(`/api/audio/highlight/${id.slice(1)}`);
    audioRef.current = audio;
    playingIdRef.current = id;
    setPlayingId(id);
    audio.play().catch(() => {});
    audio.onended = () => { playingIdRef.current = null; setPlayingId(null); };
}

function stopAudio(audioRef, playingIdRef, setPlayingId) {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
    playingIdRef.current = null;
    setPlayingId(null);
}

function clickAudio(id, audioRef, playingIdRef, setPlayingId) {
    if (playingIdRef.current === id && audioRef.current) {
        if (audioRef.current.paused) {
            audioRef.current.play().catch(() => {});
            setPlayingId(id);
        } else {
            audioRef.current.pause();
            setPlayingId(null);
        }
    } else {
        startAudio(id, audioRef, playingIdRef, setPlayingId);
    }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ConversationBloom() {
    const containerRef = useRef(null);
    const svgRef      = useRef(null);   // main SVG (flowers / force / compass)
    const gRef        = useRef(null);   // main <g> inside main SVG
    const bubbleSvgRef  = useRef(null);  // separate SVG for bubbles
    const zoomRef       = useRef(null);
    const posRef        = useRef({});
    const audioRef      = useRef(null);
    const playingIdRef  = useRef(null);
    const bubbleGoBackRef = useRef(null); // imperative goBack fn for bubble chart

    const [dims, setDims]             = useState({ w: 1200, h: 800 });
    const [mode, setMode]             = useState("setup");   // setup | loading | ready
    const [view, setView]             = useState("compass");
    const [catalogId, setCatalogId]   = useState("1208");
    const [loadError, setLoadError]   = useState(null);
    const [questions, setQuestions]   = useState([]);
    const [tiles, setTiles]           = useState([]);
    const [catalogTitle, setCatalogTitle] = useState("");
    const [activeQId, setActiveQId]   = useState(null);
    const [hov, setHov]               = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [playingId, setPlayingId]   = useState(null);
    const [bubbleDetail, setBubbleDetail] = useState(null); // focused cluster id, or null
    const [zoomT, setZoomT]           = useState({ x: dims.w / 2, y: dims.h / 2, k: 1 });

    const selectedIdRef = useRef(null);
    const hovRef        = useRef(null);

    // clear bubble detail on view switch
    useEffect(() => { setBubbleDetail(null); }, [view]);

    // ── Resize ────────────────────────────────────────────────────────────────
    useEffect(() => {
        const ro = new ResizeObserver(entries => {
            for (const en of entries) setDims({ w: en.contentRect.width, h: en.contentRect.height });
        });
        if (containerRef.current) ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);

    useEffect(() => { playingIdRef.current = playingId; }, [playingId]);
    useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
    useEffect(() => { hovRef.current = hov; }, [hov]);
    useEffect(() => () => { audioRef.current?.pause(); }, []);

    // When selection changes, scale down any dot that's neither selected nor hovered
    useEffect(() => {
        if (!gRef.current) return;
        d3.select(gRef.current).selectAll("circle.cdot")
            .filter(d => d.id !== selectedId && (!hovRef.current || d.id !== hovRef.current.id))
            .transition("size").duration(200).attr("r", 6);
    }, [selectedId]);

    // ── "P" key → animate back to default zoom ────────────────────────────────
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== "p" && e.key !== "P") return;
            if (!svgRef.current || !zoomRef.current) return;
            d3.select(svgRef.current)
                .transition().duration(700).ease(d3.easeCubicInOut)
                .call(zoomRef.current.transform, d3.zoomIdentity.translate(dims.w / 2, dims.h / 2));
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [dims.w, dims.h]);

    // ── Zoom setup (main SVG) ─────────────────────────────────────────────────
    useEffect(() => {
        if (!svgRef.current || mode !== "ready") return;
        const svg = d3.select(svgRef.current);
        const zoom = d3.zoom()
            .scaleExtent([1, 6])
            .translateExtent([[-dims.w / 2, -dims.h / 2], [dims.w / 2, dims.h / 2]])
            .on("zoom", e => {
                d3.select(gRef.current).attr("transform", e.transform);
                setZoomT({ x: e.transform.x, y: e.transform.y, k: e.transform.k });
            });
        zoomRef.current = zoom;
        svg.call(zoom);
        svg.call(zoom.transform, d3.zoomIdentity.translate(dims.w / 2, dims.h / 2));
        return () => svg.on(".zoom", null);
    }, [mode, dims.w, dims.h]);

    // ── Load catalog ──────────────────────────────────────────────────────────
    const loadCatalog = useCallback(async () => {
        setLoadError(null); setMode("loading");
        try {
            const res = await fetch(`${SERVER_URL}/api/catalog/${catalogId}`);
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            const data = await res.json();
            const mapped = data.tiles.filter(t => t.relevant !== false).map(t => ({
                id: t.id,
                qId: t.questionId,
                sp: t.speakerName,
                color: compassColor(t.compassX ?? 0, t.compassY ?? 0),
                themeCluster: t.themeCluster || "Other",
                compassX: t.compassX ?? 0,
                compassY: t.compassY ?? 0,
                sum: t.headline,
                transcript: t.text,
            }));
            setQuestions(data.questions.map(q => ({ id: q.id, text: q.text, fullText: q.fullText })));
            setTiles(mapped);
            setCatalogTitle(data.title);
            posRef.current = {};
            setActiveQId(data.questions[0]?.id || null);
            setMode("ready");
        } catch (err) {
            setLoadError(err.message); setMode("setup");
        }
    }, [catalogId]);

    // ── Focused zoom on active question (flowers) ─────────────────────────────
    useEffect(() => {
        if (mode !== "ready" || view !== "flowers" || !activeQId || !zoomRef.current || !svgRef.current) return;
        const { w, h } = dims;
        const responseMap = {};
        tiles.forEach(t => { (responseMap[t.qId] = responseMap[t.qId] || []).push(t); });
        const { qp, rp } = layout(questions, tiles, 0, 0);
        const tvb = computeFocusedViewBox(activeQId, qp, rp, responseMap, w, h);
        const scale = w / tvb.w;
        d3.select(svgRef.current).transition().duration(3800).ease(d3.easeSinInOut)
            .call(zoomRef.current.transform, d3.zoomIdentity.scale(scale).translate(-tvb.x, -tvb.y));
    }, [activeQId, mode, view, dims, questions, tiles]);

    // ── D3 render: Flowers ────────────────────────────────────────────────────
    useEffect(() => {
        if (mode !== "ready" || view !== "flowers" || !gRef.current) return;
        const g = d3.select(gRef.current);
        g.select(".force-layer").style("display", "none");
        g.select(".compass-layer").style("display", "none");
        g.select(".edges").style("display", null);
        g.select(".questions").style("display", null);
        g.select(".responses").style("display", null);

        const { qp, rp } = layout(questions, tiles, 0, 0);
        questions.forEach(q => { if (!posRef.current[q.id]) posRef.current[q.id] = { ...qp[q.id] }; });
        tiles.forEach(t => { if (!posRef.current[t.id]) posRef.current[t.id] = { ...(rp[t.id] || { x: 0, y: 0 }) }; });

        const edges = tiles.map(t => ({ src: t.qId, tgt: t.id }));
        const eG = g.select(".edges");
        const eSel = eG.selectAll("path").data(edges, d => d.src + "-" + d.tgt);
        eSel.exit().remove();
        const eEnt = eSel.enter().append("path").attr("fill", "none")
            .attr("stroke", "rgba(0,0,0,0.12)").attr("stroke-width", 0.9).style("opacity", 0);
        eEnt.merge(eSel)
            .attr("d", d => { const s = posRef.current[d.src], t = posRef.current[d.tgt]; return s && t ? edgePath(s, t, d.src, d.tgt) : ""; })
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

        const qG = g.select(".questions");
        const qSel = qG.selectAll("g.qn").data(questions, d => d.id);
        qSel.exit().remove();
        const qEnt = qSel.enter().append("g").attr("class", "qn").style("opacity", 0).style("filter", "blur(14px)");

        qEnt.append("rect").attr("rx", 24).attr("ry", 24).attr("width", QW)
            .attr("fill", BG).attr("stroke", "none")
            .each(function (d) { const qh = nodeQH(wrapLines(d.text, Q_MAX_CHARS).length); d3.select(this).attr("height", qh).attr("x", -QW / 2).attr("y", -qh / 2); });
        qEnt.append("text").attr("text-anchor", "middle").attr("x", 0)
            .attr("fill", Q_COLOR).attr("fill-opacity", 0.32).attr("font-size", "8px")
            .attr("font-family", "'Hedvig Letters Sans', sans-serif").attr("letter-spacing", "2px").text("QUESTION")
            .each(function (d) { const qh = nodeQH(wrapLines(d.text, Q_MAX_CHARS).length); d3.select(this).attr("y", -qh / 2 + Q_LABEL_Y); });
        qEnt.append("text").attr("text-anchor", "middle").attr("fill", Q_COLOR).attr("fill-opacity", 0.88)
            .attr("font-size", "13px").attr("font-family", "'Hedvig Letters Serif', serif")
            .each(function (d) {
                const el = d3.select(this);
                const lines = wrapLines(d.text, Q_MAX_CHARS);
                const qh = nodeQH(lines.length);
                const startY = -qh / 2 + Q_LABEL_Y + Q_TEXT_GAP;
                lines.forEach((l, i) => el.append("tspan").attr("x", 0).attr("y", startY + i * Q_LINE_H).text(l));
            });
        qEnt.attr("transform", d => { const p = posRef.current[d.id]; return p ? `translate(${p.x},${p.y})` : "translate(0,0)"; })
            .transition().duration(3200).ease(d3.easeCubicOut).style("opacity", 1).style("filter", "blur(0px)");

        const rG = g.select(".responses");
        const rSel = rG.selectAll("g.rn").data(tiles, d => d.id);
        rSel.exit().remove();
        const rEnt = rSel.enter().append("g").attr("class", "rn")
            .style("opacity", 0).style("filter", "blur(18px)").attr("cursor", "grab");

        rEnt.append("rect").attr("rx", 6).attr("ry", 6).attr("width", NW)
            .attr("fill", d => d.color).attr("stroke", "none")
            .each(function (d) { const nh = nodeNH(wrapLines(d.sum, R_MAX_CHARS).length); d3.select(this).attr("height", nh).attr("x", -NW / 2).attr("y", -nh / 2); });
        rEnt.append("text").attr("class", "stx").attr("font-size", "13px")
            .attr("font-family", "'Hedvig Letters Sans', sans-serif")
            .each(function (d) {
                const el = d3.select(this); const lines = wrapLines(d.sum, R_MAX_CHARS);
                const nh = nodeNH(lines.length);
                el.attr("fill", richDark(d.color));
                lines.forEach((l, i) => el.append("tspan").attr("x", -NW / 2 + 14).attr("y", -nh / 2 + R_TOP_PAD + i * R_LINE_H).text(l));
            });

        rEnt.on("mouseenter", (event, d) => { setHov(d); })
            .on("mouseleave", () => setHov(null));

        const drag = d3.drag()
            .on("start", function (event, d) { d3.select(this).attr("cursor", "grabbing"); d.__dragOrigin = [event.x, event.y]; d.__dragMoved = false; })
            .on("drag", function (event, d) {
                const dx = event.x - d.__dragOrigin[0], dy = event.y - d.__dragOrigin[1];
                if (Math.sqrt(dx * dx + dy * dy) > 4) d.__dragMoved = true;
                if (!d.__dragMoved) return;
                const p = posRef.current[d.id]; if (!p) return;
                p.x = event.x; p.y = event.y;
                d3.select(this).attr("transform", `translate(${p.x},${p.y})`);
                g.select(".edges").selectAll("path").attr("d", ed => { const s = posRef.current[ed.src], t = posRef.current[ed.tgt]; return s && t ? edgePath(s, t, ed.src, ed.tgt) : ""; });
            })
            .on("end", function (_, d) {
                d3.select(this).attr("cursor", "grab");
                if (d.__dragMoved) return;
                clickAudio(d.id, audioRef, playingIdRef, setPlayingId);
            });
        rEnt.call(drag);
        rEnt.merge(rSel).call(drag);
        rEnt.attr("transform", d => { const p = posRef.current[d.id]; return p ? `translate(${p.x},${p.y})` : "translate(0,0)"; })
            .transition().duration(3200).ease(d3.easeCubicOut).style("opacity", 1).style("filter", "blur(0px)");
    }, [mode, view, questions, tiles, dims]);

    // ── Playing indicator (flowers) ───────────────────────────────────────────
    useEffect(() => {
        if (!gRef.current || view !== "flowers") return;
        d3.select(gRef.current).selectAll("g.rn").each(function (d) {
            const isPlaying = d.id === playingId;
            d3.select(this).select("rect")
                .attr("stroke", isPlaying ? (d.color || "#fff") : "none")
                .attr("stroke-width", isPlaying ? 2 : 0)
                .attr("stroke-opacity", isPlaying ? 0.9 : 0);
        });
    }, [playingId, view]);


    // ── D3 render: Bubble chart ───────────────────────────────────────────────
    useEffect(() => {
        if (mode !== "ready" || view !== "bubbles" || !bubbleSvgRef.current) return;
        const bsvg = d3.select(bubbleSvgRef.current);
        bsvg.selectAll("*").remove();
        const w = dims.w, h = dims.h;

        // Cluster data — radius proportional to √(tile count)
        const clusterData = CLUSTER_ORDER
            .map(name => ({
                id: name, label: CLUSTER_LABELS[name], color: CLUSTER_COLORS[name],
                tiles: tiles.filter(t => t.themeCluster === name),
            }))
            .filter(c => c.tiles.length > 0);

        const maxCount = Math.max(...clusterData.map(c => c.tiles.length));
        const maxR = Math.min(w, h) * 0.21;
        clusterData.forEach(c => { c.r = Math.sqrt(c.tiles.length / maxCount) * maxR; });

        // Force-position cluster circles
        const cnodes = clusterData.map((c, i) => ({
            ...c,
            x: w / 2 + Math.cos((i / clusterData.length) * Math.PI * 2) * 180,
            y: h / 2 + Math.sin((i / clusterData.length) * Math.PI * 2) * 180,
        }));
        const csim = d3.forceSimulation(cnodes)
            .force("center", d3.forceCenter(w / 2, h / 2))
            .force("charge", d3.forceManyBody().strength(-15))
            .force("collide", d3.forceCollide(d => d.r + 26))
            .stop();
        for (let i = 0; i < 300; i++) csim.tick();
        cnodes.forEach(c => { c.ox = c.x; c.oy = c.y; c.or = c.r; });

        const overviewG = bsvg.append("g").attr("class", "overview");
        let focusedNode = null;

        cnodes.forEach(cn => {
            const cg = overviewG.append("g").attr("class", `cg cg-${cn.id}`);

            cg.append("circle").attr("class", "cbubble")
                .attr("cx", cn.x).attr("cy", cn.y).attr("r", cn.r)
                .attr("fill", cn.color).attr("fill-opacity", 0.28)
                .attr("stroke", richDark(cn.color)).attr("stroke-opacity", 0.35).attr("stroke-width", 1.5)
                .attr("cursor", "pointer")
                .on("click", () => expandCluster(cn));

            cg.append("text").attr("class", "clabel")
                .attr("x", cn.x).attr("y", cn.y - 8).attr("text-anchor", "middle")
                .attr("fill", richDark(cn.color)).attr("fill-opacity", 0.9)
                .attr("font-size", Math.min(18, cn.r * 0.17) + "px")
                .attr("font-family", "'Hedvig Letters Sans', sans-serif")
                .attr("letter-spacing", "2px").attr("pointer-events", "none")
                .text(cn.label.toUpperCase());

            cg.append("text").attr("class", "ccount")
                .attr("x", cn.x).attr("y", cn.y + Math.min(18, cn.r * 0.17) + 10)
                .attr("text-anchor", "middle")
                .attr("fill", richDark(cn.color)).attr("fill-opacity", 0.55)
                .attr("font-size", Math.min(13, cn.r * 0.11) + "px")
                .attr("font-family", "'Hedvig Letters Sans', sans-serif")
                .attr("pointer-events", "none")
                .text(`${cn.tiles.length} voices`);
        });

        function expandCluster(cn) {
            focusedNode = cn;
            setBubbleDetail(cn.id);
            const targetR = Math.min(w, h) * 0.44;

            // Fade out other clusters
            overviewG.selectAll(".cg")
                .filter(function () { return !d3.select(this).classed(`cg-${cn.id}`); })
                .transition().duration(560).style("opacity", 0).style("pointer-events", "none");

            // Expand selected circle to center
            overviewG.select(`.cg-${cn.id} .cbubble`)
                .transition().duration(700).ease(d3.easeCubicInOut)
                .attr("cx", w / 2).attr("cy", h / 2).attr("r", targetR)
                .attr("fill-opacity", 0.12).attr("stroke-opacity", 0.2);

            overviewG.select(`.cg-${cn.id} .clabel`).transition().duration(280).style("opacity", 0);
            overviewG.select(`.cg-${cn.id} .ccount`).transition().duration(280).style("opacity", 0);

            setTimeout(() => showTiles(cn, targetR), 780);
        }

        function showTiles(cn, containerR) {
            const minLen = Math.min(...cn.tiles.map(t => t.transcript.length));
            const maxLen = Math.max(...cn.tiles.map(t => t.transcript.length));
            const rMin = 10, rMax = Math.min(34, containerR / Math.sqrt(cn.tiles.length) * 1.8);

            const tnodes = cn.tiles.map(t => ({
                ...t,
                r: rMin + (rMax - rMin) * Math.sqrt((t.transcript.length - minLen) / (maxLen - minLen + 1)),
                x: w / 2 + (Math.random() - 0.5) * containerR * 0.4,
                y: h / 2 + (Math.random() - 0.5) * containerR * 0.4,
            }));

            const tsim = d3.forceSimulation(tnodes)
                .force("center", d3.forceCenter(w / 2, h / 2).strength(0.06))
                .force("charge", d3.forceManyBody().strength(-3))
                .force("collide", d3.forceCollide(d => d.r + 2.5))
                .force("radial", d3.forceRadial(containerR * 0.74, w / 2, h / 2).strength(0.04))
                .stop();
            for (let i = 0; i < 450; i++) tsim.tick();

            const tileDetailG = bsvg.append("g").attr("class", "tile-detail");

            tnodes.forEach((tn, i) => {
                const tg = tileDetailG.append("g").style("opacity", 0);

                tg.append("circle")
                    .attr("cx", tn.x).attr("cy", tn.y).attr("r", tn.r)
                    .attr("fill", tn.color).attr("fill-opacity", 0.78)
                    .attr("stroke", tn.color).attr("stroke-width", 0.5).attr("stroke-opacity", 0.4)
                    .attr("cursor", "pointer")
                    .on("mouseenter", (event) => { setHov(tn); })
                    .on("mouseleave", () => setHov(null))
                    .on("click", () => clickAudio(tn.id, audioRef, playingIdRef, setPlayingId));

                if (tn.r >= 13) {
                    const maxChars = Math.floor(tn.r * 1.6);
                    const txt = tn.sum.length > maxChars ? tn.sum.slice(0, maxChars) + "…" : tn.sum;
                    tg.append("text")
                        .attr("x", tn.x).attr("y", tn.y)
                        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
                        .attr("fill", richDark(tn.color))
                        .attr("font-size", Math.min(tn.r * 0.40, 11) + "px")
                        .attr("font-family", "'Hedvig Letters Sans', sans-serif")
                        .attr("pointer-events", "none").text(txt);
                }

                tg.transition().duration(500).delay(i * 2).style("opacity", 1);
            });

            bubbleGoBackRef.current = function goBack() {
                bsvg.select(".tile-detail").transition().duration(380).style("opacity", 0)
                    .on("end", function () { d3.select(this).remove(); });

                const fn = focusedNode;
                overviewG.select(`.cg-${fn.id} .cbubble`)
                    .transition().duration(600).delay(280).ease(d3.easeCubicInOut)
                    .attr("cx", fn.ox).attr("cy", fn.oy).attr("r", fn.or)
                    .attr("fill-opacity", 0.28).attr("stroke-opacity", 0.35);

                overviewG.select(`.cg-${fn.id} .clabel`).transition().duration(400).delay(640).style("opacity", 1);
                overviewG.select(`.cg-${fn.id} .ccount`).transition().duration(400).delay(640).style("opacity", 1);

                overviewG.selectAll(".cg")
                    .transition().duration(560).delay(280)
                    .style("opacity", 1).style("pointer-events", null);

                focusedNode = null;
            };
        }
    }, [mode, view, tiles, dims]);

    // ── D3 render: Compass (dots) ─────────────────────────────────────────────
    useEffect(() => {
        if (mode !== "ready" || view !== "compass" || !gRef.current) return;
        const g = d3.select(gRef.current);
        g.select(".edges").style("display", "none");
        g.select(".questions").style("display", "none");
        g.select(".responses").style("display", "none");
        g.select(".force-layer").style("display", "none");
        g.select(".compass-layer").style("display", null).selectAll("*").remove();
        const cg = g.select(".compass-layer");
        const { w, h } = dims;

        const xS = d3.scaleLinear().domain([-1.15, 1.15]).range([-w * 0.43, w * 0.43]);
        const yS = d3.scaleLinear().domain([-1.15, 1.15]).range([h * 0.42, -h * 0.42]);

        // Transparent background: click anywhere on empty space to clear selection/audio
        cg.append("rect")
            .attr("x", -w / 2).attr("y", -h / 2).attr("width", w).attr("height", h)
            .attr("fill", "transparent")
            .on("click", () => {
                cg.selectAll("circle.cdot").classed("cdot-dim", false)
                    .transition("size").duration(200).attr("r", 6);
                stopAudio(audioRef, playingIdRef, setPlayingId);
                setSelectedId(null);
                setHov(null);
            });

        // Axis lines — 1px regardless of zoom, draw-in on load
        const hLen = w * 0.94;
        const vLen = h * 0.94;
        cg.append("line").attr("x1", -w * 0.47).attr("x2", w * 0.47).attr("y1", 0).attr("y2", 0)
            .attr("stroke", "rgba(0,0,0,0.1)").attr("stroke-width", 1)
            .attr("vector-effect", "non-scaling-stroke")
            .attr("stroke-dasharray", hLen).attr("stroke-dashoffset", hLen)
            .transition().duration(900).ease(d3.easeCubicOut)
            .attr("stroke-dashoffset", 0)
            .on("end", function () { d3.select(this).attr("stroke-dasharray", null).attr("stroke-dashoffset", null); });
        cg.append("line").attr("x1", 0).attr("x2", 0).attr("y1", -h * 0.47).attr("y2", h * 0.47)
            .attr("stroke", "rgba(0,0,0,0.1)").attr("stroke-width", 1)
            .attr("vector-effect", "non-scaling-stroke")
            .attr("stroke-dasharray", vLen).attr("stroke-dashoffset", vLen)
            .transition().duration(900).ease(d3.easeCubicOut)
            .attr("stroke-dashoffset", 0)
            .on("end", function () { d3.select(this).attr("stroke-dasharray", null).attr("stroke-dashoffset", null); });

        const compassNodes = tiles.map(t => ({
            ...t,
            tx: xS(t.compassX), ty: yS(t.compassY),
            x: xS(t.compassX) + (Math.random() - 0.5) * 20,
            y: yS(t.compassY) + (Math.random() - 0.5) * 20,
        }));

        const sim = d3.forceSimulation(compassNodes)
            .force("x", d3.forceX(d => d.tx).strength(0.5))
            .force("y", d3.forceY(d => d.ty).strength(0.5))
            .force("collide", d3.forceCollide(9))
            .stop();
        for (let i = 0; i < 180; i++) sim.tick();

        cg.selectAll("circle.cdot").data(compassNodes).enter().append("circle").attr("class", "cdot")
            .attr("r", 6).attr("cx", d => d.x).attr("cy", d => d.y)
            .attr("fill", d => d.color)
            .attr("cursor", "pointer")
            .style("opacity", 0)
            .on("mouseenter", function(event, d) {
                setHov(d);
                d3.select(this).raise().transition("size").duration(150).attr("r", 10);
            })
            .on("mouseleave", function(event, d) {
                setHov(null);
                // Only scale down if this node isn't the selected one
                if (selectedIdRef.current !== d.id) {
                    d3.select(this).transition("size").duration(200).attr("r", 6);
                }
            })
            .on("click", (event, d) => {
                event.stopPropagation();
                cg.selectAll("circle.cdot").classed("cdot-dim", o => o.id !== d.id);
                setSelectedId(d.id);
                clickAudio(d.id, audioRef, playingIdRef, setPlayingId);
            })
            // Named transition so hover "size" transitions can run simultaneously
            .transition("enter").duration(700).delay((_, i) => Math.min(i * 1.2, 500)).style("opacity", 1);

        if (zoomRef.current && svgRef.current) {
            d3.select(svgRef.current).call(
                zoomRef.current.transform,
                d3.zoomIdentity.translate(w / 2, h / 2)
            );
        }
    }, [mode, view, tiles, dims]);

    // ── D3 render: Cards (wide compass with full tile cards) ──────────────────
    useEffect(() => {
        if (mode !== "ready" || view !== "cards" || !gRef.current) return;
        const g = d3.select(gRef.current);
        g.select(".edges").style("display", "none");
        g.select(".questions").style("display", "none");
        g.select(".responses").style("display", "none");
        g.select(".force-layer").style("display", "none");
        g.select(".compass-layer").style("display", null).selectAll("*").remove();
        const cg = g.select(".compass-layer");

        // Canvas proportional to viewport — same aspect ratio as compass dots view, just 9× bigger
        // This ensures both views show the same shape of data distribution
        const SCALE = 9;
        const xHalf = dims.w * 0.43 * SCALE;
        const yHalf = dims.h * 0.42 * SCALE;
        const CW = xHalf * 2 + dims.w;
        const CH = yHalf * 2 + dims.h;
        const xS = d3.scaleLinear().domain([-1.15, 1.15]).range([-xHalf, xHalf]);
        const yS = d3.scaleLinear().domain([-1.15, 1.15]).range([yHalf, -yHalf]);

        cg.append("line").attr("x1", -CW / 2).attr("x2", CW / 2).attr("y1", 0).attr("y2", 0)
            .attr("stroke", "rgba(0,0,0,0.08)").attr("stroke-width", 3);
        cg.append("line").attr("x1", 0).attr("x2", 0).attr("y1", -CH / 2).attr("y2", CH / 2)
            .attr("stroke", "rgba(0,0,0,0.08)").attr("stroke-width", 3);

        // Scale font sizes to canvas — both readable at 1/SCALE overview zoom
        const axisFs = Math.round(dims.w * SCALE / 100);
        const wmarkFs = Math.round(dims.w * SCALE / 40);
        const wmarkLH = Math.round(wmarkFs * 1.1);
        const edgePad = axisFs;

        [
            ["← phone as distraction", -CW / 2 + edgePad, -axisFs * 0.35, "start"],
            ["phone as lifeline →",     CW / 2 - edgePad, -axisFs * 0.35, "end"],
            ["↑  claim",        edgePad * 0.5, -CH / 2 + edgePad, "start"],
            ["experience  ↓",   edgePad * 0.5,  CH / 2 - axisFs * 0.5, "start"],
        ].forEach(([txt, x, y, anchor]) =>
            cg.append("text").attr("x", x).attr("y", y).attr("text-anchor", anchor)
                .attr("fill", "rgba(0,0,0,0.28)").attr("font-size", axisFs + "px").attr("letter-spacing", "4px")
                .attr("font-family", "'Courier New', Courier, monospace").text(txt)
        );

        [
            { x: -CW / 2 + edgePad, y: -CH / 2 + wmarkFs * 1.3, lines: ["Rules help",   "everyone focus"],        anchor: "start" },
            { x:  CW / 2 - edgePad, y: -CH / 2 + wmarkFs * 1.3, lines: ["Phones are",   "structurally essential"], anchor: "end"   },
            { x: -CW / 2 + edgePad, y:  CH / 2 - wmarkFs * 0.5, lines: ["Honestly, I",  "get pulled by it"],      anchor: "start" },
            { x:  CW / 2 - edgePad, y:  CH / 2 - wmarkFs * 0.5, lines: ["My family",    "needed me"],             anchor: "end"   },
        ].forEach(({ x, y, lines, anchor }) =>
            lines.forEach((line, i) =>
                cg.append("text").attr("x", x).attr("y", y + i * wmarkLH).attr("text-anchor", anchor)
                    .attr("fill", "rgba(0,0,0,0.055)").attr("font-size", wmarkFs + "px").attr("font-style", "italic")
                    .attr("font-family", "'Hedvig Letters Serif', serif").text(line)
            )
        );

        const compassNodes = tiles.map(t => ({
            ...t,
            tx: xS(t.compassX), ty: yS(t.compassY),
            x: xS(t.compassX) + (Math.random() - 0.5) * 80,
            y: yS(t.compassY) + (Math.random() - 0.5) * 80,
        }));

        const sim = d3.forceSimulation(compassNodes)
            .force("x", d3.forceX(d => d.tx).strength(0.28))
            .force("y", d3.forceY(d => d.ty).strength(0.28))
            .force("collide", d3.forceCollide(d => {
                const nh = nodeNH(wrapLines(d.sum, R_MAX_CHARS).length);
                return Math.sqrt((NW / 2) ** 2 + (nh / 2) ** 2) + 8;
            }))
            .stop();
        for (let i = 0; i < 520; i++) sim.tick();

        const cardG = cg.selectAll("g.cp").data(compassNodes).enter().append("g").attr("class", "cp")
            .attr("transform", d => `translate(${d.x},${d.y})`)
            .style("opacity", 0).attr("cursor", "pointer");

        cardG.append("rect").attr("rx", 6).attr("ry", 6).attr("width", NW)
            .attr("fill", d => d.color)
            .each(function (d) {
                const nh = nodeNH(wrapLines(d.sum, R_MAX_CHARS).length);
                d3.select(this).attr("height", nh).attr("x", -NW / 2).attr("y", -nh / 2);
            });

        cardG.append("text").attr("font-size", "13px")
            .attr("font-family", "'Hedvig Letters Sans', sans-serif")
            .each(function (d) {
                const el = d3.select(this); const lines = wrapLines(d.sum, R_MAX_CHARS);
                const nh = nodeNH(lines.length);
                el.attr("fill", richDark(d.color));
                lines.forEach((l, i) => el.append("tspan").attr("x", -NW / 2 + 14).attr("y", -nh / 2 + R_TOP_PAD + i * R_LINE_H).text(l));
            });

        cardG
            .on("mouseenter", (event, d) => { setHov(d); })
            .on("mouseleave", () => setHov(null))
            .on("click", (_, d) => clickAudio(d.id, audioRef, playingIdRef, setPlayingId));

        cardG.transition().duration(1400).delay((_, i) => Math.min(i * 1.8, 1200)).style("opacity", 1);

        if (zoomRef.current && svgRef.current) {
            // Fit canvas to viewport; since canvas is proportional, this ≈ 1/SCALE
            const fitScale = Math.min(dims.w / CW, dims.h / CH) * 0.92;
            d3.select(svgRef.current).call(
                zoomRef.current.transform,
                d3.zoomIdentity.translate(dims.w / 2, dims.h / 2).scale(fitScale)
            );
        }
    }, [mode, view, tiles, dims]);

    // ── Render ────────────────────────────────────────────────────────────────
    const isReady = mode === "ready";
    const selectedTile = selectedId ? tiles.find(t => t.id === selectedId) : null;
    const modalData = hov ?? selectedTile;

    // Axis pill positions — track SVG axes in screen space, clamped to viewport margins
    const PILL_H = 30;
    const pillLeft = (screenX, approxW) =>
        Math.max(20, Math.min(dims.w - 20 - approxW, screenX - approxW / 2));
    const pillTop = (screenY) =>
        Math.max(20, Math.min(dims.h - 20 - PILL_H, screenY - PILL_H / 2));


    return (
        <div ref={containerRef} style={{ width: "100%", height: "100vh", background: BG, position: "relative", overflow: "hidden", fontFamily: "Libre Baskerville, serif" }}>

            {/* Splash */}
            {(mode === "setup" || mode === "loading") && (
                <div onClick={mode === "setup" ? loadCatalog : undefined}
                    style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, cursor: mode === "setup" ? "pointer" : "default" }}>
                    <svg width="160" viewBox="0 0 750 905" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M163.546 37.68C163.546 45.1467 161.892 51.6 158.586 57.04C155.386 62.48 150.159 66.6933 142.906 69.68C135.759 72.56 126.212 74 114.266 74H99.8656V104.88C99.8656 110.107 100.346 114.107 101.306 116.88C102.372 119.653 104.452 121.52 107.546 122.48C110.746 123.44 115.546 123.92 121.946 123.92V130H65.4656V123.92C70.479 123.707 74.2123 123.173 76.6656 122.32C79.2256 121.36 80.9323 119.6 81.7856 117.04C82.639 114.48 83.0656 110.693 83.0656 105.68V31.12C83.0656 26.1067 82.6923 22.3733 81.9456 19.92C81.199 17.36 79.6523 15.6 77.3056 14.64C75.0656 13.68 71.6523 13.0933 67.0656 12.88V6.79999H117.306C131.919 6.79999 143.279 9.51999 151.386 14.96C159.492 20.4 163.546 27.9733 163.546 37.68ZM99.8656 17.04V66H111.226C121.786 66 129.679 63.9733 134.906 59.92C140.132 55.76 142.746 48.9867 142.746 39.6C142.746 30.64 140.666 24.1867 136.506 20.24C132.452 16.2933 126.052 14.32 117.306 14.32H102.586C100.772 14.32 99.8656 15.2267 99.8656 17.04ZM168.909 130V123.92C173.923 123.707 177.656 123.173 180.109 122.32C182.669 121.36 184.376 119.6 185.229 117.04C186.083 114.48 186.509 110.693 186.509 105.68V31.12C186.509 26.1067 186.136 22.3733 185.389 19.92C184.643 17.36 183.096 15.6 180.749 14.64C178.509 13.68 175.096 13.0933 170.509 12.88V6.79999H219.149V12.88C214.563 12.9867 211.149 13.5733 208.909 14.64C206.669 15.6 205.176 17.4133 204.429 20.08C203.683 22.7467 203.309 26.8 203.309 32.24V62.96H268.109V31.12C268.109 26.1067 267.736 22.3733 266.989 19.92C266.243 17.36 264.696 15.6 262.349 14.64C260.109 13.68 256.696 13.0933 252.109 12.88V6.79999H300.749V12.88C296.163 12.9867 292.749 13.5733 290.509 14.64C288.269 15.6 286.776 17.4133 286.029 20.08C285.283 22.7467 284.909 26.8 284.909 32.24V104.56C284.909 110 285.283 114.107 286.029 116.88C286.883 119.547 288.536 121.36 290.989 122.32C293.549 123.173 297.336 123.707 302.349 123.92V130H250.509V123.92C255.523 123.707 259.256 123.173 261.709 122.32C264.269 121.36 265.976 119.6 266.829 117.04C267.683 114.48 268.109 110.693 268.109 105.68V70.96H203.309V104.56C203.309 110 203.683 114.107 204.429 116.88C205.283 119.547 206.936 121.36 209.389 122.32C211.949 123.173 215.736 123.707 220.749 123.92V130H168.909ZM376.771 5.2C386.157 5.2 394.851 6.85333 402.851 10.16C410.957 13.36 417.997 17.8933 423.971 23.76C430.051 29.52 434.797 36.2933 438.211 44.08C441.624 51.8667 443.331 60.2933 443.331 69.36C443.331 78 441.624 86.1067 438.211 93.68C434.797 101.253 430.051 107.867 423.971 113.52C417.891 119.173 410.797 123.6 402.691 126.8C394.691 130 386.051 131.6 376.771 131.6C367.491 131.6 358.797 130 350.691 126.8C342.691 123.6 335.651 119.173 329.571 113.52C323.491 107.867 318.744 101.253 315.331 93.68C311.917 86.1067 310.211 78 310.211 69.36C310.211 60.2933 311.917 51.8667 315.331 44.08C318.744 36.2933 323.437 29.52 329.411 23.76C335.491 17.8933 342.531 13.36 350.531 10.16C358.637 6.85333 367.384 5.2 376.771 5.2ZM376.771 122.8C386.157 122.8 394.264 120.667 401.091 116.4C407.917 112.027 413.197 105.893 416.931 98C420.664 90 422.531 80.6133 422.531 69.84C422.531 58.4267 420.664 48.56 416.931 40.24C413.197 31.8133 407.917 25.36 401.091 20.88C394.264 16.2933 386.157 14 376.771 14C367.384 14 359.277 16.2933 352.451 20.88C345.624 25.36 340.344 31.8133 336.611 40.24C332.877 48.56 331.011 58.4267 331.011 69.84C331.011 80.6133 332.877 90 336.611 98C340.344 105.893 345.624 112.027 352.451 116.4C359.277 120.667 367.384 122.8 376.771 122.8ZM555.106 131.6L479.106 31.44H478.466V99.76C478.466 106.8 478.839 112.027 479.586 115.44C480.332 118.747 481.826 120.933 484.066 122C486.412 123.067 489.826 123.707 494.306 123.92V130H451.266V123.92C456.279 123.707 460.012 123.067 462.466 122C465.026 120.933 466.732 118.8 467.586 115.6C468.439 112.4 468.866 107.493 468.866 100.88V35.92C468.866 29.84 468.492 25.2 467.746 22C466.999 18.8 465.452 16.56 463.106 15.28C460.866 13.8933 457.452 13.0933 452.866 12.88V6.79999H484.546L554.466 100.08H555.106V37.04C555.106 30 554.732 24.8267 553.986 21.52C553.239 18.1067 551.746 15.8667 549.506 14.8C547.266 13.6267 543.852 12.9867 539.266 12.88V6.79999H582.306V12.88C577.292 12.9867 573.506 13.6267 570.946 14.8C568.492 15.8667 566.839 18 565.986 21.2C565.132 24.4 564.706 29.3067 564.706 35.92V131.6H555.106ZM623.641 16.4V62.32C629.401 62.32 634.201 62 638.041 61.36C641.987 60.6133 645.081 59.4933 647.321 58C649.667 56.5067 651.321 54.5867 652.281 52.24C653.347 49.8933 653.881 47.12 653.881 43.92H659.481V87.6H653.881C653.881 84.4 653.401 81.6267 652.441 79.28C651.587 76.9333 650.041 75.0133 647.801 73.52C645.561 71.92 642.467 70.7467 638.521 70C634.574 69.1467 629.614 68.72 623.641 68.72V104.88C623.641 109.467 624.441 113.093 626.041 115.76C627.747 118.427 630.521 120.347 634.361 121.52C638.201 122.587 643.481 123.12 650.201 123.12C657.774 123.12 663.801 122.373 668.281 120.88C672.867 119.387 676.441 116.88 679.001 113.36C681.561 109.733 683.534 104.773 684.921 98.48H691.001L688.601 130H589.241V123.92C594.254 123.707 597.987 123.173 600.441 122.32C603.001 121.36 604.707 119.6 605.561 117.04C606.414 114.48 606.841 110.693 606.841 105.68V31.12C606.841 26.1067 606.467 22.3733 605.721 19.92C604.974 17.36 603.427 15.6 601.081 14.64C598.841 13.68 595.427 13.0933 590.841 12.88V6.79999H683.321L684.761 34.96H679.161C678.307 29.3067 676.707 24.9333 674.361 21.84C672.121 18.7467 668.761 16.6133 664.281 15.44C659.801 14.2667 653.934 13.68 646.681 13.68H626.361C625.507 13.68 624.814 13.9467 624.281 14.48C623.854 14.9067 623.641 15.5467 623.641 16.4ZM318.873 195.08V227.4C318.873 238.6 317.326 248.04 314.233 255.72C311.246 263.293 306.393 269 299.673 272.84C292.953 276.68 283.993 278.6 272.793 278.6C262.34 278.6 253.593 277.16 246.553 274.28C239.62 271.4 234.393 266.653 230.873 260.04C227.46 253.427 225.753 244.52 225.753 233.32V191.08C225.753 185.747 225.7 181.32 225.593 177.8C225.486 174.173 225.166 171.187 224.633 168.84C224.1 166.493 223.193 164.68 221.913 163.4C220.633 162.013 218.873 161.107 216.633 160.68C214.5 160.147 211.62 159.88 207.993 159.88V153.8H262.553V159.88C258.926 159.88 255.993 160.093 253.753 160.52C251.513 160.947 249.753 162.013 248.473 163.72C247.086 165.64 246.126 168.733 245.593 173C245.166 177.16 244.953 183.187 244.953 191.08V234.6C244.953 245.48 247.353 253.907 252.153 259.88C256.953 265.747 265.326 268.68 277.273 268.68C287.94 268.68 295.94 265.693 301.273 259.72C306.606 253.747 309.273 245.053 309.273 233.64V195.08C309.273 185.587 308.9 178.387 308.153 173.48C307.513 168.573 306.126 165.107 303.993 163.08C302.606 161.693 300.74 160.84 298.393 160.52C296.153 160.093 293.38 159.88 290.073 159.88V153.8H336.473V159.88C333.166 159.88 330.393 160.147 328.153 160.68C325.913 161.213 324.153 162.387 322.873 164.2C321.273 166.44 320.206 169.96 319.673 174.76C319.14 179.453 318.873 186.227 318.873 195.08ZM345.508 275.24L343.108 239.4H349.028C350.521 249.107 354.521 256.733 361.028 262.28C367.641 267.72 375.748 270.44 385.348 270.44C393.241 270.44 399.481 268.573 404.068 264.84C408.655 261 410.948 255.933 410.948 249.64C410.948 246.013 410.095 242.813 408.388 240.04C406.788 237.16 403.961 234.387 399.908 231.72C395.855 229.053 390.201 226.173 382.948 223.08C374.095 219.133 367.108 215.4 361.988 211.88C356.975 208.36 353.401 204.573 351.268 200.52C349.241 196.36 348.228 191.56 348.228 186.12C348.228 179.507 349.721 173.64 352.708 168.52C355.801 163.4 360.015 159.4 365.348 156.52C370.788 153.64 377.028 152.2 384.068 152.2C393.028 152.2 401.508 155.347 409.508 161.64L413.668 154.44H417.348L419.108 186.28H413.188C410.628 177.533 406.895 171.027 401.988 166.76C397.188 162.493 391.375 160.36 384.548 160.36C378.041 160.36 372.868 162.013 369.028 165.32C365.188 168.52 363.268 172.787 363.268 178.12C363.268 181.427 364.015 184.413 365.508 187.08C367.108 189.747 369.668 192.307 373.188 194.76C376.815 197.107 381.668 199.667 387.748 202.44C398.308 207.133 406.521 211.453 412.388 215.4C418.361 219.347 422.521 223.4 424.868 227.56C427.215 231.72 428.388 236.627 428.388 242.28C428.388 249.427 426.521 255.72 422.788 261.16C419.161 266.6 414.095 270.867 407.588 273.96C401.081 277.053 393.508 278.6 384.868 278.6C378.788 278.6 373.295 277.747 368.388 276.04C363.588 274.227 358.681 271.347 353.668 267.4L349.188 275.24H345.508ZM472.153 163.4V209.32C477.913 209.32 482.713 209 486.553 208.36C490.5 207.613 493.593 206.493 495.833 205C498.18 203.507 499.833 201.587 500.793 199.24C501.86 196.893 502.393 194.12 502.393 190.92H507.993V234.6H502.393C502.393 231.4 501.913 228.627 500.953 226.28C500.1 223.933 498.553 222.013 496.313 220.52C494.073 218.92 490.98 217.747 487.033 217C483.086 216.147 478.126 215.72 472.153 215.72V251.88C472.153 256.467 472.953 260.093 474.553 262.76C476.26 265.427 479.033 267.347 482.873 268.52C486.713 269.587 491.993 270.12 498.713 270.12C506.286 270.12 512.313 269.373 516.793 267.88C521.38 266.387 524.953 263.88 527.513 260.36C530.073 256.733 532.046 251.773 533.433 245.48H539.513L537.113 277H437.753V270.92C442.766 270.707 446.5 270.173 448.953 269.32C451.513 268.36 453.22 266.6 454.073 264.04C454.926 261.48 455.353 257.693 455.353 252.68V178.12C455.353 173.107 454.98 169.373 454.233 166.92C453.486 164.36 451.94 162.6 449.593 161.64C447.353 160.68 443.94 160.093 439.353 159.88V153.8H531.833L533.273 181.96H527.673C526.82 176.307 525.22 171.933 522.873 168.84C520.633 165.747 517.273 163.613 512.793 162.44C508.313 161.267 502.446 160.68 495.193 160.68H474.873C474.02 160.68 473.326 160.947 472.793 161.48C472.366 161.907 472.153 162.547 472.153 163.4Z" fill="black"/>
                        <path d="M179.893 742V735.92C184.8 735.387 188.48 734.267 190.933 732.56C193.386 730.747 195.52 727.547 197.333 722.96L238.933 618.8H245.813L282.133 709.04C284.586 715.013 286.72 719.813 288.533 723.44C290.346 726.96 292.106 729.627 293.813 731.44C295.52 733.147 297.333 734.32 299.253 734.96C301.28 735.493 303.68 735.76 306.453 735.76V742H254.293V735.76C259.946 735.76 263.84 735.227 265.973 734.16C268.106 733.093 269.173 731.333 269.173 728.88C269.173 726.747 268.906 724.773 268.373 722.96C267.946 721.04 266.986 718.267 265.493 714.64L258.933 697.36H216.213C212.586 706.107 210.026 712.88 208.533 717.68C207.04 722.48 206.293 725.947 206.293 728.08C206.293 731.067 207.253 733.147 209.173 734.32C211.2 735.387 214.4 735.92 218.773 735.92V742H179.893ZM219.413 689.36H255.893L238.453 642.16H237.813L219.413 689.36ZM379.007 743.6L333.087 638.64H332.447V711.76C332.447 718.8 332.82 724.027 333.567 727.44C334.42 730.747 336.074 732.933 338.527 734C341.087 735.067 344.874 735.707 349.887 735.92V742H305.247V735.92C310.26 735.707 313.994 735.067 316.447 734C319.007 732.933 320.714 730.8 321.567 727.6C322.42 724.4 322.847 719.493 322.847 712.88V647.92C322.847 641.84 322.474 637.2 321.727 634C320.98 630.8 319.434 628.56 317.087 627.28C314.847 625.893 311.434 625.093 306.847 624.88V618.8H345.087L385.407 713.36H386.047L427.647 618.8H463.487V624.88C458.9 624.987 455.487 625.733 453.247 627.12C451.007 628.4 449.514 630.747 448.767 634.16C448.02 637.573 447.647 642.533 447.647 649.04V711.76C447.647 718.8 448.02 724.027 448.767 727.44C449.62 730.747 451.274 732.933 453.727 734C456.287 735.067 460.074 735.707 465.087 735.92V742H413.247V735.92C418.26 735.707 421.994 735.067 424.447 734C427.007 732.933 428.714 730.8 429.567 727.6C430.42 724.4 430.847 719.493 430.847 712.88V638.64H429.247L382.527 743.6H379.007ZM477.702 740.24L475.302 704.4H481.222C482.715 714.107 486.715 721.733 493.222 727.28C499.835 732.72 507.942 735.44 517.542 735.44C525.435 735.44 531.675 733.573 536.262 729.84C540.849 726 543.142 720.933 543.142 714.64C543.142 711.013 542.289 707.813 540.582 705.04C538.982 702.16 536.155 699.387 532.102 696.72C528.049 694.053 522.395 691.173 515.142 688.08C506.289 684.133 499.302 680.4 494.182 676.88C489.169 673.36 485.595 669.573 483.462 665.52C481.435 661.36 480.422 656.56 480.422 651.12C480.422 644.507 481.915 638.64 484.902 633.52C487.995 628.4 492.209 624.4 497.542 621.52C502.982 618.64 509.222 617.2 516.262 617.2C525.222 617.2 533.702 620.347 541.702 626.64L545.862 619.44H549.542L551.302 651.28H545.382C542.822 642.533 539.089 636.027 534.182 631.76C529.382 627.493 523.569 625.36 516.742 625.36C510.235 625.36 505.062 627.013 501.222 630.32C497.382 633.52 495.462 637.787 495.462 643.12C495.462 646.427 496.209 649.413 497.702 652.08C499.302 654.747 501.862 657.307 505.382 659.76C509.009 662.107 513.862 664.667 519.942 667.44C530.502 672.133 538.715 676.453 544.582 680.4C550.555 684.347 554.715 688.4 557.062 692.56C559.409 696.72 560.582 701.627 560.582 707.28C560.582 714.427 558.715 720.72 554.982 726.16C551.355 731.6 546.289 735.867 539.782 738.96C533.275 742.053 525.702 743.6 517.062 743.6C510.982 743.6 505.489 742.747 500.582 741.04C495.782 739.227 490.875 736.347 485.862 732.4L481.382 740.24H477.702ZM59.1144 889V882.92C64.661 882.707 68.7677 882.173 71.4344 881.32C74.2077 880.36 76.021 878.6 76.8744 876.04C77.8344 873.48 78.3144 869.693 78.3144 864.68V790.12C78.3144 785.107 77.941 781.373 77.1944 778.92C76.4477 776.36 74.901 774.6 72.5544 773.64C70.3144 772.68 66.901 772.093 62.3144 771.88V765.8H110.154C124.554 765.8 135.754 768.413 143.754 773.64C151.754 778.76 155.754 786.013 155.754 795.4C155.754 802.227 153.461 807.933 148.874 812.52C144.394 817 137.461 820.627 128.074 823.4V824.04C135.008 824.573 141.461 826.12 147.434 828.68C153.514 831.133 158.421 834.653 162.154 839.24C165.888 843.72 167.754 849.32 167.754 856.04C167.754 862.013 166.208 867.507 163.114 872.52C160.021 877.427 155.968 881.213 150.954 883.88C147.328 885.8 142.901 887.133 137.674 887.88C132.554 888.627 125.568 889 116.714 889H59.1144ZM117.034 882.12C136.448 882.12 146.154 873.96 146.154 857.64C146.154 851.453 144.821 846.173 142.154 841.8C139.594 837.32 136.021 834.013 131.434 831.88C128.128 830.28 124.128 829.267 119.434 828.84C114.848 828.413 109.141 828.2 102.314 828.2H95.1144V863.88C95.1144 870.387 96.821 875.08 100.234 877.96C103.648 880.733 109.248 882.12 117.034 882.12ZM95.1144 820.2H104.074C111.008 820.2 116.074 819.88 119.274 819.24C122.474 818.493 124.928 817.587 126.634 816.52C129.408 814.813 131.594 812.253 133.194 808.84C134.794 805.427 135.594 801.16 135.594 796.04C135.594 788.36 133.514 782.653 129.354 778.92C125.301 775.187 118.901 773.32 110.154 773.32H97.8344C96.021 773.32 95.1144 774.227 95.1144 776.04V820.2ZM273.633 796.68C273.633 805.107 271.073 812.2 265.953 817.96C260.833 823.613 252.673 827.4 241.473 829.32L276.833 871.88C279.713 875.4 282.913 877.96 286.433 879.56C289.953 881.053 294.06 882.173 298.753 882.92V889H267.873L228.673 838.76C226.86 836.307 225.153 834.493 223.553 833.32C221.953 832.147 220.086 831.4 217.953 831.08C215.926 830.76 213.26 830.6 209.953 830.6V863.88C209.953 869.107 210.433 873.107 211.393 875.88C212.46 878.653 214.54 880.52 217.633 881.48C220.833 882.44 225.633 882.92 232.033 882.92V889H175.553V882.92C180.566 882.707 184.3 882.173 186.753 881.32C189.313 880.36 191.02 878.6 191.873 876.04C192.726 873.48 193.153 869.693 193.153 864.68V790.12C193.153 785.107 192.78 781.373 192.033 778.92C191.286 776.36 189.74 774.6 187.393 773.64C185.153 772.68 181.74 772.093 177.153 771.88V765.8H227.393C242.006 765.8 253.366 768.52 261.473 773.96C269.58 779.4 273.633 786.973 273.633 796.68ZM209.953 776.04V822.6H221.313C231.873 822.6 239.766 820.627 244.993 816.68C250.22 812.733 252.833 806.333 252.833 797.48C252.833 788.947 250.753 782.813 246.593 779.08C242.54 775.24 236.14 773.32 227.393 773.32H212.673C210.86 773.32 209.953 774.227 209.953 776.04ZM360.758 764.2C370.145 764.2 378.838 765.853 386.838 769.16C394.945 772.36 401.985 776.893 407.958 782.76C414.038 788.52 418.785 795.293 422.198 803.08C425.611 810.867 427.318 819.293 427.318 828.36C427.318 837 425.611 845.107 422.198 852.68C418.785 860.253 414.038 866.867 407.958 872.52C401.878 878.173 394.785 882.6 386.678 885.8C378.678 889 370.038 890.6 360.758 890.6C351.478 890.6 342.785 889 334.678 885.8C326.678 882.6 319.638 878.173 313.558 872.52C307.478 866.867 302.731 860.253 299.318 852.68C295.905 845.107 294.198 837 294.198 828.36C294.198 819.293 295.905 810.867 299.318 803.08C302.731 795.293 307.425 788.52 313.398 782.76C319.478 776.893 326.518 772.36 334.518 769.16C342.625 765.853 351.371 764.2 360.758 764.2ZM360.758 881.8C370.145 881.8 378.251 879.667 385.078 875.4C391.905 871.027 397.185 864.893 400.918 857C404.651 849 406.518 839.613 406.518 828.84C406.518 817.427 404.651 807.56 400.918 799.24C397.185 790.813 391.905 784.36 385.078 779.88C378.251 775.293 370.145 773 360.758 773C351.371 773 343.265 775.293 336.438 779.88C329.611 784.36 324.331 790.813 320.598 799.24C316.865 807.56 314.998 817.427 314.998 828.84C314.998 839.613 316.865 849 320.598 857C324.331 864.893 329.611 871.027 336.438 875.4C343.265 879.667 351.371 881.8 360.758 881.8ZM539.093 890.6L463.093 790.44H462.453V858.76C462.453 865.8 462.826 871.027 463.573 874.44C464.32 877.747 465.813 879.933 468.053 881C470.4 882.067 473.813 882.707 478.293 882.92V889H435.253V882.92C440.266 882.707 444 882.067 446.453 881C449.013 879.933 450.72 877.8 451.573 874.6C452.426 871.4 452.853 866.493 452.853 859.88V794.92C452.853 788.84 452.48 784.2 451.733 781C450.986 777.8 449.44 775.56 447.093 774.28C444.853 772.893 441.44 772.093 436.853 771.88V765.8H468.533L538.453 859.08H539.093V796.04C539.093 789 538.72 783.827 537.973 780.52C537.226 777.107 535.733 774.867 533.493 773.8C531.253 772.627 527.84 771.987 523.253 771.88V765.8H566.293V771.88C561.28 771.987 557.493 772.627 554.933 773.8C552.48 774.867 550.826 777 549.973 780.2C549.12 783.4 548.693 788.307 548.693 794.92V890.6H539.093ZM640.428 821.64L677.228 871.56C680.001 875.187 683.095 878.013 686.508 880.04C689.921 881.96 693.601 882.92 697.548 882.92V889H642.988V882.92C647.681 882.92 650.935 882.493 652.748 881.64C654.561 880.68 655.468 879.4 655.468 877.8C655.468 876.733 655.255 875.667 654.828 874.6C654.508 873.427 653.761 871.88 652.588 869.96C651.521 867.933 649.761 865.107 647.308 861.48L629.068 834.28L615.308 851.56C610.935 857.107 607.468 861.64 604.908 865.16C602.348 868.68 600.535 871.507 599.468 873.64C598.401 875.667 597.868 877.373 597.868 878.76C597.868 880.36 598.775 881.48 600.588 882.12C602.508 882.653 605.921 882.92 610.828 882.92V889H566.348V882.92C569.761 882.92 572.801 882.44 575.468 881.48C578.135 880.52 580.801 878.867 583.468 876.52C586.135 874.173 589.121 870.92 592.428 866.76L623.788 826.76L591.308 782.44C588.641 778.707 585.655 776.04 582.348 774.44C579.041 772.733 575.095 771.88 570.508 771.88V765.8H623.628V771.88C620.108 771.88 617.495 772.413 615.788 773.48C614.081 774.44 613.228 775.987 613.228 778.12C613.228 780.787 614.721 784.307 617.708 788.68L635.148 814.6L650.828 794.76C653.815 791.027 655.895 787.987 657.068 785.64C658.241 783.293 658.828 781.053 658.828 778.92C658.828 776.253 657.921 774.44 656.108 773.48C654.401 772.413 651.308 771.88 646.828 771.88V765.8H690.828V771.88C687.415 771.88 684.535 772.253 682.188 773C679.948 773.747 677.655 775.347 675.308 777.8C672.961 780.147 669.815 783.827 665.868 788.84L640.428 821.64Z" fill="black"/>
                        <path d="M378.076 525.44C366.77 525.44 356.37 523.733 346.876 520.32C337.383 516.907 329.17 512.107 322.236 505.92C315.303 499.733 309.916 492.427 306.076 484C302.343 475.467 300.476 466.133 300.476 456C300.476 445.227 302.556 435.2 306.716 425.92C310.876 416.533 316.69 408.373 324.156 401.44C331.73 394.4 340.476 388.96 350.396 385.12C360.316 381.173 371.036 379.2 382.556 379.2C395.356 379.2 406.556 381.6 416.156 386.4C425.756 391.2 433.223 397.92 438.556 406.56C443.996 415.093 446.716 425.067 446.716 436.48C446.716 443.84 445.596 450.827 443.356 457.44C441.223 464.053 438.236 469.92 434.396 475.04C430.663 480.16 426.343 484.213 421.436 487.2C416.636 490.187 411.516 491.68 406.076 491.68C400.85 491.68 396.85 490.133 394.076 487.04C391.41 483.947 389.81 479.36 389.276 473.28H388.636C385.33 478.827 381.223 483.307 376.316 486.72C371.41 490.027 366.503 491.68 361.596 491.68C357.01 491.68 352.903 490.507 349.276 488.16C345.65 485.813 342.77 482.56 340.636 478.4C338.61 474.24 337.596 469.547 337.596 464.32C337.596 458.453 338.77 452.747 341.116 447.2C343.57 441.653 346.823 436.64 350.876 432.16C354.93 427.68 359.463 424.16 364.476 421.6C369.596 418.933 374.823 417.6 380.156 417.6C385.17 417.6 389.17 418.88 392.156 421.44C395.143 424 397.383 427.947 398.876 433.28L399.516 433.44L403.036 419.2H418.396L407.676 457.12C406.503 461.387 405.49 465.44 404.636 469.28C403.89 473.013 403.516 475.68 403.516 477.28C403.516 479.307 404.156 480.907 405.436 482.08C406.716 483.147 408.423 483.68 410.556 483.68C414.076 483.68 417.543 482.347 420.956 479.68C424.37 476.907 427.463 473.28 430.236 468.8C433.116 464.32 435.356 459.307 436.956 453.76C438.663 448.213 439.516 442.56 439.516 436.8C439.516 429.547 438.13 422.88 435.356 416.8C432.583 410.613 428.69 405.28 423.676 400.8C418.663 396.213 412.743 392.693 405.916 390.24C399.09 387.68 391.623 386.4 383.516 386.4C373.916 386.4 364.956 388.16 356.636 391.68C348.316 395.2 341.01 400.16 334.716 406.56C328.53 412.853 323.676 420.267 320.156 428.8C316.743 437.227 315.036 446.347 315.036 456.16C315.036 468.32 317.756 479.04 323.196 488.32C328.636 497.6 336.263 504.8 346.076 509.92C355.89 515.147 367.25 517.76 380.156 517.76C398.183 517.76 414.93 512.427 430.396 501.76L433.756 506.72C424.37 513.227 415.25 517.973 406.396 520.96C397.543 523.947 388.103 525.44 378.076 525.44ZM363.996 484.48C367.41 484.48 370.876 483.2 374.396 480.64C377.916 478.08 381.116 474.667 383.996 470.4C386.876 466.133 389.17 461.44 390.876 456.32C392.69 451.2 393.596 446.08 393.596 440.96C393.596 435.733 392.53 431.68 390.396 428.8C388.263 425.813 385.276 424.32 381.436 424.32C377.916 424.32 374.45 425.547 371.036 428C367.73 430.453 364.743 433.76 362.076 437.92C359.41 442.08 357.276 446.72 355.676 451.84C354.076 456.96 353.276 462.24 353.276 467.68C353.276 478.88 356.85 484.48 363.996 484.48Z" fill="black"/>
                    </svg>
                </div>
            )}

            {/* Main SVG */}
            <svg ref={svgRef} width={dims.w} height={dims.h}
                style={{ position: "absolute", top: 0, left: 0, display: isReady ? "block" : "none" }}>
                <g ref={gRef}>
                    <g className="edges" />
                    <g className="questions" />
                    <g className="responses" />
                    <g className="force-layer" />
                    <g className="compass-layer" />
                </g>
            </svg>

            {/* Axis pills — fixed to viewport, tracking zoom transform */}
            {isReady && (<>
                <div style={{ ...axisPill, position: "absolute", top: 20, left: pillLeft(zoomT.x, 58) }}>
                    Claim
                </div>
                <div style={{ ...axisPill, position: "absolute", bottom: 20, left: pillLeft(zoomT.x, 94) }}>
                    Experience
                </div>
                <div style={{ ...axisPill, position: "absolute", left: 20, top: pillTop(zoomT.y) }}>
                    Distraction
                </div>
                <div style={{ ...axisPill, position: "absolute", right: 20, top: pillTop(zoomT.y) }}>
                    Lifeline
                </div>
            </>)}

            {/* Quadrant exemplars — fixed viewport corners, 20px margins; fade when zoomed in */}
            {isReady && EXEMPLARS.map((ex, i) => (
                <div key={i} style={{
                    position: "absolute",
                    ...ex.corner,
                    fontFamily: "Libre Baskerville, serif",
                    fontStyle: "italic",
                    fontSize: 15,
                    lineHeight: 1.3,
                    color: "#000",
                    opacity: zoomT.k <= 1 ? 0.4 : 0,
                    transition: "opacity 0.35s ease-out",
                    pointerEvents: "none",
                    textAlign: ex.align,
                }}>
                    {ex.lines.map((l, j) => <div key={j}>{l}</div>)}
                </div>
            ))}

            <style>{`
                circle.cdot { transition: fill-opacity 0.18s ease-out; fill-opacity: 1; }
                circle.cdot.cdot-dim { fill-opacity: 0.12; }
            `}</style>

            {/* Quote modal — always mounted at bottom center; opacity fades in/out */}
            {/* Outer wrapper only handles position — never animated, so transform is safe */}
            <div style={{
                position: "absolute",
                bottom: 68,
                left: "50%",
                transform: "translateX(-50%)",
                width: 400,
                pointerEvents: "none",
                zIndex: 300,
                opacity: modalData ? 1 : 0,
                transition: "opacity 0.18s ease-out",
            }}>
                <div style={{
                    background: "#ffffff",
                    border: "1px solid rgba(0,0,0,0.1)",
                    borderRadius: 12,
                    padding: "16px 20px",
                    boxShadow: "0 2px 20px rgba(0,0,0,0.07)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: modalData?.color, flexShrink: 0 }} />
                        <div style={{ color: "#000", fontSize: 13, fontStyle: "italic", fontFamily: "Libre Baskerville, serif" }}>
                            {modalData?.sp}
                        </div>
                    </div>
                    <div style={{ color: "#000", fontSize: 16, lineHeight: 1.65, fontFamily: "Libre Baskerville, serif" }}>
                        &ldquo;{modalData?.transcript?.slice(0, 300)}{modalData?.transcript?.length > 300 ? "…" : ""}&rdquo;
                    </div>
                </div>
            </div>
        </div>
    );
}

const btnStyle = {
    background: "rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.18)",
    color: "#000", padding: "12px 36px", borderRadius: 28,
    fontSize: 11, cursor: "pointer", letterSpacing: 2, fontFamily: "Libre Baskerville, serif",
};
const axisPill = {
    background: "#ffffff",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 20,
    padding: "6px 14px",
    fontSize: 13,
    color: "#000",
    fontFamily: "Libre Baskerville, serif",
    pointerEvents: "none",
    userSelect: "none",
    zIndex: 20,
    whiteSpace: "nowrap",
};
