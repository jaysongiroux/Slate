import { createTestApp, resetDatabase } from "./helpers/test-app";

describe("AttachmentsService", () => {
  it("registers attachment metadata against a user-owned document", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "media@example.com",
        displayName: "Media User",
        normalizedUsername: "media user",
      },
    });

    const document = await prisma.document.create({
      data: {
        id: "doc-media",
        userId: user.id,
        title: "Media",
        path: "media.md",
        markdown: "![image](./clip.png)",
        content: {},
      },
    });

    const attachmentsService = app.attachmentsService;
    const attachment = await attachmentsService.register({
      userId: user.id,
      containerType: "note",
      containerId: document.id,
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4096,
    });

    expect(attachment.containerType).toBe("note");
    expect(attachment.containerId).toBe(document.id);
    expect(attachment.storageKey).toContain(user.id);

    await app.close();
  });
});

describe("Attachments upload route", () => {
  it("accepts containerType + containerId for a diagram", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "route@example.com",
        displayName: "Route",
        normalizedUsername: "route",
      },
    });

    const attachment = await app.attachmentsService.registerAndStore({
      buffer: Buffer.from("PNGDATA"),
      originalName: "diagram-img.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
      userId: user.id,
      containerType: "diagram",
      containerId: "diagram-xyz",
    });

    expect(attachment.containerType).toBe("diagram");
    expect(attachment.containerId).toBe("diagram-xyz");

    await app.close();
  });
});
