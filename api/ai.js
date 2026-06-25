import { GoogleGenerativeAI } from "@google/generative-ai";
import { requireAuthSession } from "./_auth.js";

function readBody(request) {
  if (!request?.body) return {};
  if (typeof request.body === "object") return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

function extractJson(rawText = "") {
  const clean = String(rawText || "").trim().replace(/```json/gi, "").replace(/```/g, "").trim();
  if (!clean) return "";
  try {
    JSON.parse(clean);
    return clean;
  } catch {
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) return clean.slice(first, last + 1).trim();
    return clean;
  }
}

function asText(value) {
  return String(value || "").trim();
}

function asList(value) {
  if (Array.isArray(value)) return value.map(item => asText(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function normalizeAnalysis(raw) {
  return {
    summary: asText(raw?.summary),
    bulletPoints: asList(raw?.bulletPoints)
  };
}

const SUMMARY_PROMPT = `
You are an expert ARE study-analysis engine for architecture learning notes.
Analyze only the raw text provided by the user. Do not assume any unseen PDF or image content.
Return ONLY valid JSON. Do not include markdown, explanations, or code fences.

Use exactly this JSON shape:
{
  "summary": "",
  "bulletPoints": [""]
}

Rules:
- summary: 2 to 4 sentences explaining the core objective, decision logic, and main study takeaway.
- bulletPoints: 5 to 10 complete, useful study bullets.
- Do not invent unsupported details.

Raw Notes text:
`;

export default async function handler(request, response) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAuthSession(request, response)) return;

  if (!process.env.GEMINI_API_KEY) {
    return response.status(500).json({ error: "Missing GEMINI_API_KEY" });
  }

  try {
    const { text = "" } = readBody(request);
    if (!String(text || "").trim()) {
      return response.status(400).json({ error: "Empty text" });
    }

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(`${SUMMARY_PROMPT}\n${text}`);
    const jsonText = extractJson(result?.response?.text?.() || "");

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return response.status(500).json({ error: `Model returned invalid JSON: ${jsonText.slice(0, 800)}` });
    }

    return response.status(200).json({ analysis: normalizeAnalysis(parsed) });
  } catch (error) {
    return response.status(500).json({ error: error?.message || "AI API Error" });
  }
}
