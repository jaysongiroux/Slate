-- CreateTable
CREATE TABLE "document_similarity_edge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromDocumentId" TEXT NOT NULL,
    "toDocumentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_similarity_edge_pkey" PRIMARY KEY ("id")
);

-- FKs
ALTER TABLE "document_similarity_edge" ADD CONSTRAINT "document_similarity_edge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_similarity_edge" ADD CONSTRAINT "document_similarity_edge_fromDocumentId_fkey" FOREIGN KEY ("fromDocumentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_similarity_edge" ADD CONSTRAINT "document_similarity_edge_toDocumentId_fkey" FOREIGN KEY ("toDocumentId") REFERENCES "document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_similarity_edge" ADD CONSTRAINT "document_similarity_edge_order_chk" CHECK ("fromDocumentId" < "toDocumentId");

CREATE UNIQUE INDEX "document_similarity_edge_userId_fromDocumentId_toDocumentId_key" ON "document_similarity_edge"("userId", "fromDocumentId", "toDocumentId");
CREATE INDEX "document_similarity_edge_userId_idx" ON "document_similarity_edge"("userId");
CREATE INDEX "document_similarity_edge_userId_fromDocumentId_idx" ON "document_similarity_edge"("userId", "fromDocumentId");
CREATE INDEX "document_similarity_edge_userId_toDocumentId_idx" ON "document_similarity_edge"("userId", "toDocumentId");
