import { RpcException } from "@nestjs/microservices";
import { DocumentsService } from "./documents.service";

describe("DocumentsService.getDocumentSnapshot", () => {
  it("throws not found for a missing document", async () => {
    const prisma = {
      document: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const jobs = {
      enqueue: jest.fn(),
    };
    const crdt = {};
    const service = new DocumentsService(prisma as any, jobs as any, crdt as any);

    await expect(
      service.getDocumentSnapshot(
        { documentId: "missing-document" },
        { userId: "user-1" },
      ),
    ).rejects.toBeInstanceOf(RpcException);
  });
});
