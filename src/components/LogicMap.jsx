import { useEffect, useMemo, useRef, useState } from "react";
import { hasWebGL } from "../three/support.js";

const LINK_SUGGESTIONS = ["leads to", "requires", "part of", "example of", "contrasts with", "related to", "causes"];

const NONE = [];

const makeLinkId = () => `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function shorten(value, max = 34) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text || "Untitled";
}

const atomOf = (kind, record) => ({ id: `${kind}:${record.id}`, kind, refId: record.id, title: shorten(record.title), fullTitle: record.title || "Untitled" });

function indexNodes(groups, loose) {
  const nodes = new Map();
  for (const group of groups) {
    nodes.set(group.id, group);
    for (const entry of group.items) nodes.set(entry.id, entry);
  }
  for (const entry of loose) nodes.set(entry.id, entry);
  return { groups, loose, nodes };
}

// Builds the molecule from saved data: room → sub-rooms → notes and wrong
// questions; notes and wrong questions not in a sub-room sit around the room.
// links: [{ id, from, to, label }] using node ids like "note:<id>".
function buildMapGraph({ subrooms = [], notes = [], wrongQuestions = [] }) {
  const known = new Set(subrooms.map(item => item.id));
  const groups = subrooms.map(subroom => ({
    id: `subroom:${subroom.id}`,
    kind: "subroom",
    refId: subroom.id,
    name: subroom.name,
    title: subroom.name,
    items: [
      ...notes.filter(note => (note.subroomId || "") === subroom.id).map(note => atomOf("note", note)),
      ...wrongQuestions.filter(card => (card.subroomId || "") === subroom.id).map(card => atomOf("wrong", card))
    ]
  }));
  const loose = [
    ...notes.filter(note => !known.has(note.subroomId || "")).map(note => atomOf("note", note)),
    ...wrongQuestions.filter(card => !known.has(card.subroomId || "")).map(card => atomOf("wrong", card))
  ];
  return indexNodes(groups, loose);
}

// The same molecule one level up: division → rooms → each room's sub-rooms
// and the notes and wrong questions filed in the room itself.
function buildDivisionGraph({ rooms = [], notes = [], wrongQuestions = [] }) {
  const groups = rooms.map(room => {
    const children = room.children || [];
    const known = new Set(children.map(child => child.id));
    const inRoom = record => record.roomId === room.id && !known.has(record.subroomId || "");
    return {
      id: `room:${room.id}`,
      kind: "room",
      refId: room.id,
      name: room.name,
      title: room.name,
      items: [
        ...children.map(child => ({ id: `subroom:${child.id}`, kind: "subroom", refId: child.id, parentId: room.id, title: shorten(child.name), fullTitle: child.name || "Sub-room" })),
        ...notes.filter(inRoom).map(note => atomOf("note", note)),
        ...wrongQuestions.filter(inRoom).map(card => atomOf("wrong", card))
      ]
    };
  });
  return indexNodes(groups, []);
}

const KIND_LABELS = { room: "Room", subroom: "Sub-room", note: "Study note", wrong: "Wrong question" };

// level "room": the room at the centre, its sub-rooms around it.
// level "division": the division at the centre, its rooms around it; give
// `rooms` instead of `subrooms`. onOpenSubroom gets (subroomId, roomId).
export default function LogicMap({ level = "room", centerName, color, subrooms = NONE, rooms = NONE, notes, wrongQuestions, links = NONE, linksStatus = "", onOpenNote, onOpenWrong, onOpenRoom, onOpenSubroom, onLinksChange }) {
  const division = level === "division";
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const [webgl] = useState(() => hasWebGL());
  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [source, setSource] = useState(null);
  const [pending, setPending] = useState(null);
  const [linkLabel, setLinkLabel] = useState("");
  const [hovered, setHovered] = useState(null);

  const graph = useMemo(() => division ? buildDivisionGraph({ rooms, notes, wrongQuestions }) : buildMapGraph({ subrooms, notes, wrongQuestions }), [division, rooms, subrooms, notes, wrongQuestions]);
  const validLinks = useMemo(() => links.filter(link => graph.nodes.has(link.from) && graph.nodes.has(link.to)), [links, graph]);
  const graphKey = useMemo(() => JSON.stringify([
    centerName,
    color,
    graph.groups.map(group => [group.id, group.name, group.items.map(entry => [entry.id, entry.title])]),
    graph.loose.map(entry => [entry.id, entry.title]),
    validLinks.map(link => [link.from, link.to, link.label])
  ]), [centerName, color, graph, validLinks]);

  const stateRef = useRef({});
  stateRef.current = { connecting, source, graph, onOpenNote, onOpenWrong, onOpenRoom, onOpenSubroom, notes, wrongQuestions };

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
    } else if (node.kind === "room") {
      state.onOpenRoom?.(node.refId);
    } else if (node.kind === "subroom") {
      state.onOpenSubroom?.(node.refId, node.parentId);
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
    sceneRef.current?.setGraph({ room: { name: centerName, color }, groups: graph.groups, loose: graph.loose, links: validLinks, weaveGroups: !division });
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

  // A division map draws only what sits directly in each room, so it counts
  // what it draws; a room map draws everything in the room.
  const drawn = kind => graph.groups.reduce((sum, group) => sum + group.items.filter(entry => entry.kind === kind).length, 0);
  const noteCount = division ? drawn("note") : notes.length;
  const wrongCount = division ? drawn("wrong") : wrongQuestions.length;
  const subroomCount = division ? drawn("subroom") : subrooms.length;
  const empty = division ? !rooms.length : !noteCount && !wrongCount && !subroomCount;
  const inRooms = division ? " in rooms" : "";
  const nodeName = id => graph.nodes.get(id)?.fullTitle || graph.nodes.get(id)?.name || "Removed item";
  const hint = !connecting
    ? "Drag to rotate · Scroll to zoom · Click an atom to open it"
    : source
      ? `Linking from "${shorten(source.fullTitle || source.name, 40)}" — pick the atom it connects to (Esc to stop)`
      : "Connect mode — pick the first atom";

  return (
    <section className={`logic-map${connecting ? " is-connecting" : ""}`} aria-label={`${centerName} logic map`}>
      <div className="logic-map-head">
        <div className="map-legend">
          {division ? <span><i className="legend-dot legend-dot--subroom" />{rooms.length} rooms</span> : null}
          <span><i className={`legend-dot legend-dot--subroom${division ? " legend-dot--small" : ""}`} />{subroomCount} sub-rooms</span>
          <span><i className="legend-dot legend-dot--note" />{noteCount} notes{inRooms}</span>
          <span><i className="legend-dot legend-dot--wrong" />{wrongCount} wrong questions{inRooms}</span>
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
          {ready && empty ? <div className="map-empty">{division ? "Create a room, then add notes. They appear here as atoms automatically." : "Add notes here or in a sub-room. They appear here as atoms automatically."}</div> : null}
          {hovered && hovered.kind !== "core" && !connecting ? (
            <div className="map-hover-card">
              <small>{KIND_LABELS[hovered.kind] || "Sub-room"}</small>
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
              <button type="button" className="flat-subroom" onClick={() => handlePick(group)}>{group.name}</button>
              <div className="flat-items">
                {group.items.map(entry => (
                  <button type="button" key={entry.id} className={`flat-item flat-item--${entry.kind}`} onClick={() => handlePick(entry)}>{entry.title}</button>
                ))}
              </div>
            </div>
          ))}
          {graph.loose.length ? (
            <div className="flat-items">
              {graph.loose.map(entry => (
                <button type="button" key={entry.id} className={`flat-item flat-item--${entry.kind}`} onClick={() => handlePick(entry)}>{entry.title}</button>
              ))}
            </div>
          ) : null}
          <p className="map-hint">3D view needs WebGL, which this browser has turned off.</p>
        </div>
      )}
    </section>
  );
}
