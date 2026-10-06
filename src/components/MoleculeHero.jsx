import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flatProjection, heroAtomLayout } from "../three/heroLayout.js";
import { hasWebGL } from "../three/support.js";

// Below this width the labels stack under the molecule and lines are hidden.
const STACKED_BREAKPOINT = 760;

function setRef(map, id) {
  return element => {
    if (element) map.set(id, element);
    else map.delete(id);
  };
}

// A 3D molecule with leader-line callouts. Each atom is clickable, both in
// the scene and through its label. atoms: [{ id, color, size (0-1),
// satellites, eyebrow, title, meta, onSelect }]
export default function MoleculeHero({ mode = "ring", centerColor = "#5a8dff", atoms = [], label, children }) {
  const sectionRef = useRef(null);
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const refs = useRef({ labels: new Map(), paths: new Map(), reticles: new Map(), tips: new Map(), fallback: new Map() });
  const metrics = useRef({ width: 0, height: 0, radius: 0, ends: new Map() });
  const [activeId, setActiveId] = useState("");
  const [sceneReady, setSceneReady] = useState(false);

  const layout = useMemo(() => heroAtomLayout(atoms.length, { zigzag: mode === "center" ? 0.32 : 0 }), [atoms.length, mode]);
  const placed = atoms.map((atom, index) => ({ ...atom, ...layout[index] }));
  const leftColumn = placed.filter(atom => atom.side === "left").sort((a, b) => a.row - b.row);
  const rightColumn = placed.filter(atom => atom.side === "right").sort((a, b) => a.row - b.row);
  const placedRef = useRef(placed);
  placedRef.current = placed;

  const sceneKey = `${mode}|${centerColor}|${atoms.map(atom => `${atom.id}:${atom.color}:${Math.round((atom.size || 0) * 10)}:${atom.satellites || 0}`).join(",")}`;
  const labelKey = atoms.map(atom => `${atom.id}:${atom.eyebrow}:${atom.title}:${atom.meta}`).join("|");

  const draw = useCallback(() => {
    const { width, height, radius, ends } = metrics.current;
    if (!width || width < STACKED_BREAKPOINT) return;
    const scene = sceneRef.current;
    for (const atom of placedRef.current) {
      const flat = flatProjection(atom, width, height, radius);
      const point = scene?.project(atom.id) || { ...flat, r: radius * 0.13 };
      const fallback = refs.current.fallback.get(atom.id);
      if (fallback) {
        fallback.setAttribute("cx", flat.x.toFixed(1));
        fallback.setAttribute("cy", flat.y.toFixed(1));
        fallback.setAttribute("r", (radius * 0.11).toFixed(1));
      }
      const end = ends.get(atom.id);
      const path = refs.current.paths.get(atom.id);
      const reticle = refs.current.reticles.get(atom.id);
      const tip = refs.current.tips.get(atom.id);
      if (!end || !path || !reticle || !tip) continue;
      const ring = point.r + 8;
      const elbowX = end.x + (atom.side === "left" ? 44 : -44);
      const dx = elbowX - point.x;
      const dy = end.y - point.y;
      const length = Math.hypot(dx, dy) || 1;
      const startX = point.x + (dx / length) * ring;
      const startY = point.y + (dy / length) * ring;
      path.setAttribute("d", `M${startX.toFixed(1)} ${startY.toFixed(1)} L${elbowX.toFixed(1)} ${end.y.toFixed(1)} L${end.x.toFixed(1)} ${end.y.toFixed(1)}`);
      reticle.setAttribute("cx", point.x.toFixed(1));
      reticle.setAttribute("cy", point.y.toFixed(1));
      reticle.setAttribute("r", ring.toFixed(1));
      tip.setAttribute("cx", end.x.toFixed(1));
      tip.setAttribute("cy", end.y.toFixed(1));
    }
  }, []);

  const measure = useCallback(() => {
    const section = sectionRef.current;
    const host = hostRef.current;
    if (!section || !host) return;
    // The canvas fills the hero on wide screens and only its top part on
    // narrow ones, so measure the canvas box rather than the section.
    const box = host.getBoundingClientRect();
    const width = box.width;
    const height = box.height;
    const radius = Math.max(100, Math.min(height * 0.34, width * (width < STACKED_BREAKPOINT ? 0.34 : 0.22)));
    metrics.current.width = width;
    metrics.current.height = height;
    metrics.current.radius = radius;
    section.style.setProperty("--hero-radius", `${radius}px`);
    metrics.current.ends = new Map();
    const range = document.createRange();
    for (const [id, element] of refs.current.labels) {
      // Aim at the end of the eyebrow's first line, even when it wraps.
      const mark = element.querySelector(".callout-eyebrow") || element;
      range.selectNodeContents(mark);
      const rect = range.getClientRects()[0] || mark.getBoundingClientRect();
      const left = element.dataset.side === "left";
      metrics.current.ends.set(id, {
        x: (left ? rect.right + 10 : rect.left - 10) - box.left,
        y: rect.top + rect.height / 2 - box.top
      });
    }
    sceneRef.current?.resize(width, height, radius);
    draw();
  }, [draw]);

  useLayoutEffect(() => {
    measure();
  }, [labelKey, measure]);

  useEffect(() => {
    sceneRef.current?.setActive(activeId);
  }, [activeId]);

  // Load three.js only when a hero is on screen; the page renders without it.
  useEffect(() => {
    if (!hasWebGL()) return undefined;
    let cancelled = false;
    let scene = null;
    import("../three/moleculeHero.js")
      .then(({ mountMoleculeHero }) => {
        if (cancelled || !hostRef.current) return;
        scene = mountMoleculeHero(hostRef.current, {
          mode,
          centerColor,
          atoms: placedRef.current.map(({ id, color, size, satellites }) => ({ id, color, size, satellites })),
          onFrame: draw,
          onHover: id => setActiveId(id || ""),
          onSelect: id => placedRef.current.find(atom => atom.id === id)?.onSelect?.()
        });
        sceneRef.current = scene;
        setSceneReady(true);
        measure();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      scene?.dispose();
      sceneRef.current = null;
      setSceneReady(false);
    };
    // sceneKey captures everything the scene is built from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneKey]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return undefined;
    const resizeObserver = new ResizeObserver(() => measure());
    resizeObserver.observe(section);
    const visibility = new IntersectionObserver(([entry]) => sceneRef.current?.setVisible(entry.isIntersecting));
    visibility.observe(section);
    document.fonts?.ready.then(() => measure()).catch(() => {});
    function handlePointer(event) {
      const box = section.getBoundingClientRect();
      sceneRef.current?.setPointer(((event.clientX - box.left) / box.width) * 2 - 1, -(((event.clientY - box.top) / box.height) * 2 - 1));
    }
    section.addEventListener("pointermove", handlePointer);
    return () => {
      resizeObserver.disconnect();
      visibility.disconnect();
      section.removeEventListener("pointermove", handlePointer);
    };
  }, [measure]);

  function renderCallout(atom) {
    return (
      <button
        key={atom.id}
        type="button"
        ref={setRef(refs.current.labels, atom.id)}
        data-side={atom.side}
        className={`hero-callout${activeId === atom.id ? " is-active" : ""}`}
        style={{ "--atom": atom.color }}
        onMouseEnter={() => setActiveId(atom.id)}
        onMouseLeave={() => setActiveId("")}
        onFocus={() => setActiveId(atom.id)}
        onBlur={() => setActiveId("")}
        onClick={atom.onSelect}
      >
        <span className="callout-eyebrow">{atom.eyebrow}</span>
        <span className="callout-title">{atom.title}</span>
        {atom.meta ? <span className="callout-meta">{atom.meta}</span> : null}
      </button>
    );
  }

  return (
    <section className={`molecule-hero molecule-hero--${mode}${sceneReady ? " is-ready" : ""}`} ref={sectionRef} aria-label={label}>
      <div className="hero-canvas" ref={hostRef} />
      <svg className="hero-lines" aria-hidden="true">
        {!sceneReady ? placed.map(atom => (
          <circle key={`fallback-${atom.id}`} className="hero-fallback-atom" ref={setRef(refs.current.fallback, atom.id)} style={{ "--atom": atom.color }} />
        )) : null}
        {placed.map(atom => (
          <g key={atom.id} className={activeId === atom.id ? "is-active" : ""} style={{ "--atom": atom.color }}>
            <circle className="hero-reticle" ref={setRef(refs.current.reticles, atom.id)} />
            <path className="hero-line" ref={setRef(refs.current.paths, atom.id)} />
            <circle className="hero-tip" r="2.6" ref={setRef(refs.current.tips, atom.id)} />
          </g>
        ))}
      </svg>
      <div className="hero-center">{children}</div>
      <div className="hero-callouts hero-callouts--left">{leftColumn.map(renderCallout)}</div>
      <div className="hero-callouts hero-callouts--right">{rightColumn.map(renderCallout)}</div>
    </section>
  );
}
