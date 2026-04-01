import { createTestApp, resetDatabase } from "./helpers/test-app";
import { AttachmentsService } from "../src/attachments/attachments.service";

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
        plainText: "image",
        serverSeq: BigInt(1),
      },
    });

    const attachmentsService = app.get(AttachmentsService);
    const attachment = await attachmentsService.register({
      documentId: document.id,
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4096,
    });

    expect(attachment.documentId).toBe(document.id);
    expect(attachment.storageKey).toContain(user.id);

    await app.close();
  });
});
