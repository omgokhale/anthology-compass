import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import * as d3 from "d3";

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
    // Embed white background
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
        canvas.width  = svgEl.getAttribute("width")  * scale;
        canvas.height = svgEl.getAttribute("height") * scale;
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

function BarChart() {
    const svgRef = useRef();

    useEffect(() => {
        async function draw() {
            const res = await fetch("/api/catalog/1208");
            const data = await res.json();

            const counts = {};
            data.tiles
                .filter(t => t.relevant !== false)
                .forEach(t => {
                    const k = t.themeCluster || "Other";
                    counts[k] = (counts[k] || 0) + 1;
                });

            const rows = Object.entries(counts)
                .map(([key, count]) => ({
                    key,
                    label: CLUSTER_LABELS[key] || key,
                    count,
                    color: CLUSTER_COLORS[key] || CLUSTER_COLORS.Other,
                }))
                .sort((a, b) => b.count - a.count);

            const W = Math.min(560, window.innerWidth - 48);
            const BAR_H = 34, GAP = 12;
            const LABEL_W = 148, PAD_R = 44;
            const H = rows.length * (BAR_H + GAP) - GAP;
            const barW = W - LABEL_W - PAD_R;
            const x = d3.scaleLinear().domain([0, d3.max(rows, d => d.count)]).range([0, barW]);

            const svg = d3.select(svgRef.current)
                .attr("width", W)
                .attr("height", H);

            const g = svg.selectAll("g.row")
                .data(rows).join("g").attr("class", "row")
                .attr("transform", (_, i) => `translate(0,${i * (BAR_H + GAP)})`);

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

        draw();
    }, []);

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#fff", gap: 32 }}>
            <svg ref={svgRef} />
            <button
                onClick={() => exportPng(svgRef.current)}
                style={{ background: "none", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, padding: "7px 18px", fontSize: 11, letterSpacing: 3, textTransform: "uppercase", cursor: "pointer", fontFamily: "Libre Baskerville, serif", color: "#1a1a1a" }}
            >
                Export PNG
            </button>
        </div>
    );
}

createRoot(document.getElementById("root")).render(<BarChart />);
