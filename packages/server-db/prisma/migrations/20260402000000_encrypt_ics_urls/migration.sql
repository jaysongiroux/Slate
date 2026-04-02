-- DropIndex
DROP INDEX "ics_subscription_userId_url_key";

-- AlterTable
ALTER TABLE "ics_subscription" ADD COLUMN "urlHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ics_subscription_userId_urlHash_key" ON "ics_subscription"("userId", "urlHash");
