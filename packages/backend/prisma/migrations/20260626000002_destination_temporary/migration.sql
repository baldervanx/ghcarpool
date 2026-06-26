-- Migration: lägg till temporary-flagga på Destination
-- Befintliga destinationer är granskade av admin → temporary = false (default)
ALTER TABLE "Destination"
  ADD COLUMN "temporary" BOOLEAN NOT NULL DEFAULT false;

-- shortName saknar default i befintlig DDL — lägg till det också
ALTER TABLE "Destination"
  ALTER COLUMN "shortName" SET DEFAULT '';
