import { useEffect, useMemo, useRef, useState } from "react";
import { hasWebGL } from "../three/support.js";

const LINK_SUGGESTIONS = ["leads to", "requires", "part of", "example of", "contrasts with", "related to", "causes"];

const makeLinkId = () => `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function shorten(value, max = 34) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "Untitled";
}

// Builds the molecule from saved data: room → sub-rooms → notes and wrong
// questions. links: [{ id, from, to, label }] using node ids like "note:<id>".
function buildMapGraph({ subrooms = [], notes = [], wrongQuestions = [] }) {
  const known = new Set(subrooms.map(item => item.id));
  const item = (kind, record) => ({ id: `${kind}:${record.id}`, kind, refId: record.id, title: shorten(record.title), fullTitle: record.title || "Untitled" });
  const groups = subrooms.map(subroom => ({
    id: `subroom:${subroom.id}`,
    refId: subroom.id,
    name: subroom.name,
    title: subroom.name,
    items: [
      ...notes.filter(note => (note.subroomId || "") === subroom.id).map(note => item("note", note)),
      ...wrongQuestions.filter(card => (card.subroomId || "") === subroom.id).map(card => item("wrong", card))
    ]
  }));
  const loose = [
    ...notes.filter(note => !known.has(note.subroomId || "")).map(note => item("note", note)),
    ...wrongQuestions.filter(card => !known.has(card.subroomId || "")).map(card => item("wrong", card))
  ];
  const nodes = new Map();
  for (const group of groups) {
    nodes.set(group.id, { ...group, kind: "subroom" });
    for (const entry of group.items) nodes.set(entry.id, entry);
  }
  for (const entry of loose) nodes.set(entry.id, entry);
  return { groups, loose, nodes };
}

export default function LogicMap({ roomName, color, subrooms, notes, wrongQuestions, links = [], linksStatus = "", onOpenNote, onOpenWrong, onOpenSubroom, onLinksChange }) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const [webgl] = useState(() => hasWebGL());
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [source, setSource] = useState(null);
  const [pending, setPending] = useState(null);
  const [linkLabel, setLinkLabel] = useState("");
  const [hovered, setHovered] = useState(null);

  const graph = useMemo(() => buildMapGraph({ subrooms, notes, wrongQuestions }), [subrooms, notes, wrongQuestions]);
  const validLinks = useMemo(() => links.filter(link => graph.nodes.has(link.from) && graph.nodes.has(link.to)), [links, graph]);
  const graphKey = useMemo(() => JSON.stringify([
    roomName,
    color,
    graph.groups.map(group => [group.id, group.name, group.items.map(entry => [entry.id, entry.title])]),
    graph.loose.map(entry => [entry.id, entry.title]),
    validLinks.map(link => [link.from, link.to, link.label])
  ]), [roomName, color, graph, validLinks]);

  const stateRef = useRef({});
  stateRef.current = { connecting, source, graph, onOpenNote, onOpenWrong, onOpenSubroom, notes, wrongQuestions };

  function handlePick(node) {
    const state = stateRef.current;
    if (state.connecting) {
      if (!state.source) {
        setSource(node);
      } else if (state.source.id === node.id) {
        setSource(null);
      } else {
        setPending({ from: state.source, to: node });
        setLinkLabel("");
      }
      return;
    }
    if (node.kind === "note") {
      const note = state.notes.find(entry => entry.id === node.refId);
      if (note) state.onOpenNote?.(note);
    } else if (node.kind === "wrong") {
      const card = state.wrongQuestions.find(entry => entry.id === node.refId);
      if (card) state.onOpenWrong?.(card);
    } else if (node.kind === "subroom") {
      state.onOpenSubroom?.(node.refId);
    }
  }
  const pickRef = useRef(handlePick);
  pickRef.current = handlePick;

  useEffect(() => {
    if (!webgl) return undefined;
    let cancelled = false;
    let scene = null;
    let resizeObserver = null;
    let visibility = null;
    import("../three/moleculeMap.js")
      .then(({ mountMoleculeMap }) => {
        const host = hostRef.current;
        if (cancelled || !host) return;
        scene = mountMoleculeMap(host, {
          onSelect: node => pickRef.current(node),
          onHover: node => setHovered(node)
        });
        sceneRef.current = scene;
        const resize = () => {
          const box = host.getBoundingClientRect();
          scene.resize(Math.max(1, box.width), Math.max(1, box.height));
        };
        resize();
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(host);
        visibility = new IntersectionObserver(([entry]) => scene.setVisible(entry.isIntersecting));
        visibility.observe(host);
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      visibility?.disconnect();
      scene?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [webgl]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.setGraph({ room: { name: roomName, color }, groups: graph.groups, loose: graph.loose, links: validLinks });
    // graphKey covers every value the scene draws.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, graphKey]);

  useEffect(() => {
    sceneRef.current?.setSource(source?.id || null);
  }, [source, ready, graphKey]);

  useEffect(() => {
    if (!connecting) return undefined;
    function handleKey(event) {
      if (event.key === "Escape" && !pending) {
        setSource(null);
        setConnecting(false);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [connecting, pending]);

  function toggleConnecting() {
    setConnecting(value => !value);
    setSource(null);
    setPending(null);
  }

  function saveLink(event) {
    event.preventDefault();
    if (!pending) return;
    const label = linkLabel.trim() || "related to";
    onLinksChange?.([...validLinks, { id: makeLinkId(), from: pending.from.id, to: pending.to.id, label, createdAt: new Date().toISOString() }]);
    setPending(null);
    setSource(null);
  }

  function removeLink(id) {
    onLinksChange?.(validLinks.filter(link => link.id !== id));
  }

  const noteCount = notes.length;
  const wrongCount = wrongQuestions.length;
  const nodeName = id => graph.nodes.get(id)?.fullTitle || graph.nodes.get(id)?.name || "Removed item";
  const hint = !connecting
    ? "Drag to rotate · Scroll to zoom · Click an atom to open it"
    : source
      ? `Linking from "${shorten(source.fullTitle || source.name, 40)}" — pick the atom it connects to (Esc to stop)`
      : "Connect mode — pick the first atom";

  return (
    <section className={`logic-map${connecting ? " is-connecting" : ""}`} aria-label={`${roomName} logic map`}>
      <div className="logic-map-head">
        <div className="map-legend">
          <span><i className="legend-dot legend-dot--subroom" />{subrooms.length} sub-rooms</span>
          <span><i className="legend-dot legend-dot--note" />{noteCount} notes</span>
          <span><i className="legend-dot legend-dot--wrong" />{wrongCount} wrong questions</span>
          <span><i className="legend-dot legend-dot--link" />{validLinks.length} links</span>
        </div>
        {webgl ? (
          <div className="map-tools">
            <button type="button" className={connecting ? "is-on" : ""} onClick={toggleConnecting}>{connecting ? "Done connecting" : "Connect"}</button>
            <button type="button" onClick={() => sceneRef.current?.recenter()}>Recenter</button>
          </div>
        ) : null}
      </div>

      {webgl ? (
        <div className="logic-map-stage">
          <div className="logic-map-canvas" ref={hostRef} />
          {!ready ? <div className="map-loading">Assembling molecule…</div> : null}
          {ready && !noteCount && !wrongCount && !subrooms.length ? <div className="map-empty">Create a sub-room, then add notes. They appear here as atoms automatically.</div> : null}
          {hovered && hovered.kind !== "room" && !connecting ? (
            <div className="map-hover-card">
              <small>{hovered.kind === "note" ? "Study note" : hovered.kind === "wrong" ? "Wrong question" : "Sub-room"}</small>
              <b>{hovered.fullTitle || hovered.name}</b>
            </div>
          ) : null}
          <p className="map-hint">{hint}</p>
          {pending ? (
            <form className="link-dialog" onSubmit={saveLink}>
              <div className="eyebrow">New link</div>
              <p><b>{shorten(pending.from.fullTitle || pending.from.name, 42)}</b><span>→</span><b>{shorten(pending.to.fullTitle || pending.to.name, 42)}</b></p>
              <label htmlFor="link-label">How are they related?</label>
              <input id="link-label" list="link-suggestions" value={linkLabel} onChange={event => setLinkLabel(event.target.value)} placeholder="leads to" autoFocus maxLength={40} />
              <datalist id="link-suggestions">{LINK_SUGGESTIONS.map(item => <option key={item} value={item} />)}</datalist>
              <div className="buttons">
                <button className="primary" type="submit">Save link</button>
                <button type="button" onClick={() => { setPending(null); setSource(null); }}>Cancel</button>
              </div>
            </form>
          ) : null}
          {connecting && validLinks.length ? (
            <div className="link-list">
              <div className="eyebrow">Your links</div>
              {validLinks.map(link => (
                <div key={link.id} className="link-row">
                  <span>{shorten(nodeName(link.from), 22)} <em>{link.label}</em> {shorten(nodeName(link.to), 22)}</span>
                  <button type="button" aria-label="Remove link" onClick={() => removeLink(link.id)}>×</button>
                </div>
              ))}
            </div>
          ) : null}
          {linksStatus ? <p className="map-status">{linksStatus}</p> : null}
        </div>
      ) : (
        <div className="logic-map-flat">
          {graph.groups.map(group => (
            <div key={group.id} className="flat-group">
              <button type="button" className="flat-subroom" onClick={() => onOpenSubroom?.(group.refId)}>{group.name}</button>
              <div className="flat-items">
                {group.items.map(entry => (
                  <button type="button" key={entry.id} className={`flat-item flat-item--${entry.kind}`} onClick={() => handlePick(entry)}>{entry.title}</button>
                ))}
              </div>
            </div>
          ))}
          <p className="map-hint">3D view needs WebGL, which this browser has turned off.</p>
        </div>
      )}
    </section>
  );
}
