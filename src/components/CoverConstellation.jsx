import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasWebGL } from "../three/support.js";
import { TREE_BESIDE_BREAKPOINT } from "../lib/coverLayout.js";

// Where the nebula goes while the tree is open: the view shifts left by this
// share of the width, and the nebula shrinks to fit this share.
const SLIDE_SHIFT = 0.2;
const SLIDE_SPACE = 0.34;
// How long a name stays up after the pointer leaves both its star and the
// path to its name.
const HOVER_GRACE_MS = 450;
// While a name is showing, another star must be hovered this long to take
// over, so passing over stars on the way to the name doesn't swap it.
const HOVER_SWITCH_MS = 160;

function canHover() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(hover: hover)").matches);
}

// The cover map: a 3D constellation of divisions, rooms, sub-rooms and notes.
// divisions: [{ code, label, name, color }]; graph: buildCoverGraph() output.
// highlightId: a star to light up from outside the map (e.g. hovering the tree
// menu); it gets the ring only, since the tree already shows its name.
// anchorRef: receives the selected division star's position every frame, so
// the tree menu's curves can start from it.
export default function CoverConstellation({ graph, divisions, selectedDivision = "", highlightId = "", anchorRef, panel = null, onSelectNode, onSelectDivision, onBackground, children }) {
  const sectionRef = useRef(null);
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const labelRef = useRef(null);
  const reticleRef = useRef(null);
  const hubButtons = useRef(new Map());
  const hideTimer = useRef(0);
  const switchTimer = useRef(0);
  const pointerRef = useRef(null); // last pointer position (client coords)
  const sceneHoverRef = useRef(null); // star currently under the pointer
  const widthRef = useRef(0);
  const engagedRef = useRef(false);
  const [webgl] = useState(() => hasWebGL());
  const [ready, setReady] = useState(false);
  const [hoveredNode, setHoveredNode] = useState(null);
  const hoveredRef = useRef(null);
  hoveredRef.current = hoveredNode;
  const [ringNode, setRingNode] = useState(null);
  const ringRef = useRef(null);
  ringRef.current = ringNode;
  const selectRef = useRef(onSelectNode);
  selectRef.current = onSelectNode;
  const backgroundRef = useRef(onBackground);
  backgroundRef.current = onBackground;
  const selectedRef = useRef(selectedDivision);
  selectedRef.current = selectedDivision;

  const graphKey = useMemo(() => graph.nodes.map(node => `${node.id}:${node.label}:${node.size.toFixed(1)}:${node.color}`).join("|") + `#${graph.links.length}`, [graph]);

  const showNode = useCallback(node => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(switchTimer.current);
    setHoveredNode(node || null);
  }, []);
  const hideNodeSoon = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(switchTimer.current);
    hideTimer.current = window.setTimeout(() => setHoveredNode(null), HOVER_GRACE_MS);
  }, []);
  // Is the pointer on the shown star, its name, or the stretch between them?
  // Then the name stays, however slowly the pointer travels.
  const nearShownName = useCallback(() => {
    const point = pointerRef.current;
    const shown = hoveredRef.current;
    const label = labelRef.current;
    const host = hostRef.current;
    const spot = shown && sceneRef.current?.screenPosition(shown.id);
    if (!point || !label || !host || !spot) return false;
    const box = host.getBoundingClientRect();
    const name = label.getBoundingClientRect();
    const reach = spot.extent + 14;
    const left = Math.min(name.left, box.left + spot.x - reach) - 12;
    const right = Math.max(name.right, box.left + spot.x + reach) + 12;
    const top = Math.min(name.top, box.top + spot.y - reach) - 12;
    const bottom = Math.max(name.bottom, box.top + spot.y + reach) + 12;
    return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
  }, []);

  // Hover from the map: show at once when nothing is showing, otherwise only
  // after the pointer rests on the new star.
  const hoverFromMap = useCallback(node => {
    sceneHoverRef.current = node || null;
    if (!node) {
      window.clearTimeout(switchTimer.current);
      if (!nearShownName()) hideNodeSoon();
      return;
    }
    const current = hoveredRef.current;
    if (!current || current.id === node.id) return showNode(node);
    window.clearTimeout(switchTimer.current);
    switchTimer.current = window.setTimeout(() => showNode(node), HOVER_SWITCH_MS);
  }, [showNode, hideNodeSoon, nearShownName]);
  useEffect(() => () => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(switchTimer.current);
  }, []);

  // Runs every frame: keep the name, ring and keyboard targets on their stars.
  const placeOverlays = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const width = widthRef.current;
    const hovered = hoveredRef.current;
    const label = labelRef.current;
    const reticle = reticleRef.current;
    const spot = hovered ? scene.screenPosition(hovered.id) : null;
    const ringed = ringRef.current || hovered;
    const ringSpot = ringed ? scene.screenPosition(ringed.id) : null;
    if (label) {
      label.classList.toggle("is-visible", Boolean(spot));
      if (spot) {
        const x = Math.min(Math.max(spot.x, 90), Math.max(90, width - 90));
        label.style.transform = `translate(${x.toFixed(1)}px, ${(spot.y + spot.extent + 6).toFixed(1)}px) translateX(-50%)`;
      }
    }
    if (reticle) {
      reticle.classList.toggle("is-visible", Boolean(ringSpot));
      if (ringSpot) {
        const ring = ringSpot.extent * 2 + 16;
        reticle.style.width = `${ring}px`;
        reticle.style.height = `${ring}px`;
        reticle.style.transform = `translate(${(ringSpot.x - ring / 2).toFixed(1)}px, ${(ringSpot.y - ring / 2).toFixed(1)}px)`;
      }
    }
    if (anchorRef) {
      const selected = selectedRef.current;
      anchorRef.current = selected ? scene.screenPosition(`division:${selected}`) : null;
    }
    for (const [code, button] of hubButtons.current) {
      const point = scene.screenPosition(`division:${code}`);
      if (point) button.style.transform = `translate(${(point.x - 16).toFixed(1)}px, ${(point.y - 16).toFixed(1)}px)`;
    }
  }, [anchorRef]);

  const applyFocus = useCallback(() => {
    const beside = widthRef.current >= TREE_BESIDE_BREAKPOINT;
    // On narrow screens the tree sits under the map, so the map stays put.
    sceneRef.current?.setFocus(Boolean(selectedDivision), beside ? { shift: SLIDE_SHIFT, available: SLIDE_SPACE, present: true } : {});
  }, [selectedDivision]);

  const applyFocusRef = useRef(applyFocus);
  applyFocusRef.current = applyFocus;

  useEffect(() => {
    if (!webgl) return undefined;
    let cancelled = false;
    let scene = null;
    let resizeObserver = null;
    let visibility = null;
    import("../three/constellation.js")
      .then(({ mountConstellation }) => {
        const host = hostRef.current;
        if (cancelled || !host) return;
        scene = mountConstellation(host, {
          onHover: hoverFromMap,
          onSelect: node => selectRef.current?.(node),
          onBackground: () => backgroundRef.current?.(),
          onFrame: placeOverlays
        });
        sceneRef.current = scene;
        const resize = () => {
          const box = host.getBoundingClientRect();
          widthRef.current = box.width;
          scene.resize(box.width, box.height);
        };
        resize();
        resizeObserver = new ResizeObserver(() => {
          resize();
          applyFocusRef.current();
        });
        resizeObserver.observe(host);
        visibility = new IntersectionObserver(([entry]) => scene.setVisible(entry.isIntersecting));
        visibility.observe(host);
        scene.setEngaged(engagedRef.current || !canHover());
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      visibility?.disconnect();
      scene?.dispose();
      sceneRef.current = null;
      setReady(false);
    };
  }, [webgl, hoverFromMap, placeOverlays]);

  useEffect(() => {
    if (ready) sceneRef.current?.setGraph(graph);
    // graphKey changes whenever anything drawn changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, graphKey]);

  useEffect(() => {
    sceneRef.current?.setSelected(selectedDivision);
    applyFocus();
  }, [selectedDivision, applyFocus, ready]);

  useEffect(() => {
    if (!ready) return;
    const graphNode = highlightId ? graph.nodes.find(node => node.id === highlightId) : null;
    sceneRef.current?.setActive(graphNode ? highlightId : null);
    setRingNode(graphNode || null);
    if (graphNode) {
      // Pointing at the tree: no name box on the map, just the ring.
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(switchTimer.current);
      setHoveredNode(null);
    }
    // Only react to highlight changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightId, ready]);

  // Lines and triangles show while the pointer is over the map. Pointer moves
  // also count, in case the pointer was already there when the map loaded.
  function trackPointer(event) {
    engage(true);
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (!hoveredRef.current || sceneHoverRef.current) return;
    if (nearShownName()) {
      window.clearTimeout(hideTimer.current);
    } else if (event.target === sceneRef.current?.canvas) {
      hideNodeSoon();
    }
  }

  function engage(on) {
    if (!canHover() || engagedRef.current === on) return;
    engagedRef.current = on;
    sceneRef.current?.setEngaged(on);
  }

  const classes = ["cover-map", ready ? "is-ready" : "", selectedDivision ? "has-selection" : "", webgl ? "" : "no-webgl"].filter(Boolean).join(" ");

  return (
    <section className={classes} ref={sectionRef} aria-label="ARE study map" onPointerEnter={() => engage(true)} onPointerMove={trackPointer} onPointerLeave={() => { engage(false); hideNodeSoon(); }}>
      {children}
      <div className="cover-canvas" ref={hostRef} />
      <div className="star-reticle" ref={reticleRef} aria-hidden="true" style={{ "--atom": (ringNode || hoveredNode)?.color }} />
      <button
        type="button"
        className="star-label"
        ref={labelRef}
        tabIndex={-1}
        aria-hidden="true"
        style={{ "--atom": hoveredNode?.color }}
        onMouseEnter={() => {
          window.clearTimeout(hideTimer.current);
          window.clearTimeout(switchTimer.current);
        }}
        onMouseLeave={hideNodeSoon}
        onClick={() => hoveredNode && onSelectNode(hoveredNode)}
      >
        {/* Just the name; a division also gets its full name underneath. */}
        {hoveredNode ? (
          <>
            <b>{hoveredNode.label}</b>
            {hoveredNode.kind === "division" ? <span>{divisions.find(item => `division:${item.code}` === hoveredNode.id)?.name}</span> : null}
          </>
        ) : null}
      </button>

      {/* Keyboard access: one invisible button per division, sitting on its star. */}
      <div className="hub-buttons">
        {divisions.map(item => (
          <button
            key={item.code}
            type="button"
            ref={element => {
              if (element) hubButtons.current.set(item.code, element);
              else hubButtons.current.delete(item.code);
            }}
            aria-label={`${item.label} — ${item.name}`}
            onFocus={() => {
              sceneRef.current?.setActive(`division:${item.code}`);
              showNode(graph.nodes.find(node => node.id === `division:${item.code}`));
            }}
            onBlur={() => {
              sceneRef.current?.setActive(null);
              hideNodeSoon();
            }}
            // detail is 0 when Enter or Space pressed the button.
            onClick={event => onSelectDivision(item.code, { keyboard: event.detail === 0 })}
          />
        ))}
      </div>

      {/* Touch screens can't hover, and some browsers have no WebGL: list the divisions. */}
      <div className="cover-chips">
        {divisions.map(item => (
          <button key={item.code} type="button" className={item.code === selectedDivision ? "is-current" : ""} style={{ "--atom": item.color }} onClick={() => onSelectDivision(item.code)}>
            <b>{item.label}</b>
            <span>{item.name}</span>
          </button>
        ))}
      </div>

      {panel ? <div className="cover-overlay">{panel}</div> : null}
    </section>
  );
}
