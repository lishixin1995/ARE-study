// Hero constellation for division pages: the division's crystal in the
// middle, linked to one crystal per room, each room with a few tiny stars
// for its sub-rooms, all inside a faint haze, in the cover map's style.
// The React component draws labels and leader lines; this module owns the
// WebGL scene.
import * as THREE from "three";
import {
  createAtom,
  createHaze,
  createLinks,
  createRenderer,
  createStarfield,
  disposeObject,
  distanceForScreenRadius,
  prefersReducedMotion,
  setAtomIntensity,
  spinAtom
} from "./space.js";
import { HERO_TILT_X, heroAtomLayout } from "./heroLayout.js";

const RING_RADIUS = 1.65;
const SATELLITE_DISTANCE = 0.34;

export function mountMoleculeHero(host, { mode = "ring", centerColor = "#5a8dff", atoms = [], onFrame, onHover, onSelect } = {}) {
  const renderer = createRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 300);
  const reduced = prefersReducedMotion();
  const molecule = new THREE.Group();
  molecule.rotation.x = HERO_TILT_X;
  scene.add(molecule);

  const stars = createStarfield();
  scene.add(stars.points);

  const layout = heroAtomLayout(atoms.length, { zigzag: mode === "center" ? 0.32 : 0 });
  const atomById = new Map();
  const spinners = [];
  const pickables = [];
  const links = [];
  const faces = [];
  const linksByAtom = new Map(); // atom id -> link indexes
  const ORIGIN = new THREE.Vector3();

  function link(a, b, colorA, colorB, alpha, owner) {
    if (owner) {
      if (!linksByAtom.has(owner)) linksByAtom.set(owner, []);
      linksByAtom.get(owner).push(links.length);
    }
    links.push({ a, b, colorA, colorB, alpha });
  }

  atoms.forEach((data, index) => {
    const spot = layout[index];
    const radius = 0.1 + Math.min(1, Math.max(0, data.size || 0)) * 0.08;
    const atom = createAtom({ color: data.color, radius, glow: 5, glowOpacity: 0.55, shape: index % 3 === 2 ? "shard" : "gem", seed: index + 1.37 });
    atom.position.set(spot.x * RING_RADIUS, spot.y * RING_RADIUS, spot.z * RING_RADIUS);
    atom.userData.id = data.id;
    atom.userData.sphere.userData.atomId = data.id;
    molecule.add(atom);
    atomById.set(data.id, atom);
    spinners.push(atom);
    pickables.push(atom.userData.sphere);

    // Satellites: one tiny star per sub-room, fanned outward and linked
    // in a little chain so each room reads as its own small constellation.
    const outward = new THREE.Vector3(spot.x, spot.y, 0).normalize();
    const count = Math.min(8, data.satellites || 0);
    let previous = null;
    for (let s = 0; s < count; s += 1) {
      const spread = count === 1 ? 0 : (s / (count - 1) - 0.5) * 1.9;
      const direction = outward.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), spread);
      direction.z = (s % 2 ? 0.55 : -0.55) * (count > 1 ? 1 : 0);
      direction.normalize();
      const position = atom.position.clone().addScaledVector(direction, radius + SATELLITE_DISTANCE * (0.85 + (s % 3) * 0.12));
      const satellite = createAtom({ color: data.color, radius: 0.026, glow: 6, glowOpacity: 0.45, shape: "star" });
      satellite.position.copy(position);
      molecule.add(satellite);
      link(atom.position, position, data.color, data.color, 0.32, data.id);
      if (previous) {
        link(previous, position, data.color, data.color, 0.12, data.id);
        faces.push({ points: [atom.position, previous, position], colors: [data.color, data.color, data.color], alpha: 0.035 });
      }
      previous = position;
    }
  });

  const ordered = layout.map((_, index) => atomById.get(atoms[index].id));
  if (mode === "center") {
    const core = createAtom({ color: centerColor, radius: 0.36, glow: 3.2, glowOpacity: 0.4, seed: 0.77 });
    setAtomIntensity(core, 0.38);
    molecule.add(core);
    spinners.push(core);
    for (const atom of ordered) link(ORIGIN, atom.position, centerColor, atom.userData.color, 0.34, atom.userData.id);
  }
  // Neighbouring rooms are linked too, and the core with each pair spans a
  // faint triangle, like the faces of the cover's mesh.
  ordered.forEach((atom, index) => {
    const next = ordered[(index + 1) % ordered.length];
    if (ordered.length < 2 || atom === next || (ordered.length === 2 && index === 1)) return;
    link(atom.position, next.position, atom.userData.color, next.userData.color, mode === "center" ? 0.14 : 0.4);
    if (mode === "center") faces.push({ points: [ORIGIN, atom.position, next.position], colors: [centerColor, atom.userData.color, next.userData.color], alpha: 0.03 });
  });
  const network = createLinks(links, faces);
  molecule.add(network.group);

  const haze = createHaze({
    radius: RING_RADIUS * 1.35,
    scale: [1.15, 0.72, 0.8],
    count: 170,
    colors: [centerColor, ...atoms.map(atom => atom.color)],
    seed: atoms.length + 3,
    lineAlpha: 0.07,
    faceAlpha: 0.022
  });
  molecule.add(haze.group);

  const size = { width: 1, height: 1, distance: 8 };
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const temp = new THREE.Vector3();
  let hovered = null;
  let active = null;
  let frame = 0;
  let visible = true;
  let disposed = false;
  let downAt = null;
  let last = 0;

  function placeCamera() {
    camera.position.set(pointer.x * size.distance * 0.08, pointer.y * size.distance * 0.06, size.distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }

  function refreshHighlight() {
    for (const [id, atom] of atomById) {
      const on = id === hovered || id === active;
      setAtomIntensity(atom, on ? 1.7 : 1);
      for (const index of linksByAtom.get(id) || []) network.setLevel(index, on ? 2.4 : 1);
    }
  }

  function render(time) {
    const t = time / 1000;
    const dt = Math.min(0.1, last ? t - last : 0);
    last = t;
    if (!reduced) {
      molecule.rotation.y = Math.sin(t * 0.22) * 0.2;
      molecule.rotation.x = HERO_TILT_X + Math.sin(t * 0.16) * 0.05;
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      for (const atom of spinners) spinAtom(atom, dt);
    }
    stars.update(t);
    haze.update(reduced ? 0 : t, size.distance);
    placeCamera();
    renderer.render(scene, camera);
    onFrame?.();
  }

  function loop(time) {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    if (visible) render(time);
  }
  if (!reduced) frame = requestAnimationFrame(loop);

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(pickables, false)[0]?.object.userData.atomId || null;
  }

  function handleMove(event) {
    const id = pick(event);
    if (id !== hovered) {
      hovered = id;
      renderer.domElement.style.cursor = id ? "pointer" : "";
      refreshHighlight();
      onHover?.(id);
      if (reduced) render(0);
    }
  }
  function handleDown(event) {
    downAt = { x: event.clientX, y: event.clientY };
  }
  function handleUp(event) {
    if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 6) return;
    const id = pick(event);
    if (id) onSelect?.(id);
  }
  function handleLeave() {
    if (hovered) {
      hovered = null;
      refreshHighlight();
      onHover?.(null);
    }
  }
  renderer.domElement.addEventListener("pointermove", handleMove);
  renderer.domElement.addEventListener("pointerdown", handleDown);
  renderer.domElement.addEventListener("pointerup", handleUp);
  renderer.domElement.addEventListener("pointerleave", handleLeave);

  return {
    resize(width, height, radiusPx) {
      size.width = width;
      size.height = height;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      size.distance = distanceForScreenRadius(camera, RING_RADIUS, radiusPx / height);
      placeCamera();
      if (reduced) render(0);
    },
    // Screen position and on-screen radius of a main atom.
    project(id) {
      const atom = atomById.get(id);
      if (!atom) return null;
      atom.getWorldPosition(temp);
      const distance = temp.distanceTo(camera.position);
      temp.project(camera);
      const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
      return {
        x: ((temp.x + 1) / 2) * size.width,
        y: ((1 - temp.y) / 2) * size.height,
        r: ((atom.userData.radius * 1.3) / (distance * Math.tan(halfFov))) * (size.height / 2)
      };
    },
    setPointer(x, y) {
      pointer.tx = x;
      pointer.ty = y;
    },
    setActive(id) {
      active = id || null;
      refreshHighlight();
      if (reduced) render(0);
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
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    }
  };
}
