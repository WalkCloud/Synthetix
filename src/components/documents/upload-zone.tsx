"use client";

import { useRef } from "react";
import { useLocale } from "@/lib/i18n";
import { SUPPORTED_FORMATS } from "@/types/documents";

// Derive the <input accept> string from the single source of truth so the
// file picker and server-side validation never drift apart.
const ACCEPT_ATTR = SUPPORTED_FORMATS.map((f) => `.${f}`).join(",");

interface UploadZoneProps {
  onFiles: (files: FileList | File[]) => void;
}

export function UploadZone({ onFiles }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const { t } = useLocale();

  return (
    <div
      className="mb-6 border-2 border-dashed border-border rounded-[16px] p-12 text-center transition-all hover:border-primary hover:bg-primary/5 dark:hover:bg-primary/10 animate-fade-in-up"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
    >
      <input ref={inputRef} type="file" className="hidden" accept={ACCEPT_ATTR} multiple
        onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <input ref={folderInputRef} type="file" className="hidden" {...({ webkitdirectory: "", directory: "", multiple: true } as any)}
        onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 text-primary-light mb-3 mx-auto opacity-60">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <h3 className="text-[16px] font-semibold text-foreground mb-1">{t.documents.upload.dragAndDrop}</h3>
      <p className="text-[14px] text-muted-foreground mb-5">{t.documents.upload.supportedFormats}</p>
      <div className="flex items-center justify-center gap-3">
        <button type="button"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium bg-primary/8 text-primary hover:bg-primary/15 dark:bg-primary/12 dark:hover:bg-primary/20 transition-colors"
          onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
          {t.documents.upload.uploadFiles}
        </button>
        <button type="button"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-medium bg-primary/8 text-primary hover:bg-primary/15 dark:bg-primary/12 dark:hover:bg-primary/20 transition-colors"
          onClick={(e) => { e.stopPropagation(); folderInputRef.current?.click(); }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          {t.documents.upload.uploadFolder}
        </button>
      </div>
    </div>
  );
}
