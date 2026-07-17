-- AlterTable
ALTER TABLE "async_tasks" ADD COLUMN "started_at" DATETIME;
ALTER TABLE "async_tasks" ADD COLUMN "heartbeat_at" DATETIME;
ALTER TABLE "async_tasks" ADD COLUMN "cancel_requested_at" DATETIME;
ALTER TABLE "async_tasks" ADD COLUMN "finished_at" DATETIME;

-- CreateIndex
CREATE INDEX "async_tasks_status_heartbeat_at_idx" ON "async_tasks"("status", "heartbeat_at");
