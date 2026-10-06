// Import from the ARE Study Vault website (the Vercel app in this repo) using
// its own API, so nothing on the website needs to change.

import { normalizeDivisionCode } from "../public/shared/are.js";
import { newSrs } from "../public/shared/srs.js";
import { makeId } from "./store.js";

const WEBSITE_DIVISIONS = ["PA", "PPD", "PDD", "PCM", "PJM", "CE"];
const NOTE_MARKER = "\n\n[[ARE_STUDY_NOTE_META_V2]]";
const LEGACY_MARKER = "\n\n[[STUDY_CAPTURE_META_V1]]";

function text(value) {
  return String(value ?? "").trim();
}

function splitMeta(raw, marker) {
  const index = raw.lastIndexOf(marker);
  if (index < 0) return { visible: raw.trim(), meta: null };
  try {
    return { visible: raw.slice(0, index).trim(), meta: JSON.parse(raw.slice(index + marker.length).trim()) };
  } catch {
    return { visible: raw.slice(0, index).trim(), meta: null };
  }
}

function firstLine(value) {
  return text(value).split(/\r?\n/).map(line => line.trim()).find(Boolean) || "";
}

function summaryText(analysis) {
  if (!analysis || typeof analysis !== "object") return "";
  const bullets = Array.isArray(analysis.bulletPoints) ? analysis.bulletPoints.map(text).filter(Boolean) : [];
  return [text(analysis.summary), bullets.map(item => `- ${item}`).join("\n")].filter(Boolean).join("\n\n");
}

// Mirrors parseNote() in the website's src/App.jsx.
export function parseWebsiteNote(note) {
  const raw = String(note?.text || "");
  const parsed = splitMeta(raw, NOTE_MARKER);
  if (parsed.meta) {
    return {
      title: text(parsed.meta.title) || "Untitled Note",
      body: typeof parsed.meta.rawNotes === "string" ? parsed.meta.rawNotes.trim() : parsed.visible,
      summary: summaryText(parsed.meta.analysis),
      attachments: Array.isArray(parsed.meta.attachments) ? parsed.meta.attachments.filter(item => item?.dataUrl) : []
    };
  }
  const legacy = splitMeta(raw, LEGACY_MARKER);
  const body = legacy.visible || parsed.visible;
  return {
    title: firstLine(body) || "Untitled Note",
    body,
    summary: summaryText(legacy.meta?.aiResult || legacy.meta?.localAnalysis),
    attachments: []
  };
}

export function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(String(dataUrl || ""));
  if (!match) return null;
  const type = match[1] || "application/octet-stream";
  const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
  return { type, buffer };
}

function topicOf(item) {
  return [text(item.roomName), text(item.subroomName || item.subRoomName)].filter(Boolean).join(" / ");
}

export function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(text(value).includes("://") ? text(value) : `https://${text(value)}`);
  } catch {
    throw new Error("That doesn't look like a web address.");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Use an http or https address.");
  return url.origin;
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  for (const value of values) {
    const match = /(?:^|,\s*)(are_study_session=[^;]+)/.exec(value);
    if (match) return match[1];
  }
  return "";
}

async function readJson(response, what) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${what} failed: ${body.error || `HTTP ${response.status}`}`);
  return body;
}

export async function fetchWebsiteData({ url, passcode, fetchImpl = fetch }) {
  const base = normalizeBaseUrl(url);
  const login = await fetchImpl(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode: String(passcode || "") })
  });
  await readJson(login, "Login");
  const cookie = sessionCookie(login);
  if (!cookie) throw new Error("Login worked but the site didn't return a session cookie.");
  const headers = { Cookie: cookie };

  const notes = [];
  for (const division of WEBSITE_DIVISIONS) {
    const body = await readJson(await fetchImpl(`${base}/api/notes?division=${division}`, { headers }), `Loading ${division} notes`);
    notes.push(...(Array.isArray(body.notes) ? body.notes : []));
  }
  const wrong = await readJson(await fetchImpl(`${base}/api/wrong-questions`, { headers }), "Loading wrong questions");
  return { base, notes, wrongQuestions: Array.isArray(wrong.flashcards) ? wrong.flashcards : [] };
}

// Decide what to do with an item that may have been imported before:
// unchanged on the site -> skip; changed on the site and untouched here ->
// update; changed in both places -> keep the local copy.
function importAction(existing, remoteSavedAt) {
  if (!existing) return "add";
  if (existing.importedSavedAt === remoteSavedAt) return "skip";
  if (Date.parse(existing.updatedAt) > Date.parse(existing.importedAt)) return "conflict";
  return "update";
}

export async function importWebsiteData(store, { notes = [], wrongQuestions = [], base = "" }, now = new Date()) {
  const result = { notes: { added: 0, updated: 0, unchanged: 0, keptLocal: 0 }, mistakes: { added: 0, updated: 0, unchanged: 0, keptLocal: 0 }, attachments: 0 };
  const stamp = now.toISOString();

  async function saveAll(items = []) {
    const ids = [];
    for (const item of items) {
      const decoded = decodeDataUrl(item.dataUrl);
      if (!decoded) continue;
      const meta = await store.saveAttachment({ name: item.name || "attachment", type: item.type || decoded.type, buffer: decoded.buffer });
      ids.push(meta.id);
      result.attachments += 1;
    }
    return ids;
  }

  for (const remote of notes) {
    const importId = `web-note:${remote.id}`;
    const savedAt = remote.savedAt ? new Date(remote.savedAt).toISOString() : stamp;
    const existing = store.data.notes.find(note => note.importId === importId);
    const action = importAction(existing, savedAt);
    if (action === "skip") { result.notes.unchanged += 1; continue; }
    if (action === "conflict") { result.notes.keptLocal += 1; continue; }
    const parsed = parseWebsiteNote(remote);
    const attachments = await saveAll(parsed.attachments);
    const fields = {
      division: normalizeDivisionCode(remote.division),
      topic: topicOf(remote),
      title: parsed.title,
      body: parsed.body,
      summary: parsed.summary,
      attachments,
      importId,
      importedSavedAt: savedAt,
      importedAt: stamp,
      updatedAt: stamp
    };
    await store.update(data => {
      const index = data.notes.findIndex(note => note.importId === importId);
      if (index >= 0) data.notes[index] = { ...data.notes[index], ...fields };
      else data.notes.push({ id: makeId("note"), area: "", tags: ["imported"], createdAt: savedAt, ...fields });
    });
    result.notes[action === "add" ? "added" : "updated"] += 1;
  }

  for (const remote of wrongQuestions) {
    const importId = `web-wrong:${remote.id}`;
    const savedAt = remote.savedAt ? new Date(remote.savedAt).toISOString() : stamp;
    const existing = store.data.cards.find(card => card.importId === importId);
    const action = importAction(existing, savedAt);
    if (action === "skip") { result.mistakes.unchanged += 1; continue; }
    if (action === "conflict") { result.mistakes.keptLocal += 1; continue; }
    const title = text(remote.title);
    const body = text(remote.text);
    const question = !body ? title : title && title !== firstLine(body) && title !== "Untitled Wrong Question" ? `${title}\n\n${body}` : body;
    const attachments = await saveAll(Array.isArray(remote.attachments) ? remote.attachments : []);
    await store.update(data => {
      const index = data.cards.findIndex(card => card.importId === importId);
      const shared = {
        division: normalizeDivisionCode(remote.division || remote.divisionId),
        topic: topicOf(remote) || text(remote.topicPath),
        attachments,
        importId,
        importedSavedAt: savedAt,
        importedAt: stamp,
        updatedAt: stamp
      };
      if (index >= 0) {
        const card = data.cards[index];
        data.cards[index] = { ...card, ...shared, mistake: { ...card.mistake, question } };
      } else {
        data.cards.push({
          id: makeId("card"),
          kind: "mistake",
          area: "",
          front: "",
          back: "",
          tags: ["imported"],
          suspended: false,
          srs: newSrs(),
          createdAt: savedAt,
          mistake: { source: base ? `Imported from ${new URL(base).host}` : "Imported", question, choices: "", myAnswer: "", correctAnswer: "", reason: "", explanation: "" },
          ...shared
        });
      }
    });
    result.mistakes[action === "add" ? "added" : "updated"] += 1;
  }

  await store.update(data => {
    data.imports.website = { base, at: stamp, result };
  });
  await store.removeOrphanAttachments();
  return result;
}
