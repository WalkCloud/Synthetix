"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { ProfileTab } from "@/components/settings/profile-tab";
import { StorageTab } from "@/components/settings/storage-tab";
import { DatabaseTab } from "@/components/settings/database-tab";
import { RagTab } from "@/components/settings/rag-tab";

type Tab = "profile" | "auth" | "storage" | "database" | "rag";

const tabs: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "auth", label: "Password Settings" },
  { id: "storage", label: "Storage Settings" },
  { id: "database", label: "Database" },
  { id: "rag", label: "Vector Database" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div>
      <Header title="User Management" />
      <div className="p-8">
        <div className="flex gap-0 border-b border-border mb-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {(tab === "profile" || tab === "auth") && <ProfileTab tab={tab} setTab={setTab} />}
        {tab === "storage" && <StorageTab />}
        {tab === "database" && <DatabaseTab />}
        {tab === "rag" && <RagTab />}
      </div>
    </div>
  );
}
