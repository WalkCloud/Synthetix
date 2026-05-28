"use client";

import { ThemeProvider } from "next-themes";
import { LocaleProvider } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <LocaleProvider>
        {children}
        <Toaster />
      </LocaleProvider>
    </ThemeProvider>
  );
}
