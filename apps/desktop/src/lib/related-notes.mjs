/**
 * @typedef {{ id: string, title: string, preview: string }} GraphNode
 * @typedef {{ source: string, target: string, score: number }} GraphEdge
 * @typedef {{ nodes: GraphNode[], edges: GraphEdge[] }} NoteGraphPayload
 * @typedef {{ id: string, title: string, preview: string, score: number }} RelatedNote
 */

/**
 * Derive the notes related to `noteId` directly from an already-loaded graph
 * payload — no extra fetch. Related notes are the other endpoints of every edge
 * touching `noteId`, resolved to their node, sorted by descending similarity.
 *
 * @param {NoteGraphPayload | null | undefined} payload
 * @param {string} noteId
 * @param {number} [limit]
 * @returns {RelatedNote[]}
 */
export function relatedNotesFor(payload, noteId, limit = 8) {
  if (!payload || !noteId) return [];

  const nodeById = new Map(payload.nodes.map((n) => [n.id, n]));

  // Collapse to the best score per neighbor (edges are already undirected pairs,
  // but dedup defensively in case both directions ever appear).
  const bestScore = new Map();
  for (const edge of payload.edges) {
    let otherId = null;
    if (edge.source === noteId) otherId = edge.target;
    else if (edge.target === noteId) otherId = edge.source;
    if (!otherId || otherId === noteId) continue;

    const prev = bestScore.get(otherId);
    if (prev === undefined || edge.score > prev) bestScore.set(otherId, edge.score);
  }

  const related = [];
  for (const [id, score] of bestScore) {
    const node = nodeById.get(id);
    if (!node) continue; // edge endpoint no longer in the node set
    related.push({ id, title: node.title, preview: node.preview, score });
  }

  related.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return related.slice(0, Math.max(0, limit));
}
