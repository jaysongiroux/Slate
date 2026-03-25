import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import * as Y from "yjs";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { PrismaService } from "../../prisma/prisma.service";
import { CrdtService } from "../../documents/crdt.service";
import { DocumentsService } from "../../documents/documents.service";
import type { StreamEvent } from "../agent.service";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function createCreateNoteTool(
  prisma: PrismaService,
  crdtService: CrdtService,
  documentsService: DocumentsService,
  userId: string,
  chatModel: any,
  emitNoteEvent: (event: StreamEvent) => void,
) {
  return (tool as any)(
    async ({
      title,
      path,
      instructions,
    }: {
      title: string;
      path?: string;
      instructions: string;
    }) => {
      const documentId = uuidv4();
      const notePath = path || `${slugify(title)}.md`;

      const ydoc = new Y.Doc();

      // Create the document record in the DB before notifying the frontend,
      // so the note exists when the editor tries to load it.
      const { update: initialUpdate } = crdtService.replaceContent(ydoc, `# ${title}\n`);
      await documentsService.pushDocumentUpdate(
        {
          clientId: "ai-writer",
          documentId,
          path: notePath,
          deleted: false,
          crdtUpdate: initialUpdate,
        },
        { userId },
      );

      emitNoteEvent({
        type: "note_create_start",
        documentId,
        title,
        path: notePath,
      });
      let accumulated = "";
      let lastPushLen = 0;
      let lastPushTime = Date.now();
      const PUSH_CHAR_THRESHOLD = 500;
      const PUSH_TIME_THRESHOLD = 500; // ms

      const pushCrdtUpdate = async () => {
        try {
          const { update } = crdtService.replaceContent(ydoc, accumulated);
          await documentsService.pushDocumentUpdate(
            {
              clientId: "ai-writer",
              documentId,
              path: notePath,
              deleted: false,
              crdtUpdate: update,
            },
            { userId },
          );
          lastPushLen = accumulated.length;
          lastPushTime = Date.now();
        } catch (err) {
          // Log but continue streaming — final push will retry
        }
      };

      try {
        const stream = await chatModel.stream([
          new SystemMessage(
            `You are a note writer. Write markdown content for a note titled "${title}". Follow the user's instructions precisely. Output only the note content as markdown, no preamble or explanation.`,
          ),
          new HumanMessage(instructions),
        ]);

        for await (const chunk of stream) {
          const text =
            typeof chunk.content === "string"
              ? chunk.content
              : Array.isArray(chunk.content)
                ? chunk.content
                    .filter((b: any) => typeof b === "object" && b.text)
                    .map((b: any) => b.text)
                    .join("")
                : "";
          if (!text) continue;

          accumulated += text;
          emitNoteEvent({ type: "note_delta", documentId, content: text });

          const charsSincePush = accumulated.length - lastPushLen;
          const timeSincePush = Date.now() - lastPushTime;
          if (
            charsSincePush >= PUSH_CHAR_THRESHOLD ||
            timeSincePush >= PUSH_TIME_THRESHOLD
          ) {
            await pushCrdtUpdate();
          }
        }
      } catch (err) {
        // Push whatever we have so far
        if (accumulated.length > 0) {
          await pushCrdtUpdate();
        }
        emitNoteEvent({
          type: "note_done",
          documentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return `Error creating note "${title}": ${err instanceof Error ? err.message : err}`;
      }

      // Final push with complete content
      await pushCrdtUpdate();
      emitNoteEvent({ type: "note_done", documentId });

      return `Created note: ${title} (id: ${documentId})`;
    },
    {
      name: "create_note",
      description:
        "Creates a new note with AI-generated content. The note will be written in real-time and visible to the user as it streams. Use this when the user asks you to write, draft, or create a new note.",
      schema: z.object({
        title: z.string().describe("Title for the new note"),
        path: z
          .string()
          .describe(
            "File path for the note (e.g., 'projects/design.md'). Use empty string to infer from title.",
          ),
        instructions: z
          .string()
          .describe(
            "Detailed instructions for what to write in the note — be specific about content, structure, and tone",
          ),
      }),
    },
  );
}
