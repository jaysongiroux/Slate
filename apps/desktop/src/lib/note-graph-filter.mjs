const DEFAULT_MAX_PER_NODE = 4;

function edgeKey(edge) {
  return edge.source < edge.target
    ? `${edge.source}\u0000${edge.target}`
    : `${edge.target}\u0000${edge.source}`;
}

export function visibleGraphEdges(edges, options = {}) {
  const maxPerNode = Math.max(0, Math.floor(options.maxPerNode ?? DEFAULT_MAX_PER_NODE));
  const focusNodeId = options.focusNodeId ?? null;
  const visible = new Set();
  const byNode = new Map();

  edges.forEach((edge, index) => {
    for (const nodeId of [edge.source, edge.target]) {
      const next = byNode.get(nodeId) ?? [];
      next.push({ edge, index });
      byNode.set(nodeId, next);
    }

    if (focusNodeId && (edge.source === focusNodeId || edge.target === focusNodeId)) {
      visible.add(edgeKey(edge));
    }
  });

  if (maxPerNode > 0) {
    for (const nodeEdges of byNode.values()) {
      nodeEdges
        .sort((a, b) => b.edge.score - a.edge.score || a.index - b.index)
        .slice(0, maxPerNode)
        .forEach(({ edge }) => visible.add(edgeKey(edge)));
    }
  }

  return edges.filter((edge) => visible.has(edgeKey(edge)));
}
