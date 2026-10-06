// Resting positions of the hero molecule's main atoms, in molecule units with
// the ring radius = 1. No three.js here so the page can place callout labels
// before the 3D scene has loaded.

export const HERO_TILT_X = -0.42; // radians; tips the top of the ring away from the viewer

// Atoms sit on a ring starting just left of the top, going counter-clockwise,
// so no atom lands dead-center on top. Each atom gets a label column (left or
// right) and a row order (top to bottom) so leader lines never cross.
export function heroAtomLayout(count, { zigzag = 0 } = {}) {
  if (!count) return [];
  const start = Math.PI / 2 + Math.PI / count;
  const atoms = Array.from({ length: count }, (_, index) => {
    const angle = start + (index * 2 * Math.PI) / count;
    return {
      index,
      x: Math.cos(angle),
      y: Math.sin(angle),
      z: zigzag ? (index % 2 ? zigzag : -zigzag) : 0
    };
  });

  const left = [];
  const right = [];
  for (const atom of atoms) {
    if (atom.x < -1e-6) left.push(atom);
    else if (atom.x > 1e-6) right.push(atom);
  }
  for (const atom of atoms) {
    if (Math.abs(atom.x) <= 1e-6) (left.length <= right.length ? left : right).push(atom);
  }
  const byHeight = (a, b) => b.y - a.y;
  left.sort(byHeight).forEach((atom, row) => Object.assign(atom, { side: "left", row }));
  right.sort(byHeight).forEach((atom, row) => Object.assign(atom, { side: "right", row }));
  return atoms;
}

// Where an atom appears on screen when the scene isn't available (no WebGL,
// or still loading): an orthographic view of the tilted ring.
export function flatProjection(atom, width, height, radiusPx) {
  const cos = Math.cos(HERO_TILT_X);
  const sin = Math.sin(HERO_TILT_X);
  const y = atom.y * cos - atom.z * sin;
  return { x: width / 2 + atom.x * radiusPx, y: height / 2 - y * radiusPx };
}
