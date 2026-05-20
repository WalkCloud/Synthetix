"use client";

import { useState, useEffect } from "react";
import { CardSelector } from "@/components/shared/card-selector";

type StorageMode = "local" | "s3";

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
      <div className="bg-white border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
          <div className="flex items-center gap-2.5">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
            <h3 className="text-base font-semibold">Document Storage Mode</h3>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${storageConfigured ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#FEF3C7] text-[#D97706]"}`}>
            <span className={`w-2 h-2 rounded-full ${storageConfigured ? "bg-[#16A34A]" : "bg-[#D97706]"}`} />
            {storageConfigured ? (storageMode === "s3" ? "S3 Object Storage" : "Local Storage") : "Not Configured"}
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-2 gap-4">
            <CardSelector
              selected={storageMode === "local"}
              onSelect={() => { setStorageMode("local"); setStorageConfigured(true); }}
              icon={<div className="w-10 h-10 rounded-lg bg-primary-100 text-primary flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg></div>}
              title="Local Storage"
              description="Store documents on your local file system. Best for offline deployment."
            />
            <CardSelector
              selected={storageMode === "s3"}
              onSelect={() => { setStorageMode("s3"); setStorageConfigured(!!s3Bucket); }}
              icon={<div className="w-10 h-10 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg></div>}
              title="S3 Object Storage"
              description="S3-compatible storage (AWS S3, MinIO). Best for cloud deployment."
            />
          </div>
        </div>
      </div>

      {storageMode === "local" && (
        <div className="bg-white border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
              <h3 className="text-base font-semibold">Local Storage Configuration</h3>
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
            <div className="mt-5 p-4 bg-[#F4F2EF] rounded-[16px]">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold">Storage Usage</span>
                <span className="text-[13px] text-muted-foreground">2.4 GB / 50 GB</span>
              </div>
              <div className="w-full h-2.5 bg-[#F4F2EF] rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: "4.8%" }} />
              </div>
              <div className="flex gap-5 mt-3 text-[13px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" /> Documents: 1.8 GB</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary-light inline-block" /> Cache: 0.6 GB</span>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              {storageMsg && (
                <div className={`text-sm px-3 py-2 rounded-lg ${storageMsg.type === "success" ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#FEE2E2] text-[#DC2626]"}`}>
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
        <div className="bg-white border rounded-[16px]">
          <div className="flex items-center justify-between px-6 py-5 border-b">
            <div className="flex items-center gap-2.5">
              <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
              <h3 className="text-base font-semibold">S3 Object Storage Configuration</h3>
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
              <button type="button" className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-50 rounded-lg transition-colors" onClick={() => setStorageMode("local")}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
