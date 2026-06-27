-- AlterTable: lägg till updatedAt på DateCarBooking
-- Befintliga rader får NOW() som startvärde (Prisma @updatedAt håller dem sedan aktuella)
ALTER TABLE "DateCarBooking"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- Index för snabba ?since= queries
CREATE INDEX "DateCarBooking_updatedAt_idx" ON "DateCarBooking"("updatedAt");
