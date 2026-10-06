// Shared three.js pieces for the 3D maps, all in the cover's constellation
// style: crystal "atoms", stars, thin bonds, a haze of linked points, a
// starfield backdrop and cleanup helpers.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export { hasWebGL, prefersReducedMotion } from "./support.js";

function additive(material) {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  return material;
}

// Stars: round soft points whose pixel size stays the same at any zoom.
// aLevel brightens (>1) or dims (<1) a point.
const POINT_SHADER = {
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

// Lines and faces with a colour and an alpha per vertex.
const LINE_SHADER = {
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

export function createRenderer(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  return renderer;
}

export function disposeObject(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value && value.isTexture && !value.userData.shared) value.dispose();
      }
      material.dispose();
    }
  });
}

// Seeded random so layouts and backdrops look the same every visit.
export function seededRandom(seed = 1) {
  let value = Math.floor(Math.abs(seed) * 2147483647) % 2147483647 || 1;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function fibonacciDirections(count) {
  const directions = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    directions.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  return directions;
}

// Bond: a thin cylinder fading between the two atom colors. With uDash > 0 it
// becomes an animated dashed bond flowing from A to B (used for user links).
export function createBondMaterial(colorA, colorB, { opacity = 0.55, dash = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(colorA) },
      uB: { value: new THREE.Color(colorB) },
      uOpacity: { value: opacity },
      uDash: { value: dash },
      uTime: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uA;
      uniform vec3 uB;
      uniform float uOpacity;
      uniform float uDash;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        if (uDash > 0.0 && fract(vUv.y * uDash - uTime * 0.9) < 0.42) discard;
        float facing = abs(dot(vNormalV, vViewV));
        vec3 color = mix(uA, uB, vUv.y);
        gl_FragColor = vec4(color * 1.15, uOpacity * (0.45 + 0.55 * facing));
      }
    `
  });
}

const UP = new THREE.Vector3(0, 1, 0);

// Cylinder from a to b. CylinderGeometry's uv.y runs 0 at the bottom to 1 at
// the top, so the mesh is oriented with its top at b.
export function createBond(a, b, material, radius = 0.035) {
  const direction = new THREE.Vector3().subVectors(b, a);
  const length = Math.max(direction.length(), 0.0001);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10, 1, true), material);
  mesh.position.copy(a).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize());
  mesh.userData.length = length;
  return mesh;
}

// Soft round glow texture for sprites, drawn once on a canvas.
let glowTexture = null;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.2, "rgba(255,255,255,0.5)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  glowTexture.userData.shared = true;
  return glowTexture;
}

export function createGlow(color, scale, opacity = 0.55) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }));
  sprite.scale.setScalar(scale);
  return sprite;
}

// Irregular polyhedron: each corner nudged so no two crystals look alike.
function crystalGeometry(shape, radius, random) {
  const base = shape === "crystal"
    ? new THREE.OctahedronGeometry(radius * 1.25, 0)
    : shape === "shard"
      ? new THREE.TetrahedronGeometry(radius * 1.3, 0)
      : new THREE.IcosahedronGeometry(radius * 1.15, 0);
  const geometry = mergeVertices(base);
  base.dispose();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const scale = 0.72 + random() * 0.58;
    positions.setXYZ(i, positions.getX(i) * scale, positions.getY(i) * scale * (0.85 + random() * 0.4), positions.getZ(i) * scale);
  }
  return geometry;
}

let atomSeed = 1;

// An atom in the constellation style: a bright star at the centre, a soft
// glow, and (unless shape is "star") an irregular wireframe crystal around it.
// shape: "gem" (icosahedron), "shard" (tetrahedron), "crystal" (octahedron)
// or "star". userData.sphere is an invisible mesh used for picking.
export function createAtom({ color, radius, glow = 4.2, glowOpacity = 0.5, shape = "gem", seed, hitRadius }) {
  const group = new THREE.Group();
  const random = seededRandom(seed ?? (atomSeed += 1) * 0.6180339);
  const tint = new THREE.Color(color);
  const star = shape === "star";
  const halo = createGlow(color, radius * glow, glowOpacity * 0.55);
  const core = createGlow(tint.clone().lerp(new THREE.Color("#ffffff"), 0.55), radius * (star ? 3.4 : 1.4), 0.95);
  group.add(halo, core);
  let body = null;
  let edges = null;
  let fill = null;
  if (!star) {
    const geometry = crystalGeometry(shape, radius, random);
    edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), additive(new THREE.LineBasicMaterial({ color: tint, opacity: 0.85 })));
    fill = new THREE.Mesh(geometry, additive(new THREE.MeshBasicMaterial({ color: tint, opacity: 0.07, side: THREE.DoubleSide })));
    body = new THREE.Group();
    body.add(fill, edges);
    body.rotation.set(random() * Math.PI, random() * Math.PI, 0);
    group.add(body);
  }
  const hit = new THREE.Mesh(new THREE.SphereGeometry(hitRadius ?? Math.max(radius * 1.5, 0.08), 10, 10), new THREE.MeshBasicMaterial({ visible: false }));
  group.add(hit);
  group.userData = { sphere: hit, halo, core, body, edges, fill, color: tint, radius, baseGlow: glowOpacity * 0.55, spin: 0.15 + random() * 0.25 };
  return group;
}

export function setAtomIntensity(atom, intensity) {
  const data = atom.userData;
  data.halo.material.opacity = data.baseGlow * Math.min(1.6, intensity);
  data.core.material.opacity = Math.min(1, 0.95 * intensity);
  if (data.edges) data.edges.material.opacity = Math.min(1, 0.72 * intensity);
  if (data.fill) data.fill.material.opacity = 0.07 * Math.min(1.6, intensity);
}

// Slow tumble for an atom's crystal; dt in seconds.
export function spinAtom(atom, dt) {
  const { body, spin } = atom.userData;
  if (!body) return;
  body.rotation.y += spin * dt;
  body.rotation.x += spin * 0.6 * dt;
}

// Hairline links like the cover's plexus: one LineSegments for many links.
// links: [{ a, b, colorA, colorB, alpha }] with a/b as Vector3.
// faces (optional): [{ points: [p, q, r], colors: [c1, c2, c3], alpha }].
// setLevel(index, level) scales one link's brightness (1 = as given).
export function createLinks(links, faces = []) {
  const group = new THREE.Group();
  const base = new Float32Array(links.length * 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(links.flatMap(link => [...link.a.toArray(), ...link.b.toArray()])), 3));
  geometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(links.flatMap(link => [...new THREE.Color(link.colorA).toArray(), ...new THREE.Color(link.colorB ?? link.colorA).toArray()])), 3));
  links.forEach((link, index) => {
    base[index * 2] = link.alpha;
    base[index * 2 + 1] = link.alpha;
  });
  const alpha = new THREE.BufferAttribute(base.slice(), 1);
  geometry.setAttribute("aAlpha", alpha);
  const lines = new THREE.LineSegments(geometry, additive(new THREE.ShaderMaterial({ ...LINE_SHADER })));
  group.add(lines);
  if (faces.length) {
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(faces.flatMap(face => face.points.flatMap(point => point.toArray()))), 3));
    faceGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(faces.flatMap(face => face.colors.flatMap(color => new THREE.Color(color).toArray()))), 3));
    faceGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(faces.flatMap(face => [face.alpha, face.alpha, face.alpha])), 1));
    group.add(new THREE.Mesh(faceGeometry, additive(new THREE.ShaderMaterial({ ...LINE_SHADER, side: THREE.DoubleSide }))));
  }
  return {
    group,
    setLevel(index, level) {
      alpha.array[index * 2] = base[index * 2] * level;
      alpha.array[index * 2 + 1] = base[index * 2 + 1] * level;
      alpha.needsUpdate = true;
    }
  };
}

// A haze of small stars filling an ellipsoid, linked to their nearest
// neighbours with faint lines and triangles: the cover's nebula look.
export function createHaze({ radius = 2.5, scale = [1, 0.75, 0.85], count = 160, colors = ["#9fc2ff"], seed = 5, lineAlpha = 0.08, faceAlpha = 0.03 } = {}) {
  const random = seededRandom(seed);
  const palette = colors.map(color => new THREE.Color(color));
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * Math.cbrt(random());
    points.push({
      position: new THREE.Vector3(Math.cos(theta) * s * r * scale[0], u * r * scale[1], Math.sin(theta) * s * r * scale[2]),
      color: palette[Math.floor(random() * palette.length)],
      size: 1.3 + random() * 1.2
    });
  }

  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(points.flatMap(p => p.position.toArray())), 3));
  pointGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(points.flatMap(p => p.color.toArray())), 3));
  pointGeometry.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(points.map(p => p.size)), 1));
  pointGeometry.setAttribute("aLevel", new THREE.BufferAttribute(new Float32Array(count).fill(0.6), 1));
  pointGeometry.setAttribute("aPhase", new THREE.BufferAttribute(new Float32Array(points.map(() => random() * Math.PI * 2)), 1));
  const pointMaterial = additive(new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }, uRefDistance: { value: 10 } },
    ...POINT_SHADER
  }));

  // Two nearest neighbours each, then every closed triangle among them.
  const maxDistance = radius * 0.5;
  const neighbours = points.map(() => new Set());
  points.forEach((point, i) => {
    points
      .map((other, j) => ({ j, d: point.position.distanceTo(other.position) }))
      .filter(item => item.j !== i && item.d <= maxDistance)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .forEach(({ j }) => {
        neighbours[i].add(j);
        neighbours[j].add(i);
      });
  });
  const pairs = [];
  const triangles = [];
  neighbours.forEach((set, i) => {
    for (const j of set) {
      if (j < i) continue;
      pairs.push([i, j]);
      for (const k of set) if (k > j && neighbours[j].has(k)) triangles.push([i, j, k]);
    }
  });

  const lineGeometry = new THREE.BufferGeometry();
  lineGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pairs.flatMap(([a, b]) => [...points[a].position.toArray(), ...points[b].position.toArray()])), 3));
  lineGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(pairs.flatMap(([a, b]) => [...points[a].color.toArray(), ...points[b].color.toArray()])), 3));
  lineGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(pairs.length * 2).fill(lineAlpha), 1));
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(triangles.flatMap(t => t.flatMap(index => points[index].position.toArray()))), 3));
  faceGeometry.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(triangles.flatMap(t => t.flatMap(index => points[index].color.toArray()))), 3));
  faceGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(triangles.length * 3).fill(faceAlpha), 1));

  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(faceGeometry, additive(new THREE.ShaderMaterial({ ...LINE_SHADER, side: THREE.DoubleSide }))),
    new THREE.LineSegments(lineGeometry, additive(new THREE.ShaderMaterial({ ...LINE_SHADER }))),
    new THREE.Points(pointGeometry, pointMaterial)
  );
  group.children.forEach(child => {
    child.frustumCulled = false;
  });
  return {
    group,
    // refDistance: camera distance, so stars keep their pixel size.
    update(time, refDistance) {
      pointMaterial.uniforms.uTime.value = time;
      pointMaterial.uniforms.uRefDistance.value = refDistance;
    }
  };
}

export function createStarfield({ count = 1400, inner = 25, outer = 70, seed = 3 } = {}) {
  const random = seededRandom(seed);
  const positions = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const size = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const u = random() * 2 - 1;
    const theta = random() * Math.PI * 2;
    const r = inner + random() * (outer - inner);
    const s = Math.sqrt(1 - u * u);
    positions[i * 3] = Math.cos(theta) * s * r;
    positions[i * 3 + 1] = u * r;
    positions[i * 3 + 2] = Math.sin(theta) * s * r;
    phase[i] = random() * Math.PI * 2;
    size[i] = 0.5 + random() * random() * 2.2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phase, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vAlpha;
      void main() {
        vAlpha = 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * 0.7 + aPhase));
        gl_PointSize = aSize * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(0.8, 0.88, 1.0, smoothstep(0.5, 0.0, d) * vAlpha * 0.8);
      }
    `
  });
  const points = new THREE.Points(geometry, material);
  return { points, update(time) { material.uniforms.uTime.value = time; } };
}

// Camera distance at which a sphere of `radius` fills `screenFraction` of the
// viewport height (as a radius), for a perspective camera.
export function distanceForScreenRadius(camera, radius, screenFraction) {
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const angle = Math.atan(screenFraction * 2 * Math.tan(halfFov));
  return radius / Math.sin(angle);
}
