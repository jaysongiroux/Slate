import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { NoteGraphPayload } from "../lib/api/ipc-core";
import { cn } from "../lib/utils";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

/** Padding around point cloud for fit (layout units -- same order as simulation coords). */
const BOUNDS_PAD = 28;
const FIT_PAD = 52;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 10;
const CLICK_MAX_MOVE = 6;

interface SimNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
  t: number;
}

function graphBounds(positions: Map<string, { x: number; y: number }>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positions.values()) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  minX -= BOUNDS_PAD;
  minY -= BOUNDS_PAD;
  maxX += BOUNDS_PAD;
  maxY += BOUNDS_PAD;
  const bw = Math.max(maxX - minX, 1e-6);
  const bh = Math.max(maxY - minY, 1e-6);
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return { minX, maxX, minY, maxY, midX, midY, bw, bh };
}

function fitScale(w: number, h: number, bw: number, bh: number) {
  return Math.min((w - 2 * FIT_PAD) / bw, (h - 2 * FIT_PAD) / bh);
}

/** Radius in layout space so it appears ~`px` on screen after scale `viewScale`. */
function layoutRadiusPx(px: number, viewScale: number) {
  const vs = Math.max(viewScale, 1e-9);
  return Math.min(48 / vs, Math.max(0.2, px / vs));
}

export function NoteGraphView({
  data,
  loading,
  error,
  onSelectNote,
  onRegenerateGraph,
  regenerating,
  className,
}: {
  data: NoteGraphPayload | null;
  loading: boolean;
  error: string | null;
  onSelectNote: (noteId: string) => void;
  onRegenerateGraph?: () => void;
  regenerating?: boolean;
  className?: string;
}) {
  const graphUid = useId().replace(/:/g, "");
  const vignetteId = `note-graph-vignette-${graphUid}`;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(false);

  const viewRef = useRef({ pan: { x: 0, y: 0 }, zoom: 1 });
  viewRef.current = { pan, zoom };

  const panDragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const clickTrackRef = useRef<{
    pointerId: number;
    noteId: string;
    clientX: number;
    clientY: number;
  } | null>(null);

  const nodeDragRef = useRef<{
    pointerId: number;
    nodeId: string;
    startClientX: number;
    startClientY: number;
  } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(320, r.width), h: Math.max(280, r.height) });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(320, r.width), h: Math.max(280, r.height) });
    return () => ro.disconnect();
  }, []);

  const [positions, setPositions] = useState(() => new Map<string, { x: number; y: number }>());
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodesRef = useRef<SimNode[]>([]);

  const metrics = useMemo(() => {
    if (!positions.size) return null;
    const b = graphBounds(positions);
    const s = fitScale(size.w, size.h, b.bw, b.bh);
    return { ...b, s };
  }, [positions, size.w, size.h]);

  const viewScale = metrics ? metrics.s * zoom : 0;

  const geom = useMemo(() => {
    if (!metrics || viewScale <= 0) return null;
    return {
      rCore: layoutRadiusPx(3.4, viewScale),
      rRing: layoutRadiusPx(11, viewScale),
      hitR: layoutRadiusPx(18, viewScale),
    };
  }, [metrics, viewScale]);

  const edgeScoreRange = useMemo(() => {
    const scores = data?.edges.map((e) => e.score) ?? [];
    if (!scores.length) return { min: 0, max: 1 };
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    return { min, max: max <= min ? min + 1e-6 : max };
  }, [data?.edges]);

  const sortedEdges = useMemo(() => {
    if (!data?.edges.length) return [];
    return [...data.edges].sort((a, b) => a.score - b.score);
  }, [data?.edges]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, [data]);

  const nodeById = useMemo(() => new Map(data?.nodes.map((n) => [n.id, n]) ?? []), [data]);

  useEffect(() => {
    // Stop any previous simulation
    simRef.current?.stop();
    simRef.current = null;
    simNodesRef.current = [];

    if (!data?.nodes.length) {
      setPositions(new Map());
      return;
    }

    const cx = size.w / 2;
    const cy = size.h / 2;

    // All nodes start at center with small jitter for symmetry breaking
    const nodes: SimNode[] = data.nodes.map((n) => ({
      id: n.id,
      x: cx + (Math.random() - 0.5) * 10,
      y: cy + (Math.random() - 0.5) * 10,
    }));
    simNodesRef.current = nodes;

    // Normalize edge weights to [0,1]
    const raw = data.edges.map((e) => e.score);
    const wMin = Math.min(...raw);
    const wMax = Math.max(...raw);
    const wSpan = wMax <= wMin ? 1 : wMax - wMin;

    const simLinks: SimLink[] = data.edges.map((e) => {
      const t = Math.min(1, Math.max(0, (e.score - wMin) / wSpan));
      return { source: e.source, target: e.target, t };
    });

    const layoutSpan = Math.min(size.w, size.h) * 0.42;
    const idealFar = layoutSpan * 0.26;
    const idealNear = layoutSpan * 0.038;
    const kSpringBase = 0.052;

    const simulation = forceSimulation<SimNode>(nodes)
      .force("charge", forceManyBody<SimNode>().strength(-220))
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((d) => idealFar - d.t * (idealFar - idealNear))
          .strength((d) => kSpringBase * (0.45 + d.t * d.t * 2.4)),
      )
      .force("x", forceX<SimNode>(cx).strength(0.014))
      .force("y", forceY<SimNode>(cy).strength(0.014))
      .velocityDecay(0.88)
      .on("tick", () => {
        const next = new Map<string, { x: number; y: number }>();
        for (const node of nodes) {
          next.set(node.id, { x: node.x, y: node.y });
        }
        setPositions(next);
      });

    simRef.current = simulation;

    return () => {
      simulation.stop();
    };
  }, [data, size.w, size.h]);

  const clientToSvg = useCallback((svg: SVGSVGElement, clientX: number, clientY: number) => {
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }, []);

  const svgToLayout = useCallback(
    (svgPt: { x: number; y: number }) => {
      if (!metrics) return null;
      const { midX, midY, s } = metrics;
      const z = s * zoom;
      if (Math.abs(z) < 1e-12) return null;
      return {
        x: (svgPt.x - size.w / 2 - pan.x) / z + midX,
        y: (svgPt.y - size.h / 2 - pan.y) / z + midY,
      };
    },
    [metrics, pan.x, pan.y, size.w, size.h, zoom],
  );

  const pickNode = useCallback(
    (layoutX: number, layoutY: number): string | null => {
      if (!geom) return null;
      let best: string | null = null;
      let bestD = geom.hitR;
      for (const [id, pos] of positions) {
        const d = Math.hypot(pos.x - layoutX, pos.y - layoutY);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      return best;
    },
    [positions, geom],
  );

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    if (!metrics) return;
    event.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const svgPt = clientToSvg(svg, event.clientX, event.clientY);
    if (!svgPt) return;

    if (event.shiftKey) {
      setPan((p) => ({ x: p.x - event.deltaY * 0.65, y: p.y - event.deltaX * 0.65 }));
      return;
    }
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      setPan((p) => ({ x: p.x - event.deltaX * 0.65, y: p.y }));
      return;
    }

    const factor = Math.exp(-event.deltaY * 0.0012);
    const { pan: p, zoom: z } = viewRef.current;
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor));
    if (nextZoom === z) return;
    const ratio = nextZoom / z;
    setPan({
      x: svgPt.x - size.w / 2 - (svgPt.x - size.w / 2 - p.x) * ratio,
      y: svgPt.y - size.h / 2 - (svgPt.y - size.h / 2 - p.y) * ratio,
    });
    setZoom(nextZoom);
  };

  const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const svgPt = clientToSvg(svg, event.clientX, event.clientY);
    if (!svgPt || !metrics) return;

    const layoutPt = svgToLayout(svgPt);
    const hit = layoutPt ? pickNode(layoutPt.x, layoutPt.y) : null;

    if (hit && event.button === 0) {
      // Start tracking for both click and drag
      clickTrackRef.current = {
        pointerId: event.pointerId,
        noteId: hit,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      nodeDragRef.current = {
        pointerId: event.pointerId,
        nodeId: hit,
        startClientX: event.clientX,
        startClientY: event.clientY,
      };

      // Pin the node immediately
      const simNode = simNodesRef.current.find((n) => n.id === hit);
      if (simNode && layoutPt) {
        simNode.fx = layoutPt.x;
        simNode.fy = layoutPt.y;
      }

      // Keep simulation warm and responsive for the duration of the drag
      simRef.current?.alphaTarget(0.3).velocityDecay(0.3).restart();

      svg.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button === 0 || event.button === 1) {
      setPanning(true);
      const p0 = viewRef.current.pan;
      panDragRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPanX: p0.x,
        startPanY: p0.y,
      };
      svg.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const wrap = wrapRef.current;
    const svgPt = clientToSvg(svg, event.clientX, event.clientY);
    if (!svgPt) return;

    // Node drag takes priority
    const nodeDrag = nodeDragRef.current;
    if (nodeDrag && nodeDrag.pointerId === event.pointerId) {
      const moved = Math.hypot(
        event.clientX - nodeDrag.startClientX,
        event.clientY - nodeDrag.startClientY,
      );
      if (moved > CLICK_MAX_MOVE) {
        // Past click threshold — this is a real drag
        if (clickTrackRef.current) {
          clickTrackRef.current = null;
          setDragging(true);
        }
        const layoutPt = svgToLayout(svgPt);
        if (layoutPt) {
          const simNode = simNodesRef.current.find((n) => n.id === nodeDrag.nodeId);
          if (simNode) {
            simNode.fx = layoutPt.x;
            simNode.fy = layoutPt.y;
          }
        }
      }
      // Update hover even while dragging
      const layoutPt = svgToLayout(svgPt);
      const id = layoutPt ? pickNode(layoutPt.x, layoutPt.y) : null;
      setHoverId(id);
      if (id && wrap) {
        const r = wrap.getBoundingClientRect();
        setPointer({ x: event.clientX - r.left, y: event.clientY - r.top });
      } else {
        setPointer(null);
      }
      return;
    }

    // Pan drag
    const drag = panDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const rect = svg.getBoundingClientRect();
      const sx = size.w / Math.max(rect.width, 1e-6);
      const sy = size.h / Math.max(rect.height, 1e-6);
      const dx = (event.clientX - drag.startClientX) * sx;
      const dy = (event.clientY - drag.startClientY) * sy;
      setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
    }

    // Hover detection
    const layoutPt = svgToLayout(svgPt);
    const id = layoutPt ? pickNode(layoutPt.x, layoutPt.y) : null;
    setHoverId(id);
    if (id && wrap) {
      const r = wrap.getBoundingClientRect();
      setPointer({ x: event.clientX - r.left, y: event.clientY - r.top });
    } else {
      setPointer(null);
    }

    // Legacy click-to-pan promotion (for clicks that miss nodes but move enough)
    const track = clickTrackRef.current;
    if (track && track.pointerId === event.pointerId && !nodeDragRef.current) {
      const moved = Math.hypot(event.clientX - track.clientX, event.clientY - track.clientY);
      if (moved > CLICK_MAX_MOVE) {
        setPanning(true);
        const p0 = viewRef.current.pan;
        panDragRef.current = {
          pointerId: event.pointerId,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPanX: p0.x,
          startPanY: p0.y,
        };
        svg.setPointerCapture(event.pointerId);
        clickTrackRef.current = null;
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;

    // Handle click (node drag that didn't exceed movement threshold)
    const track = clickTrackRef.current;
    if (track && track.pointerId === event.pointerId) {
      const moved = Math.hypot(event.clientX - track.clientX, event.clientY - track.clientY);
      if (moved <= CLICK_MAX_MOVE) {
        onSelectNote(track.noteId);
      }
      clickTrackRef.current = null;
    }

    // Clean up node drag (node stays pinned — fx/fy remain set)
    if (nodeDragRef.current?.pointerId === event.pointerId) {
      nodeDragRef.current = null;
      setDragging(false);
      // Restore damping and let simulation cool down naturally
      simRef.current?.alphaTarget(0).velocityDecay(0.5);
      try {
        svg.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }

    // Clean up pan drag
    const drag = panDragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      panDragRef.current = null;
      setPanning(false);
      try {
        svg.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const handlePointerLeave = () => {
    setHoverId(null);
    setPointer(null);
  };

  const hoverNode = hoverId ? nodeById.get(hoverId) : undefined;
  const pinnedIds = new Set(simNodesRef.current.filter((s) => s.fx != null).map((s) => s.id));

  const graphTransform = useMemo(() => {
    if (!metrics) return undefined;
    return `translate(${size.w / 2 + pan.x} ${size.h / 2 + pan.y}) scale(${metrics.s * zoom}) translate(${-metrics.midX} ${-metrics.midY})`;
  }, [metrics, pan.x, pan.y, size.h, size.w, zoom]);

  const edgeOpacity = (score: number) => {
    const { min, max } = edgeScoreRange;
    const t = (score - min) / (max - min);
    return 0.1 + t * 0.38;
  };

  return (
    <div ref={wrapRef} className={cn("relative min-h-0 flex-1", className)}>
      {!loading && error ? (
        <div className="flex h-full min-h-[280px] items-center justify-center px-6 text-center text-[0.9rem] text-danger">
          {error}
        </div>
      ) : null}

      {!loading && !error && data && data.nodes.length === 0 ? (
        <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 px-6 text-center text-[0.9rem] text-muted">
          <span>
            {
              "No similarity edges yet. Finish embedding your notes or run 'Re-scan documents' in AI settings."
            }
          </span>
          {onRegenerateGraph ? (
            <button
              className="cursor-pointer rounded-md border border-white/[0.09] bg-white/[0.04] px-3 py-1.5 text-[0.82rem] text-muted transition-colors hover:bg-white/[0.08] hover:text-foreground disabled:cursor-default disabled:opacity-40"
              onClick={onRegenerateGraph}
              disabled={regenerating}
            >
              {regenerating ? "Regenerating..." : "Regenerate graph"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && data && data.nodes.length > 0 && metrics && geom ? (
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${size.w} ${size.h}`}
          className={cn(
            "block h-full w-full touch-none select-none",
            panning || dragging ? "cursor-grabbing" : hoverId ? "cursor-grab" : "cursor-default",
          )}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
          role="img"
          aria-label="Note similarity graph. Drag to pan, scroll to zoom."
        >
          <defs>
            <radialGradient id={vignetteId} cx="50%" cy="45%" r="75%">
              <stop offset="0%" stopColor="rgba(32, 36, 42, 0.35)" />
              <stop offset="55%" stopColor="rgba(18, 20, 24, 0.08)" />
              <stop offset="100%" stopColor="rgba(10, 11, 14, 0.55)" />
            </radialGradient>
          </defs>
          <rect width={size.w} height={size.h} fill={`url(#${vignetteId})`} />
          <g
            opacity={0.09}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth={0.4}
            vectorEffect="non-scaling-stroke"
          >
            {Array.from({ length: 1 + Math.ceil(size.w / 56) }, (_, i) => (
              <line key={`gv-${i}`} x1={i * 56} y1={0} x2={i * 56} y2={size.h} />
            ))}
            {Array.from({ length: 1 + Math.ceil(size.h / 56) }, (_, i) => (
              <line key={`gh-${i}`} x1={0} y1={i * 56} x2={size.w} y2={i * 56} />
            ))}
          </g>
          <g transform={graphTransform} shapeRendering="geometricPrecision">
            {sortedEdges.map((e) => {
              const a = positions.get(e.source);
              const b = positions.get(e.target);
              if (!a || !b) return null;
              const o = edgeOpacity(e.score);
              return (
                <line
                  key={`${e.source}-${e.target}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={`rgba(154, 148, 210, ${o})`}
                  strokeWidth={1}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {data.nodes.map((n) => {
              const p = positions.get(n.id);
              if (!p) return null;
              const active = hoverId === n.id;
              const pinned = pinnedIds.has(n.id);
              const { rCore, rRing } = geom;
              return (
                <g key={n.id} transform={`translate(${p.x},${p.y})`}>
                  <circle
                    r={rRing}
                    fill={
                      active
                        ? "rgba(124, 108, 200, 0.12)"
                        : pinned
                          ? "rgba(124, 108, 200, 0.06)"
                          : "rgba(255,255,255,0.04)"
                    }
                    stroke={
                      active
                        ? "rgba(168, 150, 235, 0.45)"
                        : pinned
                          ? "rgba(168, 150, 235, 0.25)"
                          : "rgba(255,255,255,0.12)"
                    }
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    r={rCore}
                    fill={active ? "rgba(186, 172, 248, 0.98)" : "rgba(218, 220, 232, 0.92)"}
                    stroke={active ? "rgba(255,252,255,0.55)" : "rgba(255,255,255,0.22)"}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </g>
        </svg>
      ) : null}

      {!loading && !error && data && data.nodes.length > 0 && metrics ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-white/[0.07] bg-[rgba(14,14,16,0.78)] px-3 py-1.5 text-[0.72rem] tracking-wide text-muted/90 backdrop-blur-md">
          <span>Drag to pan &middot; Scroll to zoom &middot; Shift+scroll for horizontal pan</span>
          {onRegenerateGraph ? (
            <>
              <span className="text-white/10">|</span>
              <button
                className="pointer-events-auto cursor-pointer text-muted/70 transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-40"
                onClick={onRegenerateGraph}
                disabled={regenerating}
                title="Regenerate graph"
              >
                <RefreshCw size={12} className={regenerating ? "animate-spin" : ""} />
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {hoverNode && pointer && wrapRef.current ? (
        <div
          className="pointer-events-none absolute z-20 max-w-[min(320px,90vw)] rounded-[12px] border border-white/[0.09] bg-[rgba(20,20,24,0.96)] px-3.5 py-2.5 text-[0.82rem] shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-md"
          style={{
            left: Math.min(
              Math.max(0, wrapRef.current.clientWidth - 288),
              Math.max(8, pointer.x - 8),
            ),
            top: Math.max(8, pointer.y - 8 - 72),
          }}
        >
          <div className="font-medium text-foreground">{hoverNode.title}</div>
          {hoverNode.preview ? (
            <div className="mt-1 line-clamp-2 text-muted leading-snug">{hoverNode.preview}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
