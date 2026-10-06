// Hero molecule for the cover page (a ring of division atoms) and division
// pages (a central division atom bonded to its rooms). The React component
// draws labels and leader lines; this module owns the WebGL scene.
import * as THREE from "three";
import {
  createAtom,
  createBond,
  createBondMaterial,
  createGlow,
  createRenderer,
  createRing,
  createStarfield,
  disposeObject,
  distanceForScreenRadius,
  prefersReducedMotion,
  setAtomIntensity
} from "./space.js";
import { HERO_TILT_X, heroAtomLayout } from "./heroLayout.js";

const RING_RADIUS = 1.65;
const SATELLITE_DISTANCE = 0.46;

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
  const pickables = [];
  const electrons = [];

  function addElectron(from, to, color, offset) {
    const sprite = createGlow(color, 0.16, 0.95);
    molecule.add(sprite);
    electrons.push({ sprite, from, to, offset });
  }

  atoms.forEach((data, index) => {
    const spot = layout[index];
    const radius = 0.17 + Math.min(1, Math.max(0, data.size || 0)) * 0.13;
    const atom = createAtom({ color: data.color, radius, glow: 4.6, glowOpacity: 0.55 });
    atom.position.set(spot.x * RING_RADIUS, spot.y * RING_RADIUS, spot.z * RING_RADIUS);
    atom.userData.id = data.id;
    atom.userData.sphere.userData.atomId = data.id;
    molecule.add(atom);
    atomById.set(data.id, atom);
    pickables.push(atom.userData.sphere);

    // Satellites: one small bonded atom per room/sub-room, fanned outward.
    const outward = new THREE.Vector3(spot.x, spot.y, 0).normalize();
    const count = Math.min(8, data.satellites || 0);
    for (let s = 0; s < count; s += 1) {
      const spread = count === 1 ? 0 : (s / (count - 1) - 0.5) * 1.9;
      const direction = outward.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), spread);
      direction.z = (s % 2 ? 0.55 : -0.55) * (count > 1 ? 1 : 0);
      direction.normalize();
      const position = atom.position.clone().addScaledVector(direction, radius + SATELLITE_DISTANCE);
      const satellite = createAtom({ color: data.color, radius: 0.055, glow: 5, glowOpacity: 0.35, detail: 12 });
      satellite.position.copy(position);
      molecule.add(satellite);
      molecule.add(createBond(atom.position, position, createBondMaterial(data.color, data.color, { opacity: 0.35 }), 0.012));
    }
  });

  if (mode === "center") {
    const core = createAtom({ color: centerColor, radius: 0.62, glow: 3.6, glowOpacity: 0.45, detail: 48 });
    setAtomIntensity(core, 0.6);
    molecule.add(core);
    for (const atom of atomById.values()) {
      molecule.add(createBond(core.position, atom.position, createBondMaterial(centerColor, atom.userData.material.uniforms.uColor.value, { opacity: 0.5 }), 0.03));
      addElectron(core.position, atom.position, "#e6f2ff", Math.random());
    }
    for (const [tiltX, tiltY] of [[1.2, 0.3], [1.9, -0.6]]) {
      const orbit = createRing(0.98, centerColor, 0.22);
      orbit.rotation.set(tiltX, tiltY, 0);
      molecule.add(orbit);
    }
  } else {
    const ordered = layout.map((_, index) => atomById.get(atoms[index].id));
    ordered.forEach((atom, index) => {
      const next = ordered[(index + 1) % ordered.length];
      if (ordered.length < 2 || atom === next) return;
      const colorA = atom.userData.material.uniforms.uColor.value;
      const colorB = next.userData.material.uniforms.uColor.value;
      molecule.add(createBond(atom.position, next.position, createBondMaterial(colorA, colorB, { opacity: 0.6 }), 0.035));
      addElectron(atom.position, next.position, "#e6f2ff", index / ordered.length);
    });
    molecule.add(createRing(RING_RADIUS * 0.62, "#8fc4ff", 0.28));
    molecule.add(createRing(RING_RADIUS * 0.66, "#8fc4ff", 0.1));
  }

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

  function placeCamera() {
    camera.position.set(pointer.x * size.distance * 0.08, pointer.y * size.distance * 0.06, size.distance);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
  }

  function refreshHighlight() {
    for (const [id, atom] of atomById) setAtomIntensity(atom, id === hovered || id === active ? 1.6 : 1);
  }

  function render(time) {
    const t = time / 1000;
    if (!reduced) {
      molecule.rotation.y = Math.sin(t * 0.22) * 0.2;
      molecule.rotation.x = HERO_TILT_X + Math.sin(t * 0.16) * 0.05;
      pointer.x += (pointer.tx - pointer.x) * 0.05;
      pointer.y += (pointer.ty - pointer.y) * 0.05;
      for (const electron of electrons) {
        const p = (t * 0.16 + electron.offset) % 1;
        electron.sprite.position.lerpVectors(electron.from, electron.to, p);
        electron.sprite.material.opacity = Math.sin(p * Math.PI) * 0.95;
      }
    } else {
      for (const electron of electrons) electron.sprite.visible = false;
    }
    stars.update(t);
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
        r: (atom.userData.radius / (distance * Math.tan(halfFov))) * (size.height / 2)
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
