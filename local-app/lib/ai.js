// Optional: generate flashcards from a note with Google Gemini, the same
// provider the website uses. Only runs when the user adds an API key.

import { divisionByCode } from "../public/shared/are.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export function extractJson(raw) {
  const cleaned = String(raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
    throw new Error("The AI reply wasn't valid JSON. Try again.");
  }
}

export function flashcardPrompt({ text, division, count }) {
  const info = divisionByCode(division);
  const scope = info ? `the ARE 5.0 ${info.name} (${info.code}) division` : "the ARE 5.0 (Architect Registration Examination)";
  return [
    `You are helping an architecture candidate study for ${scope}.`,
    `From the study notes below, write up to ${count} flashcards on the most exam-relevant material:`,
    "definitions, code and contract requirements, numbers and thresholds, sequences, and decision rules.",
    "Each front is one specific question that requires recall, not a yes/no question.",
    "Each back is a short, precise answer (1-3 sentences).",
    "Use only information found in the notes; skip anything you would have to guess.",
    'Return only JSON shaped like {"cards":[{"front":"...","back":"..."}]}.',
    "",
    "Notes:",
    text
  ].join("\n");
}

export async function generateFlashcards({ apiKey, model, text, division, count = 8, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Add a Gemini API key in Settings to use AI flashcards.");
  if (!String(text || "").trim()) throw new Error("This note has no text to work from.");
  const response = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model || "gemini-2.5-flash")}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: flashcardPrompt({ text: String(text).slice(0, 60000), division, count }) }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.4 }
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Gemini error: ${body.error?.message || `HTTP ${response.status}`}`);
  const reply = (body.candidates?.[0]?.content?.parts || []).map(part => part.text || "").join("");
  const parsed = extractJson(reply);
  const cards = (Array.isArray(parsed?.cards) ? parsed.cards : [])
    .map(card => ({ front: String(card?.front || "").trim(), back: String(card?.back || "").trim() }))
    .filter(card => card.front && card.back);
  if (!cards.length) throw new Error("The AI didn't return any usable flashcards.");
  return cards.slice(0, count);
}
