"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { ProfileTab } from "@/components/settings/profile-tab";
import { ApiKeyTab } from "@/components/settings/api-key-tab";
import { StorageTab } from "@/components/settings/storage-tab";
import { DatabaseTab } from "@/components/settings/database-tab";
import { RagTab } from "@/components/settings/rag-tab";
import { useLocale } from "@/lib/i18n";

type Tab = "profile" | "auth" | "apiKeys" | "storage" | "database" | "rag";

export default function SettingsPage() {
  const { t } = useLocale();
  const [tab, setTab] = useState<Tab>("profile");

  // 允许通过 URL hash(#apiKeys)从外部(如用户菜单快捷入口)直接跳到指定 tab。
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#apiKeys") {
      setTab("apiKeys");
    }
  }, []);

  const tabs: { id: Tab; label: string }[] = [
    { id: "profile", label: t.settings.profile.title },
    { id: "auth", label: t.settings.profile.passwordSettings },
    { id: "apiKeys", label: t.settings.apiKeys.title },
    { id: "storage", label: t.settings.storage.title },
    { id: "database", label: t.settings.database.title },
    { id: "rag", label: t.settings.rag.title },
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
        {tab === "apiKeys" && <ApiKeyTab />}
        {tab === "storage" && <StorageTab />}
        {tab === "database" && <DatabaseTab />}
        {tab === "rag" && <RagTab />}
      </div>
    </div>
  );
}
