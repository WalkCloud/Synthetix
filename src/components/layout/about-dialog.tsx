"use client";

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import Image from "next/image";
import { useLocale } from "@/lib/i18n";
import { appVersion } from "@/lib/app-metadata";
import { isUpdateSupported } from "@/lib/update-bridge";
import { UpdatePanel } from "@/components/layout/update-panel";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const { t } = useLocale();
  const router = useRouter();
  const supported = isUpdateSupported();

  function gotoNotices() {
    onOpenChange(false);
    router.push("/legal/third-party-notices");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader className="items-center text-center">
          <Image
            src="/logo.png"
            alt="Synthetix"
            width={56}
            height={56}
            className="shrink-0"
          />
          <DialogTitle className="text-xl">Synthetix</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t.layout.about.subtitle}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-center text-sm">
          {/* Version — single line, no card */}
          <p className="font-mono text-xs text-muted-foreground">
            {t.layout.about.version} {appVersion.version}
          </p>

          {/* Auto-update panel — only in the Electron desktop app. Hidden in a
              plain browser / self-hosted web (no window.synthetix.update). */}
          {supported && open ? <UpdatePanel /> : null}

          {/* Legal entry — minimal, two quiet actions */}
          <div className="space-y-3 border-t pt-4">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t.layout.about.licenseStatement}
            </p>
            <div className="flex items-center justify-center gap-4">
              <a
                href="/legal/LICENSE.txt"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t.layout.about.actions.viewLicense}
              </a>
              <button
                type="button"
                onClick={gotoNotices}
                className="cursor-pointer text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t.layout.about.actions.thirdPartyNotices}
              </button>
            </div>
          </div>

          {/* Copyright */}
          <p className="text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} Synthetix
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
