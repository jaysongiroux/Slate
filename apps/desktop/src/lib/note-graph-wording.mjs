// Compare body phrases only. Dates, headings and folder names make poor
// evidence of a relationship between two daily notes.
const stop = new Set(
  "a an and are as at be by for from have how in into is it of on or our that the their this to was we will with you".split(
    " ",
  ),
);

function bodyLines(note) {
  if (note.markdown?.trim()) return note.markdown.split(/\r?\n/).filter((s) => !/^\s*#/.test(s));
  const lines = [];
  function visit(node) {
    if (!node || node.type === "heading") return;
    if (node.type === "paragraph" || node.type === "codeBlock") {
      lines.push((node.content ?? []).map((part) => part.text ?? " ").join(""));
    } else {
      for (const child of node.content ?? []) visit(child);
    }
  }
  visit(note.content);
  return lines;
}

function phrasesIn(note) {
  const phrases = new Set();
  for (const line of bodyLines(note)) {
    const words =
      line
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .match(/[\p{L}][\p{L}\p{M}-]*/gu) ?? [];
    for (let i = 1; i < words.length; i++) {
      const a = words[i - 1],
        b = words[i];
      if (a.length > 1 && b.length > 1 && !stop.has(a) && !stop.has(b)) phrases.add(a + " " + b);
    }
  }
  return phrases;
}

// Use postings rather than scanning every pair of note bodies. Common phrases
// (including repeated template text) contribute no evidence.
export function withWordingEdges(graph, notes, userId) {
  if (!graph) return graph;
  // Older backends returned database IDs for notes imported into multiple accounts.
  const suffix = `::${userId}`;
  if (userId && graph.nodes.some((n) => n.id.endsWith(suffix))) {
    const localId = (id) => (id.endsWith(suffix) ? id.slice(0, -suffix.length) : id);
    graph = {
      nodes: graph.nodes.map((n) => ({ ...n, id: localId(n.id) })),
      edges: graph.edges.map((e) => ({
        ...e,
        source: localId(e.source),
        target: localId(e.target),
      })),
    };
  }
  if (graph.nodes.length < 2) return graph;
  const ids = new Set(graph.nodes.map((node) => node.id));
  const postings = new Map();
  for (const note of notes) {
    if (note.isDeleted || !ids.has(note.id)) continue;
    for (const phrase of phrasesIn(note)) {
      if (!postings.has(phrase)) postings.set(phrase, []);
      postings.get(phrase).push(note.id);
    }
  }
  const totalWeight = new Map();
  const pairs = new Map();
  const maxFrequency = Math.min(16, Math.max(2, Math.ceil(ids.size * 0.2)));
  for (const [phrase, owners] of postings) {
    if (owners.length > maxFrequency) continue;
    const weight = Math.log1p(ids.size / owners.length) ** 2;
    for (const id of owners) totalWeight.set(id, (totalWeight.get(id) ?? 0) + weight);
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const [source, target] = [owners[i], owners[j]].sort();
        const key = source + "\0" + target;
        let pair = pairs.get(key);
        if (!pair) {
          pair = { source, target, weight: 0, count: 0, phrases: [] };
          pairs.set(key, pair);
        }
        pair.weight += weight;
        pair.count++;
        if (pair.phrases.length < 3) pair.phrases.push(phrase);
      }
    }
  }

  const candidates = [];
  for (const pair of pairs.values()) {
    const left = totalWeight.get(pair.source),
      right = totalWeight.get(pair.target);
    const small = Math.min(left, right);
    // A short daily entry can revisit part of a much longer running log.
    // Cap the length penalty, but still require several distinct phrases.
    const coverage = pair.weight / Math.sqrt(small * Math.min(4 * small, Math.max(left, right)));
    if ((pair.count >= 4 && coverage >= 0.035) || (pair.count >= 12 && coverage >= 0.01)) {
      const score = Math.sqrt((coverage * pair.count) / (pair.count + 12));
      candidates.push({ source: pair.source, target: pair.target, score, phrases: pair.phrases });
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score || a.source.localeCompare(b.source) || a.target.localeCompare(b.target),
  );
  const known = new Set(graph.edges.map((e) => [e.source, e.target].sort().join("\0")));
  const ranks = new Map();
  const added = [];
  for (const edge of candidates) {
    const a = ranks.get(edge.source) ?? 0,
      b = ranks.get(edge.target) ?? 0;
    ranks.set(edge.source, a + 1);
    ranks.set(edge.target, b + 1);
    if ((a < 3 || b < 3) && !known.has(edge.source + "\0" + edge.target)) added.push(edge);
  }
  return added.length ? { ...graph, edges: [...graph.edges, ...added] } : graph;
}
