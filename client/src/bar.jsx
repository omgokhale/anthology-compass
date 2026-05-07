import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as d3 from "d3";
import { ChartBar, ChartScatter } from "@phosphor-icons/react";

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

function exportPng(svgEl) {
    const clone = svgEl.cloneNode(true);
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", svgEl.getAttribute("width"));
    bg.setAttribute("height", svgEl.getAttribute("height"));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement("canvas");
        const scale = 2;
        canvas.width  = +svgEl.getAttribute("width")  * scale;
        canvas.height = +svgEl.getAttribute("height") * scale;
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        const a = document.createElement("a");
        a.download = "anthology-themes.png";
        a.href = canvas.toDataURL("image/png");
        a.click();
    };
    img.src = url;
}

function drawBar(svgEl, rows, onSelect) {
    const W = Math.min(480, window.innerWidth - 460);
    const BAR_H = 34, GAP = 12;
    const LABEL_W = 148, PAD_R = 44;
    const H = rows.length * (BAR_H + GAP) - GAP;
    const x = d3.scaleLinear().domain([0, d3.max(rows, d => d.count)]).range([0, W - LABEL_W - PAD_R]);

    const svg = d3.select(svgEl).attr("width", W).attr("height", H);
    svg.selectAll("*").remove();

    const g = svg.selectAll("g.row")
        .data(rows).join("g").attr("class", "row")
        .attr("transform", (_, i) => `translate(0,${i * (BAR_H + GAP)})`)
        .style("cursor", "pointer")
        .on("click", (_, d) => onSelect(prev => prev === d.key ? null : d.key));

    g.append("text")
        .attr("x", LABEL_W - 12).attr("y", BAR_H / 2)
        .attr("text-anchor", "end").attr("dominant-baseline", "middle")
        .attr("fill", "#1a1a1a").attr("font-size", 13)
        .style("font-family", "Libre Baskerville, serif")
        .text(d => d.label);

    g.append("rect")
        .attr("x", LABEL_W).attr("y", 0)
        .attr("width", 0).attr("height", BAR_H)
        .attr("fill", d => d.color).attr("rx", 3)
        .transition().duration(700).ease(d3.easeCubicOut)
        .delay((_, i) => i * 60)
        .attr("width", d => x(d.count));

    g.append("text")
        .attr("x", LABEL_W + 8).attr("y", BAR_H / 2)
        .attr("dominant-baseline", "middle")
        .attr("fill", "#fff").attr("font-size", 12)
        .style("font-family", "Libre Baskerville, serif")
        .attr("opacity", 0)
        .text(d => d.count)
        .transition().duration(300).delay((_, i) => i * 60 + 500)
        .attr("opacity", 1);
}

function drawBubble(svgEl, rows, onSelect) {
    const S = Math.min(460, window.innerHeight - 120, window.innerWidth - 460);
    const pack = d3.pack().size([S, S]).padding(6);
    const root = pack(d3.hierarchy({ children: rows }).sum(d => d.count));

    const svg = d3.select(svgEl).attr("width", S).attr("height", S);
    svg.selectAll("*").remove();

    const node = svg.selectAll("g.bubble")
        .data(root.leaves()).join("g").attr("class", "bubble")
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .style("cursor", "pointer")
        .on("click", (_, d) => onSelect(prev => prev === d.data.key ? null : d.data.key));

    node.append("circle")
        .attr("r", 0)
        .attr("fill", d => d.data.color)
        .attr("opacity", 0.9)
        .transition().duration(600).ease(d3.easeCubicOut)
        .delay((_, i) => i * 50)
        .attr("r", d => d.r);

    // Label — only if circle is large enough
    node.filter(d => d.r > 38)
        .append("text")
        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
        .attr("fill", "#fff").attr("font-size", d => Math.min(12, d.r / 3.5))
        .style("font-family", "Libre Baskerville, serif")
        .attr("y", -8)
        .attr("opacity", 0)
        .text(d => d.data.label)
        .transition().delay((_, i) => i * 50 + 400).duration(200)
        .attr("opacity", 1);

    node.filter(d => d.r > 24)
        .append("text")
        .attr("text-anchor", "middle").attr("dominant-baseline", "middle")
        .attr("fill", "#fff").attr("font-size", d => Math.min(13, d.r / 3))
        .style("font-family", "Libre Baskerville, serif")
        .attr("y", d => d.r > 38 ? 10 : 0)
        .attr("opacity", 0)
        .text(d => d.data.count)
        .transition().delay((_, i) => i * 50 + 400).duration(200)
        .attr("opacity", 1);
}

const PANEL_W = 360;

function TilePanel({ cluster, tiles, color }) {
    const ref = useRef();
    useEffect(() => { ref.current?.scrollTo(0, 0); }, [cluster]);
    return (
        <div ref={ref} style={{
            width: PANEL_W,
            height: "100vh",
            borderLeft: "1px solid rgba(0,0,0,0.1)",
            overflowY: "auto",
            padding: "48px 28px",
            boxSizing: "border-box",
            flexShrink: 0,
        }}>
            <div style={{ fontSize: 13, fontFamily: "Libre Baskerville, serif", color: "#1a1a1a", marginBottom: 24 }}>
                {CLUSTER_LABELS[cluster] || cluster}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {tiles.map(t => (
                    <div key={t.id} style={{
                        background: "#ffffff",
                        border: "1px solid rgba(0,0,0,0.1)",
                        borderRadius: 12,
                        padding: "16px 20px",
                        boxShadow: "0 2px 20px rgba(0,0,0,0.07)",
                    }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                            <div style={{ color: "#000", fontSize: 13, fontStyle: "italic", fontFamily: "Libre Baskerville, serif" }}>
                                {t.speakerName}
                            </div>
                        </div>
                        <div style={{ color: "#000", fontSize: 15, lineHeight: 1.65, fontFamily: "Libre Baskerville, serif" }}>
                            &ldquo;{t.text}&rdquo;
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function App() {
    const svgRef = useRef();
    const [rows, setRows] = useState([]);
    const [tilesByCluster, setTilesByCluster] = useState({});
    const [selected, setSelected] = useState(null);
    const [view, setView] = useState("bar");

    useEffect(() => {
        async function load() {
            const res = await fetch("/api/catalog/1208");
            const data = await res.json();
            const counts = {};
            const byCluster = {};
            data.tiles.filter(t => t.relevant !== false).forEach(t => {
                const k = t.themeCluster || "Other";
                counts[k] = (counts[k] || 0) + 1;
                (byCluster[k] = byCluster[k] || []).push(t);
            });
            setTilesByCluster(byCluster);
            setRows(Object.entries(counts)
                .map(([key, count]) => ({ key, label: CLUSTER_LABELS[key] || key, count, color: CLUSTER_COLORS[key] || CLUSTER_COLORS.Other }))
                .sort((a, b) => b.count - a.count));
        }
        load();
    }, []);

    useEffect(() => {
        if (!rows.length || !svgRef.current) return;
        if (view === "bar") drawBar(svgRef.current, rows, setSelected);
        else drawBubble(svgRef.current, rows, setSelected);
    }, [view, rows]);

    const selectedColor = selected ? (CLUSTER_COLORS[selected] || CLUSTER_COLORS.Other) : null;

    return (
        <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "#fff" }}>
            {/* View toggle — top left */}
            <div style={{ position: "fixed", top: 20, left: 20, display: "flex", gap: 12, zIndex: 100 }}>
                <ChartBar
                    size={20}
                    weight="regular"
                    style={{ cursor: "pointer", opacity: view === "bar" ? 1 : 0.4, transition: "opacity 0.15s" }}
                    onClick={() => setView("bar")}
                />
                <ChartScatter
                    size={20}
                    weight="regular"
                    style={{ cursor: "pointer", opacity: view === "bubble" ? 1 : 0.4, transition: "opacity 0.15s" }}
                    onClick={() => setView("bubble")}
                />
            </div>

            {/* Chart */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 32, padding: "48px 32px", overflow: "hidden" }}>
                <svg ref={svgRef} />
                <button
                    onClick={() => exportPng(svgRef.current)}
                    style={{ background: "none", border: "none", padding: 0, fontSize: 13, cursor: "pointer", fontFamily: "Libre Baskerville, serif", color: "rgba(0,0,0,0.35)" }}
                >
                    Export PNG
                </button>
            </div>

            {/* Tile panel */}
            {selected && (
                <TilePanel
                    cluster={selected}
                    tiles={tilesByCluster[selected] || []}
                    color={selectedColor}
                />
            )}
        </div>
    );
}

createRoot(document.getElementById("root")).render(<App />);
