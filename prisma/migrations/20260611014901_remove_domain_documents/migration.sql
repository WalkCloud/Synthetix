/*
  Warnings:

  - You are about to drop the `domain_documents` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `domain_segments` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `domain_count` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `domain_status` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `domain_warning` on the `documents` table. All the data in the column will be lost.
  - You are about to drop the column `domain_document_id` on the `section_references` table. All the data in the column will be lost.
  - You are about to drop the column `domain_label` on the `section_references` table. All the data in the column will be lost.
  - You are about to drop the column `domain_segment_id` on the `section_references` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "domain_documents_user_id_stable_domain_id_idx";

-- DropIndex
DROP INDEX "domain_documents_document_id_stable_domain_id_idx";

-- DropIndex
DROP INDEX "domain_documents_user_id_domain_idx";

-- DropIndex
DROP INDEX "domain_documents_document_id_idx";

-- DropIndex
DROP INDEX "domain_segments_user_id_idx";

-- DropIndex
DROP INDEX "domain_segments_document_id_idx";

-- DropIndex
DROP INDEX "domain_segments_domain_document_id_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "domain_documents";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "domain_segments";
PRAGMA foreign_keys=on;

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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "documents_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "documents" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_documents" ("conversion_method", "conversion_warning", "created_at", "id", "image_manifest_path", "markdown_path", "markdown_size", "original_format", "original_hash", "original_name", "original_path", "original_size", "parent_id", "status", "structure_path", "token_estimate", "updated_at", "user_id", "word_count") SELECT "conversion_method", "conversion_warning", "created_at", "id", "image_manifest_path", "markdown_path", "markdown_size", "original_format", "original_hash", "original_name", "original_path", "original_size", "parent_id", "status", "structure_path", "token_estimate", "updated_at", "user_id", "word_count" FROM "documents";
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "section_references_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "sections" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_section_references" ("chunk_id", "content", "created_at", "document_id", "document_name", "id", "images", "relevance_score", "section_id", "source_anchor", "source_type") SELECT "chunk_id", "content", "created_at", "document_id", "document_name", "id", "images", "relevance_score", "section_id", "source_anchor", "source_type" FROM "section_references";
DROP TABLE "section_references";
ALTER TABLE "new_section_references" RENAME TO "section_references";
CREATE INDEX "section_references_section_id_idx" ON "section_references"("section_id");
CREATE INDEX "section_references_document_id_idx" ON "section_references"("document_id");
CREATE INDEX "section_references_section_id_document_id_idx" ON "section_references"("section_id", "document_id");
CREATE INDEX "section_references_source_type_idx" ON "section_references"("source_type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
