"use client";

import { useState, useRef, useCallback } from "react";

interface UploadZoneProps {
  onUpload: (files: FileList | File[]) => void;
  disabled?: boolean;
}

export function UploadZone({ onUpload, disabled }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (!disabled && e.dataTransfer.files.length > 0) {
        onUpload(e.dataTransfer.files);
      }
    },
    [disabled, onUpload]
  );

  return (
    <div
      className={`relative border-2 border-dashed rounded-[20px] p-12 text-center transition-all cursor-pointer
        ${dragging ? "border-primary bg-primary-50/50 scale-[1.01]" : "border-[#E4E4E7] hover:border-primary/30 hover:bg-[#EEEEE9]/50"}
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.docx,.pptx,.xlsx,.html,.epub,.txt,.md"
        multiple
        onChange={(e) => e.target.files && onUpload(e.target.files)}
      />
      <div className="w-16 h-16 mx-auto mb-4 rounded-[20px] bg-primary-100 text-primary flex items-center justify-center">
        <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
      <h3 className="text-lg font-semibold mb-1">Drop files here or click to browse</h3>
      <p className="text-sm text-muted-foreground">
        PDF, Word, PowerPoint, Excel, HTML, EPUB, TXT, MD — up to 100MB
      </p>
    </div>
  );
}
