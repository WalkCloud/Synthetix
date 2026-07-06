-- Add document_atoms and document_segments tables (PR 3 + 4 schema)
CREATE TABLE IF NOT EXISTS "document_atoms" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "span_id" TEXT,
    "block_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER,
    "heading_path" TEXT,
    "heading_level" INTEGER,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "char_start" INTEGER,
    "char_end" INTEGER,
    "text_preview" TEXT,
    "keywords" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_atoms_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_atoms_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "document_atoms_document_id_index_idx" ON "document_atoms"("document_id", "index");

CREATE TABLE IF NOT EXISTS "document_segments" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "start_atom_index" INTEGER NOT NULL,
    "end_atom_index" INTEGER NOT NULL,
    "page_start" INTEGER,
    "page_end" INTEGER,
    "heading_path" TEXT,
    "token_count" INTEGER,
    "content_path" TEXT,
    "source_atom_ids" TEXT NOT NULL DEFAULT '[]',
    "source_chunk_ids" TEXT,
    "segmentation_method" TEXT NOT NULL DEFAULT 'llm',
    "segmentation_reason" TEXT,
    "confidence" REAL NOT NULL DEFAULT 0.8,
    "content_hash" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "document_segments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_segments_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "document_segments_document_id_index_idx" ON "document_segments"("document_id", "index");
