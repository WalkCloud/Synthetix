-- AlterTable
ALTER TABLE "model_configs" ADD COLUMN "embedding_batch_size" INTEGER DEFAULT 10;

-- CreateTable
CREATE TABLE "section_assets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draft_id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "prompt" TEXT,
    "path" TEXT,
    "mime_type" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "metadata" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "section_assets_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_sections" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "draft_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "key_points" TEXT,
    "estimated_words" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "content" TEXT,
    "summary" TEXT,
    "word_count" INTEGER,
    "constraints" TEXT,
    "content_a" TEXT,
    "content_b" TEXT,
    "model_a" TEXT,
    "model_b" TEXT,
    "selected_model" TEXT,
    "rag_mode" TEXT NOT NULL DEFAULT 'auto',
    "rag_document_ids" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "sections_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sections_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_sections" ("constraints", "content", "content_a", "content_b", "created_at", "description", "draft_id", "estimated_words", "id", "index", "key_points", "model_a", "model_b", "parent_id", "selected_model", "status", "summary", "title", "updated_at", "word_count") SELECT "constraints", "content", "content_a", "content_b", "created_at", "description", "draft_id", "estimated_words", "id", "index", "key_points", "model_a", "model_b", "parent_id", "selected_model", "status", "summary", "title", "updated_at", "word_count" FROM "sections";
DROP TABLE "sections";
ALTER TABLE "new_sections" RENAME TO "sections";
CREATE INDEX "sections_draft_id_index_idx" ON "sections"("draft_id", "index");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "section_assets_draft_id_idx" ON "section_assets"("draft_id");

-- CreateIndex
CREATE INDEX "section_assets_section_id_idx" ON "section_assets"("section_id");

-- CreateIndex
CREATE INDEX "messages_session_id_idx" ON "messages"("session_id");

-- CreateIndex
CREATE INDEX "token_usage_user_id_created_at_idx" ON "token_usage"("user_id", "created_at");
