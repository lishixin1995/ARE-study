import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const DIVISIONS = [
  ["PA", "PA", "Programming & Analysis"],
  ["PPD", "PPD", "Project Planning & Design"],
  ["PDD", "PDD", "Project Development & Documentation"],
  ["PCM", "PcM", "Practice Management"],
  ["PJM", "PjM", "Project Management"],
  ["CE", "CE", "Construction & Evaluation"]
];

const DEFAULT_ROOMS = {
  PA: ["Site", "Zoning", "Code", "Programming"],
  PPD: ["Site Planning", "Climate", "Structure", "Systems"],
  PDD: ["Envelope", "Detailing", "Materials", "Documentation"],
  PCM: ["Practice", "Risk", "Contracts", "Finance"],
  PJM: ["Team", "Schedule", "CA", "Delivery"],
  CE: ["Site Visit", "Submittals", "RFI", "Punch List"]
};

const MARKER = "\n\n[[ARE_STUDY_NOTE_META_V2]]";
const LEGACY_MARKER = "\n\n[[STUDY_CAPTURE_META_V1]]";
const EMPTY_ANALYSIS = { summary: "", bulletPoints: [] };
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const WRONG_QUESTION_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/jpg",
  "image/png"
]);

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const makeId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const slug = value => clean(value).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-").replace(/^-+|-+$/g, "");

function divisionInfo(code) {
  const item = DIVISIONS.find(([value]) => value === code) || DIVISIONS[0];
  return { code: item[0], label: item[1], name: item[2] };
}

function defaultTree() {
  return DIVISIONS.reduce((tree, [code]) => {
    tree[code] = (DEFAULT_ROOMS[code] || []).map((name, index) => ({
      id: `${code}-${slug(name) || `room-${index}`}`,
      name,
      children: []
    }));
    return tree;
  }, {});
}

function formatDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return value || "";
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function normalizeAnalysis(value) {
  if (!value || typeof value !== "object") return { ...EMPTY_ANALYSIS };
  const summary = String(value.summary || "").trim();
  const bulletPoints = Array.isArray(value.bulletPoints) ? value.bulletPoints.map(item => String(item || "").trim()).filter(Boolean) : [];
  return { summary, bulletPoints };
}

function hasAnalysis(analysis) {
  return Boolean(analysis?.summary || analysis?.bulletPoints?.length);
}

function splitMeta(text = "", marker = MARKER) {
  const raw = String(text || "");
  const index = raw.lastIndexOf(marker);
  if (index < 0) return { visible: raw.trim(), meta: null };
  try {
    return { visible: raw.slice(0, index).trim(), meta: JSON.parse(raw.slice(index + marker.length).trim()) };
  } catch {
    return { visible: raw.slice(0, index).trim(), meta: null };
  }
}

function parseNote(note) {
  const raw = String(note?.text || "");
  const parsed = splitMeta(raw, MARKER);
  let title = "Untitled Note";
  let rawNotes = parsed.visible;
  let analysis = { ...EMPTY_ANALYSIS };
  let attachments = [];

  if (parsed.meta) {
    title = clean(parsed.meta.title) || title;
    rawNotes = typeof parsed.meta.rawNotes === "string" ? parsed.meta.rawNotes : rawNotes;
    analysis = normalizeAnalysis(parsed.meta.analysis);
    attachments = Array.isArray(parsed.meta.attachments) ? parsed.meta.attachments.filter(item => item?.dataUrl) : [];
  } else {
    const legacy = splitMeta(raw, LEGACY_MARKER);
    rawNotes = legacy.visible || rawNotes;
    title = rawNotes.split(/\r?\n/).map(line => line.trim()).find(Boolean) || title;
    analysis = normalizeAnalysis(legacy.meta?.aiResult || legacy.meta?.localAnalysis || null);
  }

  return { ...note, title, rawNotes, plainText: rawNotes, analysis, attachments, analyzed: hasAnalysis(analysis) };
}

function packNote(draft) {
  const title = clean(draft.title) || "Untitled Note";
  const rawNotes = String(draft.rawNotes || "").trim();
  const analysis = normalizeAnalysis(draft.analysis);
  const visible = [title, rawNotes].filter(Boolean).join("\n\n");
  const meta = { version: 2, title, rawNotes, analysis, analyzed: hasAnalysis(analysis), attachments: draft.attachments || [] };
  return `${visible || title}${MARKER}${JSON.stringify(meta)}`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function countAttachments(items = []) {
  return items.reduce((count, item) => {
    if (item.kind === "pdf" || item.type === "application/pdf") count.pdf += 1;
    if (item.kind === "image" || String(item.type || "").startsWith("image/")) count.image += 1;
    return count;
  }, { pdf: 0, image: 0 });
}

function countWrongAttachments(items = []) {
  return items.reduce((count, item) => {
    if (item.kind === "pdf" || item.type === "application/pdf") count.pdf += 1;
    if (item.kind === "docx" || item.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") count.docx += 1;
    if (item.kind === "image" || String(item.type || "").startsWith("image/")) count.image += 1;
    return count;
  }, { pdf: 0, docx: 0, image: 0 });
}

function formatBytes(value = 0) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function wrongAttachmentKind(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = file?.type === "image/jpg" ? "image/jpeg" : file?.type || "";
  if (type === "application/pdf" || name.endsWith(".pdf")) return { type: "application/pdf", kind: "pdf" };
  if (type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || name.endsWith(".docx")) return { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "docx" };
  if (type === "image/jpeg" || type === "image/jpg" || type === "image/png" || /\.(jpe?g|png)$/.test(name)) return { type: type === "image/jpg" ? "image/jpeg" : type || (name.endsWith(".png") ? "image/png" : "image/jpeg"), kind: "image" };
  return null;
}

function normalizeWrongQuestion(card = {}) {
  const text = typeof card.text === "string" ? card.text : String(card.editedText || card.questionText || "");
  const title = clean(card.title) || text.split(/\r?\n/).map(line => line.trim()).find(Boolean) || "Untitled Wrong Question";
  const attachments = Array.isArray(card.attachments) ? card.attachments.filter(item => item?.dataUrl) : [];
  return {
    ...card,
    division: card.division || card.divisionId || "",
    divisionId: card.divisionId || card.division || "",
    roomId: card.roomId || "",
    roomName: card.roomName || "",
    subroomId: card.subroomId || card.subRoomId || "",
    subRoomId: card.subRoomId || card.subroomId || "",
    subroomName: card.subroomName || card.subRoomName || "",
    subRoomName: card.subRoomName || card.subroomName || "",
    topicPath: card.topicPath || "",
    title,
    text,
    attachments,
    savedAt: card.savedAt || new Date().toISOString()
  };
}

function useDebouncedValue(value, delay = 275) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

function searchableText(parts = []) {
  return parts.flat().filter(Boolean).join("\n").toLowerCase();
}

function attachmentNames(items = []) {
  return items.map(item => item?.name || "").filter(Boolean);
}

function noteSearchText(note = {}) {
  return searchableText([
    note.title,
    note.analysis?.summary,
    note.analysis?.bulletPoints || [],
    note.rawNotes,
    attachmentNames(note.attachments)
  ]);
}

function wrongSearchText(card = {}) {
  return searchableText([
    card.title,
    card.text,
    attachmentNames(card.attachments)
  ]);
}

function itemPath(item = {}) {
  return [item.division || item.divisionId, item.roomName, item.subroomName || item.subRoomName].filter(Boolean).join(" / ");
}

function matchPreview(parts = [], query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const text = parts.flat().filter(Boolean).map(value => String(value)).join(" ");
  if (!text) return "No preview available.";
  if (!needle) return clean(text).slice(0, 170);
  const lower = text.toLowerCase();
  const index = lower.indexOf(needle);
  if (index < 0) return clean(text).slice(0, 170);
  const start = Math.max(0, index - 55);
  const end = Math.min(text.length, index + needle.length + 95);
  return `${start > 0 ? "..." : ""}${clean(text.slice(start, end))}${end < text.length ? "..." : ""}`;
}

function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className="search-wrap">
      <span className="search-icon" aria-hidden="true" />
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === "Escape") onChange("");
        }}
        placeholder={placeholder}
      />
      {value ? <button type="button" onClick={() => onChange("")}>Clear</button> : null}
    </div>
  );
}

function SearchResults({ results, query, loading, emptyText, onOpen }) {
  if (loading) return <div className="empty-soft">Searching...</div>;
  if (!query) return null;
  if (!results.length) return <div className="empty-soft">{emptyText}</div>;

  return (
    <div className="search-results">
      {results.map(result => (
        <button key={`${result.type}-${result.item.id}`} className="search-result" onClick={() => onOpen(result)}>
          <div>
            <b>{result.title}</b>
            <span>{result.typeLabel} · {result.path || "Unassigned"}</span>
          </div>
          <p>{result.preview}</p>
          <small>Updated {formatDate(result.savedAt)}</small>
        </button>
      ))}
    </div>
  );
}

function CardCarousel({ title, previousLabel, nextLabel, empty, children }) {
  const scrollRef = useRef(null);
  const [scrollState, setScrollState] = useState({ canPrevious: false, canNext: false });
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);

  function updateScrollState() {
    const track = scrollRef.current;
    if (!track) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    setScrollState({
      canPrevious: track.scrollLeft > 2,
      canNext: track.scrollLeft < maxScroll - 2
    });
  }

  useEffect(() => {
    const track = scrollRef.current;
    if (!track) return undefined;
    track.scrollLeft = 0;
    const frame = window.requestAnimationFrame(updateScrollState);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateScrollState) : null;
    observer?.observe(track);
    Array.from(track.children).forEach(child => observer?.observe(child));
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [children]);

  function scrollCards(direction) {
    const track = scrollRef.current;
    if (!track) return;
    const firstCard = track.querySelector(".note-card, .wrong-card");
    const cardWidth = firstCard?.getBoundingClientRect().width || 320;
    track.scrollBy({ left: direction * Math.max(cardWidth + 14, track.clientWidth * 0.82), behavior: "smooth" });
  }

  function handleWheel(event) {
    const track = scrollRef.current;
    if (!track || track.scrollWidth <= track.clientWidth) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const maxScroll = Math.max(0, track.scrollWidth - track.clientWidth);
    if ((event.deltaY < 0 && track.scrollLeft <= 2) || (event.deltaY > 0 && track.scrollLeft >= maxScroll - 2)) return;
    event.preventDefault();
    track.scrollBy({ left: event.deltaY, behavior: "auto" });
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      scrollCards(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      scrollCards(1);
    }
  }

  return (
    <section className="content-section carousel-section">
      <div className="carousel-head">
        <h3>{title}</h3>
        {hasItems ? (
          <div className="carousel-controls">
            <button className="carousel-control" aria-label={previousLabel} disabled={!scrollState.canPrevious} onClick={() => scrollCards(-1)}>‹</button>
            <button className="carousel-control" aria-label={nextLabel} disabled={!scrollState.canNext} onClick={() => scrollCards(1)}>›</button>
          </div>
        ) : null}
      </div>
      {hasItems ? (
        <div className="card-carousel-track" ref={scrollRef} onScroll={updateScrollState} onWheel={handleWheel} onKeyDown={handleKeyDown} tabIndex={0} aria-label={`${title} cards`}>
          {children}
        </div>
      ) : empty}
    </section>
  );
}

function downloadAttachment(item) {
  const link = document.createElement("a");
  link.href = item.dataUrl;
  link.download = item.name || "attachment";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openAttachment(item) {
  if (!item?.dataUrl) return;
  window.open(item.dataUrl, "_blank", "noopener,noreferrer");
}

function AuthGate({ onAuthenticated }) {
  const [passcode, setPasscode] = useState("");
  const [status, setStatus] = useState("Enter the site passcode to continue.");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!passcode.trim()) return setStatus("Please enter the passcode.");
    try {
      setBusy(true);
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ passcode }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.authenticated) return setStatus(data.error || "Passcode was not accepted.");
      onAuthenticated();
    } catch {
      setStatus("Could not reach the auth server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="passcode-shell">
      <section className="passcode-card">
        <div className="eyebrow">ARE Study Vault</div>
        <h1>Passcode required</h1>
        <p>Your cloud study workspace is protected before notes, rooms, attachments, or AI tools load.</p>
        <form className="passcode-form" onSubmit={submit}>
          <label htmlFor="passcode">Site passcode</label>
          <input id="passcode" type="password" value={passcode} onChange={event => setPasscode(event.target.value)} autoFocus />
          <button disabled={busy}>{busy ? "Checking..." : "Unlock"}</button>
        </form>
        <p className="status-line">{status}</p>
      </section>
    </main>
  );
}

function Dashboard({ searchQuery, onSearchChange, searchResults, searchLoading, onOpenSearchResult, notes, wrongQuestions, quickAction, setQuickAction, quickRooms, onQuickStart, onOpenNote, onOpenWrongQuestion }) {
  const recentNotes = [...notes].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)).slice(0, 6);
  const recentWrongQuestions = [...wrongQuestions].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)).slice(0, 6);
  const continueNote = recentNotes[0] || null;
  const attachmentCount = notes.reduce((sum, note) => sum + (note.attachments?.length || 0), 0) + wrongQuestions.reduce((sum, card) => sum + (card.attachments?.length || 0), 0);
  const selectedRooms = Array.isArray(quickRooms[quickAction.division]) ? quickRooms[quickAction.division] : [];
  const selectedRoom = selectedRooms.find(item => item.id === quickAction.roomId) || null;
  const selectedSubrooms = selectedRoom?.children || [];

  return (
    <section className="dashboard-page">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">Main Dashboard</div>
          <h1>ARE Study Vault</h1>
        </div>
        <p>Search, continue studying, or jump straight into a sub-room.</p>
      </div>
      <SearchBar value={searchQuery} onChange={onSearchChange} placeholder="Search all study notes and wrong questions..." />
      {searchQuery ? (
        <SearchResults
          results={searchResults}
          query={searchQuery}
          loading={searchLoading}
          emptyText="No study notes or wrong questions matched this search."
          onOpen={onOpenSearchResult}
        />
      ) : null}
      <div className="dashboard-hero-grid">
        <section className="dashboard-panel continue-panel">
          <div className="eyebrow">Continue Studying</div>
          {continueNote ? (
            <>
              <h2>{continueNote.title}</h2>
              <p className="dashboard-path">{itemPath(continueNote)}</p>
              <p>{matchPreview([continueNote.analysis?.summary, continueNote.rawNotes], "")}</p>
              <small>Updated {formatDate(continueNote.savedAt)}</small>
              <button className="primary" onClick={() => onOpenNote(continueNote)}>Continue</button>
            </>
          ) : <div className="empty-soft">No study notes saved yet.</div>}
        </section>
        <section className="dashboard-panel quick-panel">
          <div className="eyebrow">Quick Actions</div>
          <div className="quick-buttons">
            <button className={quickAction.type === "note" ? "active" : ""} onClick={() => setQuickAction(prev => ({ ...prev, type: "note" }))}>+ New Note</button>
            <button className={quickAction.type === "wrong" ? "active" : ""} onClick={() => setQuickAction(prev => ({ ...prev, type: "wrong" }))}>+ New Wrong Question</button>
          </div>
          <label>Division</label>
          <select value={quickAction.division} onChange={event => setQuickAction({ type: quickAction.type, division: event.target.value, roomId: "", subroomId: "" })}>
            <option value="">Select division</option>
            {DIVISIONS.map(([code, label, name]) => <option key={code} value={code}>{label} - {name}</option>)}
          </select>
          <label>Room</label>
          <select value={quickAction.roomId} disabled={!quickAction.division} onChange={event => setQuickAction(prev => ({ ...prev, roomId: event.target.value, subroomId: "" }))}>
            <option value="">Select room</option>
            {selectedRooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <label>Sub-room</label>
          <select value={quickAction.subroomId} disabled={!quickAction.roomId} onChange={event => setQuickAction(prev => ({ ...prev, subroomId: event.target.value }))}>
            <option value="">Select sub-room</option>
            {selectedSubrooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className="primary" disabled={!quickAction.division || !quickAction.roomId || !quickAction.subroomId} onClick={onQuickStart}>
            Open Editor
          </button>
        </section>
      </div>
      <section className="dashboard-panel">
        <div className="dashboard-section-head"><h2>Recent Notes</h2></div>
        {recentNotes.length ? <div className="dashboard-mini-grid">{recentNotes.map(note => <button className="mini-card" key={note.id} onClick={() => onOpenNote(note)}><b>{note.title}</b><span>{itemPath(note)}</span><p>{matchPreview([note.analysis?.summary, note.rawNotes], "")}</p><small>Updated {formatDate(note.savedAt)}</small><em>View Note</em></button>)}</div> : <div className="empty-soft">No recent notes yet.</div>}
      </section>
      <section className="dashboard-panel light-panel">
        <div className="dashboard-section-head"><h2>Wrong Questions to Review</h2></div>
        {recentWrongQuestions.length ? <div className="dashboard-mini-grid">{recentWrongQuestions.map(card => <button className="mini-card wrong-mini" key={card.id} onClick={() => onOpenWrongQuestion(card)}><b>{card.title}</b><span>{itemPath(card)}</span><p>{matchPreview([card.text], "")}</p><small>{card.attachments?.length || 0} attachments · Updated {formatDate(card.savedAt)}</small><em>View</em></button>)}</div> : <div className="empty-soft">No wrong questions saved yet.</div>}
      </section>
      <div className="dashboard-stats">{notes.length} Notes · {wrongQuestions.length} Wrong Questions · {attachmentCount} Attachments</div>
    </section>
  );
}

function NoteCard({ note, onOpen, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = countAttachments(note.attachments);
  return (
    <article className="note-card" onClick={() => onOpen(note)} tabIndex={0} role="button" onKeyDown={event => event.key === "Enter" && onOpen(note)}>
      <div className="note-card-head">
        <div className="note-card-title-block">
          <h3>{note.title}</h3>
          <small>Updated {formatDate(note.savedAt)}</small>
        </div>
        <div className="card-menu-wrap" onClick={event => event.stopPropagation()}>
          <button className="icon-menu-btn" aria-label="Note actions" onClick={() => setMenuOpen(open => !open)}>•••</button>
          {menuOpen ? (
            <div className="card-menu">
              <button onClick={() => { setMenuOpen(false); onEdit(note); }}>Edit</button>
              <button onClick={() => { setMenuOpen(false); onDelete(note.id); }}>Delete</button>
            </div>
          ) : null}
        </div>
      </div>
      <p className="summary-clamp">{note.analysis?.summary || clean(note.rawNotes) || "No summary yet."}</p>
      <ul className="bullet-clamp">
        {(note.analysis?.bulletPoints || []).slice(0, 2).map((item, index) => <li key={index}>{item}</li>)}
      </ul>
      <div className="card-footer">
        <div className="card-badges">
          <span className={note.analyzed ? "ok" : "muted"}>{note.analyzed ? "AI Analyzed" : "Not Analyzed"}</span>
          <span>PDF {counts.pdf}</span>
          <span>Image {counts.image}</span>
        </div>
        <span className="view-note-label">View Note</span>
      </div>
    </article>
  );
}

function NoteEditor({ draft, editing, busy, status, setDraft, onFiles, onRemoveFile, onAnalyze, onSave, onCancel }) {
  const inputRef = useRef(null);
  return (
    <section className="editor">
      <div className="workspace-head"><div><div className="eyebrow">{editing ? "Edit Note" : "New Note"}</div><h2>Capture Editor</h2></div><button onClick={onCancel}>Cancel</button></div>
      <label>Note Title</label>
      <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Give this note a title" />
      <label>Raw Notes text</label>
      <textarea value={draft.rawNotes} onChange={event => setDraft({ ...draft, rawNotes: event.target.value })} placeholder="Paste or type raw notes here..." />
      <div className="upload-row"><div><b>Attachments</b><p>PDF, JPEG, JPG, and PNG are saved only as attachments.</p></div><button onClick={() => inputRef.current?.click()}>Upload Files</button><input ref={inputRef} type="file" multiple accept="application/pdf,image/jpeg,image/jpg,image/png,.pdf,.jpeg,.jpg,.png" hidden onChange={event => onFiles(event.target.files)} /></div>
      {draft.attachments.length ? <div className="chips">{draft.attachments.map(item => <span key={item.id}>{item.kind.toUpperCase()} {item.name}<button onClick={() => onRemoveFile(item.id)}>Remove</button></span>)}</div> : null}
      <div className="buttons"><button className="ai" disabled={busy || !clean(draft.rawNotes)} onClick={onAnalyze}>{busy ? "Thinking..." : "Analyze with AI"}</button><button className="primary" onClick={onSave}>Save Note</button><button onClick={onCancel}>Cancel</button></div>
      {status ? <p className="status-banner">{status}</p> : null}
      {hasAnalysis(draft.analysis) ? <div className="analysis-preview"><section><h3>Summary</h3><p>{draft.analysis.summary}</p></section><section><h3>Bullet Points</h3><ul>{draft.analysis.bulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ul></section></div> : null}
    </section>
  );
}

function Viewer({ note, busy, onClose, onEdit, onDelete, onAnalyze }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!note) return;
    setPreview(null);
    setMenuOpen(false);
  }, [note?.id]);

  if (!note) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="viewer" onClick={event => event.stopPropagation()}>
        <header className="viewer-header">
          <div>
            <div className="eyebrow">Full Note Viewer</div>
            <h2>{note.title}</h2>
            <p>{note.division} / {note.roomName} / {note.subroomName} · Updated {formatDate(note.savedAt)}</p>
          </div>
          <div className="viewer-actions">
            <button onClick={() => onEdit(note)}>Edit</button>
            <button className="ai" disabled={busy || !clean(note.rawNotes)} onClick={() => onAnalyze(note)}>{busy ? "Thinking..." : "Re-analyze"}</button>
            <div className="card-menu-wrap">
              <button className="icon-menu-btn" aria-label="More actions" onClick={() => setMenuOpen(open => !open)}>•••</button>
              {menuOpen ? <div className="card-menu viewer-menu"><button onClick={() => { setMenuOpen(false); onDelete(note.id); }}>Delete</button></div> : null}
            </div>
            <button onClick={onClose}>Close</button>
          </div>
        </header>

        <div className="viewer-body viewer-two-column">
          <div className="viewer-left-column">
            <section className="viewer-panel">
              <h3>Summary</h3>
              <p>{note.analysis?.summary || "No AI summary yet."}</p>
            </section>
            <section className="viewer-panel">
              <h3>Bullet Points</h3>
              {note.analysis?.bulletPoints?.length ? <ul>{note.analysis.bulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No AI bullet points yet.</p>}
            </section>
            <section className="viewer-panel attachments-panel">
              <h3>Attachments</h3>
              {note.attachments?.length ? (
                <>
                  <div className="attachment-cards">
                    {note.attachments.map(item => {
                      const isPdf = item.kind === "pdf" || item.type === "application/pdf";
                      return (
                        <article className={`attachment-card ${isPdf ? "pdf" : "image"}`} key={item.id}>
                          <div className="attachment-thumb">{isPdf ? <span>PDF</span> : <img src={item.dataUrl} alt={item.name} />}</div>
                          <div className="attachment-info"><b>{item.name}</b><small>{isPdf ? "PDF file" : "Image file"}</small></div>
                          <div className="attachment-actions">
                            <button onClick={() => openAttachment(item)}>Open</button>
                            <button onClick={() => setPreview(item)}>Preview</button>
                            <button onClick={() => downloadAttachment(item)}>Download</button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {preview ? (
                    <div className="attachment-preview">
                      <div><b>{preview.name}</b><button onClick={() => setPreview(null)}>Close Preview</button></div>
                      {preview.kind === "pdf" || preview.type === "application/pdf" ? <iframe title={preview.name} src={preview.dataUrl} /> : <img src={preview.dataUrl} alt={preview.name} />}
                    </div>
                  ) : null}
                </>
              ) : <div className="empty-soft">No attachments saved for this note.</div>}
            </section>
          </div>
          <section className="viewer-panel raw-notes-panel">
            <h3>Raw Notes</h3>
            <div className="raw-note-text">{note.rawNotes || "No raw notes saved."}</div>
          </section>
        </div>
      </section>
    </div>
  );
}

function WrongQuestionCard({ card, onOpen, onEdit, onDelete, canManage = true }) {
  const counts = countWrongAttachments(card.attachments);
  return (
    <article className="wrong-card" onClick={() => onOpen(card)} tabIndex={0} role="button" onKeyDown={event => event.key === "Enter" && onOpen(card)}>
      <div className="wrong-card-head">
        <div>
          <h3>{card.title}</h3>
          <small>Updated {formatDate(card.savedAt)}</small>
        </div>
      </div>
      <p>{card.text || "No wrong question text saved."}</p>
      <div className="card-badges">
        <span>Image {counts.image}</span>
        <span>PDF {counts.pdf}</span>
        <span>DOCX {counts.docx}</span>
      </div>
      <div className="wrong-card-actions" onClick={event => event.stopPropagation()}>
        <button onClick={() => onOpen(card)}>View</button>
        {canManage ? <button onClick={() => onEdit(card)}>Edit</button> : null}
        {canManage ? <button onClick={() => onDelete(card.id)}>Delete</button> : null}
      </div>
    </article>
  );
}

function WrongQuestionEditor({ draft, editing, status, setDraft, onFiles, onRemoveFile, onSave, onCancel }) {
  const inputRef = useRef(null);
  return (
    <section className="editor wrong-editor">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">{editing ? "Edit Wrong Question" : "New Wrong Question"}</div>
          <h2>Wrong Question Editor</h2>
        </div>
        <button onClick={onCancel}>Cancel</button>
      </div>
      <label>Title</label>
      <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Give this wrong question a title" />
      <label>Wrong Question Text</label>
      <textarea value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} placeholder="Paste or type the wrong question here..." />
      <div className="upload-row">
        <div>
          <b>Multiple Attachments</b>
          <p>JPG, JPEG, PNG, PDF, and DOCX are saved with this wrong question.</p>
        </div>
        <button onClick={() => inputRef.current?.click()}>Upload Files</button>
        <input ref={inputRef} type="file" multiple accept=".jpg,.jpeg,.png,.pdf,.docx,image/jpeg,image/jpg,image/png,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={event => onFiles(event.target.files)} />
      </div>
      {draft.attachments.length ? (
        <div className="wrong-attachment-list">
          {draft.attachments.map(item => (
            <div key={item.id}>
              <span>{item.name}</span>
              <small>{item.kind.toUpperCase()} · {formatBytes(item.size)}</small>
              <button onClick={() => onRemoveFile(item.id)}>Remove</button>
            </div>
          ))}
        </div>
      ) : <div className="empty-soft">No attachments selected.</div>}
      <div className="buttons">
        <button className="primary" onClick={onSave}>Save</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {status ? <p className="status-banner">{status}</p> : null}
    </section>
  );
}

function WrongQuestionViewer({ card, onClose, onEdit, onDelete, canManage = true }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    setPreview(null);
  }, [card?.id]);

  if (!card) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="viewer wrong-viewer" onClick={event => event.stopPropagation()}>
        <header className="viewer-header">
          <div>
            <div className="eyebrow">Full Wrong Question Viewer</div>
            <h2>{card.title}</h2>
            <p>Updated {formatDate(card.savedAt)}</p>
          </div>
          <div className="viewer-actions">
            {canManage ? <button onClick={() => onEdit(card)}>Edit</button> : null}
            {canManage ? <button onClick={() => onDelete(card.id)}>Delete</button> : null}
            <button onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="wrong-viewer-body">
          <section className="viewer-panel">
            <h3>Wrong Question Text</h3>
            <div className="raw-note-text">{card.text || "No wrong question text saved."}</div>
          </section>
          <section className="viewer-panel">
            <h3>Attachments</h3>
            {card.attachments.length ? (
              <>
                <div className="attachment-cards">
                  {card.attachments.map(item => {
                    const isPdf = item.kind === "pdf" || item.type === "application/pdf";
                    const isDocx = item.kind === "docx" || item.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                    return (
                      <article className={`attachment-card ${isPdf ? "pdf" : isDocx ? "docx" : "image"}`} key={item.id}>
                        <div className="attachment-thumb">{isPdf ? <span>PDF</span> : isDocx ? <span>DOCX</span> : <img src={item.dataUrl} alt={item.name} />}</div>
                        <div className="attachment-info"><b>{item.name}</b><small>{item.kind.toUpperCase()} file · {formatBytes(item.size)}</small></div>
                        <div className="attachment-actions">
                          <button onClick={() => openAttachment(item)}>Open</button>
                          {!isDocx ? <button onClick={() => setPreview(item)}>Preview</button> : null}
                          <button onClick={() => downloadAttachment(item)}>Download</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {preview ? (
                  <div className="attachment-preview">
                    <div><b>{preview.name}</b><button onClick={() => setPreview(null)}>Close Preview</button></div>
                    {preview.kind === "pdf" || preview.type === "application/pdf" ? <iframe title={preview.name} src={preview.dataUrl} /> : <img src={preview.dataUrl} alt={preview.name} />}
                  </div>
                ) : null}
              </>
            ) : <div className="empty-soft">No attachments saved for this wrong question.</div>}
          </section>
        </div>
      </section>
    </div>
  );
}

function SubroomNameModal({ mode, name, status, busy, onNameChange, onSave, onCancel }) {
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <section className="small-modal" onClick={event => event.stopPropagation()}>
        <div>
          <div className="eyebrow">{mode === "rename" ? "Rename Sub-room" : "New Sub-room"}</div>
          <h2>{mode === "rename" ? "Rename sub-room" : "Create sub-room"}</h2>
        </div>
        <label>Sub-room name</label>
        <input value={name} onChange={event => onNameChange(event.target.value)} autoFocus placeholder="Sub-room name" />
        {status ? <p className="status-banner">{status}</p> : null}
        <div className="buttons">
          <button className="primary" disabled={busy || !clean(name)} onClick={onSave}>{busy ? "Saving..." : "Save"}</button>
          <button disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function DeleteSubroomModal({ subroom, counts, status, busy, onConfirm, onCancel }) {
  const hasContent = counts.notes || counts.wrongQuestions || counts.attachments;
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <section className="small-modal danger-modal" onClick={event => event.stopPropagation()}>
        <div>
          <div className="eyebrow">Delete Sub-room</div>
          <h2>Delete "{subroom?.name}"?</h2>
        </div>
        {hasContent ? (
          <div className="delete-warning">
            <p>Deleting this sub-room will also delete all notes, wrong questions, and attachments inside it.</p>
            <div className="card-badges">
              <span>{counts.notes} Study Notes</span>
              <span>{counts.wrongQuestions} Wrong Questions</span>
              <span>{counts.attachments} Attachments</span>
            </div>
          </div>
        ) : <p className="muted-text">This sub-room has no saved notes, wrong questions, or attachments.</p>}
        {status ? <p className="status-banner">{status}</p> : null}
        <div className="buttons">
          <button className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? "Deleting..." : "Delete Sub-room"}</button>
          <button disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState({ checking: true, authenticated: false, configured: true });
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const response = await fetch("/api/auth/status", { credentials: "same-origin" });
        const data = await response.json().catch(() => ({}));
        if (!cancelled) setAuth({ checking: false, authenticated: Boolean(response.ok && data.authenticated), configured: data.configured !== false });
      } catch {
        if (!cancelled) setAuth({ checking: false, authenticated: false, configured: true });
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    setAuth({ checking: false, authenticated: false, configured: true });
  }

  if (auth.checking) return <main className="passcode-shell"><section className="passcode-card"><div className="eyebrow">ARE Study Vault</div><h1>Checking access</h1><p>Loading your secure session...</p></section></main>;
  if (!auth.configured) return <main className="passcode-shell"><section className="passcode-card"><div className="eyebrow">ARE Study Vault</div><h1>Passcode not configured</h1><p>Add SITE_PASSCODE in Vercel Environment Variables, then redeploy.</p></section></main>;
  if (!auth.authenticated) return <AuthGate onAuthenticated={() => setAuth({ checking: false, authenticated: true, configured: true })} />;
  return <StudyApp onLogout={logout} />;
}

function StudyApp({ onLogout }) {
  const [division, setDivision] = useState("");
  const [roomId, setRoomId] = useState("");
  const [subroomId, setSubroomId] = useState("");
  const [tree, setTree] = useState(defaultTree);
  const [notes, setNotes] = useState([]);
  const [wrongQuestions, setWrongQuestions] = useState([]);
  const [viewerId, setViewerId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
  const [wrongEditorOpen, setWrongEditorOpen] = useState(false);
  const [wrongEditingId, setWrongEditingId] = useState("");
  const [wrongDraft, setWrongDraft] = useState({ title: "", text: "", attachments: [] });
  const [wrongViewerId, setWrongViewerId] = useState("");
  const [wrongStatus, setWrongStatus] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [allSearchData, setAllSearchData] = useState({ loaded: false, notes: [], wrongQuestions: [] });
  const [allSearchLoading, setAllSearchLoading] = useState(false);
  const [quickAction, setQuickAction] = useState({ type: "note", division: "", roomId: "", subroomId: "" });
  const [loadedRoomDivisions, setLoadedRoomDivisions] = useState([]);
  const [subroomForm, setSubroomForm] = useState(null);
  const [subroomName, setSubroomName] = useState("");
  const [deleteSubroomTarget, setDeleteSubroomTarget] = useState(null);
  const [openSubroomMenuId, setOpenSubroomMenuId] = useState("");
  const [subroomBusy, setSubroomBusy] = useState(false);
  const [subroomStatus, setSubroomStatus] = useState("");
  const debouncedDashboardSearch = useDebouncedValue(dashboardSearch);
  const debouncedRoomSearch = useDebouncedValue(roomSearch);

  const info = divisionInfo(division);
  const rooms = useMemo(() => Array.isArray(tree[division]) ? tree[division] : [], [tree, division]);
  const room = useMemo(() => rooms.find(item => item.id === roomId) || null, [rooms, roomId]);
  const subroom = useMemo(() => (room?.children || []).find(item => item.id === subroomId) || null, [room, subroomId]);
  const divisionNotes = useMemo(() => notes.filter(note => note.division === division).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)), [notes, division]);
  const subroomNotes = useMemo(() => divisionNotes.filter(note => note.roomId === roomId && (note.subroomId || "") === subroomId), [divisionNotes, roomId, subroomId]);
  const wrongQuestionsForSubroom = (targetRoomId, targetSubroomId) => wrongQuestions.filter(card => (card.division || card.divisionId) === division && card.roomId === targetRoomId && (card.subroomId || "") === targetSubroomId).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  const subroomWrongQuestions = useMemo(() => wrongQuestionsForSubroom(roomId, subroomId), [wrongQuestions, division, roomId, subroomId]);
  const unassignedWrongQuestions = useMemo(() => wrongQuestions.filter(card => !(card.division || card.divisionId) || !card.roomId || !card.subroomId), [wrongQuestions]);
  const viewerNote = notes.find(note => note.id === viewerId) || null;
  const wrongViewerCard = wrongQuestions.find(card => card.id === wrongViewerId) || null;
  const dashboardNotes = allSearchData.loaded ? allSearchData.notes : [];
  const dashboardWrongQuestions = allSearchData.loaded ? allSearchData.wrongQuestions : [];
  const dashboardSearchResults = useMemo(() => {
    const query = clean(debouncedDashboardSearch).toLowerCase();
    if (!query) return [];

    const noteResults = allSearchData.notes
      .filter(note => noteSearchText(note).includes(query))
      .map(note => ({
        type: "note",
        typeLabel: "Study Note",
        title: note.title,
        path: itemPath(note),
        preview: matchPreview([note.title, note.analysis?.summary, note.analysis?.bulletPoints || [], note.rawNotes, attachmentNames(note.attachments)], query),
        savedAt: note.savedAt,
        item: note
      }));

    const wrongResults = allSearchData.wrongQuestions
      .filter(card => wrongSearchText(card).includes(query))
      .map(card => ({
        type: "wrong",
        typeLabel: "Wrong Question",
        title: card.title,
        path: itemPath(card),
        preview: matchPreview([card.title, card.text, attachmentNames(card.attachments)], query),
        savedAt: card.savedAt,
        item: card
      }));

    return [...noteResults, ...wrongResults].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
  }, [allSearchData, debouncedDashboardSearch]);

  useEffect(() => {
    if (!division) return;
    fetch(`/api/rooms?division=${encodeURIComponent(division)}`).then(response => response.json().then(data => ({ ok: response.ok, data }))).then(({ ok, data }) => {
      if (!ok) return;
      setTree(prev => ({ ...prev, [division]: Array.isArray(data.rooms) ? data.rooms : [] }));
      setLoadedRoomDivisions(prev => prev.includes(division) ? prev : [...prev, division]);
    }).catch(() => setStatus("Cloud rooms unavailable."));
    fetch(`/api/notes?division=${encodeURIComponent(division)}`).then(response => response.json().then(data => ({ ok: response.ok, data }))).then(({ ok, data }) => ok && setNotes(Array.isArray(data.notes) ? data.notes.map(parseNote) : [])).catch(() => setStatus("Cloud notes unavailable."));
    fetch(`/api/wrong-questions?division=${encodeURIComponent(division)}`).then(response => response.json().then(data => ({ ok: response.ok, data }))).then(({ ok, data }) => {
      if (!ok) return setWrongStatus(data.error || "Cloud wrong questions unavailable.");
      setWrongQuestions(Array.isArray(data.flashcards) ? data.flashcards.map(normalizeWrongQuestion) : []);
      setWrongStatus("");
    }).catch(() => setWrongStatus("Cloud wrong questions unavailable."));
  }, [division]);

  useEffect(() => {
    if (division || allSearchData.loaded) return;

    let cancelled = false;
    async function loadAllSearchData() {
      try {
        setAllSearchLoading(true);
        const noteResponses = await Promise.all(DIVISIONS.map(([code]) => fetch(`/api/notes?division=${encodeURIComponent(code)}`).then(response => response.json().then(data => ({ ok: response.ok, data })))));
        const wrongResponse = await fetch("/api/wrong-questions").then(response => response.json().then(data => ({ ok: response.ok, data })));
        if (cancelled) return;

        const allNotes = noteResponses.flatMap(({ ok, data }) => ok && Array.isArray(data.notes) ? data.notes.map(parseNote) : []);
        const allWrongQuestions = wrongResponse.ok && Array.isArray(wrongResponse.data.flashcards) ? wrongResponse.data.flashcards.map(normalizeWrongQuestion) : [];
        setAllSearchData({ loaded: true, notes: allNotes, wrongQuestions: allWrongQuestions });
      } catch {
        if (!cancelled) setStatus("Dashboard search data unavailable.");
      } finally {
        if (!cancelled) setAllSearchLoading(false);
      }
    }

    loadAllSearchData();
    return () => { cancelled = true; };
  }, [allSearchData.loaded, division]);

  useEffect(() => {
    if (!quickAction.division || loadedRoomDivisions.includes(quickAction.division)) return;
    let cancelled = false;
    fetch(`/api/rooms?division=${encodeURIComponent(quickAction.division)}`)
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!cancelled && ok) {
          setTree(prev => ({ ...prev, [quickAction.division]: Array.isArray(data.rooms) ? data.rooms : [] }));
          setLoadedRoomDivisions(prev => prev.includes(quickAction.division) ? prev : [...prev, quickAction.division]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [loadedRoomDivisions, quickAction.division]);

  function closeEditor() {
    setEditorOpen(false);
    setEditingId("");
    setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
  }

  function closeWrongEditor() {
    setWrongEditorOpen(false);
    setWrongEditingId("");
    setWrongDraft({ title: "", text: "", attachments: [] });
  }

  function closeSubroomPanels() {
    setSubroomForm(null);
    setSubroomName("");
    setDeleteSubroomTarget(null);
    setOpenSubroomMenuId("");
    setSubroomBusy(false);
    setSubroomStatus("");
  }

  function chooseDivision(code) {
    setDivision(code);
    setRoomId("");
    setSubroomId("");
    setViewerId("");
    setWrongViewerId("");
    setRoomSearch("");
    closeEditor();
    closeWrongEditor();
    closeSubroomPanels();
    setStatus("");
    setWrongStatus("");
  }

  function chooseRoom(idValue) {
    setRoomId(idValue);
    setSubroomId("");
    setViewerId("");
    setWrongViewerId("");
    setRoomSearch("");
    closeEditor();
    closeWrongEditor();
    closeSubroomPanels();
  }

  function chooseSubroom(parentId, idValue) {
    setRoomId(parentId);
    setSubroomId(idValue);
    setViewerId("");
    setWrongViewerId("");
    setRoomSearch("");
    closeEditor();
    closeWrongEditor();
    closeSubroomPanels();
  }

  function openSearchResult(result) {
    if (result.type === "note") {
      const note = parseNote(result.item);
      openDashboardNote(note);
      return;
    }

    const card = normalizeWrongQuestion(result.item);
    openDashboardWrongQuestion(card);
  }

  function openDashboardNote(note) {
    const parsed = parseNote(note);
    setNotes(prev => [parsed, ...prev.filter(item => item.id !== parsed.id)]);
    setViewerId(parsed.id);
    setWrongViewerId("");
  }

  function openDashboardWrongQuestion(card) {
    const parsed = normalizeWrongQuestion(card);
    setWrongQuestions(prev => [parsed, ...prev.filter(item => item.id !== parsed.id)]);
    setWrongViewerId(parsed.id);
    setViewerId("");
  }

  function startQuickAction() {
    if (!quickAction.division || !quickAction.roomId || !quickAction.subroomId) return;
    setDivision(quickAction.division);
    setRoomId(quickAction.roomId);
    setSubroomId(quickAction.subroomId);
    setViewerId("");
    setWrongViewerId("");
    setStatus("");
    setWrongStatus("");
    if (quickAction.type === "wrong") {
      closeEditor();
      setWrongEditingId("");
      setWrongDraft({ title: "", text: "", attachments: [] });
      setWrongEditorOpen(true);
      return;
    }

    closeWrongEditor();
    setEditingId("");
    setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
    setEditorOpen(true);
  }

  async function attachFiles(fileList) {
    const next = [];
    for (const file of Array.from(fileList || [])) {
      const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
      if (!ACCEPTED_TYPES.has(type)) continue;
      next.push({ id: makeId("att"), name: file.name, type, size: file.size, kind: type === "application/pdf" ? "pdf" : "image", dataUrl: await fileToDataUrl(file) });
    }
    setDraft(prev => ({ ...prev, attachments: [...prev.attachments, ...next] }));
  }

  async function attachWrongFiles(fileList) {
    const next = [];
    for (const file of Array.from(fileList || [])) {
      const detected = wrongAttachmentKind(file);
      if (!detected || !WRONG_QUESTION_TYPES.has(detected.type)) continue;
      next.push({ id: makeId("wq-att"), name: file.name, type: detected.type, size: file.size, kind: detected.kind, dataUrl: await fileToDataUrl(file) });
    }
    setWrongDraft(prev => ({ ...prev, attachments: [...prev.attachments, ...next] }));
  }

  async function analyzeSummary(rawNotes) {
    const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: rawNotes }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return normalizeAnalysis(data.analysis);
  }

  async function analyzeDraft() {
    if (!clean(draft.rawNotes)) return setStatus("Raw Notes text is empty.");
    try {
      setBusy(true);
      setStatus("AI generating Summary and Bullet Points from Raw Notes text only...");
      const analysis = await analyzeSummary(draft.rawNotes);
      setDraft(prev => ({ ...prev, analysis }));
      setStatus("AI summary complete. Save Note to create or update the card.");
    } catch (error) {
      setStatus(`AI Error: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(noteDraft = draft, noteId = editingId, targetRoom = roomId, targetSubroom = subroomId) {
    if (!targetRoom || !targetSubroom) return setStatus("Select a sub-room before saving.");
    if (!clean(noteDraft.title) && !clean(noteDraft.rawNotes) && !noteDraft.attachments.length) return setStatus("Add a title, Raw Notes text, or attachment before saving.");
    const targetRoomObj = rooms.find(item => item.id === targetRoom);
    const targetSubroomObj = (targetRoomObj?.children || []).find(item => item.id === targetSubroom);
    const existing = noteId ? notes.find(note => note.id === noteId) : null;
    const payload = { id: noteId || makeId("note"), division, roomId: targetRoom, roomName: targetRoomObj?.name || "", subroomId: targetSubroom, subroomName: targetSubroomObj?.name || "", text: packNote(noteDraft), savedAt: existing?.savedAt || new Date().toISOString() };
    const response = await fetch("/api/notes", { method: noteId ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const saved = parseNote({ ...payload, ...(data.note || {}) });
    setNotes(prev => [saved, ...prev.filter(note => note.id !== saved.id)]);
    setAllSearchData(prev => prev.loaded ? { ...prev, notes: [saved, ...prev.notes.filter(note => note.id !== saved.id)] } : prev);
    return saved;
  }

  async function saveDraft() {
    try {
      const saved = await saveNote();
      if (!saved) return;
      closeEditor();
      setStatus(`Saved "${saved.title}" and closed the editor.`);
    } catch (error) {
      setStatus(`Cloud save failed: ${error.message}`);
    }
  }

  function editNote(note) {
    const parsed = parseNote(note);
    setRoomId(parsed.roomId || roomId);
    setSubroomId(parsed.subroomId || "");
    setViewerId("");
    setEditingId(parsed.id);
    setDraft({ title: parsed.title, rawNotes: parsed.rawNotes, attachments: parsed.attachments || [], analysis: normalizeAnalysis(parsed.analysis) });
    setEditorOpen(true);
    setStatus("");
  }

  async function reanalyze(note) {
    if (!clean(note.rawNotes)) return;
    try {
      setBusy(true);
      setStatus("Re-analyzing Summary and Bullet Points from Raw Notes text only...");
      const analysis = await analyzeSummary(note.rawNotes);
      const saved = await saveNote({ title: note.title, rawNotes: note.rawNotes, attachments: note.attachments || [], analysis }, note.id, note.roomId, note.subroomId);
      setViewerId(saved.id);
      setStatus("Saved note Summary and Bullet Points updated.");
    } catch (error) {
      setStatus(`AI Error: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(noteId) {
    if (!noteId || !window.confirm("Delete this saved note?")) return;
    const response = await fetch(`/api/notes?id=${encodeURIComponent(noteId)}`, { method: "DELETE" });
    if (!response.ok) return setStatus("Cloud delete failed.");
    setNotes(prev => prev.filter(note => note.id !== noteId));
    setAllSearchData(prev => prev.loaded ? { ...prev, notes: prev.notes.filter(note => note.id !== noteId) } : prev);
    if (viewerId === noteId) setViewerId("");
    if (editingId === noteId) closeEditor();
    setStatus("Saved note deleted.");
  }

  async function saveWrongQuestion() {
    try {
      if (!roomId || !subroomId) return setWrongStatus("Open a sub-room before saving a wrong question.");
      if (!clean(wrongDraft.title) && !clean(wrongDraft.text) && !wrongDraft.attachments.length) return setWrongStatus("Add a title, wrong question text, or attachment before saving.");
      const existing = wrongEditingId ? wrongQuestions.find(card => card.id === wrongEditingId) : null;
      const targetRoomId = existing?.roomId || roomId;
      const targetSubroomId = existing?.subroomId || subroomId;
      const targetRoom = rooms.find(item => item.id === targetRoomId);
      const targetSubroom = (targetRoom?.children || []).find(item => item.id === targetSubroomId);
      const payload = {
        id: wrongEditingId || makeId("wrong"),
        division: existing?.division || existing?.divisionId || division,
        divisionId: existing?.divisionId || existing?.division || division,
        roomId: targetRoomId,
        roomName: existing?.roomName || targetRoom?.name || "",
        subroomId: targetSubroomId,
        subRoomId: targetSubroomId,
        subroomName: existing?.subroomName || targetSubroom?.name || "",
        subRoomName: existing?.subRoomName || existing?.subroomName || targetSubroom?.name || "",
        title: clean(wrongDraft.title) || "Untitled Wrong Question",
        text: String(wrongDraft.text || "").trim(),
        attachments: wrongDraft.attachments,
        savedAt: new Date().toISOString()
      };
      const response = await fetch("/api/wrong-questions", { method: existing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const saved = normalizeWrongQuestion(data.flashcard || payload);
      setWrongQuestions(prev => [saved, ...prev.filter(card => card.id !== saved.id)]);
      setAllSearchData(prev => prev.loaded ? { ...prev, wrongQuestions: [saved, ...prev.wrongQuestions.filter(card => card.id !== saved.id)] } : prev);
      closeWrongEditor();
      setWrongStatus(`Saved "${saved.title}" and closed the editor.`);
    } catch (error) {
      setWrongStatus(`Cloud save failed: ${error.message}`);
    }
  }

  function editWrongQuestion(card) {
    const parsed = normalizeWrongQuestion(card);
    if (!parsed.roomId || !parsed.subroomId) {
      setWrongStatus("This legacy wrong question has no sub-room assignment yet, so it is preserved but cannot be edited from a sub-room.");
      return;
    }
    setRoomId(parsed.roomId);
    setSubroomId(parsed.subroomId);
    setWrongViewerId("");
    setWrongEditingId(parsed.id);
    setWrongDraft({ title: parsed.title, text: parsed.text, attachments: parsed.attachments || [] });
    setWrongEditorOpen(true);
    setWrongStatus("");
  }

  async function deleteWrongQuestion(cardId) {
    if (!cardId || !window.confirm("Delete this wrong question card?")) return;
    const response = await fetch(`/api/wrong-questions?id=${encodeURIComponent(cardId)}`, { method: "DELETE" });
    if (!response.ok) return setWrongStatus("Cloud delete failed.");
    setWrongQuestions(prev => prev.filter(card => card.id !== cardId));
    setAllSearchData(prev => prev.loaded ? { ...prev, wrongQuestions: prev.wrongQuestions.filter(card => card.id !== cardId) } : prev);
    if (wrongViewerId === cardId) setWrongViewerId("");
    if (wrongEditingId === cardId) closeWrongEditor();
    setWrongStatus("Wrong question deleted.");
  }

  function subroomContentCounts(targetRoomId, targetSubroomId) {
    const noteItems = notes.filter(note => note.division === division && note.roomId === targetRoomId && (note.subroomId || "") === targetSubroomId);
    const wrongItems = wrongQuestions.filter(card => (card.division || card.divisionId) === division && card.roomId === targetRoomId && (card.subroomId || "") === targetSubroomId);
    return {
      notes: noteItems.length,
      wrongQuestions: wrongItems.length,
      attachments: noteItems.reduce((sum, note) => sum + (note.attachments?.length || 0), 0) + wrongItems.reduce((sum, card) => sum + (card.attachments?.length || 0), 0)
    };
  }

  function updateSubroomInTree(targetRoomId, updater) {
    setTree(prev => ({
      ...prev,
      [division]: (prev[division] || []).map(item => item.id === targetRoomId ? { ...item, children: updater(item.children || []) } : item)
    }));
  }

  function openNewSubroom() {
    setSubroomForm({ mode: "new" });
    setSubroomName("");
    setSubroomStatus("");
    setOpenSubroomMenuId("");
  }

  function openRenameSubroom(child) {
    setSubroomForm({ mode: "rename", child });
    setSubroomName(child.name || "");
    setSubroomStatus("");
    setOpenSubroomMenuId("");
  }

  async function saveSubroom() {
    const name = clean(subroomName);
    if (!name || !roomId || !division || !subroomForm) return;
    try {
      setSubroomBusy(true);
      setSubroomStatus("");
      if (subroomForm.mode === "rename") {
        const child = subroomForm.child;
        const response = await fetch("/api/rooms", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: child.id, division, parentId: roomId, name })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        updateSubroomInTree(roomId, children => children.map(item => item.id === child.id ? { ...item, name } : item));
        setNotes(prev => prev.map(note => note.division === division && note.roomId === roomId && (note.subroomId || "") === child.id ? { ...note, subroomName: name } : note));
        setWrongQuestions(prev => prev.map(card => (card.division || card.divisionId) === division && card.roomId === roomId && (card.subroomId || "") === child.id ? { ...card, subroomName: name, subRoomName: name, topicPath: [card.division || card.divisionId || division, card.roomName, name].filter(Boolean).join(" / ") } : card));
        setAllSearchData(prev => prev.loaded ? {
          ...prev,
          notes: prev.notes.map(note => note.division === division && note.roomId === roomId && (note.subroomId || "") === child.id ? { ...note, subroomName: name } : note),
          wrongQuestions: prev.wrongQuestions.map(card => (card.division || card.divisionId) === division && card.roomId === roomId && (card.subroomId || "") === child.id ? { ...card, subroomName: name, subRoomName: name, topicPath: [card.division || card.divisionId || division, card.roomName, name].filter(Boolean).join(" / ") } : card)
        } : prev);
        setStatus(`Renamed sub-room to "${name}".`);
      } else {
        const existingChildren = room?.children || [];
        const payload = {
          id: makeId("subroom"),
          division,
          parentId: roomId,
          name,
          roomType: "subroom",
          sortOrder: existingChildren.length
        };
        const response = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        const saved = data.room || { id: payload.id, name };
        updateSubroomInTree(roomId, children => [...children, saved]);
        setStatus(`Created sub-room "${saved.name}".`);
      }
      closeSubroomPanels();
    } catch (error) {
      setSubroomStatus(`Cloud save failed: ${error.message}`);
    } finally {
      setSubroomBusy(false);
    }
  }

  function openDeleteSubroom(child) {
    setDeleteSubroomTarget(child);
    setSubroomStatus("");
    setOpenSubroomMenuId("");
  }

  async function deleteSubroom() {
    if (!deleteSubroomTarget || !roomId || !division) return;
    const targetId = deleteSubroomTarget.id;
    try {
      setSubroomBusy(true);
      setSubroomStatus("");
      const response = await fetch(`/api/rooms?id=${encodeURIComponent(targetId)}&division=${encodeURIComponent(division)}&parentId=${encodeURIComponent(roomId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      updateSubroomInTree(roomId, children => children.filter(child => child.id !== targetId));
      setNotes(prev => prev.filter(note => !(note.division === division && note.roomId === roomId && (note.subroomId || "") === targetId)));
      setWrongQuestions(prev => prev.filter(card => !((card.division || card.divisionId) === division && card.roomId === roomId && (card.subroomId || "") === targetId)));
      setAllSearchData(prev => prev.loaded ? {
        ...prev,
        notes: prev.notes.filter(note => !(note.division === division && note.roomId === roomId && (note.subroomId || "") === targetId)),
        wrongQuestions: prev.wrongQuestions.filter(card => !((card.division || card.divisionId) === division && card.roomId === roomId && (card.subroomId || "") === targetId))
      } : prev);
      if (subroomId === targetId) setSubroomId("");
      if (viewerNote?.roomId === roomId && (viewerNote.subroomId || "") === targetId) setViewerId("");
      if (wrongViewerCard?.roomId === roomId && (wrongViewerCard.subroomId || "") === targetId) setWrongViewerId("");
      if (editingId && notes.some(note => note.id === editingId && note.roomId === roomId && (note.subroomId || "") === targetId)) closeEditor();
      if (wrongEditingId && wrongQuestions.some(card => card.id === wrongEditingId && card.roomId === roomId && (card.subroomId || "") === targetId)) closeWrongEditor();
      closeSubroomPanels();
      setStatus(`Deleted sub-room "${deleteSubroomTarget.name}".`);
    } catch (error) {
      setSubroomStatus(`Cloud delete failed: ${error.message}`);
    } finally {
      setSubroomBusy(false);
    }
  }

  const topMenu = (
    <header className="top-menu">
      <nav className="top-nav">
        <button className="top-brand" onClick={() => chooseDivision("")}>ARE Study Vault</button>
        <button className={!division ? "active" : ""} onClick={() => chooseDivision("")}>Dashboard</button>
        {DIVISIONS.map(([code, label]) => <button key={code} className={division === code ? "active" : ""} onClick={() => chooseDivision(code)}>{label}</button>)}
      </nav>
      <div className="top-actions">
        <button onClick={() => chooseDivision("")}>Search</button>
        <button onClick={onLogout}>Logout</button>
      </div>
    </header>
  );

  function roomDirectory() {
    const children = room?.children || [];
    const query = clean(debouncedRoomSearch).toLowerCase();
    const deleteCounts = deleteSubroomTarget ? subroomContentCounts(roomId, deleteSubroomTarget.id) : null;
    const groups = children.map(child => {
      const cards = divisionNotes.filter(note => note.roomId === roomId && (note.subroomId || "") === child.id);
      const wrongCards = wrongQuestionsForSubroom(roomId, child.id);
      return {
        child,
        cards: query ? cards.filter(note => noteSearchText(note).includes(query)) : cards,
        wrongCards: query ? wrongCards.filter(card => wrongSearchText(card).includes(query)) : wrongCards,
        totalCards: cards.length,
        totalWrongCards: wrongCards.length
      };
    });
    const hasRoomSearchResults = groups.some(group => group.cards.length || group.wrongCards.length);

    return (
      <>
        <section className="workspace">
          <div className="workspace-head">
            <div><div className="eyebrow">Room Directory</div><h1>{room?.name}</h1><p>Sub-rooms with Study Notes and Wrong Question previews.</p></div>
            <div className="buttons"><button className="primary" onClick={openNewSubroom}>+ New Sub-room</button></div>
          </div>
          <SearchBar value={roomSearch} onChange={setRoomSearch} placeholder="Search in this room..." />
          {children.length ? (
            <>
              {query && !hasRoomSearchResults ? <div className="empty-soft">No cards in this room matched this search.</div> : null}
              {groups.map(({ child, cards, wrongCards, totalCards, totalWrongCards }) => {
                if (query && !cards.length && !wrongCards.length) return null;
                return (
                  <section className="subroom-section" key={child.id}>
                    <div className="subroom-head">
                      <button className="subroom-title-button" onClick={() => chooseSubroom(roomId, child.id)}>{child.name}</button>
                      <div className="subroom-head-actions">
                        <span>{query ? `${cards.length} matching notes - ${wrongCards.length} matching wrong questions` : `${totalCards} notes - ${totalWrongCards} wrong questions`}</span>
                        <div className="card-menu-wrap">
                          <button className="icon-menu-btn" aria-label={`${child.name} actions`} onClick={() => setOpenSubroomMenuId(open => open === child.id ? "" : child.id)}>•••</button>
                          {openSubroomMenuId === child.id ? (
                            <div className="card-menu">
                              <button onClick={() => openRenameSubroom(child)}>Rename</button>
                              <button className="danger-menu-item" onClick={() => openDeleteSubroom(child)}>Delete</button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <CardCarousel
                      title="Study Notes"
                      previousLabel={`Previous study notes in ${child.name}`}
                      nextLabel={`Next study notes in ${child.name}`}
                      empty={<div className="empty-soft">{query ? "No matching study note cards in this sub-room." : "No saved note cards in this sub-room yet."}</div>}
                    >
                      {cards.map(note => <NoteCard key={note.id} note={note} onOpen={item => setViewerId(item.id)} onEdit={editNote} onDelete={deleteNote} />)}
                    </CardCarousel>
                    <CardCarousel
                      title="Wrong Questions"
                      previousLabel={`Previous wrong questions in ${child.name}`}
                      nextLabel={`Next wrong questions in ${child.name}`}
                      empty={<div className="empty-soft">{query ? "No matching wrong question cards in this sub-room." : "No wrong question cards in this sub-room yet."}</div>}
                    >
                      {wrongCards.map(card => <WrongQuestionCard key={card.id} card={card} canManage={false} onOpen={item => setWrongViewerId(item.id)} onEdit={editWrongQuestion} onDelete={deleteWrongQuestion} />)}
                    </CardCarousel>
                  </section>
                );
              })}
            </>
          ) : <div className="empty-soft">No sub-rooms yet.</div>}
        </section>
        {subroomForm ? <SubroomNameModal mode={subroomForm.mode} name={subroomName} status={subroomStatus} busy={subroomBusy} onNameChange={setSubroomName} onSave={saveSubroom} onCancel={closeSubroomPanels} /> : null}
        {deleteSubroomTarget ? <DeleteSubroomModal subroom={deleteSubroomTarget} counts={deleteCounts} status={subroomStatus} busy={subroomBusy} onConfirm={deleteSubroom} onCancel={closeSubroomPanels} /> : null}
      </>
    );
  }

  function subroomView() {
    return <section className="workspace"><div className="workspace-head"><div><div className="eyebrow">Sub-room</div><h1>{subroom?.name}</h1><p>{info.label} / {room?.name}</p></div><div className="buttons"><button className="primary" onClick={() => { closeWrongEditor(); setEditingId(""); setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } }); setEditorOpen(true); }}>+ New Note</button><button className="primary" onClick={() => { closeEditor(); setWrongEditingId(""); setWrongDraft({ title: "", text: "", attachments: [] }); setWrongEditorOpen(true); setWrongStatus(""); }}>+ New Wrong Question</button></div></div><section className="content-section"><div className="content-section-head"><h2>Study Notes</h2><span>{subroomNotes.length} cards</span></div>{editorOpen ? <NoteEditor draft={draft} editing={editingId} busy={busy} status={status} setDraft={setDraft} onFiles={attachFiles} onRemoveFile={fileId => setDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))} onAnalyze={analyzeDraft} onSave={saveDraft} onCancel={closeEditor} /> : null}<div className="cards">{subroomNotes.map(note => <NoteCard key={note.id} note={note} onOpen={item => setViewerId(item.id)} onEdit={editNote} onDelete={deleteNote} />)}</div>{!subroomNotes.length && !editorOpen ? <div className="empty-soft">No saved note cards here yet. Use + New Note when ready.</div> : null}</section><section className="content-section"><div className="content-section-head"><h2>Wrong Questions</h2><span>{subroomWrongQuestions.length} cards</span></div>{wrongEditorOpen ? <WrongQuestionEditor draft={wrongDraft} editing={wrongEditingId} status={wrongStatus} setDraft={setWrongDraft} onFiles={attachWrongFiles} onRemoveFile={fileId => setWrongDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))} onSave={saveWrongQuestion} onCancel={closeWrongEditor} /> : null}{!wrongEditorOpen && wrongStatus ? <p className="status-banner">{wrongStatus}</p> : null}<div className="wrong-cards">{subroomWrongQuestions.map(card => <WrongQuestionCard key={card.id} card={card} onOpen={item => setWrongViewerId(item.id)} onEdit={editWrongQuestion} onDelete={deleteWrongQuestion} />)}</div>{!subroomWrongQuestions.length && !wrongEditorOpen ? <div className="empty-soft">No wrong question cards here yet. Use + New Wrong Question when ready.</div> : null}</section></section>;
  }

  function divisionView() {
    return <section className="workspace"><div className="workspace-head"><div><div className="eyebrow">Division</div><h1>{info.label} - {info.name}</h1></div><p>{divisionNotes.length} saved notes</p></div><div className="directory-grid">{rooms.map(item => <button key={item.id} onClick={() => chooseRoom(item.id)}><b>{item.name}</b><span>{item.children?.length || 0} sub-rooms - {divisionNotes.filter(note => note.roomId === item.id).length} notes</span></button>)}</div></section>;
  }

  const main = !division ? (
    <Dashboard
      onSelect={chooseDivision}
      searchQuery={dashboardSearch}
      onSearchChange={setDashboardSearch}
      searchResults={dashboardSearchResults}
      searchLoading={allSearchLoading || (Boolean(clean(debouncedDashboardSearch)) && !allSearchData.loaded)}
      onOpenSearchResult={openSearchResult}
      notes={dashboardNotes}
      wrongQuestions={dashboardWrongQuestions}
      quickAction={quickAction}
      setQuickAction={setQuickAction}
      quickRooms={tree}
      onQuickStart={startQuickAction}
      onOpenNote={openDashboardNote}
      onOpenWrongQuestion={openDashboardWrongQuestion}
    />
  ) : roomId && !subroomId ? roomDirectory() : roomId && subroomId ? subroomView() : divisionView();
  return <div className="app-shell">{topMenu}<main>{status && !editorOpen ? <p className="status-banner">{status}</p> : null}{unassignedWrongQuestions.length && division ? <p className="status-banner">{unassignedWrongQuestions.length} legacy wrong question card(s) are preserved without sub-room assignment and are not shown in Sub-room lists.</p> : null}{main}</main><Viewer note={viewerNote} busy={busy} onClose={() => setViewerId("")} onEdit={editNote} onDelete={deleteNote} onAnalyze={reanalyze} /><WrongQuestionViewer card={wrongViewerCard} canManage={Boolean(subroomId)} onClose={() => setWrongViewerId("")} onEdit={editWrongQuestion} onDelete={deleteWrongQuestion} /></div>;
}
