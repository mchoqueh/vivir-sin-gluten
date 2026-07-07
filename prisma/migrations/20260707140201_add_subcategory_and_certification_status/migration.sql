-- CreateEnum
CREATE TYPE "ItemCertificationStatus" AS ENUM ('CERTIFIED_GLUTEN_FREE', 'NOT_RENEWED_ANALYSIS', 'UNKNOWN');

-- AlterTable
ALTER TABLE "ItemSnapshot" ADD COLUMN     "certificationStatus" "ItemCertificationStatus" NOT NULL DEFAULT 'CERTIFIED_GLUTEN_FREE',
ADD COLUMN     "rawSubcategory" TEXT;

-- AlterTable
ALTER TABLE "OfficialItem" ADD COLUMN     "certificationStatus" "ItemCertificationStatus" NOT NULL DEFAULT 'CERTIFIED_GLUTEN_FREE',
ADD COLUMN     "subcategory" TEXT;

-- CreateIndex
CREATE INDEX "OfficialItem_certificationStatus_idx" ON "OfficialItem"("certificationStatus");

-- CreateIndex
CREATE INDEX "OfficialItem_category_idx" ON "OfficialItem"("category");

-- CreateIndex
CREATE INDEX "OfficialItem_subcategory_idx" ON "OfficialItem"("subcategory");
