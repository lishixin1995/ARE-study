// Shared three.js pieces for the molecule maps: renderer setup, glowing atom
// and bond materials, a dust/starfield backdrop and cleanup helpers.
import * as THREE from "three";

export { hasWebGL, prefersReducedMotion } from "./support.js";

// Light direction in view space, so highlights stay put while the user orbits.
const LIGHT_VIEW = "normalize(vec3(-0.45, 0.6, 0.65))";

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

// Glassy atom: dark core, bright fresnel rim, small specular glint.
export function createAtomMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 1 } },
    vertexShader: `
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormalV;
      varying vec3 vViewV;
      void main() {
        vec3 light = ${LIGHT_VIEW};
        float facing = clamp(dot(vNormalV, vViewV), 0.0, 1.0);
        float rim = pow(1.0 - facing, 2.0);
        float diffuse = clamp(dot(vNormalV, light), 0.0, 1.0);
        float spec = pow(max(dot(vNormalV, normalize(light + vViewV)), 0.0), 70.0);
        vec3 color = uColor * (0.1 + 0.5 * diffuse) + uColor * rim * 1.5 + vec3(1.0) * spec * 0.9;
        gl_FragColor = vec4(color * uIntensity, 1.0);
      }
    `
  });
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

// An atom: glassy sphere (or faceted crystal) plus a soft glow halo.
export function createAtom({ color, radius, glow = 4.2, glowOpacity = 0.5, detail = 32, shape = "sphere" }) {
  const group = new THREE.Group();
  const material = createAtomMaterial(color);
  const geometry = shape === "crystal" ? new THREE.OctahedronGeometry(radius * 1.3, 0) : new THREE.SphereGeometry(radius, detail, detail);
  const sphere = new THREE.Mesh(geometry, material);
  const halo = createGlow(color, radius * glow, glowOpacity);
  group.add(halo, sphere);
  group.userData = { sphere, halo, material, radius, baseGlow: glowOpacity };
  return group;
}

export function setAtomIntensity(atom, intensity) {
  atom.userData.material.uniforms.uIntensity.value = intensity;
  atom.userData.halo.material.opacity = atom.userData.baseGlow * Math.min(1.6, intensity);
}

// Thin circle (electron orbit / aromatic ring) in the XY plane.
export function createRing(radius, color, opacity = 0.2, segments = 160) {
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })
  );
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
