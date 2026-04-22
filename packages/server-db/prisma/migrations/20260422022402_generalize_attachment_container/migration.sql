-- Add new columns as nullable so we can backfill existing rows.
ALTER TABLE "attachment" ADD COLUMN "containerType" TEXT;
ALTER TABLE "attachment" ADD COLUMN "containerId" TEXT;

-- Backfill existing rows: all prior attachments were note-scoped via documentId.
UPDATE "attachment" SET "containerType" = 'note', "containerId" = "documentId";

-- Now enforce NOT NULL.
ALTER TABLE "attachment" ALTER COLUMN "containerType" SET NOT NULL;
ALTER TABLE "attachment" ALTER COLUMN "containerId" SET NOT NULL;

-- Drop the old FK + index + column.
ALTER TABLE "attachment" DROP CONSTRAINT IF EXISTS "attachment_documentId_fkey";
DROP INDEX IF EXISTS "attachment_documentId_idx";
DROP INDEX IF EXISTS "attachment_createdAt_idx";
ALTER TABLE "attachment" DROP COLUMN "documentId";

-- New polymorphic container index.
CREATE INDEX "attachment_containerType_containerId_idx"
  ON "attachment"("containerType", "containerId");
