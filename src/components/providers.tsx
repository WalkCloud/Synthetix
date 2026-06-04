"use client";

import { ThemeProvider } from "next-themes";
import { LocaleProvider, type Locale } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";

export function Providers({
  children,
  initialLocale,
}: {
  children: React.ReactNode;
  initialLocale: Locale;
}) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <LocaleProvider initialLocale={initialLocale}>
        {children}
        <Toaster />
      </LocaleProvider>
    </ThemeProvider>
  );
}
