-- CreateTable
CREATE TABLE "document_images" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "document_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "alt_text" TEXT,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "page_number" INTEGER,
    "hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_images_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "domain_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stable_domain_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "domain_label" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "heading_path" TEXT,
    "source_anchors" TEXT,
    "section_indices" TEXT,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "segment_count" INTEGER NOT NULL DEFAULT 0,
    "index" INTEGER NOT NULL DEFAULT 0,
    "content_hash" TEXT NOT NULL,
    "summary_hash" TEXT,
    "is_user_edited" BOOLEAN NOT NULL DEFAULT false,
    "edit_count" INTEGER NOT NULL DEFAULT 0,
    "edited_at" DATETIME,
    "source_task_id" TEXT,
    "model_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "domain_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "domain_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "domain_segments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "domain_document_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "heading_path" TEXT,
    "source_anchor" TEXT,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "content_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_segments_domain_document_id_fkey" FOREIGN KEY ("domain_document_id") REFERENCES "domain_documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "original_format" TEXT NOT NULL,
    "original_size" INTEGER NOT NULL,
    "original_hash" TEXT,
    "original_path" TEXT NOT NULL,
    "markdown_path" TEXT,
    "markdown_size" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'uploading',
    "parent_id" TEXT,
    "token_estimate" INTEGER,
    "word_count" INTEGER,
    "conversion_method" TEXT,
    "conversion_warning" TEXT,
    "structure_path" TEXT,
    "image_manifest_path" TEXT,
    "domain_status" TEXT,
    "domain_count" INTEGER NOT NULL DEFAULT 0,
    "domain_warning" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "documents_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_documents" ("created_at", "id", "markdown_path", "markdown_size", "original_format", "original_hash", "original_name", "original_path", "original_size", "parent_id", "status", "token_estimate", "updated_at", "user_id", "word_count") SELECT "created_at", "id", "markdown_path", "markdown_size", "original_format", "original_hash", "original_name", "original_path", "original_size", "parent_id", "status", "token_estimate", "updated_at", "user_id", "word_count" FROM "documents";
DROP TABLE "documents";
ALTER TABLE "new_documents" RENAME TO "documents";
CREATE INDEX "documents_user_id_status_idx" ON "documents"("user_id", "status");
CREATE INDEX "documents_original_hash_idx" ON "documents"("original_hash");
CREATE TABLE "new_section_references" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "section_id" TEXT NOT NULL,
    "document_id" TEXT,
    "chunk_id" TEXT,
    "document_name" TEXT NOT NULL,
    "relevance_score" REAL NOT NULL,
    "source_anchor" TEXT,
    "content" TEXT,
    "images" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'rag_chunk',
    "domain_document_id" TEXT,
    "domain_segment_id" TEXT,
    "domain_label" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "section_references_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_section_references" ("chunk_id", "created_at", "document_id", "document_name", "id", "relevance_score", "section_id", "source_anchor") SELECT "chunk_id", "created_at", "document_id", "document_name", "id", "relevance_score", "section_id", "source_anchor" FROM "section_references";
DROP TABLE "section_references";
ALTER TABLE "new_section_references" RENAME TO "section_references";
CREATE INDEX "section_references_section_id_idx" ON "section_references"("section_id");
CREATE INDEX "section_references_document_id_idx" ON "section_references"("document_id");
CREATE INDEX "section_references_section_id_document_id_idx" ON "section_references"("section_id", "document_id");
CREATE INDEX "section_references_source_type_idx" ON "section_references"("source_type");
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
    CONSTRAINT "sections_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_sections" ("constraints", "content", "content_a", "content_b", "created_at", "description", "draft_id", "estimated_words", "id", "index", "key_points", "model_a", "model_b", "parent_id", "rag_document_ids", "rag_mode", "selected_model", "status", "summary", "title", "updated_at", "word_count") SELECT "constraints", "content", "content_a", "content_b", "created_at", "description", "draft_id", "estimated_words", "id", "index", "key_points", "model_a", "model_b", "parent_id", "rag_document_ids", "rag_mode", "selected_model", "status", "summary", "title", "updated_at", "word_count" FROM "sections";
DROP TABLE "sections";
ALTER TABLE "new_sections" RENAME TO "sections";
CREATE INDEX "sections_draft_id_index_idx" ON "sections"("draft_id", "index");
CREATE TABLE "new_token_usage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "model_config_id" TEXT,
    "module" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_estimate" REAL,
    "reference_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "token_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "token_usage_model_config_id_fkey" FOREIGN KEY ("model_config_id") REFERENCES "model_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_token_usage" ("cost_estimate", "created_at", "id", "input_tokens", "model_config_id", "module", "output_tokens", "reference_id", "user_id") SELECT "cost_estimate", "created_at", "id", "input_tokens", "model_config_id", "module", "output_tokens", "reference_id", "user_id" FROM "token_usage";
DROP TABLE "token_usage";
ALTER TABLE "new_token_usage" RENAME TO "token_usage";
CREATE INDEX "token_usage_user_id_created_at_idx" ON "token_usage"("user_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "document_images_document_id_idx" ON "document_images"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_images_document_id_filename_key" ON "document_images"("document_id", "filename");

-- CreateIndex
CREATE INDEX "domain_documents_document_id_idx" ON "domain_documents"("document_id");

-- CreateIndex
CREATE INDEX "domain_documents_user_id_domain_idx" ON "domain_documents"("user_id", "domain");

-- CreateIndex
CREATE INDEX "domain_documents_document_id_stable_domain_id_idx" ON "domain_documents"("document_id", "stable_domain_id");

-- CreateIndex
CREATE INDEX "domain_documents_user_id_stable_domain_id_idx" ON "domain_documents"("user_id", "stable_domain_id");

-- CreateIndex
CREATE INDEX "domain_segments_domain_document_id_idx" ON "domain_segments"("domain_document_id");

-- CreateIndex
CREATE INDEX "domain_segments_document_id_idx" ON "domain_segments"("document_id");

-- CreateIndex
CREATE INDEX "domain_segments_user_id_idx" ON "domain_segments"("user_id");
