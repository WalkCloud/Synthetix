"use client";

import { useState, useEffect } from "react";
import { CardSelector } from "@/components/shared/card-selector";

type StorageMode = "local" | "s3";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) { val /= 1024; idx++; }
  return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[idx]}`;
}

interface UsageStats {
  documentsBytes: number;
  assetsBytes: number;
  indexBytes: number;
  otherBytes: number;
  totalDataBytes: number;
  diskFreeBytes: number;
  diskTotalBytes: number;
}

function Row({ label, bytes, color, hint }: { label: string; bytes: number; color: string; hint: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-sm ${color} inline-block shrink-0`} />
        <span className="text-[13px] text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground hidden sm:inline">({hint})</span>
      </div>
      <span className="text-[13px] text-muted-foreground tabular-nums">{formatBytes(bytes)}</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <div className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/15 shrink-0 animate-pulse" />
        <div className="h-3 w-24 bg-muted-foreground/15 rounded animate-pulse" />
      </div>
      <div className="h-3 w-14 bg-muted-foreground/15 rounded animate-pulse" />
    </div>
  );
}

export function StorageTab() {
  const [storageMode, setStorageMode] = useState<StorageMode>("local");
  const [storageLocalPath, setStorageLocalPath] = useState("./data/documents");
  const [storageCachePath, setStorageCachePath] = useState("./data/cache");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("us-east-1");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [savingStorage, setSavingStorage] = useState(false);
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [storageMsg, setStorageMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [usage, setUsage] = useState<UsageStats | null>(null);

  useEffect(() => {
    fetch("/api/v1/settings/storage")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          const s = data.data;
          setStorageMode(s.storageType === "s3" ? "s3" : "local");
          setStorageLocalPath(s.localPath || "./data/documents");
          setStorageCachePath(s.cachePath || "./data/cache");
          setS3Endpoint(s.s3Endpoint || "");
          setS3Region(s.s3Region || "us-east-1");
          setS3Bucket(s.s3Bucket || "");
          setS3AccessKey(s.s3AccessKey || "");
          setS3SecretKey(s.s3SecretKey || "");
          setStorageConfigured(s.storageType !== "s3" || !!s.s3Bucket);
          if (s.usage) setUsage(s.usage);
        }
      })
      .catch(() => {});
  }, []);

  async function saveStorage() {
    setSavingStorage(true);
    setStorageMsg(null);
    try {
      const body: Record<string, unknown> = {
        storageType: storageMode,
        localPath: storageLocalPath || undefined,
        cachePath: storageCachePath || undefined,
      };
      if (storageMode === "s3") {
        body.s3Endpoint = s3Endpoint || undefined;
        body.s3Region = s3Region || undefined;
        body.s3Bucket = s3Bucket || undefined;
        body.s3AccessKey = s3AccessKey || undefined;
        body.s3SecretKey = s3SecretKey || undefined;
      }
      const res = await fetch("/api/v1/settings/storage", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      setStorageMsg(d.success ? { type: "success", text: "Storage settings saved" } : { type: "error", text: d.error });
    } catch {
      setStorageMsg({ type: "error", text: "Failed to save" });
    } finally {
      setSavingStorage(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            <h3 className="text-base font-semibold text-foreground">Document Storage Mode</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${storageConfigured ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/35 dark:text-amber-300"}`}>
            <span className={`w-2 h-2 rounded-full ${storageConfigured ? "bg-emerald-500" : "bg-amber-500"}`} />
            {storageConfigured ? (storageMode === "s3" ? "S3 Object Storage" : "Local Storage") : "Not Configured"}
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <CardSelector
              selected={storageMode === "local"}
              onSelect={() => { setStorageMode("local"); setStorageConfigured(true); }}
              icon={<div className="w-10 h-10 rounded-lg bg-primary-100 dark:bg-primary/12 text-primary flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg></div>}
              title="Local Storage"
              description="Store documents on your local file system. Best for offline deployment."
            />
            <CardSelector
              selected={storageMode === "s3"}
              onSelect={() => { setStorageMode("s3"); setStorageConfigured(!!s3Bucket); }}
              icon={<div className="w-10 h-10 rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950/35 dark:text-blue-300 flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg></div>}
              title="S3 Object Storage"
              description="S3-compatible storage (AWS S3, MinIO). Best for cloud deployment."
            />
          </div>
        </div>
      </div>

      {storageMode === "local" && (
        <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              <h3 className="text-base font-semibold text-foreground">Local Storage Configuration</h3>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Document Root Directory</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={storageLocalPath} onChange={(e) => setStorageLocalPath(e.target.value)} />
              <span className="text-xs text-muted-foreground mt-1 block">All converted Markdown documents and assets will be stored here.</span>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Cache Directory</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={storageCachePath} onChange={(e) => setStorageCachePath(e.target.value)} />
              <span className="text-xs text-muted-foreground mt-1 block">Temporary files and processing cache. Can be safely deleted.</span>
            </div>
            <div className="mt-5 p-4 bg-muted rounded-[16px]">
              <div className="flex justify-between items-start mb-3">
                <span className="text-sm font-semibold text-foreground">Storage Usage</span>
                {usage && (
                  <span className="text-sm font-semibold text-foreground">{formatBytes(usage.totalDataBytes)}</span>
                )}
              </div>

              {usage ? (
                <div className="space-y-1.5">
                  <Row label="Documents" bytes={usage.documentsBytes} color="bg-primary" hint="original & markdown" />
                  <Row label="Assets" bytes={usage.assetsBytes} color="bg-blue-500" hint="images, diagrams, SVG" />
                  <Row label="Index" bytes={usage.indexBytes} color="bg-amber-500" hint="vector embeddings" />
                  <Row label="Other" bytes={usage.otherBytes} color="bg-muted-foreground/40" hint="tmp, settings" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </div>
              )}

              {usage && usage.diskTotalBytes > 0 && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                  <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
                  <span className="text-[12px] text-muted-foreground">
                    Disk free <span className="text-foreground font-medium">{formatBytes(usage.diskFreeBytes)}</span> / {formatBytes(usage.diskTotalBytes)}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              {storageMsg && (
                <div className={`text-sm px-3 py-2 rounded-lg ${storageMsg.type === "success" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300" : "bg-red-100 text-red-700 dark:bg-red-950/35 dark:text-red-300"}`}>
                  {storageMsg.text}
                </div>
              )}
              <button type="button" onClick={saveStorage} disabled={savingStorage} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm disabled:opacity-50">
                {savingStorage ? "Saving..." : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    Save Storage Settings
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {storageMode === "s3" && (
        <div className="bg-card border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
              <h3 className="text-base font-semibold text-foreground">S3 Object Storage Configuration</h3>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">S3 Endpoint</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="https://s3.amazonaws.com" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} />
                <span className="text-xs text-muted-foreground mt-1 block">Leave empty for AWS S3 default.</span>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Region</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={s3Region} onChange={(e) => setS3Region(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Bucket Name</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="synthetix-documents" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Access Key ID</label>
                <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="AKIAIOSFODNN7EXAMPLE" value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Secret Access Key</label>
                <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter secret access key" value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Path Prefix (Optional)</label>
              <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" defaultValue="documents/" />
              <span className="text-xs text-muted-foreground mt-1 block">Subdirectory path within the bucket.</span>
            </div>
            <div className="flex gap-3 mt-5">
              <button type="button" onClick={saveStorage} disabled={savingStorage} className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm disabled:opacity-50">
                {savingStorage ? "Saving..." : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    Save S3 Settings
                  </>
                )}
              </button>
              <button type="button" className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/70 rounded-lg transition-colors" onClick={() => setStorageMode("local")}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
