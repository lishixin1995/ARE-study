import { useEffect, useRef, useState } from "react";

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// Tree menu for one division: rooms, each expanding to its sub-rooms.
// focusRoomId / focusSubroomId open and mark the branch the user clicked on
// the map.
// onHighlight(mapNodeId | "") lights the matching star while a row is hovered.
export default function DivisionTree({ code, label, name, color, rooms = [], status = "ready", notes = [], focusRoomId = "", focusSubroomId = "", onClose, onEnter, onOpenRoom, onOpenSubroom, onRetry, onHighlight }) {
  const [open, setOpen] = useState(() => new Set(focusRoomId ? [focusRoomId] : []));
  const panelRef = useRef(null);

  useEffect(() => {
    setOpen(new Set(focusRoomId ? [focusRoomId] : []));
  }, [code, focusRoomId]);

  useEffect(() => {
    panelRef.current?.querySelector(".tree-close")?.focus({ preventScroll: true });
  }, [code]);

  function toggle(roomId) {
    setOpen(prev => {
      const next = new Set(prev);
      if (next.has(roomId)) next.delete(roomId);
      else next.add(roomId);
      return next;
    });
  }

  const subroomCount = rooms.reduce((sum, room) => sum + (room.children?.length || 0), 0);
  const notesIn = (roomId, subroomId) => notes.filter(note => note.roomId === roomId && (subroomId === undefined || (note.subroomId || "") === subroomId)).length;

  return (
    <aside className="division-tree" ref={panelRef} style={{ "--atom": color }} aria-label={`${label} rooms`}>
      <header className="tree-head">
        <div>
          <div className="eyebrow">Division</div>
          <h2><span className="tree-code">{label}</span> {name}</h2>
          <p>{status === "ready" ? `${plural(rooms.length, "room")} · ${plural(subroomCount, "sub-room")} · ${plural(notes.length, "note")}` : status === "error" ? "Rooms couldn't load." : "Loading rooms…"}</p>
        </div>
        <button type="button" className="tree-close" aria-label="Close menu" onClick={onClose}>×</button>
      </header>

      {status === "error" ? (
        <button type="button" className="mini-action" onClick={onRetry}>Try again</button>
      ) : status === "loading" ? (
        <div className="tree-loading" aria-hidden="true"><span /><span /><span /></div>
      ) : rooms.length ? (
        <ul className="tree">
          {rooms.map((room, index) => {
            const children = room.children || [];
            const isOpen = open.has(room.id);
            const isFocus = room.id === focusRoomId;
            return (
              <li key={room.id} className={`tree-room${isOpen ? " is-open" : ""}${isFocus ? " is-focus" : ""}`} style={{ "--i": index }}>
                <div className="tree-row" onMouseEnter={() => onHighlight?.(`room:${room.id}`)} onMouseLeave={() => onHighlight?.("")}>
                  <button type="button" className="tree-toggle" aria-expanded={isOpen} onClick={() => toggle(room.id)}>
                    <span className="tree-chevron" aria-hidden="true" />
                    <span className="tree-name">{room.name}</span>
                    <span className="tree-count">{plural(children.length, "sub-room")}</span>
                  </button>
                  <button type="button" className="tree-open" aria-label={`Open ${room.name}`} title="Open room" onClick={() => onOpenRoom(room.id)}>→</button>
                </div>
                <div className="tree-children" {...(isOpen ? {} : { inert: "" })}>
                  <ul>
                    {children.length ? children.map(child => (
                      <li key={child.id}>
                        <button type="button" className={`tree-sub${child.id === focusSubroomId ? " is-focus" : ""}`} onMouseEnter={() => onHighlight?.(`subroom:${child.id}`)} onMouseLeave={() => onHighlight?.("")} onClick={() => onOpenSubroom(room.id, child.id)}>
                          <span className="tree-name">{child.name}</span>
                          <span className="tree-count">{plural(notesIn(room.id, child.id), "note")}</span>
                        </button>
                      </li>
                    )) : <li className="tree-empty">No sub-rooms yet</li>}
                  </ul>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tree-empty">No rooms yet. Enter the division to create your first room.</p>
      )}

      <footer className="tree-foot">
        <button type="button" className="primary" onClick={onEnter}>Enter {label} map →</button>
      </footer>
    </aside>
  );
}
