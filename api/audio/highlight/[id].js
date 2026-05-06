module.exports = async function handler(req, res) {
    const { id } = req.query;

    const audioRes = await fetch(`https://api.cortico.ai/v1/highlights/${id}/audio`, {
        headers: { Authorization: `Bearer ${process.env.CORTICO_API_KEY}` },
    });

    if (!audioRes.ok) {
        return res.status(audioRes.status).json({ error: "Audio unavailable" });
    }

    const buffer = await audioRes.arrayBuffer();
    res.setHeader("Content-Type", audioRes.headers.get("content-type") || "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(Buffer.from(buffer));
};
