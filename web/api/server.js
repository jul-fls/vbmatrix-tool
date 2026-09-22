const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config({ path: "./.env" });

const { discoverMatrix, fetchMatrixPoints, getLiveConnection, applyAction, restartAudioEngine } = require("../../helpers"); // reuse your logic

const VBAN_HOST = process.env.VBAN_HOST;
const VBAN_PORT = process.env.VBAN_PORT || 6980;
const HTTP_PORT = process.env.HTTP_PORT || 3000;

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static("./web/front"));

/** --- In-memory cache --- **/
let matrixState = null;
let connectionState = null;
let refreshInFlight = null;
let refreshIsFull = false;

async function refreshMatrixAndConnections({ full = false } = {}) {
  if (refreshInFlight) {
    if (!full || refreshIsFull) return refreshInFlight;
    try {
      await refreshInFlight;
    } catch (err) {
      console.error("❌ Connection refresh failed before full refresh:", err);
    }
    return refreshMatrixAndConnections({ full: true });
  }

  refreshIsFull = full || !matrixState;
  refreshInFlight = (async () => {
    console.log("🔁 Refreshing matrix and connections...");
    const nextMatrix = refreshIsFull ? await discoverMatrix() : matrixState;
    if (!Object.keys(nextMatrix).length) throw new Error("No matrix slots discovered");
    const nextConnections = await fetchMatrixPoints(nextMatrix);
    matrixState = nextMatrix;
    global.matrixState = nextMatrix;
    connectionState = nextConnections;
    return { matrix: matrixState, connections: connectionState };
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
    refreshIsFull = false;
  }
}

/** --- Initialize matrix on startup --- **/
(async () => {
  try {
    await refreshMatrixAndConnections({ full: true });
    console.log("✅ Matrix and connections ready");
  } catch (err) {
    console.error("❌ Initial matrix refresh failed:", err);
  }
})();

/** --- GET /api/matrix --- **/
app.get("/api/matrix", (req, res) => {
  if (!matrixState) return res.status(503).json({ error: "Matrix not initialized yet" });
  res.json(matrixState);
});

/** --- GET /api/connections --- **/
app.get("/api/connections", (req, res) => {
  if (!connectionState) return res.status(503).json({ error: "Connection state not loaded yet" });
  res.json(connectionState);
});

/** --- GET /api/connections/:src/:dst --- **/
app.get("/api/connections/:src/:dst", (req, res) => {
  const { src, dst } = req.params;
  if (!connectionState) return res.status(503).json({ error: "Connection state not loaded yet" });

  const key = `${src.toUpperCase()} → ${dst.toUpperCase()}`;
  const section = connectionState[key];
  if (!section) return res.status(404).json({ error: "No such connection section" });
  res.json(section);
});

app.get("/api/live/:src/:dst", async (req, res) => {
  const { src, dst } = req.params;
  const { inName, outName } = req.query;

  if (!src || !dst || !inName || !outName)
    return res.status(400).json({ error: "Missing parameters" });

  try {
    const result = await getLiveConnection(src, dst, inName, outName);
    res.json(result);
  } catch (err) {
    console.error("❌ Live fetch error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** --- POST /api/action --- **/
app.post("/api/action", async (req, res) => {
  const { source, target, action, value } = req.body;

  if (!source || !target || !action) {
    return res.status(400).json({ error: "Missing parameters: source, target, action" });
  }

  try {
    await applyAction(source, target, action, value);
    res.json({ ok: true, message: `Action '${action}' applied on ${source} → ${target}` });
  } catch (err) {
    console.error("❌ Error in /api/action:", err);
    res.status(500).json({ error: err.message });
  }
});

/** --- POST /api/refresh --- **/
app.post("/api/refresh", async (req, res) => {
  try {
    const { matrix, connections } = await refreshMatrixAndConnections({ full: req.body?.full === true });
    res.json({ ok: true, message: "Matrix and connections refreshed", matrix, connections });
  } catch (err) {
    console.error("❌ Error refreshing:", err);
    res.status(500).json({ error: err.message });
  }
});

/** 🔄 Restart audio engine */
app.post("/api/restart", async (req, res) => {
  try {
    restartAudioEngine();
    console.log("🔄 Audio engine restart requested via API");
    res.json({ success: true, message: "Audio engine restarted." });
  } catch (err) {
    console.error("❌ Failed to restart engine:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** --- Start server --- **/
app.listen(HTTP_PORT, () => {
  console.log(`🚀 API server running at http://localhost:${HTTP_PORT}`);
});
