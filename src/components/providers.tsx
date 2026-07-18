"use client";

import { ThemeProvider } from "next-themes";
import { LocaleProvider, type Locale } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";
import { TitlebarSync } from "@/components/electron/titlebar-sync";
import { UpdateStatusProvider } from "@/lib/update-status-context";

export function Providers({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <TitlebarSync />
      <LocaleProvider initialLocale={initialLocale}>
        {/* UpdateStatusProvider subscribes to the Electron update bridge once
            at the root, so the sidebar badge and the About dialog share a
            single source of truth and a single IPC subscription. Inside
            LocaleProvider because it needs `t` for the toast strings. */}
        <UpdateStatusProvider>
          {children}
          <Toaster />
        </UpdateStatusProvider>
      </LocaleProvider>
    </ThemeProvider>
  );
}
