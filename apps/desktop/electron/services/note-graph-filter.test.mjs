import test from "node:test";
import assert from "node:assert/strict";
import { visibleGraphEdges } from "../../src/lib/note-graph-filter.mjs";

test("visibleGraphEdges keeps the strongest local connections for each node", () => {
  const edges = [
    { source: "a", target: "b", score: 0.95 },
    { source: "a", target: "c", score: 0.82 },
    { source: "a", target: "d", score: 0.6 },
    { source: "b", target: "c", score: 0.74 },
    { source: "c", target: "d", score: 0.71 },
  ];

  assert.deepEqual(
    visibleGraphEdges(edges, { maxPerNode: 1 }).map((edge) => `${edge.source}-${edge.target}`),
    ["a-b", "a-c", "c-d"],
  );
});

test("visibleGraphEdges reveals every edge connected to the hovered node", () => {
  const edges = [
    { source: "a", target: "b", score: 0.95 },
    { source: "a", target: "c", score: 0.82 },
    { source: "a", target: "d", score: 0.6 },
    { source: "b", target: "c", score: 0.74 },
    { source: "d", target: "e", score: 0.9 },
  ];

  assert.deepEqual(
    visibleGraphEdges(edges, { maxPerNode: 1, focusNodeId: "a" }).map(
      (edge) => `${edge.source}-${edge.target}`,
    ),
    ["a-b", "a-c", "a-d", "d-e"],
  );
});
