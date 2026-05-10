import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { Toaster } from "sonner";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
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
    <html lang="zh-CN" className={cn(geist.variable)}>
      <body className="font-sans antialiased bg-base text-foreground">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
