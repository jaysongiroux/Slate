export type Vec2 = { x: number; y: number };

type SimNode = Vec2 & { vx: number; vy: number };

/** Edge for layout: optional `weight` (e.g. backend similarity score); higher = more similar. */
export type LayoutLink = { source: string; target: string; weight?: number };

type PreparedLink = LayoutLink & { t: number };

/**
 * Simple force-ish layout for a small note graph (no extra dependencies).
 * Uses `weight` on each link so **higher similarity → shorter target distance** and a slightly
 * stiffer spring, so relationships read visually (still not a literal metric embedding).
 */
export function layoutNoteGraph(
  nodeIds: string[],
  links: LayoutLink[],
  width: number,
  height: number,
): Map<string, Vec2> {
  const positions = new Map<string, SimNode>();
  const cx = width / 2;
  const cy = height / 2;
  const ring = Math.min(width, height) * 0.32;
  nodeIds.forEach((id, i) => {
    const a = (i / Math.max(1, nodeIds.length)) * Math.PI * 2;
    positions.set(id, {
      x: cx + Math.cos(a) * ring,
      y: cy + Math.sin(a) * ring,
      vx: 0,
      vy: 0,
    });
  });

  const raw = links.map((l) => l.weight ?? 0.5);
  const wMin = Math.min(...raw);
  const wMax = Math.max(...raw);
  const wSpan = wMax <= wMin ? 1 : wMax - wMin;

  const prepared: PreparedLink[] = links.map((l) => {
    const w = l.weight ?? 0.5;
    const t = (w - wMin) / wSpan;
    return { ...l, weight: w, t: Math.min(1, Math.max(0, t)) };
  });

  /** Layout span used to scale “near” vs “far” target gaps (same units as simulation). */
  const layoutSpan = Math.min(width, height) * 0.42;
  /** Target edge length for the **weakest** link in this graph (more similar = shorter). */
  const idealFar = layoutSpan * 0.26;
  /** Target edge length for the **strongest** link — exaggerated gap vs weak. */
  const idealNear = layoutSpan * 0.038;

  const kRepel = 220;
  const kSpringBase = 0.052;
  /** Stronger edges get a stiffer spring so lengths stay near their target. */
  const springStiffness = (t: number) => kSpringBase * (0.45 + t * t * 2.4);

  const kCenter = 0.014;

  const steps = 140;
  for (let step = 0; step < steps; step++) {
    for (const id of nodeIds) {
      const p = positions.get(id)!;
      p.vx = 0;
      p.vy = 0;
    }

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const a = positions.get(nodeIds[i])!;
        const b = positions.get(nodeIds[j])!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const force = kRepel / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const link of prepared) {
      const a = positions.get(link.source);
      const b = positions.get(link.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.01;
      const t = link.t;
      const ideal = idealFar - t * (idealFar - idealNear);
      const excess = dist - ideal;
      const k = springStiffness(t);
      const mag = k * excess;
      const fx = (dx / dist) * mag;
      const fy = (dy / dist) * mag;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const id of nodeIds) {
      const p = positions.get(id)!;
      p.vx += (cx - p.x) * kCenter;
      p.vy += (cy - p.y) * kCenter;
      p.x += p.vx * 0.12;
      p.y += p.vy * 0.12;
    }
  }

  const out = new Map<string, Vec2>();
  for (const id of nodeIds) {
    const p = positions.get(id)!;
    out.set(id, { x: p.x, y: p.y });
  }
  return out;
}
