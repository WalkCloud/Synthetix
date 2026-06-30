"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Image from "next/image";
import { useLocale } from "@/lib/i18n";

const APP_VERSION = "0.5.3.0";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useLocale();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Synthetix"
              width={36}
              height={36}
              className="shrink-0"
            />
            <div>
              <DialogTitle className="text-lg">{t.layout.about.title}</DialogTitle>
              <DialogDescription className="text-xs">
                {t.layout.about.subtitle}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-muted-foreground">{t.layout.about.version}</span>
            <span className="font-mono font-medium">{APP_VERSION}</span>
          </div>

          <div className="text-muted-foreground text-xs leading-relaxed">
            <p>{t.layout.about.techStack}</p>
          </div>

          <div className="border-t pt-3 text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Synthetix. {t.layout.about.copyright}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
