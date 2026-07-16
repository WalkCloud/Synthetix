-- AlterTable
ALTER TABLE "async_tasks" ADD COLUMN "lease_owner" TEXT;
ALTER TABLE "async_tasks" ADD COLUMN "lease_expires_at" DATETIME;
ALTER TABLE "async_tasks" ADD COLUMN "execution_generation" INTEGER;
