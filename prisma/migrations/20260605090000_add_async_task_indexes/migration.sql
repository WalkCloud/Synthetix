-- CreateIndex
CREATE INDEX "async_tasks_user_id_type_created_at_idx" ON "async_tasks"("user_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "async_tasks_user_id_created_at_idx" ON "async_tasks"("user_id", "created_at");
