import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import MoleculeHero from "./components/MoleculeHero.jsx";
import CoverConstellation from "./components/CoverConstellation.jsx";
import DivisionTree from "./components/DivisionTree.jsx";
import { buildCoverGraph, shiftColor } from "./lib/coverGraph.js";
import LogicMap from "./components/LogicMap.jsx";
import WrongReview from "./components/WrongReview.jsx";
import { MISS_REASONS, isDue, missReasonLabel, nextDueLabel, normalizeReviewState, reviewStatus, sortForReview } from "./lib/wrongReview.js";
import "./App.css";

const DIVISIONS = [
  ["PA", "PA", "Programming & Analysis"],
  ["PPD", "PPD", "Project Planning & Design"],
  ["PDD", "PDD", "Project Development & Documentation"],
  ["PCM", "PcM", "Practice Management"],
  ["PJM", "PjM", "Project Management"],
  ["CE", "CE", "Construction & Evaluation"]
];

// One color per division, distinct enough to tell the cover map's clusters apart.
const DIVISION_COLORS = {
  PA: "#5fd8c8",
  PPD: "#e8c26a",
  PDD: "#f08a8a",
  PCM: "#b39dfa",
  PJM: "#6fb2ff",
  CE: "#f29ac4"
};
const NO_COVER_FOCUS = { division: "", roomId: "", subroomId: "" };
const COVER_RING_ORDER = ["PA", "PPD", "PDD", "CE", "PJM", "PCM"];
// Rooms on a division page: siblings of the division's colour.
function roomColor(divisionColor, index) {
  return shiftColor(divisionColor, ((index * 37) % 60) - 30, index % 2 ? 0.06 : -0.02);
}
const MAX_HERO_ROOMS = 12;
const EMPTY_WRONG_DRAFT = { title: "", text: "", answer: "", explanation: "", missReason: "", attachments: [] };

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
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ACCEPTED_TYPES = new Set(["application/pdf", DOCX_TYPE, "image/jpeg", "image/jpg", "image/png"]);
const WRONG_QUESTION_TYPES = new Set([
  "application/pdf",
  DOCX_TYPE,
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
  if (type === DOCX_TYPE || name.endsWith(".docx")) return { type: DOCX_TYPE, kind: "docx" };
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
    answer: typeof card.answer === "string" ? card.answer : "",
    explanation: typeof card.explanation === "string" ? card.explanation : "",
    missReason: card.missReason || "",
    reviewState: normalizeReviewState(card.reviewState),
    attachments,
    savedAt: card.savedAt || new Date().toISOString()
  };
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function dueCards(cards = []) {
  const now = new Date();
  return cards.filter(card => isDue(card.reviewState, now));
}

const STATUS_LABELS = { new: "New", due: "Due", learning: "Learning", mastered: "Mastered" };

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
    card.answer,
    card.explanation,
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

// One "Divisions" dropdown in the top menu; each option shows the code and
// the division's full name.
function DivisionMenu({ current, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const itemRefs = useRef([]);
  const active = current ? divisionInfo(current) : null;

  useEffect(() => {
    if (!open) return undefined;
    const currentIndex = Math.max(0, DIVISIONS.findIndex(([code]) => code === current));
    itemRefs.current[currentIndex]?.focus();
    function handlePointer(event) {
      if (!wrapRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKey(event) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, current]);

  function moveFocus(event) {
    const items = itemRefs.current.filter(Boolean);
    const index = items.indexOf(document.activeElement);
    let next = -1;
    if (event.key === "ArrowDown") next = (index + 1) % items.length;
    else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Tab") setOpen(false);
    if (next >= 0) {
      event.preventDefault();
      items[next].focus();
    }
  }

  function choose(code) {
    setOpen(false);
    onSelect(code);
  }

  return (
    <div className="division-menu" ref={wrapRef}>
      <button
        ref={buttonRef}
        className={`division-menu-trigger${active ? " active" : ""}`}
        style={active ? { "--atom": DIVISION_COLORS[active.code] } : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {active ? active.label : "Divisions"}
        <span className="division-menu-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="division-menu-list" role="menu" aria-label="Divisions" onKeyDown={moveFocus}>
          {DIVISIONS.map(([code, label, name], index) => (
            <button
              key={code}
              ref={element => { itemRefs.current[index] = element; }}
              role="menuitem"
              className={code === current ? "is-current" : ""}
              aria-current={code === current ? "page" : undefined}
              style={{ "--atom": DIVISION_COLORS[code] }}
              onClick={() => choose(code)}
            >
              <span className="division-menu-dot" aria-hidden="true" />
              <span className="division-menu-code">{label}</span>
              <span className="division-menu-name">{name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionMenu({ label, children }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const idRef = useRef(makeId("menu"));

  useEffect(() => {
    if (!open) return undefined;
    function handlePointer(event) {
      if (!menuRef.current?.contains(event.target)) setOpen(false);
    }
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function handleOtherMenu(event) {
      if (event.detail !== idRef.current) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("are-study-menu-open", handleOtherMenu);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("are-study-menu-open", handleOtherMenu);
    };
  }, [open]);

  function toggleMenu(event) {
    event.stopPropagation();
    setOpen(current => {
      const next = !current;
      if (next) window.dispatchEvent(new CustomEvent("are-study-menu-open", { detail: idRef.current }));
      return next;
    });
  }

  return (
    <div className="card-menu-wrap" ref={menuRef} onClick={event => event.stopPropagation()}>
      <button className="icon-menu-btn" aria-label={label} onClick={toggleMenu}>{"\u2022\u2022\u2022"}</button>
      {open ? (
        <div className="card-menu">
          {Children.map(children, child => {
            if (!isValidElement(child)) return child;
            return cloneElement(child, {
              onClick: event => {
                setOpen(false);
                child.props.onClick?.(event);
              }
            });
          })}
        </div>
      ) : null}
    </div>
  );
}

function CardCarousel({ title, previousLabel, nextLabel, action, empty, children }) {
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
        <div className="carousel-actions">
          {action}
          {hasItems ? (
            <div className="carousel-controls">
              <button className="carousel-control" aria-label={previousLabel} disabled={!scrollState.canPrevious} onClick={() => scrollCards(-1)}>‹</button>
              <button className="carousel-control" aria-label={nextLabel} disabled={!scrollState.canNext} onClick={() => scrollCards(1)}>›</button>
            </div>
          ) : null}
        </div>
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

// Cover page: a constellation map of every division, room, sub-room and note.
// Clicking a division (or anything in it) opens its room tree beside the map.
// Wrong questions live in each division's own session, so they aren't shown here.
function Dashboard({ searchQuery, onSearchChange, searchResults, searchLoading, onOpenSearchResult, notes, quickAction, setQuickAction, quickRooms, loadedRoomDivisions, roomErrors, onRetryRooms, coverFocus, setCoverFocus, onCoverNode, onOpenRoom, onOpenSubroom, onQuickStart, onOpenNote, onSelectDivision }) {
  const recentNotes = [...notes].sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)).slice(0, 6);
  const continueNote = recentNotes[0] || null;
  const attachmentCount = notes.reduce((sum, note) => sum + (note.attachments?.length || 0), 0);
  const selectedRooms = Array.isArray(quickRooms[quickAction.division]) ? quickRooms[quickAction.division] : [];
  const selectedRoom = selectedRooms.find(item => item.id === quickAction.roomId) || null;
  const selectedSubrooms = selectedRoom?.children || [];

  const mapDivisions = useMemo(() => COVER_RING_ORDER.map(code => {
    const info = divisionInfo(code);
    return { code, label: info.label, name: info.name, color: DIVISION_COLORS[code] };
  }), []);
  // Only rooms confirmed by the server; until then the map uses the rooms notes mention.
  const loadedTrees = useMemo(() => Object.fromEntries(loadedRoomDivisions.map(code => [code, quickRooms[code] || []])), [loadedRoomDivisions, quickRooms]);
  const graph = useMemo(() => buildCoverGraph({ divisions: mapDivisions, trees: loadedTrees, notes }), [mapDivisions, loadedTrees, notes]);

  const focusInfo = mapDivisions.find(item => item.code === coverFocus.division);
  const [treeHighlight, setTreeHighlight] = useState("");
  // The selected division star's live screen position, shared by the map and the tree.
  const treeAnchorRef = useRef(null);
  useEffect(() => setTreeHighlight(""), [coverFocus.division]);
  const panel = focusInfo ? (
    <DivisionTree
      key={focusInfo.code}
      code={focusInfo.code}
      label={focusInfo.label}
      name={focusInfo.name}
      color={focusInfo.color}
      rooms={loadedTrees[focusInfo.code] || []}
      status={loadedRoomDivisions.includes(focusInfo.code) ? "ready" : roomErrors.includes(focusInfo.code) ? "error" : "loading"}
      notes={notes.filter(note => note.division === focusInfo.code)}
      focusRoomId={coverFocus.roomId}
      focusSubroomId={coverFocus.subroomId}
      autoFocus={Boolean(coverFocus.keyboard)}
      onClose={() => setCoverFocus(NO_COVER_FOCUS)}
      onEnter={() => onSelectDivision(focusInfo.code)}
      onOpenRoom={roomId => onOpenRoom(focusInfo.code, roomId)}
      onOpenSubroom={(roomId, subroomId) => onOpenSubroom(focusInfo.code, roomId, subroomId)}
      onRetry={() => onRetryRooms(focusInfo.code)}
      onHighlight={setTreeHighlight}
      anchorRef={treeAnchorRef}
    />
  ) : null;

  return (
    <section className="dashboard-page">
      <CoverConstellation
        graph={graph}
        divisions={mapDivisions}
        selectedDivision={coverFocus.division}
        highlightId={treeHighlight}
        anchorRef={treeAnchorRef}
        panel={panel}
        onSelectNode={onCoverNode}
        onSelectDivision={(code, how) => setCoverFocus({ ...NO_COVER_FOCUS, division: code, keyboard: Boolean(how?.keyboard) })}
        onBackground={() => setCoverFocus(NO_COVER_FOCUS)}
      >
        <h1 className="sr-only">ARE Study Vault</h1>
      </CoverConstellation>

      <div className="dashboard-body">
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
            <div className="eyebrow">Quick Note</div>
            <label>Division</label>
            <select value={quickAction.division} onChange={event => setQuickAction({ division: event.target.value, roomId: "", subroomId: "" })}>
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
              Open Note Editor
            </button>
          </section>
        </div>
        <section className="dashboard-panel">
          <div className="dashboard-section-head"><h2>Recent Notes</h2></div>
          {recentNotes.length ? <div className="dashboard-mini-grid">{recentNotes.map(note => <button className="mini-card" key={note.id} onClick={() => onOpenNote(note)}><b>{note.title}</b><span>{itemPath(note)}</span><p>{matchPreview([note.analysis?.summary, note.rawNotes], "")}</p><small>Updated {formatDate(note.savedAt)}</small><em>View Note</em></button>)}</div> : <div className="empty-soft">No recent notes yet.</div>}
        </section>
        <div className="dashboard-stats">{plural(notes.length, "note")} · {plural(attachmentCount, "attachment")}</div>
      </div>
    </section>
  );
}

function NoteCard({ note, onOpen, onEdit, onDelete }) {
  const counts = countAttachments(note.attachments);
  return (
    <article className="note-card" onClick={() => onOpen(note)} tabIndex={0} role="button" onKeyDown={event => event.key === "Enter" && onOpen(note)}>
      <div className="note-card-head">
        <div className="note-card-title-block">
          <h3>{note.title}</h3>
          <small>Updated {formatDate(note.savedAt)}</small>
        </div>
        <ActionMenu label="Note actions">
          <button onClick={() => onEdit(note)}>Edit</button>
          <button onClick={() => onDelete(note.id)}>Delete</button>
        </ActionMenu>
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
      <div className="upload-row"><div><b>Attachments</b><p>PDF, JPEG, JPG, PNG, and DOCX are saved only as attachments.</p></div><button onClick={() => inputRef.current?.click()}>Upload Files</button><input ref={inputRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.docx,application/pdf,image/jpeg,image/jpg,image/png,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={event => onFiles(event.target.files)} /></div>
      {draft.attachments.length ? <div className="chips">{draft.attachments.map(item => <span key={item.id}>{item.kind.toUpperCase()} {item.name}<button onClick={() => onRemoveFile(item.id)}>Remove</button></span>)}</div> : null}
      <div className="buttons"><button className="ai" disabled={busy || !clean(draft.rawNotes)} onClick={onAnalyze}>{busy ? "Thinking..." : "Analyze with AI"}</button><button className="primary" onClick={onSave}>Save Note</button><button onClick={onCancel}>Cancel</button></div>
      {status ? <p className="status-banner">{status}</p> : null}
      {hasAnalysis(draft.analysis) ? <div className="analysis-preview"><section><h3>Summary</h3><p>{draft.analysis.summary}</p></section><section><h3>Bullet Points</h3><ul>{draft.analysis.bulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ul></section></div> : null}
    </section>
  );
}

function Viewer({ note, busy, onClose, onEdit, onDelete, onAnalyze }) {
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!note) return;
    setPreview(null);
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
            <ActionMenu label="More note actions">
              <button onClick={() => onDelete(note.id)}>Delete</button>
            </ActionMenu>
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
                      const isDocx = item.kind === "docx" || item.type === DOCX_TYPE;
                      return (
                        <article className={`attachment-card ${isPdf ? "pdf" : isDocx ? "docx" : "image"}`} key={item.id}>
                          <div className="attachment-thumb">{isPdf ? <span>PDF</span> : isDocx ? <span>DOCX</span> : <img src={item.dataUrl} alt={item.name} />}</div>
                          <div className="attachment-info"><b>{item.name}</b><small>{isPdf ? "PDF file" : isDocx ? "DOCX file" : "Image file"}</small></div>
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

function WrongQuestionCard({ card, path = "", unfiled = false, onOpen, onEdit, onDelete, canManage = true }) {
  const counts = countWrongAttachments(card.attachments);
  const status = reviewStatus(card.reviewState);
  return (
    <article className="wrong-card" onClick={() => onOpen(card)} tabIndex={0} role="button" onKeyDown={event => event.key === "Enter" && onOpen(card)}>
      <div className="wrong-card-head">
        <div className="wrong-card-title-block">
          <h3>{card.title}</h3>
          {path ? <span className={`wrong-card-path${unfiled ? " is-unfiled" : ""}`}>{path}</span> : null}
          <small>Updated {formatDate(card.savedAt)}</small>
        </div>
        {canManage ? (
          <ActionMenu label="Wrong question actions">
            <button onClick={() => onEdit(card)}>Edit</button>
            <button onClick={() => onDelete(card.id)}>Delete</button>
          </ActionMenu>
        ) : null}
      </div>
      <p>{card.text || "No wrong question text saved."}</p>
      <div className="card-badges">
        <span className={`status-chip status-${status}`}>{STATUS_LABELS[status]}</span>
        {!card.answer ? <span className="warn-chip">No answer yet</span> : null}
        {card.missReason ? <span>{missReasonLabel(card.missReason)}</span> : null}
        {counts.image + counts.pdf + counts.docx ? <span>{plural(counts.image + counts.pdf + counts.docx, "file")}</span> : null}
      </div>
      <div className="wrong-card-actions">
        <small>{nextDueLabel(card.reviewState)}</small>
        <span className="view-note-label">View</span>
      </div>
    </article>
  );
}

// placement (optional): { rooms, roomId, subroomId, onChange } lets the user
// choose which sub-room the question is filed under.
function WrongQuestionEditor({ draft, editing, status, setDraft, onFiles, onRemoveFile, onSave, onCancel, placement = null }) {
  const inputRef = useRef(null);
  const placeRoom = placement ? placement.rooms.find(item => item.id === placement.roomId) : null;
  const placeSubrooms = placeRoom?.children || [];
  return (
    <section className="editor wrong-editor">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">{editing ? "Edit Wrong Question" : "New Wrong Question"}</div>
          <h2>Wrong Question Editor</h2>
        </div>
        <button onClick={onCancel}>Cancel</button>
      </div>
      {placement ? (
        <div className="editor-columns placement-row">
          <div>
            <label htmlFor="wrong-place-room">Room</label>
            <select id="wrong-place-room" value={placement.roomId} onChange={event => placement.onChange({ roomId: event.target.value, subroomId: "" })}>
              <option value="">Choose a room</option>
              {placement.rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="wrong-place-subroom">Sub-room</label>
            <select id="wrong-place-subroom" value={placement.subroomId} disabled={!placeSubrooms.length} onChange={event => placement.onChange({ roomId: placement.roomId, subroomId: event.target.value })}>
              <option value="">{!placeRoom ? "Choose a room first" : placeSubrooms.length ? "Choose a sub-room" : "This room has no sub-rooms yet"}</option>
              {placeSubrooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </div>
        </div>
      ) : null}
      <label>Title</label>
      <input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Give this wrong question a title" />
      <label>Question</label>
      <textarea value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} placeholder="Paste or type the question and its answer choices..." />
      <div className="editor-columns">
        <div>
          <label>Correct answer</label>
          <textarea className="short-textarea" value={draft.answer} onChange={event => setDraft({ ...draft, answer: event.target.value })} placeholder="e.g. C. Moment frames" />
        </div>
        <div>
          <label>Rule to remember</label>
          <textarea className="short-textarea" value={draft.explanation} onChange={event => setDraft({ ...draft, explanation: event.target.value })} placeholder="Why the right answer is right, in one or two lines" />
        </div>
      </div>
      <label>Why did you miss it?</label>
      <div className="reason-picker">
        {MISS_REASONS.map(([key, label]) => (
          <button type="button" key={key} className={draft.missReason === key ? "active" : ""} aria-pressed={draft.missReason === key} onClick={() => setDraft({ ...draft, missReason: draft.missReason === key ? "" : key })}>{label}</button>
        ))}
      </div>
      <div className="upload-row">
        <div>
          <b>Attachments</b>
          <p>JPG, JPEG, PNG, PDF, and DOCX are saved with this wrong question. Screenshots show up during review.</p>
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
      ) : null}
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
  const state = card.reviewState || normalizeReviewState();
  const status = reviewStatus(state);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="viewer wrong-viewer" onClick={event => event.stopPropagation()}>
        <header className="viewer-header">
          <div>
            <div className="eyebrow">Wrong Question</div>
            <h2>{card.title}</h2>
            <p>{itemPath(card) || "Unassigned"} · Updated {formatDate(card.savedAt)}</p>
          </div>
          <div className="viewer-actions">
            {canManage ? <button onClick={() => onEdit(card)}>Edit</button> : null}
            {canManage ? (
              <ActionMenu label="More wrong question actions">
                <button onClick={() => onDelete(card.id)}>Delete</button>
              </ActionMenu>
            ) : null}
            <button onClick={onClose}>Close</button>
          </div>
        </header>
        <div className="wrong-viewer-body">
          <section className="viewer-panel">
            <h3>Question</h3>
            <div className="raw-note-text">{card.text || "No wrong question text saved."}</div>
          </section>
          <div className="viewer-answer-grid">
            <section className="viewer-panel answer-panel">
              <h3>Correct answer</h3>
              {card.answer ? <p className="answer-text">{card.answer}</p> : <p className="muted-text">No answer saved yet. Edit this card to add it.</p>}
            </section>
            <section className="viewer-panel">
              <h3>Rule to remember</h3>
              <p>{card.explanation || "Nothing saved yet."}</p>
              {card.missReason ? <span className="reason-chip">Missed because: {missReasonLabel(card.missReason)}</span> : null}
            </section>
            <section className="viewer-panel review-stats-panel">
              <h3>Review progress</h3>
              <p><span className={`status-chip status-${status}`}>{STATUS_LABELS[status]}</span> {nextDueLabel(state)}</p>
              <p className="muted-text">{state.reviews ? `${plural(state.reviews, "review")} · ${Math.round((state.correct / state.reviews) * 100)}% correct` : "Not reviewed yet."}</p>
            </section>
          </div>
          <section className="viewer-panel">
            <h3>Attachments</h3>
            {card.attachments.length ? (
              <>
                <div className="attachment-cards">
                  {card.attachments.map(item => {
                    const isPdf = item.kind === "pdf" || item.type === "application/pdf";
                    const isDocx = item.kind === "docx" || item.type === DOCX_TYPE;
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

function RoomNameModal({ roomType, mode, name, status, busy, onNameChange, onSave, onCancel }) {
  const label = roomType === "room" ? "Room" : "Sub-room";
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <section className="small-modal" onClick={event => event.stopPropagation()}>
        <div>
          <div className="eyebrow">{mode === "rename" ? `Rename ${label}` : `New ${label}`}</div>
          <h2>{mode === "rename" ? `Rename ${label.toLowerCase()}` : `Create ${label.toLowerCase()}`}</h2>
        </div>
        <label>{label} name</label>
        <input value={name} onChange={event => onNameChange(event.target.value)} autoFocus placeholder={`${label} name`} />
        {status ? <p className="status-banner">{status}</p> : null}
        <div className="buttons">
          <button className="primary" disabled={busy || !clean(name)} onClick={onSave}>{busy ? "Saving..." : "Save"}</button>
          <button disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function DeleteRoomModal({ roomType, item, counts, status, busy, onConfirm, onCancel }) {
  const isRoom = roomType === "room";
  const label = isRoom ? "Room" : "Sub-room";
  const hasContent = counts.subrooms || counts.notes || counts.wrongQuestions || counts.attachments;
  return (
    <div className="modal-backdrop" onClick={() => { if (!busy) onCancel(); }}>
      <section className="small-modal danger-modal" onClick={event => event.stopPropagation()}>
        <div>
          <div className="eyebrow">Delete {label}</div>
          <h2>Delete "{item?.name}"?</h2>
        </div>
        {hasContent ? (
          <div className="delete-warning">
            <p>Deleting this {label.toLowerCase()} will also delete all {isRoom ? "sub-rooms, " : ""}notes, wrong questions, and attachments inside it.</p>
            <div className="card-badges">
              {isRoom ? <span>{counts.subrooms} Sub-rooms</span> : null}
              <span>{counts.notes} Study Notes</span>
              <span>{counts.wrongQuestions} Wrong Questions</span>
              <span>{counts.attachments} Attachments</span>
            </div>
          </div>
        ) : <p className="muted-text">This {label.toLowerCase()} has no saved content.</p>}
        {status ? <p className="status-banner">{status}</p> : null}
        <div className="buttons">
          <button className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? "Deleting..." : `Delete ${label}`}</button>
          <button disabled={busy} onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

function RoomCreatePicker({ mode, subrooms, value, onChange, onContinue, onCancel }) {
  const label = mode === "wrong" ? "Wrong Question" : "Study Note";
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <section className="small-modal" onClick={event => event.stopPropagation()}>
        <div>
          <div className="eyebrow">Choose Sub-room</div>
          <h2>New {label}</h2>
        </div>
        <label>Sub-room</label>
        <select value={value} onChange={event => onChange(event.target.value)} autoFocus>
          <option value="">Select sub-room</option>
          {subrooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div className="buttons">
          <button className="primary" disabled={!value} onClick={onContinue}>Continue</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

const WRONG_PAGE_SIZE = 6;
const ROOM_PAGE_SIZE = 8;
const WRONG_STATUS_FILTERS = [["due", "Due now"], ["learning", "Learning"], ["mastered", "Mastered"], ["missing", "Missing an answer"]];
const UNFILED = "unfiled"; // room filter value for questions not in a sub-room
const WRONG_SORTS = [["newest", "Newest first"], ["oldest", "Oldest first"], ["due", "Due first"], ["title", "Title A–Z"]];

// One page of a list. Goes back to the first page when resetKey changes and
// stays in range when the list shrinks.
function usePaged(items, pageSize, resetKey = "") {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [resetKey]);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const start = current * pageSize;
  return { page: current, pageCount, setPage, start, total: items.length, items: items.slice(start, start + pageSize) };
}

// Page numbers to show: all of them when there are few, otherwise the ends
// and the neighbours of the current page.
function pageWindow(page, pageCount) {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);
  const keep = new Set([0, pageCount - 1, page - 1, page, page + 1].filter(index => index >= 0 && index < pageCount));
  const sorted = [...keep].sort((a, b) => a - b);
  return sorted.flatMap((index, i) => (i && index - sorted[i - 1] > 1 ? ["gap" + index, index] : [index]));
}

function Pager({ paged, label, onTurn }) {
  if (paged.pageCount <= 1) return null;
  const turn = page => {
    paged.setPage(page);
    onTurn?.();
  };
  return (
    <nav className="pager" aria-label={label}>
      <button type="button" className="pager-step" disabled={paged.page === 0} onClick={() => turn(paged.page - 1)}>‹ Prev</button>
      <div className="pager-pages">
        {pageWindow(paged.page, paged.pageCount).map(item => typeof item === "string" ? (
          <span key={item} className="pager-gap" aria-hidden="true">…</span>
        ) : (
          <button type="button" key={item} className={item === paged.page ? "is-current" : ""} aria-current={item === paged.page ? "page" : undefined} aria-label={`Page ${item + 1}`} onClick={() => turn(item)}>{item + 1}</button>
        ))}
      </div>
      <span className="pager-range">{paged.start + 1}–{paged.start + paged.items.length} of {paged.total}</span>
      <button type="button" className="pager-step" disabled={paged.page >= paged.pageCount - 1} onClick={() => turn(paged.page + 1)}>Next ›</button>
    </nav>
  );
}

// Keep the top of a section in view after turning a page from below it.
function revealTop(ref) {
  const element = ref.current;
  if (element && element.getBoundingClientRect().top < 0) element.scrollIntoView({ block: "start", behavior: "smooth" });
}

function wrongStatusMatches(card, filter, now) {
  if (!filter) return true;
  if (filter === "missing") return !clean(card.answer);
  if (filter === "due") return isDue(card.reviewState, now);
  return reviewStatus(card.reviewState, now) === filter;
}

// Every wrong question in a division, wherever it was filed: search, filter,
// page through, review, and add new ones to any sub-room.
function DivisionWrongPanel({ info, rooms, cards, editor, status, onStartReview, onNew, onOpen, onEdit, onDelete }) {
  const sectionRef = useRef(null);
  const editorRef = useRef(null);
  const editorOpen = Boolean(editor);
  // Editing a card from further down the list: bring the editor into view.
  useEffect(() => {
    if (editorOpen) editorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [editorOpen]);
  const [query, setQuery] = useState("");
  const [roomFilter, setRoomFilter] = useState("");
  const [subroomFilter, setSubroomFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState("");
  const [sort, setSort] = useState("newest");
  const debouncedQuery = useDebouncedValue(query, 200);
  const needle = clean(debouncedQuery).toLowerCase();
  const now = new Date();

  const filterRoom = rooms.find(item => item.id === roomFilter) || null;
  // A question is filed when its sub-room still exists in this division.
  const placeOf = card => {
    const cardRoom = rooms.find(item => item.id === card.roomId);
    const cardSubroom = (cardRoom?.children || []).find(item => item.id === card.subroomId);
    return cardSubroom ? { room: cardRoom, subroom: cardSubroom } : null;
  };
  const pathOf = card => {
    const place = placeOf(card);
    return place ? `${place.room.name} / ${place.subroom.name}` : "Not in a sub-room yet";
  };
  const unfiledCount = cards.filter(card => !placeOf(card)).length;
  const counts = { due: 0, learning: 0, mastered: 0, missing: 0 };
  for (const card of cards) {
    if (isDue(card.reviewState, now)) counts.due += 1;
    const state = reviewStatus(card.reviewState, now);
    if (state === "learning" || state === "mastered") counts[state] += 1;
    if (!clean(card.answer)) counts.missing += 1;
  }

  const matches = cards.filter(card =>
    (!roomFilter || (roomFilter === UNFILED ? !placeOf(card) : card.roomId === roomFilter)) &&
    (!subroomFilter || card.subroomId === subroomFilter) &&
    (!reasonFilter || card.missReason === reasonFilter) &&
    wrongStatusMatches(card, statusFilter, now) &&
    (!needle || `${wrongSearchText(card)}\n${pathOf(card).toLowerCase()}`.includes(needle))
  );
  const sorted = sort === "due"
    ? sortForReview(matches)
    : [...matches].sort((a, b) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      const difference = new Date(a.savedAt) - new Date(b.savedAt);
      return sort === "oldest" ? difference : -difference;
    });
  const filtered = Boolean(needle || roomFilter || subroomFilter || statusFilter || reasonFilter);
  const paged = usePaged(sorted, WRONG_PAGE_SIZE, [needle, roomFilter, subroomFilter, statusFilter, reasonFilter, sort].join("|"));

  function clearFilters() {
    setQuery("");
    setRoomFilter("");
    setSubroomFilter("");
    setStatusFilter("");
    setReasonFilter("");
  }

  return (
    <section className="workspace wrong-session" ref={sectionRef}>
      <div className="workspace-head">
        <div>
          <div className="eyebrow">Wrong Questions</div>
          <h2>{info.label} wrong questions</h2>
          <p>{cards.length ? "Every wrong question in this division, from all its rooms and sub-rooms. Review them here; missed ones come back sooner." : "No wrong questions yet. Add one and choose the sub-room it belongs to."}</p>
        </div>
        <div className="buttons">
          {cards.length ? <button className="ghost-button" onClick={onStartReview}>{counts.due ? `Start session · ${counts.due} due` : "Practice all"}</button> : null}
          <button className="primary" onClick={() => onNew({ roomId: roomFilter === UNFILED ? "" : roomFilter, subroomId: subroomFilter })}>+ New Wrong Question</button>
        </div>
      </div>
      {editor ? <div className="wrong-editor-slot" ref={editorRef}>{editor}</div> : null}
      {!editor && status ? <p className="status-banner">{status}</p> : null}
      {cards.length ? (
        <>
          <div className="session-stats" role="group" aria-label="Filter by status">
            {WRONG_STATUS_FILTERS.map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={[statusFilter === key ? "is-active" : "", key === "missing" && counts.missing ? "is-warn" : ""].filter(Boolean).join(" ")}
                aria-pressed={statusFilter === key}
                onClick={() => setStatusFilter(statusFilter === key ? "" : key)}
              >
                <b>{counts[key]}</b>{label}
              </button>
            ))}
          </div>
          <div className="wrong-toolbar">
            <SearchBar value={query} onChange={setQuery} placeholder={`Search ${info.label} wrong questions...`} />
            <div className="wrong-filters">
              <label>
                <span>Room</span>
                <select value={roomFilter} onChange={event => { setRoomFilter(event.target.value); setSubroomFilter(""); }}>
                  <option value="">All rooms</option>
                  {rooms.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                  {unfiledCount ? <option value={UNFILED}>Not in a sub-room ({unfiledCount})</option> : null}
                </select>
              </label>
              <label>
                <span>Sub-room</span>
                <select value={subroomFilter} disabled={!filterRoom?.children?.length} onChange={event => setSubroomFilter(event.target.value)}>
                  <option value="">{filterRoom ? "All sub-rooms" : "Pick a room first"}</option>
                  {(filterRoom?.children || []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>
                <span>Status</span>
                <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                  <option value="">Any status</option>
                  {WRONG_STATUS_FILTERS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>Why missed</span>
                <select value={reasonFilter} onChange={event => setReasonFilter(event.target.value)}>
                  <option value="">Any reason</option>
                  {MISS_REASONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>Sort</span>
                <select value={sort} onChange={event => setSort(event.target.value)}>
                  {WRONG_SORTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </label>
            </div>
          </div>
          <div className="wrong-results-head">
            <span>{filtered ? `${sorted.length} of ${plural(cards.length, "wrong question")} match` : plural(cards.length, "wrong question")}</span>
            {filtered ? <button type="button" className="mini-action" onClick={clearFilters}>Clear filters</button> : null}
          </div>
          {paged.items.length ? (
            <div className="wrong-cards wrong-cards--paged">
              {paged.items.map(card => <WrongQuestionCard key={card.id} card={card} path={pathOf(card)} unfiled={!placeOf(card)} onOpen={onOpen} onEdit={onEdit} onDelete={onDelete} />)}
            </div>
          ) : <div className="empty-soft">No wrong questions match these filters.</div>}
          <Pager paged={paged} label={`${info.label} wrong question pages`} onTurn={() => revealTop(sectionRef)} />
        </>
      ) : null}
    </section>
  );
}

// The division's rooms, a page at a time.
function RoomDirectory({ info, rooms, noteCount, renderRoom, children }) {
  const sectionRef = useRef(null);
  const paged = usePaged(rooms, ROOM_PAGE_SIZE, info.label);
  return (
    <section className="workspace" ref={sectionRef}>
      <div className="workspace-head">
        <div><div className="eyebrow">Room Directory</div><h2>{info.label} rooms</h2></div>
        <div className="division-head-actions">
          <p>{plural(rooms.length, "room")} · {plural(noteCount, "saved note")}</p>
          {children}
        </div>
      </div>
      {rooms.length ? null : <div className="empty-soft">No rooms yet. Use + New Room to add a chapter or topic.</div>}
      <div className="directory-grid">{paged.items.map(renderRoom)}</div>
      <Pager paged={paged} label={`${info.label} room pages`} onTurn={() => revealTop(sectionRef)} />
    </section>
  );
}

function DivisionRoomCard({ room, noteCount, wrongCount, onOpenRoom, onOpenSubroom, onNewSubroom, onRenameRoom, onDeleteRoom, onRenameSubroom, onDeleteSubroom }) {
  const subrooms = room.children || [];
  function openRoomFromKeyboard(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenRoom(room.id);
    }
  }
  function openSubroomFromKeyboard(event, childId) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      onOpenSubroom(room.id, childId);
    }
  }
  return (
    <article className="room-card" role="button" tabIndex={0} onClick={() => onOpenRoom(room.id)} onKeyDown={openRoomFromKeyboard}>
      <div className="room-card-head">
        <div className="room-card-title">
          <b>{room.name}</b>
          <span>{subrooms.length} sub-rooms {"\u00B7"} {noteCount} notes {"\u00B7"} {wrongCount} wrong questions</span>
        </div>
        <ActionMenu label={`${room.name} actions`}>
          <button onClick={() => onNewSubroom(room.id)}>+ New Sub-room</button>
          <button onClick={() => onRenameRoom(room)}>Rename Room</button>
          <button className="danger-menu-item" onClick={() => onDeleteRoom(room)}>Delete Room</button>
        </ActionMenu>
      </div>
      <div className="room-card-actions">
        <button className="room-card-new-subroom" onClick={event => {
          event.stopPropagation();
          onNewSubroom(room.id);
        }}>+ New Sub-room</button>
      </div>
      <section className="room-subroom-list">
        <div className="eyebrow">Sub-rooms</div>
        {subrooms.length ? (
          <div className="subroom-list">
            {subrooms.map(child => (
              <div
                className="subroom-row"
                key={child.id}
                role="button"
                tabIndex={0}
                onClick={event => {
                  event.stopPropagation();
                  onOpenSubroom(room.id, child.id);
                }}
                onKeyDown={event => openSubroomFromKeyboard(event, child.id)}
              >
                <span className="subroom-row-name">{child.name}</span>
                <ActionMenu label={`${child.name} actions`}>
                  <button onClick={() => onRenameSubroom(child, room.id)}>Rename</button>
                  <button className="danger-menu-item" onClick={() => onDeleteSubroom(child, room.id)}>Delete</button>
                </ActionMenu>
              </div>
            ))}
          </div>
        ) : <div className="empty-soft">No sub-rooms yet.</div>}
      </section>
    </article>
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
  const [wrongDraft, setWrongDraft] = useState({ ...EMPTY_WRONG_DRAFT });
  const [wrongViewerId, setWrongViewerId] = useState("");
  const [wrongStatus, setWrongStatus] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const [roomSearch, setRoomSearch] = useState("");
  const [allSearchData, setAllSearchData] = useState({ loaded: false, notes: [], wrongQuestions: [] });
  const [allSearchLoading, setAllSearchLoading] = useState(false);
  const [quickAction, setQuickAction] = useState({ division: "", roomId: "", subroomId: "" });
  const [loadedRoomDivisions, setLoadedRoomDivisions] = useState([]);
  const [roomErrors, setRoomErrors] = useState([]);
  const [coverFocus, setCoverFocus] = useState(NO_COVER_FOCUS);
  const roomRequests = useRef(new Set());
  const [roomForm, setRoomForm] = useState(null);
  const [roomName, setRoomName] = useState("");
  const [deleteRoomTarget, setDeleteRoomTarget] = useState(null);
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomStatus, setRoomStatus] = useState("");
  const [subroomForm, setSubroomForm] = useState(null);
  const [subroomName, setSubroomName] = useState("");
  const [deleteSubroomTarget, setDeleteSubroomTarget] = useState(null);
  const [subroomBusy, setSubroomBusy] = useState(false);
  const [subroomStatus, setSubroomStatus] = useState("");
  const [roomCreateMode, setRoomCreateMode] = useState("");
  const [roomCreateSubroomId, setRoomCreateSubroomId] = useState("");
  const [editorTargetSubroomId, setEditorTargetSubroomId] = useState("");
  const [wrongEditorTargetSubroomId, setWrongEditorTargetSubroomId] = useState("");
  // Set while the division page's editor is open: where the question is filed.
  const [wrongPlacement, setWrongPlacement] = useState(null);
  const [review, setReview] = useState(null);
  const [roomLinks, setRoomLinks] = useState({ key: "", links: [], status: "" });
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
    if (!division || !roomId) return undefined;
    const key = `room-links:${division}:${roomId}`;
    let cancelled = false;
    setRoomLinks({ key, links: [], status: "" });
    fetch(`/api/cloud-data?app=are-study&key=${encodeURIComponent(key)}`)
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        const links = Array.isArray(data?.item?.data?.links) ? data.item.data.links : [];
        setRoomLinks({ key, links, status: ok ? "" : "Saved links unavailable." });
      })
      .catch(() => !cancelled && setRoomLinks({ key, links: [], status: "Saved links unavailable." }));
    return () => { cancelled = true; };
  }, [division, roomId]);

  const loadRooms = useCallback(code => {
    if (!code || roomRequests.current.has(code)) return;
    roomRequests.current.add(code);
    setRoomErrors(prev => prev.filter(item => item !== code));
    fetch(`/api/rooms?division=${encodeURIComponent(code)}`)
      .then(response => response.json().then(data => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "Rooms unavailable");
        setTree(prev => ({ ...prev, [code]: Array.isArray(data.rooms) ? data.rooms : [] }));
        setLoadedRoomDivisions(prev => prev.includes(code) ? prev : [...prev, code]);
      })
      .catch(() => setRoomErrors(prev => prev.includes(code) ? prev : [...prev, code]))
      .finally(() => roomRequests.current.delete(code));
  }, []);

  // The cover map shows every division's rooms.
  useEffect(() => {
    if (division) return;
    for (const [code] of DIVISIONS) {
      if (!loadedRoomDivisions.includes(code)) loadRooms(code);
    }
  }, [division, loadedRoomDivisions, loadRooms]);

  useEffect(() => {
    if (!coverFocus.division) return undefined;
    function handleKey(event) {
      if (event.key === "Escape" && !event.defaultPrevented) setCoverFocus(NO_COVER_FOCUS);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [coverFocus.division]);

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
    setEditorTargetSubroomId("");
    setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
  }

  function closeWrongEditor() {
    setWrongEditorOpen(false);
    setWrongEditingId("");
    setWrongEditorTargetSubroomId("");
    setWrongPlacement(null);
    setWrongDraft({ ...EMPTY_WRONG_DRAFT });
  }

  function closeSubroomPanels() {
    setSubroomForm(null);
    setSubroomName("");
    setDeleteSubroomTarget(null);
    setSubroomBusy(false);
    setSubroomStatus("");
  }

  function closeRoomPanels() {
    setRoomForm(null);
    setRoomName("");
    setDeleteRoomTarget(null);
    setRoomBusy(false);
    setRoomStatus("");
  }

  function closeRoomCreatePicker() {
    setRoomCreateMode("");
    setRoomCreateSubroomId("");
  }

  function chooseDivision(code) {
    setDivision(code);
    setCoverFocus(NO_COVER_FOCUS);
    setRoomId("");
    setSubroomId("");
    setViewerId("");
    setWrongViewerId("");
    setRoomSearch("");
    closeEditor();
    closeWrongEditor();
    closeRoomPanels();
    closeSubroomPanels();
    closeRoomCreatePicker();
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
    closeRoomPanels();
    closeSubroomPanels();
    closeRoomCreatePicker();
  }

  function chooseSubroom(parentId, idValue) {
    setRoomId(parentId);
    setSubroomId(idValue);
    setViewerId("");
    setWrongViewerId("");
    setRoomSearch("");
    closeEditor();
    closeWrongEditor();
    closeRoomPanels();
    closeSubroomPanels();
    closeRoomCreatePicker();
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

  function handleCoverNode(node) {
    if (node.kind === "note") {
      const note = allSearchData.notes.find(item => item.id === node.noteId);
      if (note) openDashboardNote(note);
      return;
    }
    setCoverFocus({ division: node.division, roomId: node.roomId || "", subroomId: node.subroomId || "" });
  }

  function openRoomFromCover(code, targetRoomId) {
    chooseDivision(code);
    setRoomId(targetRoomId);
  }

  function openSubroomFromCover(code, targetRoomId, targetSubroomId) {
    chooseDivision(code);
    setRoomId(targetRoomId);
    setSubroomId(targetSubroomId);
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
    closeWrongEditor();
    setEditingId("");
    setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
    setEditorOpen(true);
  }

  async function attachFiles(fileList) {
    const next = [];
    for (const file of Array.from(fileList || [])) {
      const detected = wrongAttachmentKind(file);
      if (!detected || !ACCEPTED_TYPES.has(detected.type)) continue;
      next.push({ id: makeId("att"), name: file.name, type: detected.type, size: file.size, kind: detected.kind, dataUrl: await fileToDataUrl(file) });
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

  async function saveNote(noteDraft = draft, noteId = editingId, targetRoom = roomId, targetSubroom = editorTargetSubroomId || subroomId, targetDivision = division) {
    if (!targetRoom || !targetSubroom) return setStatus("Select a sub-room before saving.");
    if (!clean(noteDraft.title) && !clean(noteDraft.rawNotes) && !noteDraft.attachments.length) return setStatus("Add a title, Raw Notes text, or attachment before saving.");
    const divisionRooms = Array.isArray(tree[targetDivision]) ? tree[targetDivision] : [];
    const targetRoomObj = divisionRooms.find(item => item.id === targetRoom);
    const targetSubroomObj = (targetRoomObj?.children || []).find(item => item.id === targetSubroom);
    const existing = noteId ? notes.find(note => note.id === noteId) || allSearchData.notes.find(note => note.id === noteId) : null;
    const payload = {
      id: noteId || makeId("note"),
      division: targetDivision,
      roomId: targetRoom,
      roomName: targetRoomObj?.name || existing?.roomName || "",
      subroomId: targetSubroom,
      subroomName: targetSubroomObj?.name || existing?.subroomName || "",
      text: packNote(noteDraft),
      savedAt: existing?.savedAt || new Date().toISOString()
    };
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
    if (parsed.division && parsed.division !== division) setDivision(parsed.division);
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
      const saved = await saveNote({ title: note.title, rawNotes: note.rawNotes, attachments: note.attachments || [], analysis }, note.id, note.roomId, note.subroomId, note.division || division);
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
      const placed = wrongPlacement;
      if (placed && !placed.subroomId) return setWrongStatus("Choose the room and sub-room this wrong question belongs to.");
      if (!placed && (!roomId || !(wrongEditorTargetSubroomId || subroomId || wrongEditingId))) return setWrongStatus("Select a sub-room before saving a wrong question.");
      if (!clean(wrongDraft.title) && !clean(wrongDraft.text) && !wrongDraft.attachments.length) return setWrongStatus("Add a title, wrong question text, or attachment before saving.");
      const existing = wrongEditingId ? wrongQuestions.find(card => card.id === wrongEditingId) : null;
      const targetRoomId = placed?.roomId || existing?.roomId || roomId;
      const targetSubroomId = placed?.subroomId || existing?.subroomId || wrongEditorTargetSubroomId || subroomId;
      if (!targetRoomId || !targetSubroomId) return setWrongStatus("Select a sub-room before saving a wrong question.");
      const targetRoom = rooms.find(item => item.id === targetRoomId);
      const targetSubroom = (targetRoom?.children || []).find(item => item.id === targetSubroomId);
      const payload = {
        id: wrongEditingId || makeId("wrong"),
        division: existing?.division || existing?.divisionId || division,
        divisionId: existing?.divisionId || existing?.division || division,
        roomId: targetRoomId,
        roomName: targetRoom?.name || existing?.roomName || "",
        subroomId: targetSubroomId,
        subRoomId: targetSubroomId,
        subroomName: targetSubroom?.name || existing?.subroomName || "",
        subRoomName: targetSubroom?.name || existing?.subRoomName || existing?.subroomName || "",
        title: clean(wrongDraft.title) || "Untitled Wrong Question",
        text: String(wrongDraft.text || "").trim(),
        answer: String(wrongDraft.answer || "").trim(),
        explanation: String(wrongDraft.explanation || "").trim(),
        missReason: wrongDraft.missReason || "",
        attachments: wrongDraft.attachments,
        savedAt: new Date().toISOString()
      };
      const response = await fetch("/api/wrong-questions", { method: existing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const saved = normalizeWrongQuestion({ ...(data.flashcard || payload), reviewState: data.flashcard?.reviewState || existing?.reviewState });
      setWrongQuestions(prev => [saved, ...prev.filter(card => card.id !== saved.id)]);
      setAllSearchData(prev => prev.loaded ? { ...prev, wrongQuestions: [saved, ...prev.wrongQuestions.filter(card => card.id !== saved.id)] } : prev);
      closeWrongEditor();
      setWrongStatus(placed ? `Saved "${saved.title}" to ${[saved.roomName, saved.subroomName].filter(Boolean).join(" / ")}.` : `Saved "${saved.title}" and closed the editor.`);
    } catch (error) {
      setWrongStatus(`Cloud save failed: ${error.message}`);
    }
  }

  function editWrongQuestion(card) {
    const parsed = normalizeWrongQuestion(card);
    const cardDivision = parsed.division || parsed.divisionId;
    // On the division page, edit in place; the editor there can also move it,
    // or file an older question that was never put in a sub-room.
    const inPlace = Boolean(division) && !roomId && cardDivision === division;
    if (!inPlace && (!parsed.roomId || !parsed.subroomId)) {
      setWrongStatus(`This older wrong question isn't in a sub-room yet. Open it from the ${cardDivision || "division"} page to file it in one.`);
      return;
    }
    if (inPlace) {
      closeEditor();
      // Start from where it is filed; if those ids are gone, from a room and
      // sub-room with the saved names, so re-filing it is one Save.
      const placeRoom = rooms.find(item => item.id === parsed.roomId) || rooms.find(item => parsed.roomName && item.name === parsed.roomName);
      const placeSubroom = (placeRoom?.children || []).find(item => item.id === parsed.subroomId) || (placeRoom?.children || []).find(item => parsed.subroomName && item.name === parsed.subroomName);
      setWrongPlacement({ roomId: placeRoom ? placeRoom.id : "", subroomId: placeSubroom ? placeSubroom.id : "" });
    } else {
      if (cardDivision && cardDivision !== division) setDivision(cardDivision);
      setRoomId(parsed.roomId);
      setSubroomId(parsed.subroomId);
    }
    setWrongViewerId("");
    setReview(null);
    setWrongEditingId(parsed.id);
    setWrongDraft({ title: parsed.title, text: parsed.text, answer: parsed.answer, explanation: parsed.explanation, missReason: parsed.missReason, attachments: parsed.attachments || [] });
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

  function reviewPool(scope) {
    return wrongQuestions.filter(card => {
      if ((card.division || card.divisionId) !== division) return false;
      if (scope.type === "room") return card.roomId === roomId;
      if (scope.type === "subroom") return card.roomId === roomId && (card.subroomId || "") === subroomId;
      return true;
    });
  }

  function reviewScopeLabel(scope) {
    if (scope.type === "room") return `${info.label} / ${room?.name || "Room"}`;
    if (scope.type === "subroom") return `${info.label} / ${room?.name || "Room"} / ${subroom?.name || "Sub-room"}`;
    return `${info.label} - ${info.name}`;
  }

  // Due questions first; if nothing is due, offer a practice round of everything.
  function startReview(scope) {
    const pool = reviewPool(scope);
    if (!pool.length) return setWrongStatus("No wrong questions here yet.");
    const due = sortForReview(dueCards(pool));
    setViewerId("");
    setWrongViewerId("");
    setReview({ cards: due.length ? due : sortForReview(pool), practice: !due.length, scopeLabel: reviewScopeLabel(scope) });
  }

  async function recordReview(card, result) {
    const response = await fetch("/api/wrong-questions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: card.id, result }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const updated = normalizeWrongQuestion(data.flashcard);
    setWrongQuestions(prev => prev.map(item => item.id === updated.id ? updated : item));
    setAllSearchData(prev => prev.loaded ? { ...prev, wrongQuestions: prev.wrongQuestions.map(item => item.id === updated.id ? updated : item) } : prev);
    return updated;
  }

  async function saveRoomLinks(nextLinks) {
    const key = roomLinks.key;
    if (!key) return;
    const previous = roomLinks.links;
    setRoomLinks({ key, links: nextLinks, status: "" });
    try {
      const response = await fetch("/api/cloud-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app: "are-study", key, data: { links: nextLinks } }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    } catch (error) {
      setRoomLinks(current => current.key === key ? { key, links: previous, status: `Link not saved: ${error.message}` } : current);
    }
  }

  function roomContentCounts(targetRoomId) {
    const targetRoom = rooms.find(item => item.id === targetRoomId);
    const noteItems = notes.filter(note => note.division === division && note.roomId === targetRoomId);
    const wrongItems = wrongQuestions.filter(card => (card.division || card.divisionId) === division && card.roomId === targetRoomId);
    return {
      subrooms: targetRoom?.children?.length || 0,
      notes: noteItems.length,
      wrongQuestions: wrongItems.length,
      attachments: noteItems.reduce((sum, note) => sum + (note.attachments?.length || 0), 0) + wrongItems.reduce((sum, card) => sum + (card.attachments?.length || 0), 0)
    };
  }

  function openNewRoom() {
    setRoomForm({ mode: "new" });
    setRoomName("");
    setRoomStatus("");
  }

  function openRenameRoom(targetRoom) {
    setRoomForm({ mode: "rename", room: targetRoom });
    setRoomName(targetRoom.name || "");
    setRoomStatus("");
  }

  async function saveRoom() {
    const name = clean(roomName);
    if (!name || !division || !roomForm) return;
    try {
      setRoomBusy(true);
      setRoomStatus("");
      if (roomForm.mode === "rename") {
        const targetRoom = roomForm.room;
        const response = await fetch("/api/rooms", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: targetRoom.id, division, name, roomType: "room" })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        setTree(prev => ({
          ...prev,
          [division]: (prev[division] || []).map(item => item.id === targetRoom.id ? { ...item, name } : item)
        }));
        setNotes(prev => prev.map(note => note.division === division && note.roomId === targetRoom.id ? { ...note, roomName: name } : note));
        setWrongQuestions(prev => prev.map(card => (card.division || card.divisionId) === division && card.roomId === targetRoom.id ? { ...card, roomName: name, topicPath: [card.division || card.divisionId || division, name, card.subroomName || card.subRoomName].filter(Boolean).join(" / ") } : card));
        setAllSearchData(prev => prev.loaded ? {
          ...prev,
          notes: prev.notes.map(note => note.division === division && note.roomId === targetRoom.id ? { ...note, roomName: name } : note),
          wrongQuestions: prev.wrongQuestions.map(card => (card.division || card.divisionId) === division && card.roomId === targetRoom.id ? { ...card, roomName: name, topicPath: [card.division || card.divisionId || division, name, card.subroomName || card.subRoomName].filter(Boolean).join(" / ") } : card)
        } : prev);
        closeRoomPanels();
        setStatus(`Renamed room to "${name}".`);
        return;
      }

      const payload = {
        id: makeId("room"),
        division,
        parentId: null,
        name,
        roomType: "room",
        sortOrder: rooms.length
      };
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const saved = { ...(data.room || { id: payload.id, name }), children: [] };
      setTree(prev => ({ ...prev, [division]: [...(prev[division] || []), saved] }));
      closeRoomPanels();
      setStatus(`Created room "${saved.name}".`);
    } catch (error) {
      setRoomStatus(`Cloud save failed: ${error.message}`);
    } finally {
      setRoomBusy(false);
    }
  }

  function openDeleteRoom(targetRoom) {
    setDeleteRoomTarget(targetRoom);
    setRoomStatus("");
  }

  async function deleteRoom() {
    if (!deleteRoomTarget || !division) return;
    const targetId = deleteRoomTarget.id;
    try {
      setRoomBusy(true);
      setRoomStatus("");
      const response = await fetch(`/api/rooms?id=${encodeURIComponent(targetId)}&division=${encodeURIComponent(division)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setTree(prev => ({ ...prev, [division]: (prev[division] || []).filter(item => item.id !== targetId) }));
      setNotes(prev => prev.filter(note => !(note.division === division && note.roomId === targetId)));
      setWrongQuestions(prev => prev.filter(card => !((card.division || card.divisionId) === division && card.roomId === targetId)));
      setAllSearchData(prev => prev.loaded ? {
        ...prev,
        notes: prev.notes.filter(note => !(note.division === division && note.roomId === targetId)),
        wrongQuestions: prev.wrongQuestions.filter(card => !((card.division || card.divisionId) === division && card.roomId === targetId))
      } : prev);
      setQuickAction(prev => prev.division === division && prev.roomId === targetId ? { ...prev, roomId: "", subroomId: "" } : prev);
      if (roomId === targetId) {
        setRoomId("");
        setSubroomId("");
      }
      if (viewerNote?.roomId === targetId) setViewerId("");
      if (wrongViewerCard?.roomId === targetId) setWrongViewerId("");
      if (editingId && notes.some(note => note.id === editingId && note.roomId === targetId)) closeEditor();
      if (wrongEditingId && wrongQuestions.some(card => card.id === wrongEditingId && card.roomId === targetId)) closeWrongEditor();
      closeRoomPanels();
      setStatus(`Deleted room "${deleteRoomTarget.name}".`);
    } catch (error) {
      setRoomStatus(`Cloud delete failed: ${error.message}`);
    } finally {
      setRoomBusy(false);
    }
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

  function openNewSubroom(targetRoomId = roomId) {
    setSubroomForm({ mode: "new", parentId: targetRoomId });
    setSubroomName("");
    setSubroomStatus("");
  }

  function openRenameSubroom(child, targetRoomId = roomId) {
    setSubroomForm({ mode: "rename", child, parentId: targetRoomId });
    setSubroomName(child.name || "");
    setSubroomStatus("");
  }

  async function saveSubroom() {
    const name = clean(subroomName);
    const targetRoomId = subroomForm?.parentId || roomId;
    if (!name || !targetRoomId || !division || !subroomForm) return;
    try {
      setSubroomBusy(true);
      setSubroomStatus("");
      if (subroomForm.mode === "rename") {
        const child = subroomForm.child;
        const response = await fetch("/api/rooms", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: child.id, division, parentId: targetRoomId, name, roomType: "subroom" })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        updateSubroomInTree(targetRoomId, children => children.map(item => item.id === child.id ? { ...item, name } : item));
        setNotes(prev => prev.map(note => note.division === division && note.roomId === targetRoomId && (note.subroomId || "") === child.id ? { ...note, subroomName: name } : note));
        setWrongQuestions(prev => prev.map(card => (card.division || card.divisionId) === division && card.roomId === targetRoomId && (card.subroomId || "") === child.id ? { ...card, subroomName: name, subRoomName: name, topicPath: [card.division || card.divisionId || division, card.roomName, name].filter(Boolean).join(" / ") } : card));
        setAllSearchData(prev => prev.loaded ? {
          ...prev,
          notes: prev.notes.map(note => note.division === division && note.roomId === targetRoomId && (note.subroomId || "") === child.id ? { ...note, subroomName: name } : note),
          wrongQuestions: prev.wrongQuestions.map(card => (card.division || card.divisionId) === division && card.roomId === targetRoomId && (card.subroomId || "") === child.id ? { ...card, subroomName: name, subRoomName: name, topicPath: [card.division || card.divisionId || division, card.roomName, name].filter(Boolean).join(" / ") } : card)
        } : prev);
        setStatus(`Renamed sub-room to "${name}".`);
      } else {
        const targetRoom = rooms.find(item => item.id === targetRoomId);
        const existingChildren = targetRoom?.children || [];
        const payload = {
          id: makeId("subroom"),
          division,
          parentId: targetRoomId,
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
        updateSubroomInTree(targetRoomId, children => [...children, saved]);
        setStatus(`Created sub-room "${saved.name}".`);
      }
      closeSubroomPanels();
    } catch (error) {
      setSubroomStatus(`Cloud save failed: ${error.message}`);
    } finally {
      setSubroomBusy(false);
    }
  }

  function openDeleteSubroom(child, targetRoomId = roomId) {
    setDeleteSubroomTarget({ ...child, parentId: targetRoomId });
    setSubroomStatus("");
  }

  async function deleteSubroom() {
    if (!deleteSubroomTarget || !division) return;
    const targetId = deleteSubroomTarget.id;
    const targetRoomId = deleteSubroomTarget.parentId || roomId;
    if (!targetRoomId) return;
    try {
      setSubroomBusy(true);
      setSubroomStatus("");
      const response = await fetch(`/api/rooms?id=${encodeURIComponent(targetId)}&division=${encodeURIComponent(division)}&parentId=${encodeURIComponent(targetRoomId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      updateSubroomInTree(targetRoomId, children => children.filter(child => child.id !== targetId));
      setNotes(prev => prev.filter(note => !(note.division === division && note.roomId === targetRoomId && (note.subroomId || "") === targetId)));
      setWrongQuestions(prev => prev.filter(card => !((card.division || card.divisionId) === division && card.roomId === targetRoomId && (card.subroomId || "") === targetId)));
      setAllSearchData(prev => prev.loaded ? {
        ...prev,
        notes: prev.notes.filter(note => !(note.division === division && note.roomId === targetRoomId && (note.subroomId || "") === targetId)),
        wrongQuestions: prev.wrongQuestions.filter(card => !((card.division || card.divisionId) === division && card.roomId === targetRoomId && (card.subroomId || "") === targetId))
      } : prev);
      if (subroomId === targetId) setSubroomId("");
      if (viewerNote?.roomId === targetRoomId && (viewerNote.subroomId || "") === targetId) setViewerId("");
      if (wrongViewerCard?.roomId === targetRoomId && (wrongViewerCard.subroomId || "") === targetId) setWrongViewerId("");
      if (editingId && notes.some(note => note.id === editingId && note.roomId === targetRoomId && (note.subroomId || "") === targetId)) closeEditor();
      if (wrongEditingId && wrongQuestions.some(card => card.id === wrongEditingId && card.roomId === targetRoomId && (card.subroomId || "") === targetId)) closeWrongEditor();
      closeSubroomPanels();
      setStatus(`Deleted sub-room "${deleteSubroomTarget.name}".`);
    } catch (error) {
      setSubroomStatus(`Cloud delete failed: ${error.message}`);
    } finally {
      setSubroomBusy(false);
    }
  }

  function openRoomCreate(mode) {
    const children = room?.children || [];
    if (!children.length) {
      setStatus("Create a sub-room before adding study content to this room.");
      return;
    }
    closeEditor();
    closeWrongEditor();
    setRoomCreateMode(mode);
    setRoomCreateSubroomId("");
    setStatus("");
    setWrongStatus("");
  }

  function openNoteForSubroom(targetSubroomId) {
    closeWrongEditor();
    closeRoomCreatePicker();
    setEditingId("");
    setEditorTargetSubroomId(targetSubroomId);
    setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
    setEditorOpen(true);
    setStatus("");
  }

  // Division page: new question, filed wherever the user picks (starting
  // from the room / sub-room filters if set).
  function openDivisionWrongEditor({ roomId: presetRoom = "", subroomId: presetSubroom = "" } = {}) {
    closeEditor();
    setWrongEditingId("");
    setWrongDraft({ ...EMPTY_WRONG_DRAFT });
    setWrongPlacement({ roomId: presetRoom || (rooms.length === 1 ? rooms[0].id : ""), subroomId: presetSubroom });
    setWrongEditorOpen(true);
    setWrongStatus("");
  }

  function openWrongQuestionForSubroom(targetSubroomId) {
    closeEditor();
    closeRoomCreatePicker();
    setWrongEditingId("");
    setWrongEditorTargetSubroomId(targetSubroomId);
    setWrongDraft({ ...EMPTY_WRONG_DRAFT });
    setWrongEditorOpen(true);
    setWrongStatus("");
  }

  function continueRoomCreate() {
    if (!roomCreateSubroomId) return;
    if (roomCreateMode === "wrong") {
      openWrongQuestionForSubroom(roomCreateSubroomId);
      return;
    }
    openNoteForSubroom(roomCreateSubroomId);
  }

  const topMenu = (
    <header className="top-menu">
      <nav className="top-nav" aria-label="Main">
        <button className="top-brand" onClick={() => chooseDivision("")}><span className="brand-mark" aria-hidden="true" />ARE Study Vault</button>
        <button className={!division ? "active" : ""} onClick={() => chooseDivision("")}>Map</button>
        <DivisionMenu current={division} onSelect={chooseDivision} />
      </nav>
      <div className="top-actions">
        <button onClick={() => chooseDivision("")}>Search</button>
        <button onClick={onLogout}>Logout</button>
      </div>
    </header>
  );

  function breadcrumbs(items) {
    return (
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <button onClick={() => chooseDivision("")}>Vault</button>
        {items.map(([label, onClick], index) => (
          <span key={index}>
            <i aria-hidden="true">/</i>
            {onClick ? <button onClick={onClick}>{label}</button> : <b>{label}</b>}
          </span>
        ))}
      </nav>
    );
  }

  function reviewButton(scope, pool) {
    if (!pool.length) return null;
    const due = dueCards(pool).length;
    return <button className="ghost-button" onClick={() => startReview(scope)}>{due ? `Review ${due} due` : "Practice wrong questions"}</button>;
  }

  function roomDirectory() {
    const children = room?.children || [];
    const query = clean(debouncedRoomSearch).toLowerCase();
    const roomNotes = divisionNotes.filter(note => note.roomId === roomId);
    const roomWrong = wrongQuestions.filter(card => (card.division || card.divisionId) === division && card.roomId === roomId);
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
        <section className="workspace room-workspace">
          {breadcrumbs([[`${info.label}`, () => chooseRoom("")], [room?.name]])}
          <div className="workspace-head">
            <div><div className="eyebrow">Room · Logic Map</div><h1>{room?.name}</h1><p>{plural(children.length, "sub-room")} · {plural(roomNotes.length, "note")} · {plural(roomWrong.length, "wrong question")}</p></div>
            <div className="buttons">
              {reviewButton({ type: "room" }, roomWrong)}
              <button className="primary" onClick={() => openRoomCreate("note")}>+ New Note</button>
              <button className="primary" onClick={() => openRoomCreate("wrong")}>+ New Wrong Question</button>
            </div>
          </div>
          <LogicMap
            roomName={room?.name || "Room"}
            color={roomColor(DIVISION_COLORS[division] || "#5a8dff", Math.max(0, rooms.findIndex(item => item.id === roomId)))}
            subrooms={children}
            notes={roomNotes}
            wrongQuestions={roomWrong}
            links={roomLinks.links}
            linksStatus={roomLinks.status}
            onOpenNote={note => setViewerId(note.id)}
            onOpenWrong={card => setWrongViewerId(card.id)}
            onOpenSubroom={childId => chooseSubroom(roomId, childId)}
            onLinksChange={saveRoomLinks}
          />
          <SearchBar value={roomSearch} onChange={setRoomSearch} placeholder="Search in this room..." />
          {editorOpen && !subroomId ? <NoteEditor draft={draft} editing={editingId} busy={busy} status={status} setDraft={setDraft} onFiles={attachFiles} onRemoveFile={fileId => setDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))} onAnalyze={analyzeDraft} onSave={saveDraft} onCancel={closeEditor} /> : null}
          {wrongEditorOpen && !subroomId ? <WrongQuestionEditor draft={wrongDraft} editing={wrongEditingId} status={wrongStatus} setDraft={setWrongDraft} onFiles={attachWrongFiles} onRemoveFile={fileId => setWrongDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))} onSave={saveWrongQuestion} onCancel={closeWrongEditor} /> : null}
          {!wrongEditorOpen && !subroomId && wrongStatus ? <p className="status-banner">{wrongStatus}</p> : null}
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
                        <span>{query ? `${cards.length} matching notes · ${wrongCards.length} matching wrong questions` : `${plural(totalCards, "note")} · ${plural(totalWrongCards, "wrong question")}`}</span>
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
                      action={<button className="mini-action" onClick={() => openWrongQuestionForSubroom(child.id)}>+ New Wrong Question</button>}
                      empty={<div className="empty-soft">{query ? "No matching wrong question cards in this sub-room." : "No wrong question cards in this sub-room yet."}</div>}
                    >
                      {wrongCards.map(card => <WrongQuestionCard key={card.id} card={card} onOpen={item => setWrongViewerId(item.id)} onEdit={editWrongQuestion} onDelete={deleteWrongQuestion} />)}
                    </CardCarousel>
                  </section>
                );
              })}
            </>
          ) : <div className="empty-soft">No sub-rooms yet. Open the room menu on the division page to add one.</div>}
        </section>
        {roomCreateMode ? <RoomCreatePicker mode={roomCreateMode} subrooms={children} value={roomCreateSubroomId} onChange={setRoomCreateSubroomId} onContinue={continueRoomCreate} onCancel={closeRoomCreatePicker} /> : null}
      </>
    );
  }

  function subroomView() {
    return (
      <section className="workspace">
        {breadcrumbs([[info.label, () => chooseRoom("")], [room?.name, () => chooseRoom(roomId)], [subroom?.name]])}
        <div className="workspace-head">
          <div><div className="eyebrow">Sub-room</div><h1>{subroom?.name}</h1><p>{info.label} / {room?.name}</p></div>
          <div className="buttons">
            {reviewButton({ type: "subroom" }, subroomWrongQuestions)}
            <button className="primary" onClick={() => { closeWrongEditor(); setEditingId(""); setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } }); setEditorOpen(true); }}>+ New Note</button>
            <button className="primary" onClick={() => { closeEditor(); setWrongEditingId(""); setWrongDraft({ ...EMPTY_WRONG_DRAFT }); setWrongEditorOpen(true); setWrongStatus(""); }}>+ New Wrong Question</button>
          </div>
        </div>
        <section className="content-section">
          <div className="content-section-head"><h2>Study Notes</h2><span>{plural(subroomNotes.length, "card")}</span></div>
          {editorOpen ? <NoteEditor draft={draft} editing={editingId} busy={busy} status={status} setDraft={setDraft} onFiles={attachFiles} onRemoveFile={fileId => setDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))} onAnalyze={analyzeDraft} onSave={saveDraft} onCancel={closeEditor} /> : null}
          <div className="cards">{subroomNotes.map(note => <NoteCard key={note.id} note={note} onOpen={item => setViewerId(item.id)} onEdit={editNote} onDelete={deleteNote} />)}</div>
          {!subroomNotes.length && !editorOpen ? <div className="empty-soft">No saved note cards here yet. Use + New Note when ready.</div> : null}
        </section>
        <section className="content-section">
          <div className="content-section-head"><h2>Wrong Questions</h2><span>{plural(subroomWrongQuestions.length, "card")}</span></div>
          {wrongEditorOpen ? <WrongQuestionEditor draft={wrongDraft} editing={wrongEditingId} status={wrongStatus} setDraft={setWrongDraft} onFiles={attachWrongFiles} onRemoveFile={fileId => setWrongDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))} onSave={saveWrongQuestion} onCancel={closeWrongEditor} /> : null}
          {!wrongEditorOpen && wrongStatus ? <p className="status-banner">{wrongStatus}</p> : null}
          <div className="wrong-cards">{subroomWrongQuestions.map(card => <WrongQuestionCard key={card.id} card={card} onOpen={item => setWrongViewerId(item.id)} onEdit={editWrongQuestion} onDelete={deleteWrongQuestion} />)}</div>
          {!subroomWrongQuestions.length && !wrongEditorOpen ? <div className="empty-soft">No wrong question cards here yet. Use + New Wrong Question when ready.</div> : null}
        </section>
      </section>
    );
  }

  function divisionView() {
    const divisionWrong = wrongQuestions.filter(card => (card.division || card.divisionId) === division);
    const heroRooms = rooms.slice(0, MAX_HERO_ROOMS);
    const roomAtoms = heroRooms.map((item, index) => {
      const noteCount = divisionNotes.filter(note => note.roomId === item.id).length;
      const wrongCount = divisionWrong.filter(card => card.roomId === item.id).length;
      const dueCount = dueCards(divisionWrong.filter(card => card.roomId === item.id)).length;
      return {
        id: item.id,
        color: roomColor(DIVISION_COLORS[division], index),
        size: Math.min(1, noteCount / 12),
        satellites: item.children?.length || 0,
        eyebrow: plural(item.children?.length || 0, "sub-room"),
        title: item.name,
        meta: `${plural(noteCount, "note")} · ${dueCount ? `${dueCount} due` : plural(wrongCount, "wrong question")}`,
        onSelect: () => chooseRoom(item.id)
      };
    });
    return (
      <section className="division-page">
        <MoleculeHero mode="center" centerColor={DIVISION_COLORS[division]} atoms={roomAtoms} label={`${info.name} rooms`}>
          <div className="eyebrow">Division · {plural(rooms.length, "room")}</div>
          <h1 className="hero-title hero-title--division">{info.label}</h1>
          <p className="hero-subtitle">{info.name}</p>
          <div className="hero-actions">
            <button className="ghost-button" onClick={openNewRoom}>+ New Room</button>
          </div>
          {!rooms.length ? <p className="hero-note">No rooms yet. Create your first room (a chapter or topic) and it appears here as an atom.</p> : null}
        </MoleculeHero>
        <DivisionWrongPanel
          key={division}
          info={info}
          rooms={rooms}
          cards={divisionWrong}
          status={wrongStatus}
          editor={wrongEditorOpen && wrongPlacement ? (
            <WrongQuestionEditor
              draft={wrongDraft}
              editing={wrongEditingId}
              status={wrongStatus}
              setDraft={setWrongDraft}
              placement={{
                rooms,
                roomId: wrongPlacement.roomId,
                subroomId: wrongPlacement.subroomId,
                onChange: place => {
                  setWrongPlacement(place);
                  setWrongStatus("");
                }
              }}
              onFiles={attachWrongFiles}
              onRemoveFile={fileId => setWrongDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))}
              onSave={saveWrongQuestion}
              onCancel={closeWrongEditor}
            />
          ) : null}
          onStartReview={() => startReview({ type: "division" })}
          onNew={openDivisionWrongEditor}
          onOpen={card => setWrongViewerId(card.id)}
          onEdit={editWrongQuestion}
          onDelete={deleteWrongQuestion}
        />
        <RoomDirectory
          key={`rooms-${division}`}
          info={info}
          rooms={rooms}
          noteCount={divisionNotes.length}
          renderRoom={item => (
            <DivisionRoomCard
              key={item.id}
              room={item}
              noteCount={divisionNotes.filter(note => note.roomId === item.id).length}
              wrongCount={divisionWrong.filter(card => card.roomId === item.id).length}
              onOpenRoom={chooseRoom}
              onOpenSubroom={chooseSubroom}
              onNewSubroom={openNewSubroom}
              onRenameRoom={openRenameRoom}
              onDeleteRoom={openDeleteRoom}
              onRenameSubroom={openRenameSubroom}
              onDeleteSubroom={openDeleteSubroom}
            />
          )}
        >
          <button className="primary" onClick={openNewRoom}>+ New Room</button>
        </RoomDirectory>
      </section>
    );
  }

  const main = !division ? (
    <Dashboard
      searchQuery={dashboardSearch}
      onSearchChange={setDashboardSearch}
      searchResults={dashboardSearchResults}
      searchLoading={allSearchLoading || (Boolean(clean(debouncedDashboardSearch)) && !allSearchData.loaded)}
      onOpenSearchResult={openSearchResult}
      notes={dashboardNotes}
      quickAction={quickAction}
      setQuickAction={setQuickAction}
      quickRooms={tree}
      loadedRoomDivisions={loadedRoomDivisions}
      roomErrors={roomErrors}
      onRetryRooms={loadRooms}
      coverFocus={coverFocus}
      setCoverFocus={setCoverFocus}
      onCoverNode={handleCoverNode}
      onOpenRoom={openRoomFromCover}
      onOpenSubroom={openSubroomFromCover}
      onQuickStart={startQuickAction}
      onOpenNote={openDashboardNote}
      onSelectDivision={chooseDivision}
    />
  ) : roomId && !subroomId ? roomDirectory() : roomId && subroomId ? subroomView() : divisionView();
  const deleteRoomCounts = deleteRoomTarget ? roomContentCounts(deleteRoomTarget.id) : null;
  const deleteSubroomCounts = deleteSubroomTarget ? subroomContentCounts(deleteSubroomTarget.parentId || roomId, deleteSubroomTarget.id) : null;

  return (
    <div className="app-shell">
      {topMenu}
      <main className={division ? "" : "main--cover"}>
        {status && !editorOpen ? <p className="status-banner floating-status">{status}</p> : null}
        {!division && wrongStatus && !review ? <p className="status-banner floating-status">{wrongStatus}</p> : null}
        {unassignedWrongQuestions.length && division ? <p className="status-banner">{unassignedWrongQuestions.length} legacy wrong question card(s) are preserved without sub-room assignment and are not shown in Sub-room lists.</p> : null}
        {main}
      </main>
      <Viewer note={viewerNote} busy={busy} onClose={() => setViewerId("")} onEdit={editNote} onDelete={deleteNote} onAnalyze={reanalyze} />
      <WrongQuestionViewer card={wrongViewerCard} canManage={Boolean(subroomId || wrongViewerCard?.roomId || (division && !roomId))} onClose={() => setWrongViewerId("")} onEdit={editWrongQuestion} onDelete={deleteWrongQuestion} />
      {review ? <WrongReview cards={review.cards} practice={review.practice} scopeLabel={review.scopeLabel} onResult={recordReview} onEdit={editWrongQuestion} onClose={() => setReview(null)} /> : null}
      {roomForm ? <RoomNameModal roomType="room" mode={roomForm.mode} name={roomName} status={roomStatus} busy={roomBusy} onNameChange={setRoomName} onSave={saveRoom} onCancel={closeRoomPanels} /> : null}
      {deleteRoomTarget ? <DeleteRoomModal roomType="room" item={deleteRoomTarget} counts={deleteRoomCounts} status={roomStatus} busy={roomBusy} onConfirm={deleteRoom} onCancel={closeRoomPanels} /> : null}
      {subroomForm ? <RoomNameModal roomType="subroom" mode={subroomForm.mode} name={subroomName} status={subroomStatus} busy={subroomBusy} onNameChange={setSubroomName} onSave={saveSubroom} onCancel={closeSubroomPanels} /> : null}
      {deleteSubroomTarget ? <DeleteRoomModal roomType="subroom" item={deleteSubroomTarget} counts={deleteSubroomCounts} status={subroomStatus} busy={subroomBusy} onConfirm={deleteSubroom} onCancel={closeSubroomPanels} /> : null}
    </div>
  );
}
