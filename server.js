// server.js  (D:\about_me\gemini-midterm2\server.js)
import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch"; // make sure: npm i node-fetch@3
import { GoogleGenerativeAI } from "@google/generative-ai"; // npm i @google/generative-ai@latest

dotenv.config();

/* ---------------------- paths / app ---------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* --------------------- env + client ---------------------- */
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error("❌ Missing GEMINI_API_KEY in .env (at project root).");
  process.exit(1);
}
console.log(`🔑 GEMINI_API_KEY loaded (${KEY.slice(0, 6)}…${KEY.slice(-4)})`);

//
// IMPORTANT: force API version v1 (your key is returning 404s on v1beta).
//
const API_VERSION = "v1";

// Construct the SDK client with v1
const genAI = new GoogleGenerativeAI({
  apiKey: KEY,
  // many versions of the SDK accept this:
  apiVersion: API_VERSION
});

/* ----------------- model discovery helpers ---------------- */
const PREFERRED_MODELS = [
  // good fast choices first:
  "gemini-1.5-flash",
  "gemini-1.5-flash-latest",
  "gemini-1.5-flash-8b",
  // stronger models:
  "gemini-1.5-pro",
  "gemini-1.0-pro",
  // (older) fallbacks:
  "gemini-pro"
];

async function listModelsRaw() {
  const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models?key=${encodeURIComponent(KEY)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`ListModels failed: ${r.status} ${r.statusText}`);
  return r.json(); // { models: [...] }
}

async function pickFirstAvailableModel() {
  try {
    const json = await listModelsRaw();
    const have = new Set((json.models || []).map(m => m.name));
    // Example names look like "models/gemini-1.5-flash" on v1
    const normalised = new Set(
      [...have].map(n => n.replace(/^models\//, ""))
    );

    for (const m of PREFERRED_MODELS) {
      if (have.has(`models/${m}`) || normalised.has(m)) return m;
    }
    // If none of our preferred, just return the first text-capable model, if present
    const first = (json.models || []).find(m => (m.supportedGenerationMethods || []).includes("generateContent"));
    if (first) return first.name.replace(/^models\//, "");
  } catch (e) {
    console.error("listModels error:", e.message);
  }
  return null;
}

let SELECTED_MODEL = null;

/* -------------------- debug endpoints -------------------- */
// See which static files Express is serving
app.get("/_debug-list", (req, res) => {
  res.json(require("fs").readdirSync(path.join(__dirname, "public")));
});

// See exactly which models your key can access
app.get("/_models", async (_req, res) => {
  try {
    const data = await listModelsRaw();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ----------------------- main API ------------------------ */
app.post("/api/gemini", async (req, res) => {
  const prompt = (req.body?.prompt || "").trim();
  if (!prompt) return res.status(400).json({ error: "Empty prompt" });

  try {
    // lazily choose a model once
    if (!SELECTED_MODEL) {
      SELECTED_MODEL = await pickFirstAvailableModel();
      if (!SELECTED_MODEL) {
        return res.status(503).json({
          error: "No text model available on this key/project.",
          hint: "Open http://localhost:3000/_models to see what your key can use."
        });
      }
      console.log(`✅ Using model: ${SELECTED_MODEL} (${API_VERSION})`);
    }

    // Try SDK first
    try {
      const model = genAI.getGenerativeModel({ model: SELECTED_MODEL });
      const result = await model.generateContent(prompt);
      const text = result?.response?.text?.() ?? "";
      if (text) return res.json({ output: text });
      // fall through to HTTP if empty
    } catch (sdkErr) {
      console.warn("⚠️ SDK path failed, falling back to HTTP:", sdkErr?.message);
    }

    // Fallback: direct HTTP (works across SDK/version quirks)
    const url = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${encodeURIComponent(SELECTED_MODEL)}:generateContent?key=${encodeURIComponent(KEY)}`;

    const httpResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    if (!httpResp.ok) {
      const msg = await httpResp.text();
      return res.status(httpResp.status).json({
        error: "Gemini request failed",
        status: httpResp.status,
        statusText: httpResp.statusText,
        message: msg
      });
    }

    const data = await httpResp.json();
    const text =
      data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("") ??
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      "";

    return res.json({ output: text || "(no text)" });
  } catch (err) {
    console.error("❌ Server error:", err);
    res.status(500).json({ error: err?.message || "Unknown server error" });
  }
});

/* ---------------------- start server --------------------- */
app.listen(PORT, async () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
