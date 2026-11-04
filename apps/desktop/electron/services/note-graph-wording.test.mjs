import test from "node:test";
import assert from "node:assert/strict";
import { withWordingEdges } from "../../src/lib/note-graph-wording.mjs";

const note = (id, line) => ({
  id,
  title: "Daily Notes",
  path: `Daily Notes/${id}`,
  markdown: "",
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        content: [{ type: "text", text: "Daily shared project template headings" }],
      },
      { type: "paragraph", content: [{ type: "text", text: line }] },
    ],
  },
});

test("links overlapping daily work across editor JSON and Markdown, with evidence", () => {
  const first = note(
    "a",
    "Review payment reconciliation failures and verify settlement batch totals.",
  );
  const second = {
    ...note("b", ""),
    markdown:
      "# Daily note\nInvestigate payment reconciliation failures. Verify settlement batch totals.",
  };
  const third = note("c", "Schedule dentist appointment and pick up groceries.");
  const graph = { nodes: [first, second, third], edges: [] };
  const result = withWordingEdges(graph, [first, second, third, note("outside", second.markdown)]);
  assert.equal(result.edges.length, 1);
  assert.deepEqual([result.edges[0].source, result.edges[0].target], ["a", "b"]);
  assert.ok(result.edges[0].phrases.includes("payment reconciliation"));
  assert.deepEqual(graph.edges, []);
  assert.equal(withWordingEdges(result, [first, second, third]), result);
});

test("shared folders, dates, headings, and ubiquitous template body text create no links", () => {
  const notes = ["a", "b", "c", "d"].map((id) =>
    note(id, "Review upcoming action items before next planning meeting. 2026-01-01"),
  );
  const graph = { nodes: notes, edges: [] };
  assert.equal(withWordingEdges(graph, notes), graph);
});

test("maps legacy server endpoints to the local note IDs for the signed-in user", () => {
  const graph = {
    nodes: [{ id: "a::owner" }, { id: "b::other" }],
    edges: [{ source: "a::owner", target: "b::other", score: 0.8 }],
  };
  const result = withWordingEdges(graph, [], "owner");
  assert.deepEqual(result.nodes.map((n) => n.id), ["a", "b::other"]);
  assert.deepEqual(result.edges[0], { source: "a", target: "b::other", score: 0.8 });
});
