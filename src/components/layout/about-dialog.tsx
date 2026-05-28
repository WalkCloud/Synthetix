"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

const APP_VERSION = "0.5.3.0";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <svg
              className="w-9 h-9 text-primary shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            <div>
              <DialogTitle className="text-lg">Synthetix</DialogTitle>
              <DialogDescription className="text-xs">
                AI-Powered Document Authoring
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono font-medium">{APP_VERSION}</span>
          </div>

          <div className="text-muted-foreground text-xs leading-relaxed">
            <p>Built with Next.js, TypeScript, Prisma & SQLite.</p>
          </div>

          <div className="border-t pt-3 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Synthetix. All rights reserved.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
