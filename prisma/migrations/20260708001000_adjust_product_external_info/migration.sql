-- AlterTable
ALTER TABLE "ProductExternalInfo"
ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "matchReason" TEXT;

-- Migrate previous confidence fields when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ProductExternalInfo' AND column_name = 'matchConfidence'
  ) THEN
    EXECUTE 'UPDATE "ProductExternalInfo" SET "confidence" = COALESCE("confidence", "matchConfidence"::double precision / 100.0)';
  END IF;
END $$;

-- Drop old non-unique index if it exists, then enforce one external info per product.
DROP INDEX IF EXISTS "ProductExternalInfo_itemId_idx";

WITH ranked_external_info AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "itemId"
      ORDER BY
        CASE WHEN "source" = 'MANUAL' THEN 0 ELSE 1 END,
        COALESCE("confidence", 0) DESC,
        "updatedAt" DESC,
        "createdAt" DESC
    ) AS row_number
  FROM "ProductExternalInfo"
)
DELETE FROM "ProductExternalInfo"
WHERE "id" IN (
  SELECT "id"
  FROM ranked_external_info
  WHERE row_number > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductExternalInfo_itemId_key" ON "ProductExternalInfo"("itemId");

-- Drop old score columns from the previous draft model.
ALTER TABLE "ProductExternalInfo"
DROP COLUMN IF EXISTS "matchScore",
DROP COLUMN IF EXISTS "matchConfidence";
