-- AlterTable: lägg till name-kolumn på User
-- @default(cuid()) på User.id och Car.id var en Prisma-klientdefault utan
-- motsvarighet i DDL — ingen SQL-ändring krävs för id-kolumnerna.
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';
