export interface Chunk {
  chunkIndex: number;
  content: string;
  heading: string | null;
}

const CHUNK_SIZE_THRESHOLD = 4000;

export class ChunkingService {
  chunkMarkdown(markdown: string): Chunk[] {
    if (markdown.length < CHUNK_SIZE_THRESHOLD) {
      return [{ chunkIndex: 0, content: markdown, heading: null }];
    }

    const sections = this.splitByHeadings(markdown);
    const chunks: Chunk[] = [];

    for (const section of sections) {
      if (section.content.length <= CHUNK_SIZE_THRESHOLD) {
        chunks.push({
          chunkIndex: chunks.length,
          content: section.content,
          heading: section.heading,
        });
      } else {
        const paragraphs = section.content.split(/\n\n+/);
        let buffer = "";

        for (const paragraph of paragraphs) {
          const candidate = buffer.length > 0 ? `${buffer}\n\n${paragraph}` : paragraph;

          if (candidate.length > CHUNK_SIZE_THRESHOLD && buffer.length > 0) {
            chunks.push({
              chunkIndex: chunks.length,
              content: buffer,
              heading: section.heading,
            });
            buffer = paragraph;
          } else {
            buffer = candidate;
          }
        }

        if (buffer.length > 0) {
          chunks.push({
            chunkIndex: chunks.length,
            content: buffer,
            heading: section.heading,
          });
        }
      }
    }

    return chunks;
  }

  private splitByHeadings(markdown: string): Array<{ heading: string | null; content: string }> {
    const lines = markdown.split("\n");
    const sections: Array<{ heading: string | null; content: string }> = [];
    let currentHeading: string | null = null;
    let currentLines: string[] = [];

    for (const line of lines) {
      if (/^#{1,3} /.test(line)) {
        if (currentLines.length > 0) {
          const content = currentLines.join("\n").trim();
          if (content.length > 0) {
            sections.push({ heading: currentHeading, content });
          }
        }
        currentHeading = line.replace(/^#{1,3} /, "").trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      const content = currentLines.join("\n").trim();
      if (content.length > 0) {
        sections.push({ heading: currentHeading, content });
      }
    }

    return sections;
  }
}
