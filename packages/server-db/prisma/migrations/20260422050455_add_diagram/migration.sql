-- CreateTable
CREATE TABLE "diagram" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scene" JSONB NOT NULL DEFAULT '{}',
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diagram_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diagram_userId_idx" ON "diagram"("userId");

-- CreateIndex
CREATE INDEX "diagram_userId_deleted_idx" ON "diagram"("userId", "deleted");

-- AddForeignKey
ALTER TABLE "diagram" ADD CONSTRAINT "diagram_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
