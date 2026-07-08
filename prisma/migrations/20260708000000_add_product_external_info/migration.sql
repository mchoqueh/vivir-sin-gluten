-- CreateEnum
CREATE TYPE "ProductExternalInfoSource" AS ENUM ('ISP', 'PHARMACY', 'MANUAL');

-- CreateTable
CREATE TABLE "ProductExternalInfo" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "source" "ProductExternalInfoSource" NOT NULL,
    "externalName" TEXT NOT NULL,
    "productType" TEXT,
    "activeIngredient" TEXT,
    "components" TEXT,
    "holder" TEXT,
    "manufacturer" TEXT,
    "pharmaceuticalForm" TEXT,
    "concentration" TEXT,
    "saleCondition" TEXT,
    "sanitaryRegistry" TEXT,
    "registryStatus" TEXT,
    "sourceUrl" TEXT,
    "rawPayload" JSONB,
    "matchScore" INTEGER,
    "matchConfidence" INTEGER,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductExternalInfo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductExternalInfo_itemId_idx" ON "ProductExternalInfo"("itemId");

-- CreateIndex
CREATE INDEX "ProductExternalInfo_source_idx" ON "ProductExternalInfo"("source");

-- CreateIndex
CREATE INDEX "ProductExternalInfo_externalName_idx" ON "ProductExternalInfo"("externalName");

-- CreateIndex
CREATE INDEX "ProductExternalInfo_sanitaryRegistry_idx" ON "ProductExternalInfo"("sanitaryRegistry");

-- CreateIndex
CREATE INDEX "ProductExternalInfo_fetchedAt_idx" ON "ProductExternalInfo"("fetchedAt");

-- AddForeignKey
ALTER TABLE "ProductExternalInfo" ADD CONSTRAINT "ProductExternalInfo_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OfficialItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
