"use client";

import { useState } from "react";
import { Header } from "@/components/layout/header";
import { ProfileTab } from "@/components/settings/profile-tab";
import { StorageTab } from "@/components/settings/storage-tab";
import { DatabaseTab } from "@/components/settings/database-tab";
import { RagTab } from "@/components/settings/rag-tab";
import { useLocale } from "@/lib/i18n";

type Tab = "profile" | "auth" | "storage" | "database" | "rag";

export default function SettingsPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("profile");

  const tabs: { id: Tab; label: string }[] = [
    { id: "profile", label: t.settings.profile.title },
    { id: "auth", label: t.settings.profile.passwordSettings },
    { id: "storage", label: t.settings.storage.title },
    { id: "database", label: t.settings.database.title },
    { id: "rag", label: "RAG" },
  ];

  return (
    <div>
      <Header title={t.layout.sidebar.userManagement} />
      <div className="p-8">
        <div className="flex gap-0 border-b border-border mb-6">
          {tabs.map((tabItem) => (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === tabItem.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {tabItem.label}
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
