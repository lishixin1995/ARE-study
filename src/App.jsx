import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const EMPTY_ANALYSIS = { summary: "", bulletPoints: [], logicForest: null };
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png"]);
const LOGIC_MIN_SCALE = 0.03;
const LOGIC_MAX_SCALE = 2.5;

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

function normalizeNode(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return null;
  const label = clean(node.label || node.title || node.name || "");
  if (!label) return null;
  const children = Array.isArray(node.children) ? node.children : Array.isArray(node.nodes) ? node.nodes : [];
  return { label, type: clean(node.type || "point") || "point", children: children.map(child => normalizeNode(child, depth + 1)).filter(Boolean) };
}

function normalizeForest(value, fallback = "Study Notes") {
  if (Array.isArray(value)) {
    const nodes = value.map(item => normalizeNode(item)).filter(Boolean);
    if (nodes.length === 1) return nodes[0];
    if (nodes.length > 1) return { label: fallback, type: "topic", children: nodes };
  }
  return normalizeNode(value);
}

function normalizeAnalysis(value) {
  if (!value || typeof value !== "object") return { ...EMPTY_ANALYSIS };
  const summary = String(value.summary || "").trim();
  const bulletPoints = Array.isArray(value.bulletPoints) ? value.bulletPoints.map(item => String(item || "").trim()).filter(Boolean) : [];
  return { summary, bulletPoints, logicForest: normalizeForest(value.logicForest || value.root, summary || "Study Notes") };
}

function hasAnalysis(analysis) {
  return Boolean(analysis?.summary || analysis?.bulletPoints?.length || analysis?.logicForest);
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

function chunkLogicChildren(children = [], depth = 0) {
  const maxPerRow = depth <= 0 ? 3 : depth === 1 ? 3 : 2;
  if (children.length <= maxPerRow) return [children];
  const rowCount = Math.ceil(children.length / maxPerRow);
  const balancedSize = Math.ceil(children.length / rowCount);
  const rows = [];
  for (let index = 0; index < children.length; index += balancedSize) {
    rows.push(children.slice(index, index + balancedSize));
  }
  return rows;
}

function LogicNode({ node, root = false, depth = 0 }) {
  if (!node) return null;
  const children = Array.isArray(node.children) ? node.children : [];
  const childRows = chunkLogicChildren(children, depth);
  return (
    <div className={`logic-node ${root ? "root" : ""} depth-${Math.min(depth, 3)}`}>
      <div className="logic-label">{node.label}</div>
      {children.length ? (
        <div className="logic-children">
          {childRows.map((row, rowIndex) => (
            <div className={`logic-child-row ${row.length === 1 ? "single" : ""}`} key={`row-${depth}-${rowIndex}`}>
              {row.map((child, index) => (
                <div className="logic-child" key={`${child.label}-${rowIndex}-${index}`}>
                  <span />
                  <LogicNode node={child} depth={depth + 1} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LogicImage({ analysis, compact = false }) {
  return <div className={`logic-image ${compact ? "compact" : ""}`}>{analysis?.logicForest ? <LogicNode node={analysis.logicForest} root /> : <div className="empty-soft">No logic image yet.</div>}</div>;
}

class LogicMapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return <div className="logic-error">Logic Map could not render: {this.state.error.message}</div>;
    }
    return this.props.children;
  }
}

function LogicMapViewport({ analysis, fullscreen = false, onOpenFull, onClose }) {
  const stageRef = useRef(null);
  const contentRef = useRef(null);
  const rafRef = useRef(0);
  const [stageReady, setStageReady] = useState(false);
  const [scale, setScale] = useState(1);
  const [fitScale, setFitScale] = useState(1);
  const [mapSize, setMapSize] = useState({ width: 0, height: 0 });
  const [renderError, setRenderError] = useState("");
  const hasMap = Boolean(analysis?.logicForest);

  const fitEntireMap = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const measure = attempt => {
      rafRef.current = requestAnimationFrame(() => {
        const stage = stageRef.current;
        const content = contentRef.current;
        if (!hasMap) {
          setRenderError("No Logic Map data is available for this note.");
          return;
        }
        if (!stage || stage.clientWidth <= 0 || stage.clientHeight <= 0) {
          if (attempt < 8) return measure(attempt + 1);
          setRenderError("Logic Map container is not ready yet.");
          return;
        }
        if (!content) {
          if (attempt < 8) return measure(attempt + 1);
          setRenderError("Logic Map content was not mounted.");
          return;
        }

        const width = Math.ceil(content.scrollWidth || content.offsetWidth || 0);
        const height = Math.ceil(content.scrollHeight || content.offsetHeight || 0);
        if (!width || !height) {
          if (attempt < 8) return measure(attempt + 1);
          setRenderError("Logic Map size could not be measured.");
          return;
        }

        const availableWidth = Math.max(stage.clientWidth - 36, 1);
        const availableHeight = Math.max(stage.clientHeight - 36, 1);
        const nextFit = Math.max(LOGIC_MIN_SCALE, Math.min(1, availableWidth / width, availableHeight / height));
        setRenderError("");
        setMapSize({ width, height });
        setFitScale(nextFit);
        setScale(nextFit);
      });
    };
    measure(0);
  }, [hasMap]);

  useEffect(() => {
    const stage = stageRef.current;
    setStageReady(Boolean(stage?.clientWidth && stage?.clientHeight));
    setScale(1);
    setFitScale(1);
    setMapSize({ width: 0, height: 0 });
    setRenderError("");
  }, [analysis?.logicForest, fullscreen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const markReady = () => {
      if (stage.clientWidth > 0 && stage.clientHeight > 0) {
        setStageReady(true);
        if (hasMap) fitEntireMap();
      }
    };
    rafRef.current = requestAnimationFrame(markReady);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(markReady) : null;
    observer?.observe(stage);
    return () => {
      cancelAnimationFrame(rafRef.current);
      observer?.disconnect();
    };
  }, [fitEntireMap, hasMap]);

  useEffect(() => {
    if (stageReady && hasMap) fitEntireMap();
  }, [stageReady, hasMap, fitEntireMap]);

  const zoomed = scale > fitScale + 0.01;
  const frameStyle = mapSize.width && mapSize.height ? { width: `${mapSize.width * scale}px`, height: `${mapSize.height * scale}px` } : undefined;

  function zoomBy(delta) {
    setScale(value => Math.max(LOGIC_MIN_SCALE, Math.min(LOGIC_MAX_SCALE, Number((value + delta).toFixed(3)))));
  }

  return (
    <section className={`logic-map-view ${fullscreen ? "fullscreen" : ""}`}>
      <div className="logic-toolbar">
        <button disabled={!hasMap || scale <= LOGIC_MIN_SCALE + 0.001} onClick={() => zoomBy(-0.15)}>Zoom Out</button>
        <button disabled={!hasMap} onClick={fitEntireMap}>{fullscreen ? "Fit Map" : "Reset"}</button>
        <button disabled={!hasMap || scale >= LOGIC_MAX_SCALE} onClick={() => zoomBy(0.15)}>Zoom In</button>
        {onOpenFull ? <button onClick={onOpenFull} disabled={!hasMap}>Open Full Image</button> : null}
        {onClose ? <button onClick={onClose}>Close</button> : null}
      </div>
      {renderError ? <div className="logic-error">{renderError}</div> : null}
      <div className={`logic-stage ${zoomed ? "is-zoomed" : ""}`} ref={stageRef}>
        {hasMap && stageReady ? (
          <div className="logic-scale-frame" style={frameStyle}>
            <div className="logic-fit" ref={contentRef} style={{ transform: `scale(${scale})` }}>
              <LogicMapErrorBoundary resetKey={analysis?.logicForest}>
                <LogicImage analysis={analysis} />
              </LogicMapErrorBoundary>
            </div>
          </div>
        ) : hasMap ? (
          <div className="empty-soft">Preparing Logic Map...</div>
        ) : (
          <div className="empty-soft">No logic image yet.</div>
        )}
      </div>
    </section>
  );
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

function Dashboard({ onSelect }) {
  return (
    <section className="workspace dashboard">
      <div className="workspace-head">
        <div>
          <div className="eyebrow">Main Dashboard</div>
          <h1>ARE Study Vault</h1>
        </div>
        <p>Select a division to open rooms, sub-rooms, saved note cards, and full note viewers.</p>
      </div>
      <div className="division-grid">
        {DIVISIONS.map(([code, label, name]) => <button className="division-card" key={code} onClick={() => onSelect(code)}><strong>{label}</strong><span>{name}</span></button>)}
      </div>
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
      {hasAnalysis(draft.analysis) ? <div className="analysis-preview"><section><h3>Summary</h3><p>{draft.analysis.summary}</p></section><section><h3>Bullet Points</h3><ul>{draft.analysis.bulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ul></section>{draft.analysis?.logicForest ? <section className="wide"><h3>Logic Map</h3><LogicImage analysis={draft.analysis} /></section> : null}</div> : null}
    </section>
  );
}

function Viewer({ note, busy, onClose, onEdit, onDelete, onAnalyze, onGenerateLogicMap }) {
  const [tab, setTab] = useState("overview");
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fullLogicOpen, setFullLogicOpen] = useState(false);

  useEffect(() => {
    if (!note) return;
    setTab("overview");
    setPreview(null);
    setFullLogicOpen(false);
    setMenuOpen(false);
  }, [note?.id]);

  if (!note) return null;

  const hasLogicMap = Boolean(note.analysis?.logicForest);
  const tabs = [
    ["overview", "Overview"],
    ...(hasLogicMap ? [["logic", "Logic Image"]] : []),
    ["attachments", "Attachments"]
  ];

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
            <button className="ai" disabled={busy || !clean(note.rawNotes)} onClick={async () => { const saved = await onGenerateLogicMap(note); if (saved?.analysis?.logicForest || hasLogicMap) setTab("logic"); }}>{hasLogicMap ? "Regenerate Logic Map" : "Generate Logic Map"}</button>
            <div className="card-menu-wrap">
              <button className="icon-menu-btn" aria-label="More actions" onClick={() => setMenuOpen(open => !open)}>•••</button>
              {menuOpen ? <div className="card-menu viewer-menu"><button onClick={() => { setMenuOpen(false); onDelete(note.id); }}>Delete</button></div> : null}
            </div>
            <button onClick={onClose}>Close</button>
          </div>
        </header>

        <nav className="viewer-tabs">
          {tabs.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>{label}</button>)}
        </nav>

        <div className="viewer-body">
          {tab === "overview" ? (
            <div className="overview-stack">
              <section>
                <h3>Summary</h3>
                <p>{note.analysis?.summary || "No AI summary yet."}</p>
              </section>
              <section>
                <h3>Bullet Points</h3>
                {note.analysis?.bulletPoints?.length ? <ul>{note.analysis.bulletPoints.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>No AI bullet points yet.</p>}
              </section>
              <section className="overview-raw">
                <h3>Raw Notes</h3>
                <div className="raw-note-text">{note.rawNotes || "No raw notes saved."}</div>
              </section>
            </div>
          ) : null}

          {tab === "logic" && hasLogicMap ? (
            <section className="logic-tab">
              <LogicMapViewport analysis={note.analysis} onOpenFull={() => setFullLogicOpen(true)} />
            </section>
          ) : null}

          {tab === "attachments" ? (
            <section className="attachments-tab">
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
          ) : null}
        </div>
      </section>
      {fullLogicOpen ? (
        <div className="image-modal-backdrop" onClick={event => { event.stopPropagation(); setFullLogicOpen(false); }}>
          <div className="image-modal" onClick={event => event.stopPropagation()}>
            <div className="image-modal-head">
              <h3>Logic Image</h3>
            </div>
            <LogicMapViewport analysis={note.analysis} fullscreen onClose={() => setFullLogicOpen(false)} />
          </div>
        </div>
      ) : null}
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
  const [viewerId, setViewerId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const info = divisionInfo(division);
  const rooms = useMemo(() => Array.isArray(tree[division]) ? tree[division] : [], [tree, division]);
  const room = useMemo(() => rooms.find(item => item.id === roomId) || null, [rooms, roomId]);
  const subroom = useMemo(() => (room?.children || []).find(item => item.id === subroomId) || null, [room, subroomId]);
  const divisionNotes = useMemo(() => notes.filter(note => note.division === division).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)), [notes, division]);
  const subroomNotes = useMemo(() => divisionNotes.filter(note => note.roomId === roomId && (note.subroomId || "") === subroomId), [divisionNotes, roomId, subroomId]);
  const viewerNote = notes.find(note => note.id === viewerId) || null;

  useEffect(() => {
    if (!division) return;
    fetch(`/api/rooms?division=${encodeURIComponent(division)}`).then(response => response.json().then(data => ({ ok: response.ok, data }))).then(({ ok, data }) => ok && setTree(prev => ({ ...prev, [division]: Array.isArray(data.rooms) ? data.rooms : [] }))).catch(() => setStatus("Cloud rooms unavailable."));
    fetch(`/api/notes?division=${encodeURIComponent(division)}`).then(response => response.json().then(data => ({ ok: response.ok, data }))).then(({ ok, data }) => ok && setNotes(Array.isArray(data.notes) ? data.notes.map(parseNote) : [])).catch(() => setStatus("Cloud notes unavailable."));
  }, [division]);

  function closeEditor() {
    setEditorOpen(false);
    setEditingId("");
    setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } });
  }

  function chooseDivision(code) {
    setDivision(code);
    setRoomId("");
    setSubroomId("");
    setViewerId("");
    closeEditor();
    setStatus("");
  }

  function chooseRoom(idValue) {
    setRoomId(idValue);
    setSubroomId("");
    setViewerId("");
    closeEditor();
  }

  function chooseSubroom(parentId, idValue) {
    setRoomId(parentId);
    setSubroomId(idValue);
    setViewerId("");
    closeEditor();
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

  async function analyzeSummary(rawNotes) {
    const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: rawNotes, type: "summary", mode: "summary" }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return normalizeAnalysis(data.analysis);
  }

  async function generateLogicMapFromText(rawNotes) {
    const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: rawNotes, type: "capture" }) });
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
      setDraft(prev => ({ ...prev, analysis: { ...analysis, logicForest: prev.analysis?.logicForest || null } }));
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
      const saved = await saveNote({ title: note.title, rawNotes: note.rawNotes, attachments: note.attachments || [], analysis: { ...analysis, logicForest: note.analysis?.logicForest || null } }, note.id, note.roomId, note.subroomId);
      setViewerId(saved.id);
      setStatus("Saved note Summary and Bullet Points updated. Existing Logic Map was preserved.");
    } catch (error) {
      setStatus(`AI Error: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function generateLogicMap(note) {
    if (!clean(note.rawNotes)) return null;
    try {
      setBusy(true);
      setStatus("Generating Logic Map from Raw Notes text only...");
      const generated = await generateLogicMapFromText(note.rawNotes);
      const current = normalizeAnalysis(note.analysis);
      const analysis = {
        summary: current.summary,
        bulletPoints: current.bulletPoints,
        logicForest: generated.logicForest
      };
      const saved = await saveNote({ title: note.title, rawNotes: note.rawNotes, attachments: note.attachments || [], analysis }, note.id, note.roomId, note.subroomId);
      setViewerId(saved.id);
      setStatus("Logic Map saved to the current note.");
      return saved;
    } catch (error) {
      setStatus(`Logic Map Error: ${error.message}`);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function deleteNote(noteId) {
    if (!noteId || !window.confirm("Delete this saved note?")) return;
    const response = await fetch(`/api/notes?id=${encodeURIComponent(noteId)}`, { method: "DELETE" });
    if (!response.ok) return setStatus("Cloud delete failed.");
    setNotes(prev => prev.filter(note => note.id !== noteId));
    if (viewerId === noteId) setViewerId("");
    if (editingId === noteId) closeEditor();
    setStatus("Saved note deleted.");
  }

  const sidebar = <aside className="sidebar"><div className="brand-card"><div><button className="brand" onClick={() => chooseDivision("")}>ARE Study Vault</button><p>Cloud-synced note cards by ARE room and sub-room.</p></div><button onClick={onLogout}>Logout</button></div><section><h3>Divisions</h3>{DIVISIONS.map(([code, label, name]) => <button key={code} className={division === code ? "active" : ""} onClick={() => chooseDivision(code)}><b>{label}</b><small>{name}</small></button>)}</section>{division ? <section><h3>{info.label} Rooms</h3>{rooms.map(item => <div className="room-group" key={item.id}><button className={roomId === item.id && !subroomId ? "active" : ""} onClick={() => chooseRoom(item.id)}>{item.name}</button>{item.children?.length ? <div className="subrooms">{item.children.map(child => <button key={child.id} className={subroomId === child.id ? "active" : ""} onClick={() => chooseSubroom(item.id, child.id)}>{child.name}</button>)}</div> : null}</div>)}</section> : null}</aside>;

  function roomDirectory() {
    const children = room?.children || [];
    return <section className="workspace"><div className="workspace-head"><div><div className="eyebrow">Room Directory</div><h1>{room?.name}</h1></div><p>Sub-rooms and saved note cards only.</p></div>{children.length ? children.map(child => { const cards = divisionNotes.filter(note => note.roomId === roomId && (note.subroomId || "") === child.id); return <section className="subroom-section" key={child.id}><div className="subroom-head"><button onClick={() => chooseSubroom(roomId, child.id)}>{child.name}</button><span>{cards.length} saved cards</span></div>{cards.length ? <div className="cards">{cards.map(note => <NoteCard key={note.id} note={note} onOpen={item => setViewerId(item.id)} onEdit={editNote} onDelete={deleteNote} />)}</div> : <div className="empty-soft">No saved note cards in this sub-room yet.</div>}</section>; }) : <div className="empty-soft">No sub-rooms yet.</div>}</section>;
  }

  function subroomView() {
    return <section className="workspace"><div className="workspace-head"><div><div className="eyebrow">Sub-room</div><h1>{subroom?.name}</h1><p>{info.label} / {room?.name}</p></div><button className="primary" onClick={() => { setEditingId(""); setDraft({ title: "", rawNotes: "", attachments: [], analysis: { ...EMPTY_ANALYSIS } }); setEditorOpen(true); }}>+ New Note</button></div>{editorOpen ? <NoteEditor draft={draft} editing={editingId} busy={busy} status={status} setDraft={setDraft} onFiles={attachFiles} onRemoveFile={fileId => setDraft(prev => ({ ...prev, attachments: prev.attachments.filter(item => item.id !== fileId) }))} onAnalyze={analyzeDraft} onSave={saveDraft} onCancel={closeEditor} /> : null}<div className="cards">{subroomNotes.map(note => <NoteCard key={note.id} note={note} onOpen={item => setViewerId(item.id)} onEdit={editNote} onDelete={deleteNote} />)}</div>{!subroomNotes.length && !editorOpen ? <div className="empty-soft">No saved note cards here yet. Use + New Note when ready.</div> : null}</section>;
  }

  function divisionView() {
    return <section className="workspace"><div className="workspace-head"><div><div className="eyebrow">Division</div><h1>{info.label} - {info.name}</h1></div><p>{divisionNotes.length} saved notes</p></div><div className="directory-grid">{rooms.map(item => <button key={item.id} onClick={() => chooseRoom(item.id)}><b>{item.name}</b><span>{item.children?.length || 0} sub-rooms - {divisionNotes.filter(note => note.roomId === item.id).length} notes</span></button>)}</div></section>;
  }

  const main = !division ? <Dashboard onSelect={chooseDivision} /> : roomId && !subroomId ? roomDirectory() : roomId && subroomId ? subroomView() : divisionView();
  return <div className="app-shell">{sidebar}<main>{status && !editorOpen ? <p className="status-banner">{status}</p> : null}{main}</main><Viewer note={viewerNote} busy={busy} onClose={() => setViewerId("")} onEdit={editNote} onDelete={deleteNote} onAnalyze={reanalyze} onGenerateLogicMap={generateLogicMap} /></div>;
}
