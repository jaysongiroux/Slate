import { test } from "node:test";
import assert from "node:assert/strict";
import { relatedNotesFor } from "./related-notes.mjs";

const payload = {
  nodes: [
    { id: "a", title: "Alpha", preview: "alpha preview" },
    { id: "b", title: "Bravo", preview: "bravo preview" },
    { id: "c", title: "Charlie", preview: "charlie preview" },
    { id: "d", title: "Delta", preview: "delta preview" },
  ],
  edges: [
    { source: "a", target: "b", score: 0.9 },
    { source: "c", target: "a", score: 0.7 }, // a is the target here
    { source: "b", target: "c", score: 0.6 }, // does not touch a
  ],
};

test("returns neighbors of the note resolved to node data", () => {
  const result = relatedNotesFor(payload, "a");
  assert.deepEqual(
    result.map((r) => r.id),
    ["b", "c"],
  );
  assert.equal(result[0].title, "Bravo");
  assert.equal(result[0].preview, "bravo preview");
});

test("matches edges regardless of source/target direction", () => {
  const result = relatedNotesFor(payload, "a");
  // 'c' connects to 'a' via an edge where a is the target — still included.
  assert.ok(result.some((r) => r.id === "c"));
});

test("sorts by descending score", () => {
  const result = relatedNotesFor(payload, "a");
  assert.deepEqual(
    result.map((r) => r.score),
    [0.9, 0.7],
  );
});

test("respects the limit", () => {
  const result = relatedNotesFor(payload, "a", 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "b");
});

test("keeps the best score when both directions of a pair appear", () => {
  const dup = {
    nodes: payload.nodes,
    edges: [
      { source: "a", target: "b", score: 0.5 },
      { source: "b", target: "a", score: 0.8 },
    ],
  };
  const result = relatedNotesFor(dup, "a");
  assert.equal(result.length, 1);
  assert.equal(result[0].score, 0.8);
});

test("drops edges whose other endpoint is missing from the node set", () => {
  const dangling = {
    nodes: [{ id: "a", title: "Alpha", preview: "" }],
    edges: [{ source: "a", target: "ghost", score: 0.9 }],
  };
  assert.deepEqual(relatedNotesFor(dangling, "a"), []);
});

test("returns empty for null payload or missing note id", () => {
  assert.deepEqual(relatedNotesFor(null, "a"), []);
  assert.deepEqual(relatedNotesFor(payload, ""), []);
});
