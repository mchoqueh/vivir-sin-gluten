-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('FOOD', 'MEDICINE');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED_NO_CHANGE');

-- CreateEnum
CREATE TYPE "ChangeType" AS ENUM ('ADDED', 'REMOVED', 'MODIFIED');

-- CreateTable
CREATE TABLE "OfficialItem" (
    "id" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "company" TEXT,
    "category" TEXT,
    "normalized" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficialItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemSnapshot" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "syncId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "rawName" TEXT NOT NULL,
    "rawBrand" TEXT,
    "rawCompany" TEXT,
    "rawCategory" TEXT,
    "rowHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceSync" (
    "id" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "url" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "sourceDate" TIMESTAMP(3),
    "itemCount" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemChange" (
    "id" TEXT NOT NULL,
    "itemId" TEXT,
    "syncId" TEXT NOT NULL,
    "sourceType" "SourceType" NOT NULL,
    "type" "ChangeType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficialItem_sourceType_idx" ON "OfficialItem"("sourceType");

-- CreateIndex
CREATE INDEX "OfficialItem_active_idx" ON "OfficialItem"("active");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialItem_sourceType_normalized_key" ON "OfficialItem"("sourceType", "normalized");

-- CreateIndex
CREATE INDEX "ItemSnapshot_syncId_idx" ON "ItemSnapshot"("syncId");

-- CreateIndex
CREATE INDEX "ItemSnapshot_itemId_idx" ON "ItemSnapshot"("itemId");

-- CreateIndex
CREATE INDEX "ItemSnapshot_rowHash_idx" ON "ItemSnapshot"("rowHash");

-- CreateIndex
CREATE INDEX "SourceSync_sourceType_idx" ON "SourceSync"("sourceType");

-- CreateIndex
CREATE INDEX "SourceSync_fileHash_idx" ON "SourceSync"("fileHash");

-- CreateIndex
CREATE INDEX "SourceSync_createdAt_idx" ON "SourceSync"("createdAt");

-- CreateIndex
CREATE INDEX "ItemChange_sourceType_idx" ON "ItemChange"("sourceType");

-- CreateIndex
CREATE INDEX "ItemChange_type_idx" ON "ItemChange"("type");

-- CreateIndex
CREATE INDEX "ItemChange_createdAt_idx" ON "ItemChange"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_itemId_key" ON "Favorite"("itemId");

-- AddForeignKey
ALTER TABLE "ItemSnapshot" ADD CONSTRAINT "ItemSnapshot_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OfficialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemSnapshot" ADD CONSTRAINT "ItemSnapshot_syncId_fkey" FOREIGN KEY ("syncId") REFERENCES "SourceSync"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChange" ADD CONSTRAINT "ItemChange_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OfficialItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChange" ADD CONSTRAINT "ItemChange_syncId_fkey" FOREIGN KEY ("syncId") REFERENCES "SourceSync"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OfficialItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
