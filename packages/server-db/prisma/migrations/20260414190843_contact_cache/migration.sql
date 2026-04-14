-- CreateTable
CREATE TABLE "contact_cache" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "photoUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_cache_userId_idx" ON "contact_cache"("userId");

-- CreateIndex
CREATE INDEX "contact_cache_updatedAt_idx" ON "contact_cache"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contact_cache_userId_email_key" ON "contact_cache"("userId", "email");

-- AddForeignKey
ALTER TABLE "contact_cache" ADD CONSTRAINT "contact_cache_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
