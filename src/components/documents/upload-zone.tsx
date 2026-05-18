"use client";

import { useRef } from "react";

interface UploadZoneProps {
  onFiles: (files: FileList | File[]) => void;
}

export function UploadZone({ onFiles }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      className="mb-6 border-2 border-dashed border-[#E8E6E1] rounded-[16px] p-12 text-center cursor-pointer transition-all hover:border-primary hover:bg-primary-50 animate-fade-in-up"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.html,.epub,.txt,.md" multiple
        onChange={(e) => e.target.files && onFiles(e.target.files)} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-12 h-12 text-primary-light mb-3 mx-auto opacity-60">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      <h3 className="text-[16px] font-semibold text-foreground mb-1">Drag & Drop files here or click to browse</h3>
      <p className="text-[14px] text-muted-foreground">Supports PDF, DOCX, PPTX, XLSX, HTML, EPUB</p>
    </div>
  );
}
