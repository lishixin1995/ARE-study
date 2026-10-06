import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TREE_BESIDE_BREAKPOINT } from "../lib/coverLayout.js";

const LEAF_SPACING = 50; // vertical gap between sub-rooms on the fan
const MAX_LEAVES = 11;

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Horizontal S-curve, like a branch leaving one node and arriving level at the next.
function branch(x0, y0, x1, y1) {
  const mid = x0 + (x1 - x0) * 0.55;
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} C${mid.toFixed(1)} ${y0.toFixed(1)} ${mid.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

function setRef(map, key) {
  return element => {
    if (element) map.set(key, element);
    else map.delete(key);
  };
}

// The menu that grows out of a division's star: branches to its rooms, and
// the chosen room fans out to its sub-rooms. Beside the map on wide screens;
// a vertical branch list under the map on narrow ones.
// anchorRef holds the division star's live screen position.
export default function DivisionTree({ code, label, name, color, rooms = [], status = "ready", notes = [], focusRoomId = "", focusSubroomId = "", anchorRef, onClose, onEnter, onOpenRoom, onOpenSubroom, onRetry, onHighlight }) {
  const rootRef = useRef(null);
  const rootLabelRef = useRef(null);
  const columnRef = useRef(null);
  const itemRefs = useRef(new Map()); // room id -> room item (dot, name, open arrow)
  const curveRefs = useRef(new Map());
  const [wide, setWide] = useState(true);
  const [layout, setLayout] = useState({ width: 0, height: 0, cards: new Map(), column: null });

  const pickDefault = useCallback(() => focusRoomId || rooms.find(room => room.children?.length)?.id || rooms[0]?.id || "", [focusRoomId, rooms]);
  const [activeRoomId, setActiveRoomId] = useState(pickDefault);
  useEffect(() => {
    setActiveRoomId(pickDefault());
    // Re-pick when the division, the clicked room, or the loaded rooms change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, focusRoomId, status]);

  const activeRoom = rooms.find(room => room.id === activeRoomId) || null;
  const notesIn = (roomId, subroomId) => notes.filter(note => note.roomId === roomId && (subroomId === undefined || (note.subroomId || "") === subroomId)).length;
  const subroomCount = rooms.reduce((sum, room) => sum + (room.children?.length || 0), 0);

  // Measure the cards (relative to the menu) so branches can reach them.
  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    setWide(box.width >= TREE_BESIDE_BREAKPOINT);
    const cards = new Map();
    for (const [roomId, element] of itemRefs.current) {
      const rect = element.getBoundingClientRect();
      cards.set(roomId, { left: rect.left - box.left, right: rect.right - box.left, mid: rect.top - box.top + rect.height / 2 });
    }
    const columnRect = columnRef.current?.getBoundingClientRect();
    const column = columnRect ? { top: columnRect.top - box.top, bottom: columnRect.bottom - box.top } : null;
    setLayout({ width: box.width, height: box.height, cards, column });
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, rooms, activeRoomId, wide, status]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    itemRefs.current.get(activeRoomId)?.querySelector(".tree-node")?.focus({ preventScroll: true });
    // Only when the menu opens for a division.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, status]);

  // Every frame: follow the star with the root label and the room branches.
  useEffect(() => {
    if (!wide) return undefined;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const width = layout.width;
      const anchor = anchorRef?.current || { x: width * 0.3, y: layout.height / 2, extent: 8 };
      const rootLabel = rootLabelRef.current;
      if (rootLabel) {
        // Below the star, but never off the edge of the map.
        const halfWidth = rootLabel.offsetWidth / 2;
        const x = Math.min(Math.max(anchor.x, halfWidth + 16), width - halfWidth - 16);
        const y = Math.min(anchor.y + anchor.extent + 20, layout.height - rootLabel.offsetHeight - 16);
        rootLabel.style.transform = `translate(${x.toFixed(1)}px, ${Math.max(16, y).toFixed(1)}px) translateX(-50%)`;
      }
      const startX = anchor.x + anchor.extent + 4;
      for (const [roomId, path] of curveRefs.current) {
        const card = layout.cards.get(roomId);
        const hidden = !card || (layout.column && (card.mid < layout.column.top + 8 || card.mid > layout.column.bottom - 8));
        path.style.visibility = hidden ? "hidden" : "";
        if (!hidden) path.setAttribute("d", branch(startX, anchor.y, card.left - 1, card.mid));
      }
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [wide, layout, anchorRef]);

  // Sub-rooms of the chosen room, fanned out on an arc to the right.
  const leaves = useMemo(() => {
    const card = layout.cards.get(activeRoomId);
    if (!wide || !card || !activeRoom) return [];
    const children = activeRoom.children || [];
    const shown = children.slice(0, MAX_LEAVES);
    const extra = children.length - shown.length;
    const items = shown.map(child => ({ kind: "subroom", id: child.id, name: child.name, meta: plural(notesIn(activeRoom.id, child.id), "note") }));
    if (extra > 0) items.push({ kind: "more", id: "more", name: `+${extra} more`, meta: "Open room to see all" });
    if (!items.length) items.push({ kind: "empty", id: "empty", name: "No sub-rooms yet", meta: "Open the room to add one" });
    const centerY = layout.height / 2;
    const spacing = Math.min(LEAF_SPACING, (layout.height * 0.8) / Math.max(1, items.length));
    const radius = Math.max(layout.height * 0.55, (items.length * spacing) / 1.6);
    const peakX = Math.min(card.right + 150, layout.width - 250);
    return items.map((item, index) => {
      const offset = (index - (items.length - 1) / 2) * spacing;
      const angle = Math.asin(Math.max(-0.95, Math.min(0.95, offset / radius)));
      const x = peakX - radius * (1 - Math.cos(angle));
      const y = centerY + offset;
      return { ...item, x, y, fade: 1 - 0.5 * (offset / radius) ** 2, from: { x: card.right + 8, y: card.mid } };
    });
    // notesIn depends on notes/activeRoom, both covered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide, layout, activeRoomId, activeRoom, notes]);

  function chooseRoom(roomId) {
    setActiveRoomId(roomId);
    onHighlight?.(`room:${roomId}`);
  }

  function openLeaf(leaf) {
    if (leaf.kind === "subroom") onOpenSubroom(activeRoom.id, leaf.id);
    else onOpenRoom(activeRoom.id);
  }

  const stats = status === "ready"
    ? `${plural(rooms.length, "room")} · ${plural(subroomCount, "sub-room")} · ${plural(notes.length, "note")}`
    : status === "error" ? "Rooms couldn't load." : "Loading rooms…";

  const rootLabel = (
    <div className="tree-root" ref={rootLabelRef}>
      <div className="eyebrow">Division</div>
      <h2>{label}</h2>
      <p className="tree-root-name">{name}</p>
      <p className="tree-root-stats">{stats}</p>
      <div className="tree-root-actions">
        {status === "error" ? <button type="button" className="ghost-button" onClick={onRetry}>Try again</button> : null}
        <button type="button" className="ghost-button" onClick={onEnter}>Enter {label} map →</button>
        <button type="button" className="tree-close" aria-label="Close menu" onClick={onClose}>×</button>
      </div>
    </div>
  );

  // A room on the tree: a dot where its branch arrives, its name, and an
  // arrow that opens the room. Choosing it fans out its sub-rooms.
  const card = (room, index) => {
    const children = room.children || [];
    const active = room.id === activeRoomId;
    return (
      <div key={room.id} ref={setRef(itemRefs.current, room.id)} className={`tree-room-item${active ? " is-active" : ""}${room.id === focusRoomId ? " is-focus" : ""}`} style={{ "--i": index }}>
        <button
          type="button"
          className="tree-node"
          aria-pressed={active}
          onClick={() => chooseRoom(room.id)}
          onMouseEnter={() => onHighlight?.(`room:${room.id}`)}
          onMouseLeave={() => onHighlight?.("")}
        >
          <span className="tree-leaf-dot" aria-hidden="true" />
          <span className="tree-leaf-text">
            <b>{room.name}</b>
            <small>{plural(children.length, "sub-room")} · {plural(notesIn(room.id), "note")}</small>
          </span>
        </button>
        <button type="button" className="tree-open-link" aria-label={`Open ${room.name}`} title="Open room" onClick={() => onOpenRoom(room.id)}>→</button>
      </div>
    );
  };

  if (!wide) {
    return (
      <div className="tree-map is-stacked" ref={rootRef} style={{ "--atom": color }}>
        {rootLabel}
        {status === "loading" ? <div className="tree-skeleton" aria-hidden="true"><span /><span /><span /></div> : null}
        {status === "ready" && !rooms.length ? <p className="tree-empty">No rooms yet. Enter the division to create your first room.</p> : null}
        <ul className="tree-branches">
          {rooms.map((room, index) => (
            <li key={room.id} className={room.id === activeRoomId ? "is-active" : ""}>
              {card(room, index)}
              {room.id === activeRoomId ? (
                <ul className="tree-twigs">
                  {(room.children || []).length ? room.children.map(child => (
                    <li key={child.id}>
                      <button type="button" className={`tree-leaf${child.id === focusSubroomId ? " is-focus" : ""}`} onClick={() => onOpenSubroom(room.id, child.id)}>
                        <span className="tree-leaf-dot" aria-hidden="true" />
                        <span className="tree-leaf-text"><b>{child.name}</b><small>{plural(notesIn(room.id, child.id), "note")}</small></span>
                      </button>
                    </li>
                  )) : <li className="tree-empty">No sub-rooms yet</li>}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="tree-map is-beside" ref={rootRef} style={{ "--atom": color }}>
      <svg className="tree-curves" width={layout.width} height={layout.height} aria-hidden="true">
        {rooms.map((room, index) => (
          <path
            key={`${code}-${room.id}`}
            ref={setRef(curveRefs.current, room.id)}
            className={`tree-curve tree-curve--room${room.id === activeRoomId ? " is-active" : ""}`}
            pathLength="1"
            style={{ "--i": index }}
          />
        ))}
        {leaves.map((leaf, index) => (
          <path
            key={`${activeRoomId}-${leaf.id}`}
            className="tree-curve tree-curve--leaf"
            pathLength="1"
            d={branch(leaf.from.x, leaf.from.y, leaf.x - 5, leaf.y)}
            style={{ "--i": index, opacity: leaf.fade }}
          />
        ))}
      </svg>

      {rootLabel}

      <div className="tree-column" ref={columnRef} onScroll={measure}>
        {status === "loading" ? <div className="tree-skeleton" aria-hidden="true"><span /><span /><span /><span /></div> : null}
        {status === "ready" && !rooms.length ? <p className="tree-empty">No rooms yet. Enter the division to create your first room.</p> : null}
        {rooms.map(card)}
      </div>

      <div className="tree-fan" key={activeRoomId}>
        {leaves.map((leaf, index) => (
          <button
            key={leaf.id}
            type="button"
            className={`tree-leaf tree-leaf--${leaf.kind}${leaf.id === focusSubroomId ? " is-focus" : ""}`}
            style={{ left: `${leaf.x.toFixed(1)}px`, top: `${leaf.y.toFixed(1)}px`, "--i": index, "--fade": leaf.fade }}
            onClick={() => openLeaf(leaf)}
            onMouseEnter={() => leaf.kind === "subroom" && onHighlight?.(`subroom:${leaf.id}`)}
            onMouseLeave={() => onHighlight?.("")}
          >
            <span className="tree-leaf-dot" aria-hidden="true" />
            <span className="tree-leaf-text"><b>{leaf.name}</b><small>{leaf.meta}</small></span>
          </button>
        ))}
      </div>
    </div>
  );
}
