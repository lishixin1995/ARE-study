// Builds the cover constellation from saved data: one cluster per division
// (division hub -> rooms -> sub-rooms -> notes), placed in 3D. Positions are
// seeded from each item's id, so adding a note doesn't reshuffle the map.
// Nearby points in a cluster are also linked into triangles ("mesh" links)
// to give the network its faceted look.

const NOTES_PER_DIVISION = 36;
const MESH_NEIGHBORS = 2;
const MESH_MAX_DISTANCE = 1.25;
const TRIANGLES_PER_CLUSTER = 70;

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// mulberry32, seeded from a string.
export function seededRandom(seed) {
  let state = hashString(String(seed)) || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function add(a, b, scale = 1) {
  return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function randomDirection(random) {
  const u = random() * 2 - 1;
  const theta = random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(theta), u, s * Math.sin(theta)];
}

// Point placed around `center`, leaning away from `away` so clusters grow
// outward instead of folding back on themselves.
function scatter(seed, center, awayFrom, minDist, maxDist, lean = 1) {
  const random = seededRandom(seed);
  const outward = normalize(sub(center, awayFrom));
  const direction = normalize(add(randomDirection(random), outward, lean));
  return add(center, direction, minDist + random() * (maxDist - minDist));
}

// Rooms for a division: the saved room tree when loaded, otherwise whatever
// rooms the division's notes mention.
function roomsFor(code, trees, notes) {
  if (Array.isArray(trees[code]) && trees[code].length) return trees[code];
  const rooms = new Map();
  for (const note of notes) {
    if (note.division !== code || !note.roomId) continue;
    if (!rooms.has(note.roomId)) rooms.set(note.roomId, { id: note.roomId, name: note.roomName || "Room", children: [] });
    const room = rooms.get(note.roomId);
    if (note.subroomId && !room.children.some(child => child.id === note.subroomId)) {
      room.children.push({ id: note.subroomId, name: note.subroomName || "Sub-room" });
    }
  }
  return [...rooms.values()];
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// divisions: [{ code, label, name, color }] in display order.
export function buildCoverGraph({ divisions = [], trees = {}, notes = [] }) {
  const nodes = [];
  const links = [];
  const byId = new Map();
  const linkKeys = new Set();

  const addNode = node => {
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };
  const addLink = (a, b, kind) => {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a === b || linkKeys.has(key)) return;
    linkKeys.add(key);
    links.push({ a, b, kind });
  };

  addNode({ id: "core", kind: "core", division: "", label: "ARE Study Vault", sublabel: plural(divisions.length, "division"), color: "#e8f2ff", size: 10, position: [0, 0, 0] });

  divisions.forEach((division, index) => {
    const { code, label, name, color } = division;
    const random = seededRandom(`hub:${code}`);
    const angle = -Math.PI / 2 + ((index + 0.5) * Math.PI * 2) / divisions.length;
    const hubPosition = [
      Math.cos(angle) * 3.2 * (0.94 + random() * 0.12),
      Math.sin(angle) * 1.9 * (0.9 + random() * 0.2),
      (random() - 0.5) * 1.6
    ];
    const divisionNotes = notes
      .filter(note => note.division === code)
      .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    const rooms = roomsFor(code, trees, notes);
    const hubId = `division:${code}`;
    addNode({
      id: hubId,
      kind: "division",
      division: code,
      label,
      sublabel: `${name} · ${plural(rooms.length, "room")} · ${plural(divisionNotes.length, "note")}`,
      color,
      size: 10 + Math.min(4, Math.sqrt(divisionNotes.length)),
      position: hubPosition
    });
    addLink("core", hubId, "bridge");

    const roomPositions = new Map();
    const subroomPositions = new Map();
    for (const room of rooms) {
      const roomNotes = divisionNotes.filter(note => note.roomId === room.id).length;
      const roomPosition = scatter(`room:${room.id}`, hubPosition, [0, 0, 0], 0.72, 1.08, 1.15);
      const roomId = `room:${room.id}`;
      roomPositions.set(room.id, roomPosition);
      const children = Array.isArray(room.children) ? room.children : [];
      addNode({
        id: roomId,
        kind: "room",
        division: code,
        roomId: room.id,
        label: room.name,
        sublabel: `${label} · ${plural(children.length, "sub-room")} · ${plural(roomNotes, "note")}`,
        color,
        size: 5.5 + Math.min(2.5, Math.sqrt(roomNotes) * 0.7),
        position: roomPosition
      });
      addLink(hubId, roomId, "tree");
      for (const child of children) {
        const subNotes = divisionNotes.filter(note => note.roomId === room.id && (note.subroomId || "") === child.id).length;
        const subPosition = scatter(`sub:${child.id}`, roomPosition, hubPosition, 0.32, 0.48, 0.9);
        subroomPositions.set(child.id, subPosition);
        const subId = `subroom:${child.id}`;
        addNode({
          id: subId,
          kind: "subroom",
          division: code,
          roomId: room.id,
          subroomId: child.id,
          label: child.name,
          sublabel: `${label} / ${room.name} · ${plural(subNotes, "note")}`,
          color,
          size: 4,
          position: subPosition
        });
        addLink(roomId, subId, "tree");
      }
    }

    for (const note of divisionNotes.slice(0, NOTES_PER_DIVISION)) {
      const subPosition = note.subroomId ? subroomPositions.get(note.subroomId) : null;
      const roomPosition = roomPositions.get(note.roomId);
      const parentId = subPosition ? `subroom:${note.subroomId}` : roomPosition ? `room:${note.roomId}` : hubId;
      const parentPosition = subPosition || roomPosition || hubPosition;
      const grandparent = subPosition ? roomPosition : roomPosition ? hubPosition : [0, 0, 0];
      const noteId = `note:${note.id}`;
      addNode({
        id: noteId,
        kind: "note",
        division: code,
        roomId: note.roomId,
        subroomId: note.subroomId || "",
        noteId: note.id,
        label: note.title || "Untitled Note",
        sublabel: [label, note.roomName, note.subroomName].filter(Boolean).join(" / "),
        color,
        size: 2.8,
        position: scatter(`note:${note.id}`, parentPosition, grandparent, 0.16, 0.26, 0.8)
      });
      addLink(parentId, noteId, "tree");
    }
  });

  // Divisions hold hands around the ring.
  divisions.forEach((division, index) => {
    const next = divisions[(index + 1) % divisions.length];
    if (next && next !== division) addLink(`division:${division.code}`, `division:${next.code}`, "bridge");
  });

  relaxClusters(nodes);

  // Plexus: link each point to its nearest neighbours in the same cluster.
  const clusters = new Map();
  for (const node of nodes) {
    if (!node.division) continue;
    if (!clusters.has(node.division)) clusters.set(node.division, []);
    clusters.get(node.division).push(node);
  }
  for (const members of clusters.values()) {
    for (const node of members) {
      const nearest = members
        .filter(other => other !== node)
        .map(other => ({ other, d: distance(node.position, other.position) }))
        .filter(item => item.d <= MESH_MAX_DISTANCE)
        .sort((a, b) => a.d - b.d)
        .slice(0, MESH_NEIGHBORS);
      for (const { other } of nearest) addLink(node.id, other.id, "mesh");
    }
  }

  // Triangles: three points of one cluster that are all linked to each other.
  const neighbors = new Map(nodes.map(node => [node.id, new Set()]));
  for (const link of links) {
    neighbors.get(link.a).add(link.b);
    neighbors.get(link.b).add(link.a);
  }
  const triangles = [];
  const perCluster = new Map();
  const seen = new Set();
  for (const link of links) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a.division || a.division !== b.division) continue;
    for (const cId of neighbors.get(a.id)) {
      if (!neighbors.get(b.id).has(cId)) continue;
      const c = byId.get(cId);
      if (c.division !== a.division) continue;
      const key = [a.id, b.id, cId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const count = perCluster.get(a.division) || 0;
      if (count >= TRIANGLES_PER_CLUSTER) continue;
      perCluster.set(a.division, count + 1);
      triangles.push({ a: a.id, b: b.id, c: cId, division: a.division });
    }
  }

  return { nodes, links, triangles, neighbors };
}

// Nudge apart points of the same cluster that landed too close together.
function relaxClusters(nodes) {
  const movable = nodes.filter(node => node.kind !== "core" && node.kind !== "division");
  const spacing = { room: 0.34, subroom: 0.22, note: 0.13 };
  for (let pass = 0; pass < 24; pass += 1) {
    for (let i = 0; i < movable.length; i += 1) {
      for (let j = i + 1; j < movable.length; j += 1) {
        const a = movable[i];
        const b = movable[j];
        if (a.division !== b.division) continue;
        const min = Math.max(spacing[a.kind], spacing[b.kind]);
        const d = distance(a.position, b.position);
        if (d >= min) continue;
        const push = normalize(d > 1e-6 ? sub(a.position, b.position) : randomDirection(seededRandom(`${a.id}${b.id}`)));
        const amount = (min - d) / 2;
        a.position = add(a.position, push, amount);
        b.position = add(b.position, push, -amount);
      }
    }
  }
}
