"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n";

/** List/representation DTO for an API key; never carries plaintext or hash. */
interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  status: "active" | "revoked";
}

/** Creation response (carries the plaintext exactly once). */
interface CreatedKey {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  keyLast4: string;
  createdAt: string;
}

type CreatedStep = "naming" | "revealed";

export function ApiKeyTab() {
  const { t } = useLocale();
  const tr = t.settings.apiKeys;
  const [keys, setKeys] = useState<ApiKeyItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<CreatedStep>("naming");
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Revoke dialog state
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyItem | null>(null);
  const [revoking, setRevoking] = useState(false);

  const fetchKeys = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/v1/users/api-keys");
      const data = await res.json();
      if (data.success) {
        setKeys(data.data);
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  function openCreate() {
    setName("");
    setCreatedKey(null);
    setCopied(false);
    setCreateStep("naming");
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!name.trim()) {
      toast.error(tr.errors.nameRequired);
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/v1/users/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setCreatedKey(data.data);
        setCreateStep("revealed");
        // Auto-copy immediately to reduce the chance of the user losing it.
        void copyToClipboard(data.data.key);
      } else {
        toast.error(tr.errors.createFailed);
      }
    } catch {
      toast.error(tr.errors.createFailed);
    } finally {
      setCreating(false);
    }
  }

  function closeCreate() {
    setCreateOpen(false);
    if (createdKey) {
      // After closing the reveal view, refresh the list (new key persisted,
      // now shown masked).
      setCreatedKey(null);
      void fetchKeys();
    }
  }

  async function copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(tr.copiedToast);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error(tr.errors.createFailed);
    }
  }

  async function handleRevokeConfirm() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/v1/users/api-keys/${revokeTarget.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        toast.success(tr.revokedToast);
        setRevokeTarget(null);
        await fetchKeys();
      } else {
        toast.error(tr.errors.revokeFailed);
      }
    } catch {
      toast.error(tr.errors.revokeFailed);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-5">
      {/* Description card */}
      <div className="rounded-[16px] border border-border bg-card p-6 shadow-soft">
        <h3 className="text-base font-semibold text-foreground">{tr.title}</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{tr.description}</p>
      </div>

      {/* Loading state */}
      {keys === null && !loadError && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 rounded-[16px] border border-border bg-card animate-pulse" />
          ))}
        </div>
      )}

      {/* Load failure */}
      {loadError && (
        <div className="rounded-[16px] border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {tr.errors.loadFailed}
        </div>
      )}

      {/* Key list */}
      {keys !== null && (
        <div className="space-y-4">
          {keys.length === 0 && (
            <div className="rounded-[16px] border border-border bg-card p-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 2a4 4 0 0 0-4 4l-9 9 4 4 9-9a4 4 0 0 0 4-4" />
                  <path d="m14 12 2 2" />
                </svg>
              </div>
              <p className="text-sm text-muted-foreground">{tr.emptyHint}</p>
            </div>
          )}

          {keys.map((k) => (
            <KeyCard
              key={k.id}
              item={k}
              tr={tr}
              onRevoke={() => setRevokeTarget(k)}
            />
          ))}

          {/* Add card (dashed border, mirrors model-list-tab) */}
          <button
            onClick={openCreate}
            className="flex w-full items-center justify-center gap-2 rounded-[16px] border-2 border-dashed border-border py-5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {tr.createNew}
          </button>
        </div>
      )}

      {/* Create modal (full-screen overlay, two steps: name -> reveal) */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onClick={closeCreate}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {createStep === "naming" ? (
              <>
                <h3 className="text-base font-semibold text-foreground">{tr.createTitle}</h3>
                <p className="mt-1 text-[13px] text-muted-foreground">{tr.createDesc}</p>

                <label className="mt-4 block text-xs font-medium text-muted-foreground">{tr.keyName}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !creating) void handleCreate();
                  }}
                  placeholder={tr.keyNamePlaceholder}
                  autoFocus
                  className="mt-1.5 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-primary"
                />

                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 9v4M12 17h.01" />
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                  <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">{tr.createWarning}</p>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="outline" size="lg" onClick={closeCreate} disabled={creating}>
                    {t.common.actions.cancel}
                  </Button>
                  <Button size="lg" onClick={handleCreate} disabled={creating || !name.trim()}>
                    {creating ? t.common.actions.loading : tr.create}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-foreground">{tr.createdTitle}</h3>
                    <p className="mt-0.5 text-[13px] text-muted-foreground">{createdKey?.name}</p>
                  </div>
                </div>

                {/* One-time plaintext reveal (monospace + copy button) */}
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-border bg-muted/50 p-3">
                  <code className="flex-1 break-all font-mono text-sm text-foreground">{createdKey?.key}</code>
                  <button
                    onClick={() => createdKey && copyToClipboard(createdKey.key)}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary"
                    title={tr.copy}
                  >
                    {copied ? (
                      <svg className="h-4 w-4 text-emerald-600 dark:text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                      </svg>
                    )}
                    {copied ? tr.copied : tr.copy}
                  </button>
                </div>

                <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
                  <svg className="mt-0.5 h-4 w-4 shrink-0 text-destructive" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 9v4M12 17h.01" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                  <p className="text-xs leading-relaxed text-destructive">{tr.createdOnceWarning}</p>
                </div>

                <div className="mt-5 flex justify-end">
                  <Button size="lg" onClick={closeCreate}>{tr.savedClose}</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Revoke confirmation dialog (mirrors delete-document-dialog) */}
      <Dialog open={revokeTarget !== null} onOpenChange={(v) => !revoking && !v && setRevokeTarget(null)}>
        <DialogContent className="sm:max-w-[420px]" showCloseButton={!revoking}>
          <DialogHeader className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base break-words leading-snug">{tr.revokeConfirmTitle}</DialogTitle>
                <DialogDescription className="mt-1 truncate text-xs break-all" title={revokeTarget?.name}>
                  {revokeTarget?.name}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <p className="text-xs leading-relaxed text-muted-foreground">{tr.revokeConfirmDesc}</p>

          <DialogFooter>
            <Button variant="outline" size="lg" disabled={revoking} onClick={() => setRevokeTarget(null)}>
              {t.common.actions.cancel}
            </Button>
            <Button variant="destructive" size="lg" disabled={revoking} onClick={handleRevokeConfirm}>
              {revoking ? t.common.actions.loading : tr.revokeButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A single key card. */
function KeyCard({
  item,
  tr,
  onRevoke,
}: {
  item: ApiKeyItem;
  tr: {
    neverUsed: string;
    lastUsed: string;
    statusActive: string;
    statusRevoked: string;
    revoke: string;
    copyMasked: string;
  };
  onRevoke: () => void;
}) {
  const isActive = item.status === "active";

  return (
    <div className="rounded-[16px] border border-border bg-card p-5 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{item.name}</span>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                isActive
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-muted-foreground"}`} />
              {isActive ? tr.statusActive : tr.statusRevoked}
            </span>
          </div>
          <code className="mt-1.5 block font-mono text-xs text-muted-foreground">
            {item.keyPrefix}••••••••••••{item.keyLast4}
          </code>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {item.revokedAt
              ? `${tr.statusRevoked}`
              : `${tr.lastUsed}: ${item.lastUsedAt ? new Date(item.lastUsedAt).toLocaleString() : tr.neverUsed}`}
          </p>
        </div>

        {isActive && (
          <Button variant="outline" size="sm" className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onRevoke}>
            {tr.revoke}
          </Button>
        )}
      </div>
    </div>
  );
}
