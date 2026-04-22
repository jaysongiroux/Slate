import { createTestApp, resetDatabase } from "./helpers/test-app";

describe("Attachment container polymorphism", () => {
  it("stores and retrieves attachments scoped by containerType + containerId", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "poly@example.com",
        displayName: "Poly",
        normalizedUsername: "poly",
      },
    });

    const noteAttachment = await prisma.attachment.create({
      data: {
        userId: user.id,
        containerType: "note",
        containerId: "note-1",
        originalName: "a.png",
        mimeType: "image/png",
        sizeBytes: BigInt(10),
        storageKey: `${user.id}/a.png`,
        status: "uploaded",
      },
    });

    const diagramAttachment = await prisma.attachment.create({
      data: {
        userId: user.id,
        containerType: "diagram",
        containerId: "diagram-1",
        originalName: "b.png",
        mimeType: "image/png",
        sizeBytes: BigInt(20),
        storageKey: `${user.id}/b.png`,
        status: "uploaded",
      },
    });

    const diagramOnly = await prisma.attachment.findMany({
      where: { userId: user.id, containerType: "diagram", containerId: "diagram-1" },
    });
    expect(diagramOnly).toHaveLength(1);
    expect(diagramOnly[0].id).toBe(diagramAttachment.id);

    await app.close();
  });
});
