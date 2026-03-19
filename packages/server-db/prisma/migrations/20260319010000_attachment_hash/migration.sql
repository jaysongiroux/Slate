-- AlterTable
ALTER TABLE "attachment" ADD COLUMN "hash" TEXT;

-- CreateIndex
CREATE INDEX "attachment_workspaceId_hash_idx" ON "attachment"("workspaceId", "hash");
