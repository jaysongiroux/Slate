import { ChunkingService } from "./chunking.service";

describe("ChunkingService", () => {
  let service: ChunkingService;

  beforeEach(() => {
    service = new ChunkingService();
  });

  describe("short documents", () => {
    it("returns a single chunk with heading null for a short document", () => {
      const markdown = "# Hello\n\nThis is a short document.";
      const chunks = service.chunkMarkdown(markdown);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].content).toBe(markdown);
      expect(chunks[0].heading).toBeNull();
    });

    it("returns a single chunk for an empty string", () => {
      const chunks = service.chunkMarkdown("");

      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].content).toBe("");
      expect(chunks[0].heading).toBeNull();
    });

    it("returns a single chunk for a document just under the threshold", () => {
      const markdown = "a".repeat(3999);
      const chunks = service.chunkMarkdown(markdown);

      expect(chunks).toHaveLength(1);
      expect(chunks[0].heading).toBeNull();
    });
  });

  describe("splitting by headings", () => {
    it("splits a long document into chunks by heading", () => {
      const section1Body = "word ".repeat(900); // ~4500 chars per section when added to heading
      const section2Body = "other ".repeat(900);

      // Make each section long enough to be split, but use distinct headings
      // We want a document that exceeds the threshold but splits cleanly by heading
      // Each section body is ~4500 chars — large enough to force chunking by paragraph too,
      // so let's keep sections under threshold individually
      const shortSection = "word ".repeat(100); // ~500 chars

      const markdown = [
        `# Section One`,
        shortSection,
        `## Section Two`,
        shortSection,
        `### Section Three`,
        shortSection,
      ].join("\n\n");

      // Force total length over threshold so the heading-split path is taken
      const paddedMarkdown = markdown + "\n\n" + "x".repeat(4000);

      const chunks = service.chunkMarkdown(paddedMarkdown);

      expect(chunks.length).toBeGreaterThan(1);

      // Find chunks for each heading
      const sectionOneChunk = chunks.find((c) => c.heading === "Section One");
      const sectionTwoChunk = chunks.find((c) => c.heading === "Section Two");
      const sectionThreeChunk = chunks.find((c) => c.heading === "Section Three");

      expect(sectionOneChunk).toBeDefined();
      expect(sectionTwoChunk).toBeDefined();
      expect(sectionThreeChunk).toBeDefined();
    });

    it("preserves heading text without the markdown prefix", () => {
      const body = "content ".repeat(100);
      // Build a document over 4000 chars with two headings
      const markdown = `## My Heading\n\n${body}\n\n## Another Heading\n\n${body}`.padEnd(
        5000,
        " ",
      );

      const chunks = service.chunkMarkdown(markdown);

      const headings = chunks.map((c) => c.heading);
      expect(headings).toContain("My Heading");
      expect(headings).toContain("Another Heading");
    });

    it("supports h1, h2, and h3 headings", () => {
      const body = "x ".repeat(100);
      const totalContent = [`# H1\n\n${body}`, `## H2\n\n${body}`, `### H3\n\n${body}`]
        .join("\n\n")
        .padEnd(5000, "z");

      const chunks = service.chunkMarkdown(totalContent);
      const headings = chunks.map((c) => c.heading);

      expect(headings).toContain("H1");
      expect(headings).toContain("H2");
      expect(headings).toContain("H3");
    });

    it("does not split on h4 or deeper headings", () => {
      const body = "content ".repeat(100);
      // Document over threshold but with only h4+ headings — should not split into per-heading chunks
      const markdown =
        `#### Not a split heading\n\n${body}\n\n#### Also not split\n\n${body}`.padEnd(5000, "a");

      const chunks = service.chunkMarkdown(markdown);

      // Since no h1/h2/h3 found, the whole doc is one "section" then further split by paragraph if needed
      const headings = new Set(chunks.map((c) => c.heading));
      // The heading context should be null (no h1/h2/h3 found before any content)
      // Actually the content before any h1/h2/h3 heading will have heading: null
      expect(headings.has("Not a split heading")).toBe(false);
    });
  });

  describe("long sections split by paragraph", () => {
    it("splits a long section into multiple chunks retaining the heading", () => {
      const heading = "## Long Section";
      // Build 3 paragraphs each ~1500 chars — total ~4500 chars, over threshold
      const para1 = "a ".repeat(750); // ~1500 chars
      const para2 = "b ".repeat(750);
      const para3 = "c ".repeat(750);

      const sectionContent = `${heading}\n\n${para1}\n\n${para2}\n\n${para3}`;
      // Pad overall doc to exceed 4000 chars
      const markdown = sectionContent.padEnd(5000, "\n");

      const chunks = service.chunkMarkdown(markdown);

      // All chunks from this section should have the same heading
      const longSectionChunks = chunks.filter((c) => c.heading === "Long Section");
      expect(longSectionChunks.length).toBeGreaterThan(1);

      // Verify the paragraphs are distributed across chunks
      const allContent = longSectionChunks.map((c) => c.content).join(" ");
      expect(allContent).toContain("a a");
      expect(allContent).toContain("b b");
      expect(allContent).toContain("c c");
    });

    it("retains the section heading on each sub-chunk", () => {
      const heading = "### Deep Section";
      const longPara = "word ".repeat(1000); // ~5000 chars — forces paragraph split
      const sectionContent = `${heading}\n\n${longPara}\n\n${longPara}`;

      // Overall doc is already way over 4000 chars
      const chunks = service.chunkMarkdown(sectionContent);

      for (const chunk of chunks) {
        expect(chunk.heading).toBe("Deep Section");
      }
    });
  });

  describe("sequential chunk indices", () => {
    it("assigns sequential indices starting from 0", () => {
      const para = "word ".repeat(1000); // ~5000 chars each
      const markdown = `# A\n\n${para}\n\n# B\n\n${para}\n\n# C\n\n${para}`;

      const chunks = service.chunkMarkdown(markdown);

      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach((chunk, i) => {
        expect(chunk.chunkIndex).toBe(i);
      });
    });

    it("single chunk has index 0", () => {
      const chunks = service.chunkMarkdown("Short doc");
      expect(chunks[0].chunkIndex).toBe(0);
    });
  });
});
