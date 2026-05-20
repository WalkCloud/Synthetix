"use client";

import { useState } from "react";
import type { SectionMeta } from "@/types/writing";
import { Edit3, Check, X, Plus, Trash2, GripVertical } from "lucide-react";

interface OutlinePanelProps {
  sections: SectionMeta[];
  draftId: string;
  draftOutline?: string | null;
  activeSectionId: string | null;
  onSelectSection: (id: string) => void;
  onSectionsChanged: () => void;
}

interface EditableSection {
  id: string;
  title: string;
  index: number;
  parentId: string | null;
  estimatedWords: number | null;
  isNew?: boolean;
  isDeleted?: boolean;
}

function getSectionStatus(status: string): "done" | "current" | "pending" {
  if (["summarized", "locked", "accepted"].includes(status)) return "done";
  if (["generating", "comparing", "reviewing", "retrieving"].includes(status)) return "current";
  return "pending";
}

function getOutlineNumber(section: SectionMeta, fallback: string): string {
  if (!section.constraints) return fallback;
  try {
    const parsed = JSON.parse(section.constraints) as { outlineNumber?: unknown };
    return typeof parsed.outlineNumber === "string" && parsed.outlineNumber.trim()
      ? parsed.outlineNumber
      : fallback;
  } catch {
    return fallback;
  }
}

interface OutlineNodeMap {
  num: string;
  title: string;
  children?: OutlineNodeMap[];
}

function flattenOutlineNumbers(
  nodes: OutlineNodeMap[] | undefined,
  result = new Map<string, string>(),
): Map<string, string> {
  if (!nodes) return result;
  for (const node of nodes) {
    const key = normalizeTitle(node.title);
    if (key && node.num) {
      result.set(key, node.num);
    }
    flattenOutlineNumbers(node.children, result);
  }
  return result;
}

function parseOutlineNumbers(outline?: string | null): Map<string, string> {
  if (!outline) return new Map();
  try {
    const parsed = JSON.parse(outline) as { sections?: OutlineNodeMap[] };
    return flattenOutlineNumbers(parsed.sections);
  } catch {
    return new Map();
  }
}

function normalizeTitle(title: string): string {
  return title.replace(/^\d+(\.\d+)*\.?\s*/, "").trim();
}

function SectionNode({
  section,
  sections,
  activeSectionId,
  onSelectSection,
  fallbackNumber,
  outlineNumbers,
  depth,
}: {
  section: SectionMeta;
  sections: SectionMeta[];
  activeSectionId: string | null;
  onSelectSection: (id: string) => void;
  fallbackNumber: string;
  outlineNumbers: Map<string, string>;
  depth: number;
}) {
  const status = getSectionStatus(section.status);
  const isActive = section.id === activeSectionId;
  const children = sections
    .filter((s) => s.parentId === section.id)
    .sort((a, b) => a.index - b.index);
  const outlineNumber = getOutlineNumber(
    section,
    outlineNumbers.get(normalizeTitle(section.title)) ?? fallbackNumber,
  );

  return (
    <div>
      <div
        onClick={() => onSelectSection(section.id)}
        className={`flex items-start gap-2 px-2.5 py-2 rounded-lg text-[13px] cursor-pointer transition-colors ${
          isActive
            ? "bg-primary-50 text-primary-700 font-semibold"
            : status === "done"
              ? "text-emerald-600"
              : "text-slate-500 hover:bg-slate-50"
        }`}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
      >
        <span
          className={`w-2 h-2 rounded-full shrink-0 mt-[7px] ${
            status === "done"
              ? "bg-emerald-500"
              : status === "current"
                ? "bg-primary-600 animate-pulse"
                : "bg-slate-200"
          }`}
        />
        <span className="min-w-0 leading-5">
          <span className="font-medium tabular-nums">{outlineNumber}.</span>{" "}
          {section.title}
        </span>
      </div>

      {children.map((child, index) => (
        <SectionNode
          key={child.id}
          section={child}
          sections={sections}
          activeSectionId={activeSectionId}
          onSelectSection={onSelectSection}
          fallbackNumber={`${outlineNumber}.${index + 1}`}
          outlineNumbers={outlineNumbers}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function EditSectionRow({
  item,
  allItems,
  onUpdate,
  onRemove,
  depth,
}: {
  item: EditableSection;
  allItems: EditableSection[];
  onUpdate: (id: string, field: "title" | "estimatedWords", value: string) => void;
  onRemove: (id: string) => void;
  depth: number;
}) {
  const children = allItems.filter((s) => s.parentId === item.id && !s.isDeleted);
  const indent = 10 + depth * 14;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg group/editRow"
        style={{ paddingLeft: `${indent}px` }}
      >
        <GripVertical className="w-3 h-3 shrink-0 text-slate-300" />
        <input
          type="text"
          value={item.title}
          onChange={(e) => onUpdate(item.id, "title", e.target.value)}
          placeholder="Section title..."
          className="min-w-0 flex-1 bg-transparent text-[13px] text-slate-800 focus:outline-none border-b border-transparent focus:border-primary-300 transition"
        />
        <input
          type="text"
          inputMode="numeric"
          value={item.estimatedWords ?? ""}
          onChange={(e) => onUpdate(item.id, "estimatedWords", e.target.value)}
          className="shrink-0 w-14 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-center text-slate-500 focus:ring-1 focus:ring-primary/20 focus:outline-none"
          placeholder="words"
        />
        <button
          onClick={() => onRemove(item.id)}
          className="flex shrink-0 cursor-pointer items-center justify-center rounded h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {children.map((child) => (
        <EditSectionRow
          key={child.id}
          item={child}
          allItems={allItems}
          onUpdate={onUpdate}
          onRemove={onRemove}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

export function OutlinePanel({
  sections,
  draftId,
  draftOutline,
  activeSectionId,
  onSelectSection,
  onSectionsChanged,
}: OutlinePanelProps) {
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState<EditableSection[]>([]);
  const [saving, setSaving] = useState(false);

  const topLevelSections = sections
    .filter((s) => !s.parentId)
    .sort((a, b) => a.index - b.index);
  const outlineNumbers = parseOutlineNumbers(draftOutline);
  const completedCount = sections.filter(
    (s) => s.status === "summarized" || s.status === "locked" || s.status === "accepted"
  ).length;
  const totalCount = sections.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  function startEditing() {
    setEditItems(
      sections.map((s) => ({
        id: s.id,
        title: s.title,
        index: s.index,
        parentId: s.parentId,
        estimatedWords: s.estimatedWords,
      }))
    );
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditItems([]);
  }

  function updateEditItem(id: string, field: "title" | "estimatedWords", value: string) {
    setEditItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]: field === "estimatedWords" ? (parseInt(value) || 0) : value,
            }
          : item
      )
    );
  }

  function removeEditItem(id: string) {
    const hasChildren = editItems.some((s) => s.parentId === id && !s.isDeleted);
    if (hasChildren) return;
    setEditItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isDeleted: true } : item))
    );
  }

  function addEditSection() {
    const topLevel = editItems.filter((s) => !s.parentId && !s.isDeleted);
    const newId = `_new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setEditItems((prev) => [
      ...prev,
      {
        id: newId,
        title: "",
        index: topLevel.length,
        parentId: null,
        estimatedWords: 500,
        isNew: true,
      },
    ]);
  }

  function addEditChild(parentId: string) {
    const siblings = editItems.filter((s) => s.parentId === parentId && !s.isDeleted);
    const newId = `_new_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setEditItems((prev) => [
      ...prev,
      {
        id: newId,
        title: "",
        index: siblings.length,
        parentId,
        estimatedWords: 200,
        isNew: true,
      },
    ]);
  }

  async function saveEditing() {
    setSaving(true);
    try {
      const changes: {
        sections: Array<{
          id?: string;
          title?: string;
          index?: number;
          parentId?: string | null;
          estimatedWords?: number;
          _delete?: boolean;
          _new?: boolean;
        }>;
      } = { sections: [] };

      const visibleItems = editItems.filter((s) => !s.isDeleted);
      const deletedItems = editItems.filter((s) => s.isDeleted);

      const topLevel = visibleItems.filter((s) => !s.parentId);
      for (let i = 0; i < topLevel.length; i++) {
        const item = topLevel[i];
        changes.sections.push({
          id: item.id,
          title: item.title,
          index: i,
          parentId: null,
          estimatedWords: item.estimatedWords ?? undefined,
          _new: item.isNew ? true : undefined,
        });

        const children = visibleItems.filter((s) => s.parentId === item.id);
        for (let j = 0; j < children.length; j++) {
          const child = children[j];
          changes.sections.push({
            id: child.id,
            title: child.title,
            index: j,
            parentId: item.id,
            estimatedWords: child.estimatedWords ?? undefined,
            _new: child.isNew ? true : undefined,
          });
        }
      }

      for (const d of deletedItems) {
        changes.sections.push({ id: d.id, _delete: true });
      }

      const res = await fetch(`/api/v1/drafts/${draftId}/outline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });

      if (res.ok) {
        setEditing(false);
        setEditItems([]);
        onSectionsChanged();
      }
    } catch {
    } finally {
      setSaving(false);
    }
  }

  const visibleEditItems = editItems.filter((s) => !s.isDeleted);
  const topLevelEdit = visibleEditItems.filter((s) => !s.parentId);

  return (
    <div className="outline-panel bg-white border-r border-slate-200 p-5 overflow-y-auto h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold flex items-center gap-2 text-slate-900">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="w-[18px] h-[18px] text-primary-600"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Outline
        </h3>

        {editing ? (
          <div className="flex items-center gap-1">
            <button
              onClick={saveEditing}
              disabled={saving}
              className="flex cursor-pointer items-center justify-center h-7 w-7 rounded-lg bg-primary-600 text-white hover:bg-primary-700 transition disabled:opacity-40"
              title="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={cancelEditing}
              disabled={saving}
              className="flex cursor-pointer items-center justify-center h-7 w-7 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition disabled:opacity-40"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={startEditing}
            className="flex cursor-pointer items-center gap-1 h-7 px-2.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition text-xs font-medium"
            title="Edit outline"
          >
            <Edit3 className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {editing ? (
          <div className="space-y-1">
            {topLevelEdit.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                <EditSectionRow
                  item={item}
                  allItems={visibleEditItems}
                  onUpdate={updateEditItem}
                  onRemove={removeEditItem}
                  depth={0}
                />
                {visibleEditItems.filter((s) => s.parentId === item.id).length > 0 && (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-2 py-1">
                    {visibleEditItems
                      .filter((s) => s.parentId === item.id)
                      .map((child) => (
                        <EditSectionRow
                          key={child.id}
                          item={child}
                          allItems={visibleEditItems}
                          onUpdate={updateEditItem}
                          onRemove={removeEditItem}
                          depth={1}
                        />
                      ))}
                    <button
                      onClick={() => addEditChild(item.id)}
                      className="flex cursor-pointer items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-primary/50 hover:text-primary transition"
                    >
                      <Plus className="h-3 w-3" /> Add Sub-section
                    </button>
                  </div>
                )}
                {visibleEditItems.filter((s) => s.parentId === item.id).length === 0 && (
                  <div className="border-t border-slate-100 px-2 py-1">
                    <button
                      onClick={() => addEditChild(item.id)}
                      className="flex cursor-pointer items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-primary/50 hover:text-primary transition"
                    >
                      <Plus className="h-3 w-3" /> Add Sub-section
                    </button>
                  </div>
                )}
              </div>
            ))}
            <button
              onClick={addEditSection}
              className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-200 py-2 text-xs font-semibold text-primary hover:bg-primary-50 transition"
            >
              <Plus className="h-3.5 w-3.5" /> Add Section
            </button>
          </div>
        ) : (
          topLevelSections.map((section, index) => (
            <SectionNode
              key={section.id}
              section={section}
              sections={sections}
              activeSectionId={activeSectionId}
              onSelectSection={onSelectSection}
              fallbackNumber={String(index + 1)}
              outlineNumbers={outlineNumbers}
              depth={0}
            />
          ))
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-200">
        <div className="text-xs text-slate-500 mb-1.5 font-medium">
          {completedCount} / {totalCount} sections completed
        </div>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-600 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
