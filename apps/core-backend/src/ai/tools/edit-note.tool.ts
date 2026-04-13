import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { PrismaClient } from "@slate/server-db";
import type { StreamEvent } from "../agent.service";

export function createEditNoteTool(
  prisma: PrismaClient,
  userId: string,
  chatModel: any,
  emitNoteEvent: (event: StreamEvent) => void,
) {
  return (tool as any)(
    async ({
      documentId,
      instructions,
      mode,
    }: {
      documentId: string;
      instructions: string;
      mode: "rewrite" | "targeted" | "auto";
    }) => {
      const doc = await prisma.document.findFirst({
        where: { id: documentId, userId, deleted: false },
        select: {
          id: true,
          title: true,
          path: true,
          markdown: true,
        },
      });

      if (!doc) {
        return `Error: Note not found (id: ${documentId})`;
      }

      emitNoteEvent({
        type: "note_edit_start",
        documentId,
        title: doc.title,
      });

      const wordCount = (doc.markdown || "").split(/\s+/).length;
      const effectiveMode = mode === "auto" ? (wordCount > 500 ? "targeted" : "rewrite") : mode;

      const systemPrompt =
        effectiveMode === "rewrite"
          ? `Rewrite this note following the instructions. Output the complete updated note as markdown, no preamble or explanation.\n\nCurrent note:\n${doc.markdown}`
          : `Edit this note following the instructions. Output the complete note with your changes applied as markdown. Preserve all content that doesn't need to change. No preamble or explanation.\n\nCurrent note:\n${doc.markdown}`;

      let accumulated = "";
      let lastPushLen = 0;
      let lastPushTime = Date.now();
      const PUSH_CHAR_THRESHOLD = 500;
      const PUSH_TIME_THRESHOLD = 500;

      const pushUpdate = async () => {
        try {
          await prisma.document.update({
            where: { id: documentId },
            data: {
              markdown: accumulated,
              embedded: false,
            },
          });
          lastPushLen = accumulated.length;
          lastPushTime = Date.now();
        } catch {
          // Log but continue — final push will retry
        }
      };

      try {
        const stream = await chatModel.stream([
          new SystemMessage(systemPrompt),
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
          if (charsSincePush >= PUSH_CHAR_THRESHOLD || timeSincePush >= PUSH_TIME_THRESHOLD) {
            await pushUpdate();
          }
        }
      } catch (err) {
        if (accumulated.length > 0) {
          await pushUpdate();
        }
        emitNoteEvent({
          type: "note_done",
          documentId,
          error: err instanceof Error ? err.message : String(err),
        });
        return `Error editing note "${doc.title}": ${err instanceof Error ? err.message : err}`;
      }

      await pushUpdate();
      emitNoteEvent({ type: "note_done", documentId });

      return `Edited note: ${doc.title} (id: ${documentId})`;
    },
    {
      name: "edit_note",
      description:
        "Edits an existing note by rewriting or making targeted changes. The changes stream in real-time. Use this when the user wants to modify, update, or improve an existing note. First use search tools to find the document ID.",
      schema: z.object({
        documentId: z.string().describe("The ID of the note to edit (find via search tools first)"),
        instructions: z
          .string()
          .describe("What changes to make — be specific about what to add, remove, or modify"),
        mode: z
          .enum(["rewrite", "targeted", "auto"])
          .describe(
            "'rewrite' replaces entire content, 'targeted' preserves unchanged sections, 'auto' selects based on note length.",
          ),
      }),
    },
  );
}
