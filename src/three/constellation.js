// Cover constellation: one 3D nebula where every room, sub-room and note is a
// small star (plus a haze of decorative points), linked into a faceted
// network with an irregular crystal marking each division. At rest only the
// stars show; lines, triangles and crystals fade in while the pointer is over
// the map, around a hovered star, and across a selected division's region.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { createRenderer, createStarfield, disposeObject, getGlowTexture, prefersReducedMotion } from "./space.js";
import { seededRandom } from "../lib/coverGraph.js";

const LINK_BASE = { tree: 0.32, mesh: 0.16 };
const HAZE_LINK = 0.075; // mesh links that touch a haze point
const FACE_BASE = 0.05;
const DRAG_THRESHOLD = 5;

function ease(current, target, rate) {
  const next = current + (target - current) * rate;
  return Math.abs(target - next) < 0.002 ? target : next;
}

const pointShader = {
  vertexShader: `
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aLevel;
    attribute float aPhase;
    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uRefDistance;
    varying vec3 vColor;
    varying float vLevel;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vColor = aColor;
      vLevel = aLevel * (0.86 + 0.14 * sin(uTime * 1.7 + aPhase));
      gl_PointSize = aSize * 2.2 * uPixelRatio * (uRefDistance / -mv.z) * (0.72 + 0.3 * min(aLevel, 1.9));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vLevel;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float core = smoothstep(0.2, 0.02, d);
      float halo = smoothstep(0.5, 0.04, d);
      float alpha = (core + halo * 0.3) * clamp(vLevel, 0.0, 1.0) + core * max(vLevel - 1.0, 0.0) * 0.5;
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5), alpha);
    }
  `
};

const lineShader = {
  vertexShader: `
    attribute vec3 aColor;
    attribute float aAlpha;
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      vColor = aColor;
      vAlpha = aAlpha;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
      if (vAlpha < 0.003) discard;
      gl_FragColor = vec4(vColor, vAlpha);
    }
  `
};

function additive(material) {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  return material;
}

// Irregular wireframe crystal: a polyhedron with each corner nudged.
function createCrystal(kind, color, seed) {
  const random = seededRandom(seed);
  const base = kind === "division" ? new THREE.IcosahedronGeometry(0.21, 0) : new THREE.TetrahedronGeometry(0.095, 0);
  const geometry = mergeVertices(base);
  base.dispose();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const scale = 0.72 + random() * 0.6;
    positions.setXYZ(i, positions.getX(i) * scale, positions.getY(i) * scale * (0.85 + random() * 0.4), positions.getZ(i) * scale);
  }
  geometry.computeVertexNormals();
  const group = new THREE.Group();
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), additive(new THREE.LineBasicMaterial({ color, opacity: 0 })));
  group.add(edges);
  let fill = null;
  if (kind === "division") {
    fill = new THREE.Mesh(geometry, additive(new THREE.MeshBasicMaterial({ color, opacity: 0, side: THREE.DoubleSide })));
    group.add(fill);
  } else {
    geometry.dispose();
  }
  group.rotation.set(random() * Math.PI, random() * Math.PI, 0);
  return { group, edges, fill, spin: (random() - 0.5) * 0.01 + 0.004, level: 0, scale: 1 };
}

export function mountConstellation(host, { onHover, onSelect, onBackground, onFrame } = {}) {
  const renderer = createRenderer(host);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 400);
  const reduced = prefersReducedMotion();
  const stars = createStarfield({ count: 1100, inner: 24, outer: 80, seed: 11 });
  scene.add(stars.points);
  const network = new THREE.Group();
  scene.add(network);

  const pointMaterial = additive(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }, uRefDistance: { value: 10 } },
    ...pointShader
  }));
  const lineMaterial = additive(new THREE.ShaderMaterial({ ...lineShader }));
  const faceMaterial = additive(new THREE.ShaderMaterial({ ...lineShader, side: THREE.DoubleSide }));

  let graph = { nodes: [], links: [], triangles: [], neighbors: new Map() };
  let nodeIndex = new Map();
  let points = null;
  let lines = null;
  let faces = null;
  let crystals = new Map(); // node index -> crystal
  let glows = []; // soft colour clouds behind each division's region
  let pointLevels = new Float32Array(0);
  let linkLevels = new Float32Array(0);
  let faceLevels = new Float32Array(0);
  let screen = new Float32Array(0); // per node: x, y, sizePx, visible, extentPx
  let fitDistance = 10;

  const size = { width: 1, height: 1 };
  const engaged = { value: 0, target: 0 };
  // Selecting a division flies the camera to its cluster, shifted left of the panel.
  const focus = { value: 0, target: 0, shift: 0, center: new THREE.Vector3(), centerTarget: new THREE.Vector3(), radius: 1.5, radiusTarget: 1.5 };
  const drag = { x: 0, y: 0, down: null, moved: false };
  const world = new THREE.Vector3();
  let hovered = null;
  let active = null;
  let selected = "";
  let swayTime = 0;
  let lastTime = 0;
  let frame = 0;
  let visible = true;
  let disposed = false;

  function clearGraphObjects() {
    for (const object of [points, lines, faces]) {
      if (!object) continue;
      network.remove(object);
      object.geometry.dispose();
    }
    for (const crystal of crystals.values()) {
      network.remove(crystal.group);
      disposeObject(crystal.group);
    }
    for (const glow of glows) {
      network.remove(glow.sprite);
      glow.sprite.material.dispose();
    }
    points = lines = faces = null;
    crystals = new Map();
    glows = [];
  }

  function setGraph(next) {
    clearGraphObjects();
    graph = next;
    const { nodes, links, triangles } = graph;
    nodeIndex = new Map(nodes.map((node, index) => [node.id, index]));
    const colors = nodes.map(node => new THREE.Color(node.color));

    const positions = new Float32Array(nodes.length * 3);
    const colorArray = new Float32Array(nodes.length * 3);
    const sizes = new Float32Array(nodes.length);
    const phases = new Float32Array(nodes.length);
    nodes.forEach((node, i) => {
      positions.set(node.position, i * 3);
      colorArray.set([colors[i].r, colors[i].g, colors[i].b], i * 3);
      sizes[i] = node.size;
      phases[i] = seededRandom(node.id)() * Math.PI * 2;
    });
    const previousLevels = pointLevels;
    pointLevels = new Float32Array(nodes.length).fill(1);
    if (previousLevels.length === nodes.length) pointLevels.set(previousLevels);
    const pointGeometry = new THREE.BufferGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointGeometry.setAttribute("aColor", new THREE.BufferAttribute(colorArray, 3));
    pointGeometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    pointGeometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    pointGeometry.setAttribute("aLevel", new THREE.BufferAttribute(new Float32Array(pointLevels), 1));
    points = new THREE.Points(pointGeometry, pointMaterial);
    points.frustumCulled = false;

    const linePositions = new Float32Array(links.length * 6);
    const lineColors = new Float32Array(links.length * 6);
    links.forEach((link, j) => {
      const a = nodeIndex.get(link.a);
      const b = nodeIndex.get(link.b);
      linePositions.set(nodes[a].position, j * 6);
      linePositions.set(nodes[b].position, j * 6 + 3);
      lineColors.set([colors[a].r, colors[a].g, colors[a].b, colors[b].r, colors[b].g, colors[b].b], j * 6);
    });
    linkLevels = new Float32Array(links.length);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute("position", new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute("aColor", new THREE.BufferAttribute(lineColors, 3));
    lineGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(links.length * 2), 1));
    lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.frustumCulled = false;

    const facePositions = new Float32Array(triangles.length * 9);
    const faceColors = new Float32Array(triangles.length * 9);
    triangles.forEach((triangle, k) => {
      [triangle.a, triangle.b, triangle.c].forEach((id, corner) => {
        const i = nodeIndex.get(id);
        facePositions.set(nodes[i].position, k * 9 + corner * 3);
        faceColors.set([colors[i].r, colors[i].g, colors[i].b], k * 9 + corner * 3);
      });
    });
    faceLevels = new Float32Array(triangles.length);
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", new THREE.BufferAttribute(facePositions, 3));
    faceGeometry.setAttribute("aColor", new THREE.BufferAttribute(faceColors, 3));
    faceGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(triangles.length * 3), 1));
    faces = new THREE.Mesh(faceGeometry, faceMaterial);
    faces.frustumCulled = false;

    network.add(faces, lines, points);

    nodes.forEach((node, i) => {
      if (node.kind !== "division" && node.kind !== "room") return;
      const crystal = createCrystal(node.kind, node.color, `crystal:${node.id}`);
      crystal.group.position.set(...node.position);
      network.add(crystal.group);
      crystals.set(i, crystal);
    });

    // Overlapping glows give the nebula its blended colour.
    for (const node of nodes) {
      if (node.kind !== "division") continue;
      const random = seededRandom(`glow:${node.id}`);
      for (let k = 0; k < 3; k += 1) {
        const sprite = new THREE.Sprite(additive(new THREE.SpriteMaterial({ map: getGlowTexture(), color: new THREE.Color(node.color), opacity: 0 })));
        const offset = k === 0 ? [0, 0, 0] : [(random() - 0.5) * 1.6, (random() - 0.5) * 1.1, (random() - 0.5) * 1.2];
        sprite.position.set(node.position[0] + offset[0], node.position[1] + offset[1], node.position[2] + offset[2]);
        sprite.scale.setScalar(k === 0 ? 4.2 : 2.6 + random() * 1.4);
        network.add(sprite);
        glows.push({ sprite, region: node.division, base: k === 0 ? 0.075 : 0.05, level: 0 });
      }
    }

    screen = new Float32Array(nodes.length * 5);
    fitCamera();
  }

  // Distance at which the whole network fits the view (rotation ignored, with
  // margin for the gentle sway).
  function fitCamera() {
    const { nodes } = graph;
    if (!nodes.length) return;
    const saved = network.rotation.clone();
    network.rotation.set(0, 0, 0);
    network.updateMatrixWorld();
    camera.clearViewOffset();
    let distance = 12;
    for (let pass = 0; pass < 4; pass += 1) {
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
      let extent = 0.05;
      for (const node of nodes) {
        world.set(...node.position).project(camera);
        extent = Math.max(extent, Math.abs(world.x) / 0.8, Math.abs(world.y) / 0.74);
      }
      distance = THREE.MathUtils.clamp(distance * extent, 3, 200);
    }
    fitDistance = distance;
    network.rotation.copy(saved);
  }

  function clusterBounds(code) {
    const members = graph.nodes.filter(node => node.division === code);
    if (!members.length) return null;
    const center = new THREE.Vector3();
    for (const node of members) center.add(world.set(...node.position));
    center.divideScalar(members.length);
    let radius = 0.9;
    for (const node of members) radius = Math.max(radius, center.distanceTo(world.set(...node.position)) + 0.35);
    return { center, radius };
  }

  // Distance that fits a cluster of `radius` in the space left of the panel.
  function clusterDistance(radius) {
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const available = Math.max(0.3, 1 - 2 * focus.shift);
    const vertical = radius / (tanV * 0.52);
    const horizontal = radius / (tanV * camera.aspect * available * 0.72);
    return THREE.MathUtils.clamp(Math.max(vertical, horizontal), 2.2, fitDistance);
  }

  function placeCamera() {
    const distance = THREE.MathUtils.lerp(fitDistance, clusterDistance(focus.radius), focus.value);
    // Slide the focused cluster to the middle of the view.
    world.copy(focus.center).applyEuler(network.rotation);
    network.position.copy(world).multiplyScalar(-focus.value);
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    const offset = focus.value * focus.shift * size.width;
    if (offset > 0.5) camera.setViewOffset(size.width, size.height, offset, 0, size.width, size.height);
    else camera.clearViewOffset();
    camera.updateMatrixWorld();
    pointMaterial.uniforms.uRefDistance.value = distance;
  }

  function step(snap) {
    const rate = snap ? 1 : 0.14;
    const { nodes, links, triangles, neighbors } = graph;
    engaged.value = ease(engaged.value, engaged.target, snap ? 1 : 0.08);
    focus.value = ease(focus.value, focus.target, snap ? 1 : 0.07);
    focus.center.lerp(focus.centerTarget, snap ? 1 : 0.08);
    focus.radius = ease(focus.radius, focus.radiusTarget, snap ? 1 : 0.08);
    const spotlight = hovered || active;
    const near = spotlight ? neighbors.get(spotlight) : null;
    const reveal = engaged.value;

    const levelAttr = points?.geometry.attributes.aLevel;
    nodes.forEach((node, i) => {
      const haze = node.kind === "haze";
      let target = haze ? 0.62 : node.kind === "note" ? 0.8 : 1;
      if (selected && node.region !== selected) target = haze ? 0.16 : 0.28;
      else if (selected && haze) target = 0.7;
      if (selected && node.kind === "division" && node.division === selected) target = 1.6;
      if (near?.has(node.id)) target = Math.max(target, 1.3);
      if (node.id === spotlight) target = 1.9;
      pointLevels[i] = ease(pointLevels[i], target, rate);
      if (levelAttr) levelAttr.array[i] = pointLevels[i];
    });
    if (levelAttr) levelAttr.needsUpdate = true;

    const lineAttr = lines?.geometry.attributes.aAlpha;
    links.forEach((link, j) => {
      const a = nodes[nodeIndex.get(link.a)];
      const b = nodes[nodeIndex.get(link.b)];
      const base = a.kind === "haze" || b.kind === "haze" ? HAZE_LINK : LINK_BASE[link.kind] || 0.1;
      let target = base * reveal;
      if (selected) {
        const inside = a.region === selected && b.region === selected;
        const touches = a.region === selected || b.region === selected;
        target = inside ? base * 2.3 : touches ? base * 1.3 : base * 0.3 * reveal;
      }
      if (spotlight && (link.a === spotlight || link.b === spotlight)) target = 0.8;
      linkLevels[j] = ease(linkLevels[j], target, rate);
      if (lineAttr) {
        lineAttr.array[j * 2] = linkLevels[j];
        lineAttr.array[j * 2 + 1] = linkLevels[j];
      }
    });
    if (lineAttr) lineAttr.needsUpdate = true;

    const faceAttr = faces?.geometry.attributes.aAlpha;
    triangles.forEach((triangle, k) => {
      let target = FACE_BASE * reveal;
      if (selected) target = triangle.region === selected ? FACE_BASE * 2.2 : FACE_BASE * 0.25 * reveal;
      if (spotlight && (triangle.a === spotlight || triangle.b === spotlight || triangle.c === spotlight)) target = FACE_BASE * 3;
      faceLevels[k] = ease(faceLevels[k], target, rate);
      if (faceAttr) faceAttr.array.fill(faceLevels[k], k * 3, k * 3 + 3);
    });
    if (faceAttr) faceAttr.needsUpdate = true;

    for (const glow of glows) {
      const target = glow.base * (selected ? (glow.region === selected ? 1.7 : 0.45) : 1);
      glow.level = ease(glow.level, target, snap ? 1 : 0.05);
      glow.sprite.material.opacity = glow.level;
    }

    for (const [i, crystal] of crystals) {
      const node = nodes[i];
      const inSelected = selected && node.division === selected;
      let target = (node.kind === "division" ? 0.55 : 0.32) * reveal;
      if (selected) target = inSelected ? (node.kind === "division" ? 0.95 : 0.55) : 0.1 * reveal;
      if (node.id === spotlight) target = 1;
      crystal.level = ease(crystal.level, target, rate);
      crystal.edges.material.opacity = crystal.level;
      if (crystal.fill) crystal.fill.material.opacity = crystal.level * 0.08;
      crystal.group.visible = crystal.level > 0.01;
      const scaleTarget = node.id === spotlight || (inSelected && node.kind === "division") ? 1.35 : 1;
      crystal.scale = ease(crystal.scale, scaleTarget, snap ? 1 : 0.12);
      crystal.group.scale.setScalar(crystal.scale);
      if (!reduced) {
        crystal.group.rotation.y += crystal.spin;
        crystal.group.rotation.x += crystal.spin * 0.6;
      }
    }
  }

  function updateScreen() {
    network.updateMatrixWorld();
    const { nodes } = graph;
    const focal = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    for (let i = 0; i < nodes.length; i += 1) {
      world.set(...nodes[i].position).applyMatrix4(network.matrixWorld);
      const depth = world.distanceTo(camera.position);
      world.project(camera);
      const o = i * 5;
      screen[o] = ((world.x + 1) / 2) * size.width;
      screen[o + 1] = ((1 - world.y) / 2) * size.height;
      screen[o + 2] = nodes[i].size * 0.9 * (camera.position.z / depth);
      screen[o + 3] = world.z < 1 ? 1 : 0;
      // How far the star's visible shape reaches, so labels clear its crystal.
      const crystal = crystals.get(i);
      const reach = crystal && crystal.level > 0.15 ? ((nodes[i].kind === "division" ? 0.27 : 0.12) * crystal.scale * focal) / depth : 0;
      screen[o + 4] = Math.max(screen[o + 2] / 2, reach);
    }
  }

  function render(time, snap = false) {
    const t = time / 1000;
    const delta = lastTime ? Math.min(0.1, t - lastTime) : 0;
    lastTime = t;
    // The sway pauses while a star is hovered or dragged, so it stays under the pointer.
    if (!reduced && !hovered && !drag.moved) swayTime += delta;
    step(snap || reduced);
    const swayScale = selected ? 0.35 : 1;
    network.rotation.y = (reduced ? 0 : Math.sin(swayTime * 0.11) * 0.34 * swayScale) + drag.y;
    network.rotation.x = (reduced ? 0 : Math.sin(swayTime * 0.08) * 0.08 * swayScale) + drag.x;
    pointMaterial.uniforms.uTime.value = reduced ? 0 : t;
    stars.update(t);
    placeCamera();
    updateScreen();
    renderer.render(scene, camera);
    onFrame?.();
  }

  function loop(time) {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    if (visible) render(time);
  }
  frame = requestAnimationFrame(loop);

  function pickAt(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best = null;
    let bestScore = Infinity;
    for (let i = 0; i < graph.nodes.length; i += 1) {
      const o = i * 5;
      if (!screen[o + 3] || graph.nodes[i].kind === "haze") continue;
      const d = Math.hypot(screen[o] - x, screen[o + 1] - y);
      const reach = Math.max(10, screen[o + 2] + 6);
      if (d > reach) continue;
      const score = d - reach * 0.35; // favour bigger stars a little when they overlap
      if (score < bestScore) {
        bestScore = score;
        best = graph.nodes[i];
      }
    }
    return best;
  }

  function setHovered(node) {
    const id = node?.id || null;
    if (id === hovered) return;
    hovered = id;
    renderer.domElement.style.cursor = id ? "pointer" : drag.down ? "grabbing" : "";
    onHover?.(node || null);
  }

  function handleDown(event) {
    drag.down = { x: event.clientX, y: event.clientY, startX: drag.x, startY: drag.y };
    drag.moved = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
  }
  function handleMove(event) {
    if (drag.down) {
      const dx = event.clientX - drag.down.x;
      const dy = event.clientY - drag.down.y;
      if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        drag.moved = true;
        setHovered(null);
        renderer.domElement.style.cursor = "grabbing";
      }
      if (drag.moved) {
        drag.y = drag.down.startY + dx * 0.006;
        drag.x = THREE.MathUtils.clamp(drag.down.startX + dy * 0.004, -0.55, 0.55);
        return;
      }
    }
    if (event.pointerType !== "touch") setHovered(pickAt(event.clientX, event.clientY));
  }
  function handleUp(event) {
    const wasDrag = drag.moved;
    drag.down = null;
    drag.moved = false;
    renderer.domElement.releasePointerCapture?.(event.pointerId);
    renderer.domElement.style.cursor = hovered ? "pointer" : "";
    if (wasDrag) return;
    const node = pickAt(event.clientX, event.clientY);
    if (node) {
      if (event.pointerType === "touch") setHovered(node);
      onSelect?.(node);
    } else {
      onBackground?.();
    }
  }
  function handleLeave() {
    if (!drag.down) setHovered(null);
  }
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", handleDown);
  canvas.addEventListener("pointermove", handleMove);
  canvas.addEventListener("pointerup", handleUp);
  canvas.addEventListener("pointercancel", handleUp);
  canvas.addEventListener("pointerleave", handleLeave);

  return {
    canvas,
    setGraph,
    resize(width, height) {
      size.width = Math.max(1, width);
      size.height = Math.max(1, height);
      renderer.setSize(size.width, size.height);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
      fitCamera();
    },
    // Latest screen position of a star: { x, y, size, extent } or null when
    // hidden. extent is the radius its crystal (if showing) reaches.
    screenPosition(id) {
      const i = nodeIndex.get(id);
      if (i === undefined || !screen[i * 5 + 3]) return null;
      const o = i * 5;
      return { x: screen[o], y: screen[o + 1], size: screen[o + 2], extent: screen[o + 4] };
    },
    setActive(id) {
      active = id || null;
    },
    setSelected(code) {
      selected = code || "";
      const bounds = selected ? clusterBounds(selected) : null;
      if (!bounds) return;
      focus.centerTarget.copy(bounds.center);
      focus.radiusTarget = bounds.radius;
      // Coming from the overview, start at the target instead of sweeping across.
      if (focus.value < 0.02) {
        focus.center.copy(bounds.center);
        focus.radius = bounds.radius;
      }
    },
    setEngaged(on) {
      engaged.target = on ? 1 : 0;
    },
    // shift: share of the width the view moves left to make room for the panel.
    setFocus(on, shift = 0) {
      focus.target = on ? 1 : 0;
      if (on) focus.shift = shift;
    },
    setVisible(value) {
      visible = value;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("pointerdown", handleDown);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerup", handleUp);
      canvas.removeEventListener("pointercancel", handleUp);
      canvas.removeEventListener("pointerleave", handleLeave);
      clearGraphObjects();
      disposeObject(scene);
      pointMaterial.dispose();
      lineMaterial.dispose();
      faceMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
    }
  };
}
