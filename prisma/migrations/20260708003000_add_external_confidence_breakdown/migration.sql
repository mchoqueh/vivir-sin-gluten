ALTER TABLE "ProductExternalInfo"
ADD COLUMN IF NOT EXISTS "tavilyScore" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "dataConfidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "confidenceBreakdown" JSONB;

UPDATE "ProductExternalInfo"
SET "dataConfidence" = COALESCE("dataConfidence", "confidence")
WHERE "confidence" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ExternalSearchLog" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "tavilyScore" DOUBLE PRECISION,
  "dataConfidence" DOUBLE PRECISION,
  "confidenceBreakdown" JSONB,
  "status" TEXT NOT NULL,
  "generated" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "durationMs" INTEGER,
  "resultsCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalSearchLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ExternalSearchLog_itemId_idx" ON "ExternalSearchLog"("itemId");
CREATE INDEX IF NOT EXISTS "ExternalSearchLog_provider_idx" ON "ExternalSearchLog"("provider");
CREATE INDEX IF NOT EXISTS "ExternalSearchLog_status_idx" ON "ExternalSearchLog"("status");
CREATE INDEX IF NOT EXISTS "ExternalSearchLog_createdAt_idx" ON "ExternalSearchLog"("createdAt");
