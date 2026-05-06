const fs = require("fs");
const path = require("path");

module.exports = async function handler(req, res) {
    const { id } = req.query;
    const cacheFile = path.join(process.cwd(), "server", "cache", `${id}.json`);

    if (!fs.existsSync(cacheFile)) {
        return res.status(404).json({ error: `Catalog ${id} not found` });
    }

    const data = fs.readFileSync(cacheFile, "utf8");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(data);
};
