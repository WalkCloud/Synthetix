import type { Metadata } from "next";
import { Plus_Jakarta_Sans, Inter } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "sonner";
import "./globals.css";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Synthetix - AI-Powered Document Authoring",
  description:
    "Write, organize, and publish professional documents with intelligent assistance.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="zh-CN" className={cn(plusJakartaSans.variable, inter.variable)} suppressHydrationWarning>
      <body className="font-sans antialiased bg-base text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
