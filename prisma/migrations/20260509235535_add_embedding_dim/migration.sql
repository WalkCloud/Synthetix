-- AlterTable
ALTER TABLE "model_configs" ADD COLUMN "embedding_dim" INTEGER;

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "outline" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "session_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sections" (
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "sections_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "sections_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "sections" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "section_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "section_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "model_id" TEXT,
    "word_count" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "section_versions_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "section_references" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "section_id" TEXT NOT NULL,
    "document_id" TEXT,
    "chunk_id" TEXT,
    "document_name" TEXT NOT NULL,
    "relevance_score" REAL NOT NULL,
    "source_anchor" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "section_references_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "drafts_user_id_status_idx" ON "drafts"("user_id", "status");

-- CreateIndex
CREATE INDEX "sections_draft_id_index_idx" ON "sections"("draft_id", "index");

-- CreateIndex
CREATE INDEX "section_versions_section_id_version_idx" ON "section_versions"("section_id", "version");

-- CreateIndex
CREATE INDEX "section_references_section_id_idx" ON "section_references"("section_id");

-- CreateIndex
CREATE INDEX "section_references_document_id_idx" ON "section_references"("document_id");

-- CreateIndex
CREATE INDEX "section_references_section_id_document_id_idx" ON "section_references"("section_id", "document_id");
