function normalizedTitleSearch(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function titleRank(title, query) {
  const normalizedTitle = normalizedTitleSearch(title);
  if (!query || !normalizedTitle.includes(query)) return null;
  if (normalizedTitle === query) return 0;
  if (normalizedTitle.startsWith(query)) return 1;
  return 2;
}

export function searchNoteGraphTitles(nodes, query) {
  const normalizedQuery = normalizedTitleSearch(query);
  if (!normalizedQuery) return [];

  return nodes
    .map((node, index) => ({
      node,
      index,
      rank: titleRank(node.title, normalizedQuery),
    }))
    .filter((entry) => entry.rank != null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.node);
}
