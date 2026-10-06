// Room logic map in the cover's constellation style: the room is a crystal
// at the centre, sub-rooms are small crystals linked to it, and each
// sub-room's notes (tiny stars) and wrong questions (tiny amber crystals)
// cluster around it. User-drawn links render as animated dashed bonds. Built
// from saved data every time, so new notes appear automatically.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  createAtom,
  createBond,
  createBondMaterial,
  createHaze,
  createLinks,
  createRenderer,
  createStarfield,
  disposeObject,
  fibonacciDirections,
  prefersReducedMotion,
  setAtomIntensity,
  spinAtom
} from "./space.js";

export const MAP_COLORS = {
  subroom: "#9fc2ff",
  note: "#6fd6ff",
  wrong: "#ffb066",
  link: "#ffe28a"
};

const DENSE_LABELS = 32;

function clusterRadius(count) {
  return count ? 0.7 + Math.sqrt(count) * 0.34 : 0;
}

function makeLabel(text, className, id) {
  const element = document.createElement(id ? "button" : "div");
  element.className = className;
  element.textContent = text;
  if (id) {
    element.type = "button";
    element.dataset.nodeId = id;
  }
  const label = new CSS2DObject(element);
  label.center.set(0.5, 1);
  return label;
}

export function mountMoleculeMap(host, { onSelect, onHover } = {}) {
  const renderer = createRenderer(host);
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = "map-label-layer";
  host.appendChild(labelRenderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  const reduced = prefersReducedMotion();
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.45;
  // Spin slowly until the user grabs the map; pause while the pointer is
  // over it so labels hold still long enough to click.
  let interacted = false;
  controls.addEventListener("start", () => {
    interacted = true;
    controls.autoRotate = false;
  });
  const pauseSpin = () => {
    controls.autoRotate = false;
  };
  const resumeSpin = () => {
    controls.autoRotate = !reduced && !interacted;
  };
  host.addEventListener("pointerenter", pauseSpin);
  host.addEventListener("pointerleave", resumeSpin);

  const stars = createStarfield({ count: 900, inner: 30, outer: 90, seed: 7 });
  scene.add(stars.points);
  const graph = new THREE.Group();
  scene.add(graph);

  const nodes = new Map(); // id -> { atom, label, data, neighbors:Set, links:[] }
  const pickables = [];
  const linkMaterials = [];
  let network = null; // hairline links between atoms
  let haze = null;
  const size = { width: 1, height: 1 };
  const fit = { distance: 10 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const temp = new THREE.Vector3();
  let hovered = null;
  let source = null;
  let frame = 0;
  let visible = true;
  let disposed = false;
  let downAt = null;

  function clearGraph() {
    for (const child of [...graph.children]) {
      graph.remove(child);
      // CSS2DObject only removes its own element when it is the object being
      // removed; labels nested inside atoms need removing by hand.
      child.traverse(object => {
        if (object.isCSS2DObject) object.element.remove();
      });
      disposeObject(child);
    }
    nodes.clear();
    pickables.length = 0;
    linkMaterials.length = 0;
    network = null;
    haze = null;
  }

  function addNode(id, data, atom, label) {
    atom.userData.sphere.userData.nodeId = id;
    if (label) {
      label.userData.lift = atom.userData.radius * 1.35 + 0.06;
      label.position.set(0, label.userData.lift, 0);
      atom.add(label);
    }
    graph.add(atom);
    pickables.push(atom.userData.sphere);
    nodes.set(id, { atom, label, data, neighbors: new Set(), links: [] });
  }

  // Structural links are collected while placing atoms, then drawn as one
  // set of hairlines; each node remembers its links so they can light up.
  let pending = { links: [], faces: [] };
  function connect(fromId, toId, alpha) {
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) return;
    const index = pending.links.length;
    pending.links.push({ a: from.atom.position, b: to.atom.position, colorA: from.atom.userData.color, colorB: to.atom.userData.color, alpha });
    from.neighbors.add(toId);
    to.neighbors.add(fromId);
    from.links.push(index);
    to.links.push(index);
  }

  // User links: animated dashed bonds.
  function connectUser(fromId, toId, material) {
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) return;
    graph.add(createBond(from.atom.position, to.atom.position, material, 0.009));
    from.neighbors.add(toId);
    to.neighbors.add(fromId);
  }

  // Faint plexus inside a cluster: each atom to its nearest sibling, and a
  // triangle where three siblings close a loop.
  function weave(ids, alpha) {
    const atoms = ids.map(id => nodes.get(id)?.atom).filter(Boolean);
    const linked = new Set();
    atoms.forEach((atom, index) => {
      let best = -1;
      let bestDistance = Infinity;
      atoms.forEach((other, j) => {
        const distance = atom.position.distanceTo(other.position);
        if (j !== index && distance < bestDistance) {
          best = j;
          bestDistance = distance;
        }
      });
      const key = `${Math.min(index, best)}:${Math.max(index, best)}`;
      if (best >= 0 && !linked.has(key)) {
        linked.add(key);
        pending.links.push({ a: atom.position, b: atoms[best].position, colorA: atom.userData.color, colorB: atoms[best].userData.color, alpha });
      }
      const next = atoms[(index + 1) % atoms.length];
      const after = atoms[(index + 2) % atoms.length];
      if (atoms.length >= 3 && index % 2 === 0) {
        pending.faces.push({ points: [atom.position, next.position, after.position], colors: [atom.userData.color, next.userData.color, after.userData.color], alpha: alpha * 0.3 });
      }
    });
  }

  function refreshHighlight() {
    const focus = hovered || source;
    const related = focus ? nodes.get(focus)?.neighbors || new Set() : null;
    for (const [id, node] of nodes) {
      let intensity = 1;
      if (focus) intensity = id === focus ? 1.8 : related.has(id) ? 1.3 : 0.55;
      if (id === source) intensity = 1.9;
      setAtomIntensity(node.atom, intensity);
      if (network) for (const index of node.links) network.setLevel(index, 1);
      const element = node.label?.element;
      if (element) {
        element.classList.toggle("is-hovered", id === hovered);
        element.classList.toggle("is-source", id === source);
        element.classList.toggle("is-related", Boolean(related?.has(id)));
      }
    }
    // Light the focused atom's own links after resetting the rest.
    if (network && focus) for (const index of nodes.get(focus)?.links || []) network.setLevel(index, 2.6);
  }

  // Keep the room's crystal in the middle of the view, then fit what the
  // camera actually sees: project every atom and move the camera until the
  // widest one sits ~75% of the way to the viewport edge.
  function frameCamera() {
    // Sub-rooms sit on a flat ring; on tall (phone) views the map turns on
    // its side so the ring runs top to bottom and fills the height.
    const turn = camera.aspect < 1 ? Math.PI / 2 : 0;
    graph.rotation.z = turn;
    // Labels hang off their atoms, so undo the turn to keep them above.
    for (const node of nodes.values()) {
      const lift = node.label?.userData.lift;
      if (lift) node.label.position.set(lift * Math.sin(turn), lift * Math.cos(turn), 0);
    }
    graph.updateMatrixWorld(true);
    const points = [...nodes.values()].map(node => node.atom.getWorldPosition(new THREE.Vector3()));
    const center = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0.72, 1).normalize();
    let distance = Math.max(6, Math.max(0, ...points.map(point => point.length())) * 2.4);
    controls.target.copy(center);
    if (points.length > 1) {
      for (let pass = 0; pass < 4; pass += 1) {
        camera.position.copy(center).addScaledVector(direction, distance);
        camera.lookAt(center);
        camera.updateMatrixWorld();
        let extent = 0.05;
        for (const point of points) {
          temp.copy(point).project(camera);
          extent = Math.max(extent, Math.abs(temp.x), Math.abs(temp.y) * 1.15);
        }
        distance = THREE.MathUtils.clamp(distance * (extent / 0.75), 4, 300);
      }
    }
    fit.distance = distance;
    camera.position.copy(center).addScaledVector(direction, distance);
    controls.minDistance = 1.5;
    controls.maxDistance = distance * 2.6;
    controls.update();
  }

  // graph: { room: {name, color}, groups: [{id, name, items:[{id, kind, title}]}], loose: [...], links: [{id, from, to, label}] }
  function setGraph({ room, groups = [], loose = [], links = [] }) {
    clearGraph();
    const coreId = "room";
    pending = { links: [], faces: [] };
    addNode(coreId, { kind: "room" }, createAtom({ color: room.color, radius: 0.3, glow: 3.6, glowOpacity: 0.5, seed: 0.91 }), makeLabel(room.name, "map-label map-label--room"));

    const largest = Math.max(0, ...groups.map(group => group.items.length));
    const ringRadius = Math.max(2.8, groups.length > 1 ? (groups.length * (2 * clusterRadius(largest) + 0.9)) / (2 * Math.PI) : 2.8);
    const itemCount = groups.reduce((sum, group) => sum + group.items.length, loose.length);
    host.classList.toggle("is-dense", itemCount > DENSE_LABELS);

    const placeItems = (items, center, outward, radius, parentId) => {
      const directions = fibonacciDirections(items.length);
      items.forEach((item, index) => {
        const direction = directions[index].clone().addScaledVector(outward, 0.85).normalize();
        const wrong = item.kind === "wrong";
        const atom = createAtom({
          color: MAP_COLORS[item.kind] || MAP_COLORS.note,
          radius: wrong ? 0.045 : 0.05,
          glow: wrong ? 5 : 6.5,
          glowOpacity: 0.55,
          shape: wrong ? "crystal" : "star",
          seed: index + 2.3,
          hitRadius: 0.14
        });
        atom.position.copy(center).addScaledVector(direction, radius);
        addNode(item.id, item, atom, makeLabel(item.title, `map-label map-label--${item.kind}`, item.id));
        connect(parentId, item.id, 0.3);
      });
      weave(items.map(item => item.id), 0.1);
    };

    groups.forEach((group, index) => {
      const angle = (index / Math.max(1, groups.length)) * Math.PI * 2;
      const lift = groups.length > 2 ? (index % 2 ? 0.6 : -0.6) : 0;
      const position = new THREE.Vector3(Math.cos(angle) * ringRadius, lift, Math.sin(angle) * ringRadius);
      const atom = createAtom({ color: MAP_COLORS.subroom, radius: 0.13, glow: 4.6, glowOpacity: 0.5, shape: index % 3 === 2 ? "shard" : "gem", seed: index + 1.7, hitRadius: 0.22 });
      atom.position.copy(position);
      addNode(group.id, { kind: "subroom", ...group }, atom, makeLabel(group.name, "map-label map-label--subroom", group.id));
      connect(coreId, group.id, 0.5);
      const outward = position.clone().setY(0).normalize();
      placeItems(group.items, position, outward, clusterRadius(group.items.length), group.id);
    });

    if (loose.length) placeItems(loose, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 1.6, coreId);
    // Neighbouring sub-rooms are linked too, spanning faint triangles with the core.
    if (groups.length > 2) weave(groups.map(group => group.id), 0.16);

    network = createLinks(pending.links, pending.faces);
    graph.add(network.group);
    const reach = Math.max(2.4, ...[...nodes.values()].map(node => node.atom.position.length()));
    haze = createHaze({
      radius: reach * 1.15,
      scale: [1, 0.55, 1],
      count: Math.round(Math.min(220, 90 + reach * 18)),
      colors: [room.color, MAP_COLORS.subroom, MAP_COLORS.note],
      seed: itemCount + groups.length + 1,
      lineAlpha: 0.06,
      faceAlpha: 0.018
    });
    graph.add(haze.group);

    for (const link of links) {
      const from = nodes.get(link.from);
      const to = nodes.get(link.to);
      if (!from || !to || link.from === link.to) continue;
      const length = from.atom.position.distanceTo(to.atom.position);
      const material = createBondMaterial(MAP_COLORS.link, MAP_COLORS.link, { opacity: 0.95, dash: Math.max(3, length * 2.4) });
      linkMaterials.push(material);
      connectUser(link.from, link.to, material);
      if (link.label) {
        const label = makeLabel(link.label, "map-label map-label--link");
        label.center.set(0.5, 0.5);
        label.position.lerpVectors(from.atom.position, to.atom.position, 0.5);
        graph.add(label);
      }
    }

    frameCamera();
    refreshHighlight();
  }

  let last = 0;
  function render(time) {
    const t = time / 1000;
    const dt = Math.min(0.1, last ? t - last : 0);
    last = t;
    controls.update();
    stars.update(t);
    if (!reduced) for (const node of nodes.values()) spinAtom(node.atom, dt);
    haze?.update(reduced ? 0 : t, fit.distance);
    for (const material of linkMaterials) material.uniforms.uTime.value = reduced ? 0 : t;
    // Depth cue: far labels fade.
    const near = Math.max(0.1, fit.distance * 0.55);
    const far = fit.distance * 1.45;
    for (const node of nodes.values()) {
      if (!node.label) continue;
      node.atom.getWorldPosition(temp);
      const depth = THREE.MathUtils.clamp((temp.distanceTo(camera.position) - near) / (far - near), 0, 1);
      node.label.element.style.setProperty("--depth", (1 - depth * 0.6).toFixed(2));
    }
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
  }

  function loop(time) {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    if (visible) render(time);
  }
  frame = requestAnimationFrame(loop);

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(pickables, false)[0]?.object.userData.nodeId || null;
  }

  function setHovered(id) {
    if (id === hovered) return;
    hovered = id;
    renderer.domElement.style.cursor = id && id !== "room" ? "pointer" : "";
    refreshHighlight();
    onHover?.(id ? nodes.get(id)?.data || null : null);
  }

  function select(id) {
    const node = nodes.get(id);
    if (node && node.data.kind !== "room") onSelect?.(node.data);
  }

  const handleMove = event => setHovered(pick(event));
  const handleDown = event => {
    downAt = { x: event.clientX, y: event.clientY };
  };
  const handleUp = event => {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return;
    const id = pick(event);
    if (id) select(id);
  };
  const handleLeave = () => setHovered(null);
  // Labels are buttons too, which also makes the map usable by keyboard.
  const handleLabelClick = event => {
    const id = event.target.closest?.("[data-node-id]")?.dataset.nodeId;
    if (id) select(id);
  };
  const handleLabelOver = event => {
    const id = event.target.closest?.("[data-node-id]")?.dataset.nodeId;
    if (id) setHovered(id);
  };
  const handleLabelOut = event => {
    if (event.target.closest?.("[data-node-id]")) setHovered(null);
  };

  renderer.domElement.addEventListener("pointermove", handleMove);
  renderer.domElement.addEventListener("pointerdown", handleDown);
  renderer.domElement.addEventListener("pointerup", handleUp);
  renderer.domElement.addEventListener("pointerleave", handleLeave);
  labelRenderer.domElement.addEventListener("click", handleLabelClick);
  labelRenderer.domElement.addEventListener("pointerover", handleLabelOver);
  labelRenderer.domElement.addEventListener("pointerout", handleLabelOut);
  labelRenderer.domElement.addEventListener("focusin", handleLabelOver);
  labelRenderer.domElement.addEventListener("focusout", handleLabelOut);

  return {
    setGraph,
    setSource(id) {
      source = id || null;
      refreshHighlight();
    },
    recenter() {
      frameCamera();
    },
    resize(width, height) {
      const wasTall = camera.aspect < 1;
      size.width = width;
      size.height = height;
      renderer.setSize(width, height);
      labelRenderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (nodes.size && !interacted && wasTall !== camera.aspect < 1) frameCamera();
    },
    setVisible(value) {
      visible = value;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener("pointermove", handleMove);
      renderer.domElement.removeEventListener("pointerdown", handleDown);
      renderer.domElement.removeEventListener("pointerup", handleUp);
      renderer.domElement.removeEventListener("pointerleave", handleLeave);
      host.removeEventListener("pointerenter", pauseSpin);
      host.removeEventListener("pointerleave", resumeSpin);
      controls.dispose();
      clearGraph();
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
    }
  };
}
