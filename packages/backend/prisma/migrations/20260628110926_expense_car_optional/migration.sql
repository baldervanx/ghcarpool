-- DropForeignKey
ALTER TABLE "Expense" DROP CONSTRAINT "Expense_carId_fkey";

-- AlterTable
ALTER TABLE "DateCarBooking" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Expense" ALTER COLUMN "carId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_carId_fkey" FOREIGN KEY ("carId") REFERENCES "Car"("id") ON DELETE SET NULL ON UPDATE CASCADE;
