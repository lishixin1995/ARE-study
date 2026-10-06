// Room logic map: the room is the nucleus, sub-rooms are bonded atoms, and
// each sub-room's notes and wrong questions cluster around it. User-drawn
// links render as animated dashed bonds. Built from saved data every time, so
// new notes appear automatically.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import {
  createAtom,
  createBond,
  createBondMaterial,
  createRenderer,
  createStarfield,
  disposeObject,
  fibonacciDirections,
  prefersReducedMotion,
  setAtomIntensity
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

  const nodes = new Map(); // id -> { atom, label, data, neighbors:Set }
  const pickables = [];
  const linkMaterials = [];
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
  }

  function addNode(id, data, atom, label) {
    atom.userData.sphere.userData.nodeId = id;
    if (label) {
      label.position.set(0, atom.userData.radius * 1.35 + 0.06, 0);
      atom.add(label);
    }
    graph.add(atom);
    pickables.push(atom.userData.sphere);
    nodes.set(id, { atom, label, data, neighbors: new Set() });
  }

  function connect(fromId, toId, material, radius) {
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) return null;
    const bond = createBond(from.atom.position, to.atom.position, material, radius);
    graph.add(bond);
    from.neighbors.add(toId);
    to.neighbors.add(fromId);
    return bond;
  }

  function refreshHighlight() {
    const focus = hovered || source;
    const related = focus ? nodes.get(focus)?.neighbors || new Set() : null;
    for (const [id, node] of nodes) {
      let intensity = 1;
      if (focus) intensity = id === focus ? 1.8 : related.has(id) ? 1.3 : 0.55;
      if (id === source) intensity = 1.9;
      setAtomIntensity(node.atom, intensity);
      const element = node.label?.element;
      if (element) {
        element.classList.toggle("is-hovered", id === hovered);
        element.classList.toggle("is-source", id === source);
        element.classList.toggle("is-related", Boolean(related?.has(id)));
      }
    }
  }

  // Fit what the camera actually sees: project every atom and move the
  // camera until the widest one sits ~75% of the way to the viewport edge.
  function frameCamera() {
    const points = [...nodes.values()].map(node => node.atom.position);
    const box = new THREE.Box3().setFromPoints(points.length ? points : [new THREE.Vector3()]);
    const center = box.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(0, 0.72, 1).normalize();
    let distance = Math.max(6, box.getSize(new THREE.Vector3()).length() * 1.2);
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
    addNode(coreId, { kind: "room" }, createAtom({ color: room.color, radius: 0.55, glow: 3.4, glowOpacity: 0.45, detail: 48 }), makeLabel(room.name, "map-label map-label--room"));

    const largest = Math.max(0, ...groups.map(group => group.items.length));
    const ringRadius = Math.max(2.8, groups.length > 1 ? (groups.length * (2 * clusterRadius(largest) + 0.9)) / (2 * Math.PI) : 2.8);
    const itemCount = groups.reduce((sum, group) => sum + group.items.length, loose.length);
    host.classList.toggle("is-dense", itemCount > DENSE_LABELS);

    const placeItems = (items, center, outward, radius, parentId) => {
      const directions = fibonacciDirections(items.length);
      items.forEach((item, index) => {
        const direction = directions[index].clone().addScaledVector(outward, 0.85).normalize();
        const atom = createAtom({
          color: MAP_COLORS[item.kind] || MAP_COLORS.note,
          radius: 0.15,
          glow: 5,
          glowOpacity: 0.5,
          detail: 20,
          shape: item.kind === "wrong" ? "crystal" : "sphere"
        });
        atom.position.copy(center).addScaledVector(direction, radius);
        addNode(item.id, item, atom, makeLabel(item.title, `map-label map-label--${item.kind}`, item.id));
        connect(parentId, item.id, createBondMaterial(MAP_COLORS.subroom, MAP_COLORS[item.kind] || MAP_COLORS.note, { opacity: 0.34 }), 0.012);
      });
    };

    groups.forEach((group, index) => {
      const angle = (index / Math.max(1, groups.length)) * Math.PI * 2;
      const lift = groups.length > 2 ? (index % 2 ? 0.6 : -0.6) : 0;
      const position = new THREE.Vector3(Math.cos(angle) * ringRadius, lift, Math.sin(angle) * ringRadius);
      const atom = createAtom({ color: MAP_COLORS.subroom, radius: 0.26, glow: 4, glowOpacity: 0.5, detail: 32 });
      atom.position.copy(position);
      addNode(group.id, { kind: "subroom", ...group }, atom, makeLabel(group.name, "map-label map-label--subroom", group.id));
      connect(coreId, group.id, createBondMaterial(room.color, MAP_COLORS.subroom, { opacity: 0.55 }), 0.03);
      const outward = position.clone().setY(0).normalize();
      placeItems(group.items, position, outward, clusterRadius(group.items.length), group.id);
    });

    if (loose.length) placeItems(loose, new THREE.Vector3(), new THREE.Vector3(0, 1, 0), 1.6, coreId);

    for (const link of links) {
      const from = nodes.get(link.from);
      const to = nodes.get(link.to);
      if (!from || !to || link.from === link.to) continue;
      const length = from.atom.position.distanceTo(to.atom.position);
      const material = createBondMaterial(MAP_COLORS.link, MAP_COLORS.link, { opacity: 0.95, dash: Math.max(3, length * 2.4) });
      linkMaterials.push(material);
      connect(link.from, link.to, material, 0.022);
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

  function render(time) {
    const t = time / 1000;
    controls.update();
    stars.update(t);
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
      size.width = width;
      size.height = height;
      renderer.setSize(width, height);
      labelRenderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
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
