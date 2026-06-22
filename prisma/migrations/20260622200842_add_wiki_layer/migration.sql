-- CreateTable: WikiEntry
-- LLM-synthesized, human-readable knowledge entries sitting above the raw
-- chunks and graph layers (LLM-Wiki synthesized layer + OKF portable format).
CREATE TABLE "wiki_entries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source_refs" TEXT NOT NULL DEFAULT '[]',
    "confidence" REAL NOT NULL DEFAULT 0.8,
    "status" TEXT NOT NULL DEFAULT 'active',
    "last_validated_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "wiki_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "wiki_entries_user_id_slug_idx" ON "wiki_entries"("user_id", "slug");

-- CreateIndex
CREATE INDEX "wiki_entries_user_id_type_idx" ON "wiki_entries"("user_id", "type");

-- CreateIndex
CREATE INDEX "wiki_entries_user_id_status_idx" ON "wiki_entries"("user_id", "status");

-- CreateTable: WikiLink
-- Explicit typed edges between Wiki entries (OKF "links form the graph").
CREATE TABLE "wiki_links" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "from_id" TEXT NOT NULL,
    "to_id" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    CONSTRAINT "wiki_links_from_id_fkey" FOREIGN KEY ("from_id") REFERENCES "wiki_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "wiki_links_to_id_fkey" FOREIGN KEY ("to_id") REFERENCES "wiki_entries" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "wiki_links_from_id_to_id_relation_idx" ON "wiki_links"("from_id", "to_id", "relation");

-- CreateIndex
CREATE INDEX "wiki_links_to_id_idx" ON "wiki_links"("to_id");

-- CreateTable: WikiChangeLog
-- Append-only history backing the human-readable log.md (LLM-Wiki schema layer).
CREATE TABLE "wiki_change_log" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "entry_id" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "wiki_change_log_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "wiki_entries" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "wiki_change_log_user_id_created_at_idx" ON "wiki_change_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "wiki_change_log_entry_id_idx" ON "wiki_change_log"("entry_id");
