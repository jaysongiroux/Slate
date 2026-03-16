import { createTestApp, resetDatabase } from "./helpers/test-app";
import { AttachmentsService } from "../src/attachments/attachments.service";

describe("AttachmentsService", () => {
  it("registers attachment metadata against a document", async () => {
    const { app, prisma } = await createTestApp();
    await resetDatabase(app);

    const user = await prisma.user.create({
      data: {
        email: "media@example.com",
        displayName: "Media User"
      }
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: "Media Workspace",
        ownerUserId: user.id,
        members: {
          create: {
            userId: user.id,
            role: "OWNER"
          }
        }
      }
    });

    const document = await prisma.document.create({
      data: {
        id: "doc-media",
        workspaceId: workspace.id,
        ownerUserId: user.id,
        title: "Media",
        path: "media.md",
        markdown: "![image](./clip.png)",
        plainText: "image"
      }
    });

    const attachmentsService = app.get(AttachmentsService);
    const attachment = await attachmentsService.register({
      workspaceId: workspace.id,
      documentId: document.id,
      originalName: "clip.mp4",
      mimeType: "video/mp4",
      sizeBytes: 4096
    });

    expect(attachment.documentId).toBe(document.id);
    expect(attachment.storageKey).toContain(workspace.id);

    await app.close();
  });
});

