-- AlterTable
ALTER TABLE "SourceSync" ADD COLUMN     "contentHash" TEXT;

-- CreateIndex
CREATE INDEX "SourceSync_contentHash_idx" ON "SourceSync"("contentHash");
