import { createEditNoteTool } from "./edit-note.tool";
import { PrismaService } from "../../prisma/prisma.service";
import { CrdtService } from "../../documents/crdt.service";
import { DocumentsService } from "../../documents/documents.service";
import type { StreamEvent } from "../agent.service";

const EXISTING_DOC = {
  id: "doc-1",
  userId: "user-1",
  title: "Existing Note",
  path: "existing.md",
  markdown: "# Existing Note\n\nOriginal content.",
  plainText: "Existing Note Original content.",
  crdtState: Buffer.from("fake-crdt-state"),
  deleted: false,
};

function makeMocks(document: unknown = EXISTING_DOC) {
  const prisma = {
    document: {
      findFirst: jest.fn().mockResolvedValue(document),
    },
  } as unknown as PrismaService;

  const crdtService = {
    replaceContent: jest.fn().mockReturnValue({
      update: Buffer.from("fake-update"),
      markdown: "# Updated",
      plainText: "Updated",
    }),
  } as unknown as CrdtService;

  const documentsService = {
    pushDocumentUpdate: jest.fn().mockResolvedValue({
      serverSeq: 1,
      serverDelta: new Uint8Array(),
      path: "existing.md",
      deleted: false,
    }),
  } as unknown as DocumentsService;

  const chatModel = {
    stream: jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { content: "# Updated Note" };
        yield { content: "\n\nNew content." };
      },
    }),
  };

  const emittedEvents: StreamEvent[] = [];
  const emitNoteEvent = (event: StreamEvent) => emittedEvents.push(event);

  return { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent };
}

describe("createEditNoteTool", () => {
  const userId = "user-1";

  it("returns a tool with name 'edit_note'", () => {
    const { prisma, crdtService, documentsService, chatModel, emitNoteEvent } = makeMocks();
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);
    expect(t.name).toBe("edit_note");
  });

  it("returns error when document is not found", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } = makeMocks(null);
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);

    const result = await t.invoke({ documentId: "nonexistent", instructions: "Change it", mode: "auto" });

    expect(result).toContain("not found");
    expect(emittedEvents.filter((e) => e.type === "note_edit_start")).toHaveLength(0);
  });

  it("emits note_edit_start with correct documentId and title", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } = makeMocks();
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);

    await t.invoke({ documentId: "doc-1", instructions: "Improve it", mode: "auto" });

    expect(emittedEvents[0]).toMatchObject({
      type: "note_edit_start",
      documentId: "doc-1",
      title: "Existing Note",
    });
  });

  it("emits note_delta events during streaming", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } = makeMocks();
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);

    await t.invoke({ documentId: "doc-1", instructions: "Rewrite", mode: "auto" });

    const deltas = emittedEvents.filter((e) => e.type === "note_delta");
    expect(deltas.length).toBeGreaterThan(0);
  });

  it("emits note_done as the last event", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } = makeMocks();
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);

    await t.invoke({ documentId: "doc-1", instructions: "Rewrite", mode: "auto" });

    const lastEvent = emittedEvents[emittedEvents.length - 1];
    expect(lastEvent.type).toBe("note_done");
    expect(lastEvent.documentId).toBe("doc-1");
  });

  it("calls pushDocumentUpdate with the existing document ID", async () => {
    const { prisma, crdtService, documentsService, chatModel, emitNoteEvent } = makeMocks();
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);

    await t.invoke({ documentId: "doc-1", instructions: "Rewrite", mode: "auto" });

    expect(documentsService.pushDocumentUpdate).toHaveBeenCalled();
    const call = (documentsService.pushDocumentUpdate as jest.Mock).mock.calls[0];
    expect(call[0].documentId).toBe("doc-1");
    expect(call[0].clientId).toBe("ai-writer");
  });

  it("uses rewrite mode for short notes by default", async () => {
    const { prisma, crdtService, documentsService, chatModel, emitNoteEvent } = makeMocks();
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);

    await t.invoke({ documentId: "doc-1", instructions: "Improve", mode: "auto" });

    const systemMsg = chatModel.stream.mock.calls[0][0][0];
    expect(systemMsg.content).toContain("Rewrite");
  });

  it("returns a success message", async () => {
    const { prisma, crdtService, documentsService, chatModel, emitNoteEvent } = makeMocks();
    const t = createEditNoteTool(prisma, crdtService, documentsService, userId, chatModel as any, emitNoteEvent);

    const result = await t.invoke({ documentId: "doc-1", instructions: "Improve", mode: "auto" });

    expect(result).toContain("Edited note");
    expect(result).toContain("Existing Note");
  });
});
