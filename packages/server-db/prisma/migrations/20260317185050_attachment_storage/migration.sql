-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AppConfigName" ADD VALUE 'STORAGE_BACKEND';
ALTER TYPE "AppConfigName" ADD VALUE 'STORAGE_FILESYSTEM_ROOT';
ALTER TYPE "AppConfigName" ADD VALUE 'STORAGE_S3_CONFIG';

-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "processedKey" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';

-- CreateIndex
CREATE INDEX "attachment_status_idx" ON "attachment"("status");
