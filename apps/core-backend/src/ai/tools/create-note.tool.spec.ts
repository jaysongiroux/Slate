import { createCreateNoteTool } from "./create-note.tool";
import { PrismaService } from "../../prisma/prisma.service";
import { CrdtService } from "../../documents/crdt.service";
import { DocumentsService } from "../../documents/documents.service";
import type { StreamEvent } from "../agent.service";

function makeMocks() {
  const prisma = {} as PrismaService;

  const crdtService = {
    replaceContent: jest.fn().mockReturnValue({
      update: Buffer.from("fake-update"),
      markdown: "# Test",
      plainText: "Test",
    }),
    bootstrapFromMarkdown: jest.fn().mockReturnValue({
      crdtState: Buffer.from("fake-state"),
      markdown: "# Test",
      plainText: "Test",
    }),
  } as unknown as CrdtService;

  const documentsService = {
    pushDocumentUpdate: jest.fn().mockResolvedValue({
      serverSeq: 1,
      serverDelta: new Uint8Array(),
      path: "test.md",
      deleted: false,
    }),
  } as unknown as DocumentsService;

  // Mock chat model with streaming
  const chatModel = {
    stream: jest.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        yield { content: "# Hello" };
        yield { content: "\n\nWorld" };
      },
    }),
  };

  const emittedEvents: StreamEvent[] = [];
  const emitNoteEvent = (event: StreamEvent) => emittedEvents.push(event);

  return { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent };
}

describe("createCreateNoteTool", () => {
  const userId = "user-1";

  it("returns a tool with name 'create_note'", () => {
    const { prisma, crdtService, documentsService, chatModel, emitNoteEvent } = makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );
    expect(t.name).toBe("create_note");
  });

  it("emits note_create_start as the first event", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } =
      makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );

    await t.invoke({ title: "My Note", path: "", instructions: "Write something" });

    expect(emittedEvents[0]).toMatchObject({
      type: "note_create_start",
      title: "My Note",
    });
    expect(emittedEvents[0].documentId).toBeDefined();
    expect(emittedEvents[0].path).toBeDefined();
  });

  it("emits note_delta events during streaming", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } =
      makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );

    await t.invoke({ title: "Test", path: "", instructions: "Write" });

    const deltas = emittedEvents.filter((e) => e.type === "note_delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas[0].content).toBeDefined();
  });

  it("emits note_done as the last event", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } =
      makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );

    await t.invoke({ title: "Test", path: "", instructions: "Write" });

    const lastEvent = emittedEvents[emittedEvents.length - 1];
    expect(lastEvent.type).toBe("note_done");
  });

  it("calls pushDocumentUpdate at least once", async () => {
    const { prisma, crdtService, documentsService, chatModel, emitNoteEvent } = makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );

    await t.invoke({ title: "Test", path: "", instructions: "Write" });

    expect(documentsService.pushDocumentUpdate).toHaveBeenCalled();
    const call = (documentsService.pushDocumentUpdate as jest.Mock).mock.calls[0];
    expect(call[0]).toMatchObject({
      clientId: "ai-writer",
      deleted: false,
    });
    expect(call[1]).toEqual({ userId });
  });

  it("derives path from title when path is not provided", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } =
      makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );

    await t.invoke({ title: "My Great Note", path: "", instructions: "Write" });

    expect(emittedEvents[0].path).toMatch(/my-great-note\.md$/);
  });

  it("uses provided path when given", async () => {
    const { prisma, crdtService, documentsService, chatModel, emittedEvents, emitNoteEvent } =
      makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );

    await t.invoke({ title: "Test", path: "projects/test.md", instructions: "Write" });

    expect(emittedEvents[0].path).toBe("projects/test.md");
  });

  it("returns a success message with title and document ID", async () => {
    const { prisma, crdtService, documentsService, chatModel, emitNoteEvent } = makeMocks();
    const t = createCreateNoteTool(
      prisma,
      crdtService,
      documentsService,
      userId,
      chatModel as any,
      emitNoteEvent,
    );

    const result = await t.invoke({ title: "My Note", path: "", instructions: "Write" });

    expect(result).toContain("My Note");
    expect(result).toContain("Created note");
  });
});
