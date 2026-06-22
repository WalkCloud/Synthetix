/**
 * Schema layer for the Wiki — the `index.md` (directory) + `log.md`
 * (change log) files, borrowed directly from Karpathy's LLM-Wiki design.
 *
 * - `index.md` is regenerated on demand from all active entries.
 * - `log.md` is append-only: every mutation adds one line via WikiChangeLog.
 *
 * Both are also the OKF export artifacts (portable Markdown the user can
 * open in Obsidian or any text editor).
 */

import fs from "fs";
import { promises as fsp } from "fs";
import path from "path";
import os from "os";
import { db } from "@/lib/db";
import type { WikiChangeAction } from "@/lib/wiki/types";

/** Resolve the per-user Wiki directory on disk. */
export function wikiDir(userId: string): string {
  const root = process.env.DB_PATH || path.join(os.homedir(), "synthetix-data");
  return path.join(root, "wiki", userId);
}

/** Ensure the per-user Wiki directory exists. */
async function ensureWikiDir(userId: string): Promise<void> {
  await fsp.mkdir(wikiDir(userId), { recursive: true }).catch(() => {});
}

/**
 * Append a change-log row to the DB (and mirror to log.md on next regeneration).
 * Called by the merger on every create/update/merge/supersede/conflict.
 */
export async function appendChangeLog(
  userId: string,
  entryId: string | null,
  action: WikiChangeAction,
  summary: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  await db.wikiChangeLog.create({
    data: {
      userId,
      entryId,
      action,
      summary,
      detail: detail ? JSON.stringify(detail) : null,
    },
  });
}

/**
 * Regenerate `index.md` — a human-readable directory of all active Wiki
 * entries, grouped by type. OKF-compatible (plain Markdown with links).
 */
export async function regenerateIndexMd(userId: string): Promise<string> {
  await ensureWikiDir(userId);
  const entries = await db.wikiEntry.findMany({
    where: { userId, status: "active" },
    select: { type: true, title: true, slug: true, confidence: true, updatedAt: true },
    orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
  });

  const typeLabels: Record<string, string> = {
    doc_summary: "Document Summaries",
    topic: "Topics",
    concept: "Concepts",
    claim: "Claims",
  };

  const lines: string[] = [
    "# Knowledge Base Index",
    "",
    `> ${entries.length} entries · last updated ${new Date().toISOString().slice(0, 10)}`,
    "",
  ];

  const grouped = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = grouped.get(e.type) ?? [];
    arr.push(e);
    grouped.set(e.type, arr);
  }

  for (const [type, label] of Object.entries(typeLabels)) {
    const group = grouped.get(type);
    if (!group || group.length === 0) continue;
    lines.push(`## ${label} (${group.length})`, "");
    for (const e of group) {
      const conf = `${Math.round(e.confidence * 100)}%`;
      const date = e.updatedAt.toISOString().slice(0, 10);
      // OKF-style: filename-as-link. Each entry is a separate .md file in export.
      lines.push(`- [[${e.slug}]] ${e.title} \`${conf}\` _${date}_`);
    }
    lines.push("");
  }

  const content = lines.join("\n");
  await fsp.writeFile(path.join(wikiDir(userId), "index.md"), content, "utf-8").catch(() => {});
  return content;
}

/**
 * Regenerate `log.md` — the human-readable change history (most recent first).
 * Backed by the WikiChangeLog table.
 */
export async function regenerateLogMd(userId: string, limit = 200): Promise<string> {
  await ensureWikiDir(userId);
  const logs = await db.wikiChangeLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { action: true, summary: true, createdAt: true },
  });

  const lines: string[] = [
    "# Knowledge Base Change Log",
    "",
    `> ${logs.length} recent changes`,
    "",
  ];

  for (const log of logs) {
    const ts = log.createdAt.toISOString().replace("T", " ").slice(0, 19);
    const icon = logIcon(log.action);
    lines.push(`- \`${ts}\` ${icon} ${log.summary}`);
  }

  const content = lines.join("\n");
  await fsp.writeFile(path.join(wikiDir(userId), "log.md"), content, "utf-8").catch(() => {});
  return content;
}

function logIcon(action: string): string {
  switch (action) {
    case "create": return "✨";
    case "update": return "📝";
    case "merge": return "🔗";
    case "supersede": return "🔄";
    case "conflict": return "⚠️";
    default: return "•";
  }
}

/**
 * Export a single Wiki entry as an OKF-format Markdown file.
 * Minimal YAML frontmatter (at least `type` per OKF spec) + Markdown body.
 */
export function entryToOkfMarkdown(entry: {
  type: string;
  title: string;
  slug: string;
  content: string;
  confidence: number;
  updatedAt: Date;
}): string {
  const frontmatter = [
    "---",
    `type: ${entry.type}`,
    `title: ${JSON.stringify(entry.title)}`,
    `confidence: ${entry.confidence}`,
    `updated: ${entry.updatedAt.toISOString()}`,
    "---",
    "",
  ].join("\n");
  return frontmatter + entry.content + "\n";
}

/** Read the on-disk index.md (or regenerate if missing). */
export async function readIndexMd(userId: string): Promise<string> {
  const file = path.join(wikiDir(userId), "index.md");
  try {
    return await fsp.readFile(file, "utf-8");
  } catch {
    return regenerateIndexMd(userId);
  }
}

/** Read the on-disk log.md (or regenerate if missing). */
export async function readLogMd(userId: string): Promise<string> {
  const file = path.join(wikiDir(userId), "log.md");
  try {
    return await fsp.readFile(file, "utf-8");
  } catch {
    return regenerateLogMd(userId);
  }
}
