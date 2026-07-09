import type { Metadata } from "next";
import { ThirdPartyNoticesView } from "@/components/layout/third-party-notices-view";

export const metadata: Metadata = {
  title: "Third-party Notices — Synthetix",
  description:
    "Open-source licenses and attribution for third-party software included in Synthetix.",
};

export default function ThirdPartyNoticesPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <ThirdPartyNoticesView />
    </main>
  );
}
