-- AlterTable
ALTER TABLE "async_tasks" ADD COLUMN "document_id" TEXT;
ALTER TABLE "async_tasks" ADD COLUMN "draft_id" TEXT;
ALTER TABLE "async_tasks" ADD COLUMN "section_id" TEXT;
ALTER TABLE "async_tasks" ADD COLUMN "session_id" TEXT;
ALTER TABLE "async_tasks" ADD COLUMN "operation_id" TEXT;
ALTER TABLE "async_tasks" ADD COLUMN "parent_task_id" TEXT;
ALTER TABLE "async_tasks" ADD COLUMN "attempt" INTEGER;

-- CreateIndex
CREATE INDEX "async_tasks_user_id_document_id_type_created_at_idx" ON "async_tasks"("user_id", "document_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "async_tasks_user_id_draft_id_type_created_at_idx" ON "async_tasks"("user_id", "draft_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "async_tasks_user_id_section_id_type_created_at_idx" ON "async_tasks"("user_id", "section_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "async_tasks_user_id_session_id_type_created_at_idx" ON "async_tasks"("user_id", "session_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "async_tasks_operation_id_idx" ON "async_tasks"("operation_id");

-- CreateIndex
CREATE INDEX "async_tasks_parent_task_id_idx" ON "async_tasks"("parent_task_id");
