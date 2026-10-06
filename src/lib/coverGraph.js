// Builds the cover constellation from saved data: one 3D nebula in which each
// division (hub -> rooms -> sub-rooms -> notes) occupies its own region.
// Colors blend smoothly between regions, and a haze of small decorative
// points fills the space so the whole map reads as one mass. Positions are
// seeded from each item's id, so adding a note doesn't reshuffle the map.
// Nearby points are linked into a mesh of lines and triangles across the
// whole cloud.

const NOTES_PER_DIVISION = 36;
const HAZE_POINTS = 460;
const MESH_NEIGHBORS = 3;
const MESH_MAX_DISTANCE = 0.95;
const MAX_TRIANGLES = 520;
// Half-size of the nebula along x, y and z.
const CLOUD = [3.1, 2.1, 1.9];

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

// Pull a point back inside the nebula's ellipsoid if it strayed out.
function keepInside(point, margin = 1) {
  const scaled = Math.hypot(point[0] / CLOUD[0], point[1] / CLOUD[1], point[2] / CLOUD[2]);
  if (scaled <= margin) return point;
  const factor = margin / scaled;
  return [point[0] * factor, point[1] * factor, point[2] * factor];
}

// Point placed around `center`, leaning away from `awayFrom` so branches
// spread out instead of folding back on themselves.
function scatter(seed, center, awayFrom, minDist, maxDist, lean = 1) {
  const random = seededRandom(seed);
  const outward = normalize(sub(center, awayFrom));
  const direction = normalize(add(randomDirection(random), outward, lean));
  return keepInside(add(center, direction, minDist + random() * (maxDist - minDist)), 1.05);
}

// ---- Colors: blend hues (not RGB) so in-between colors stay vivid. ----

function hexToHsl(hex) {
  const value = parseInt(String(hex).replace("#", ""), 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex([h, s, l]) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const toHex = value => Math.round((value + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Weighted blend of colors on the hue circle.
export function blendColors(entries) {
  let x = 0;
  let y = 0;
  let s = 0;
  let l = 0;
  let total = 0;
  for (const { hsl, weight } of entries) {
    const angle = (hsl[0] * Math.PI) / 180;
    x += Math.cos(angle) * hsl[1] * weight;
    y += Math.sin(angle) * hsl[1] * weight;
    s += hsl[1] * weight;
    l += hsl[2] * weight;
    total += weight;
  }
  if (!total) return "#ffffff";
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return hslToHex([hue, Math.min(1, s / total), Math.min(0.85, l / total)]);
}

// Hubs sit on a twisted, uneven loop through the nebula, so neighbouring
// divisions blend into each other and no flat ring shape shows.
function hubPosition(index, count, code) {
  const random = seededRandom(`hub:${code}`);
  const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.6;
  const radius = 0.62 + random() * 0.3;
  return [
    Math.cos(angle) * CLOUD[0] * radius,
    Math.sin(angle) * CLOUD[1] * radius * 0.8 + (random() - 0.5) * 0.8,
    Math.sin(angle * 2 + 0.7) * CLOUD[2] * 0.6 + (random() - 0.5) * 0.6
  ];
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
  const hubs = [];

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

  divisions.forEach((division, index) => {
    const { code, label, name, color } = division;
    const center = hubPosition(index, divisions.length, code);
    hubs.push({ code, center, hsl: hexToHsl(color) });
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
      baseColor: color,
      size: 10 + Math.min(4, Math.sqrt(divisionNotes.length)),
      position: center
    });

    const roomPositions = new Map();
    const subroomPositions = new Map();
    for (const room of rooms) {
      const roomNotes = divisionNotes.filter(note => note.roomId === room.id).length;
      const roomPosition = scatter(`room:${room.id}`, center, [0, 0, 0], 0.7, 1.35, 0.35);
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
        baseColor: color,
        size: 5.5 + Math.min(2.5, Math.sqrt(roomNotes) * 0.7),
        position: roomPosition
      });
      addLink(hubId, roomId, "tree");
      for (const child of children) {
        const subNotes = divisionNotes.filter(note => note.roomId === room.id && (note.subroomId || "") === child.id).length;
        const subPosition = scatter(`sub:${child.id}`, roomPosition, center, 0.34, 0.55, 0.7);
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
          baseColor: color,
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
      const parentPosition = subPosition || roomPosition || center;
      const grandparent = subPosition ? roomPosition : roomPosition ? center : [0, 0, 0];
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
        baseColor: color,
        size: 2.8,
        position: scatter(`note:${note.id}`, parentPosition, grandparent, 0.16, 0.3, 0.8)
      });
      addLink(parentId, noteId, "tree");
    }
  });

  relaxStars(nodes);

  // Haze: small decorative points filling the nebula, denser near the hubs.
  if (hubs.length) {
    const random = seededRandom("nebula-haze");
    for (let i = 0; i < HAZE_POINTS; i += 1) {
      let position;
      if (random() < 0.6) {
        const hub = hubs[Math.floor(random() * hubs.length)];
        const spread = 0.55 + random() * 1.15;
        position = add(hub.center, randomDirection(random), spread * Math.cbrt(random()));
      } else {
        position = [0, 0, 0].map((_, axis) => (random() * 2 - 1) * CLOUD[axis]);
      }
      position = keepInside(position, 0.98);
      addNode({ id: `haze:${i}`, kind: "haze", division: "", size: 1.6 + random() * 1.3, position });
    }
  }

  // Color every point from the hubs around it; a point's own division counts
  // extra so rooms and notes keep their division's tint.
  for (const node of nodes) {
    const weights = hubs.map(hub => {
      const d = distance(node.position, hub.center);
      let weight = 1 / (Math.pow(d, 3) + 0.08);
      if (hub.code === node.division) weight *= node.kind === "division" ? 40 : 2.5;
      return { hsl: hub.hsl, weight, code: hub.code };
    });
    node.color = blendColors(weights);
    // Haze belongs to whichever division's region it sits in.
    if (node.kind === "haze") node.region = weights.reduce((best, item) => (item.weight > best.weight ? item : best), weights[0]).code;
    else node.region = node.division;
  }

  // Plexus: link each point to its nearest neighbours anywhere in the cloud.
  for (const node of nodes) {
    const nearest = [];
    for (const other of nodes) {
      if (other === node) continue;
      const d = distance(node.position, other.position);
      if (d > MESH_MAX_DISTANCE) continue;
      nearest.push({ other, d });
    }
    nearest.sort((a, b) => a.d - b.d);
    for (const { other } of nearest.slice(0, MESH_NEIGHBORS)) addLink(node.id, other.id, "mesh");
  }

  // Triangles: three points that are all linked to each other.
  const neighbors = new Map(nodes.map(node => [node.id, new Set()]));
  for (const link of links) {
    neighbors.get(link.a).add(link.b);
    neighbors.get(link.b).add(link.a);
  }
  const triangles = [];
  const seen = new Set();
  for (const link of links) {
    if (triangles.length >= MAX_TRIANGLES) break;
    for (const cId of neighbors.get(link.a)) {
      if (!neighbors.get(link.b).has(cId)) continue;
      const key = [link.a, link.b, cId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      triangles.push({ a: link.a, b: link.b, c: cId, region: byId.get(link.a).region });
      if (triangles.length >= MAX_TRIANGLES) break;
    }
  }

  return { nodes, links, triangles, neighbors };
}

// Nudge apart rooms, sub-rooms and notes that landed too close together.
function relaxStars(nodes) {
  const movable = nodes.filter(node => node.kind !== "division");
  const spacing = { room: 0.36, subroom: 0.24, note: 0.14 };
  for (let pass = 0; pass < 24; pass += 1) {
    for (let i = 0; i < movable.length; i += 1) {
      for (let j = i + 1; j < movable.length; j += 1) {
        const a = movable[i];
        const b = movable[j];
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
