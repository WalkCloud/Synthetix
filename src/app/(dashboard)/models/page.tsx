"use client";

import { Header } from "@/components/layout/header";
import { ModelsTabs } from "@/components/models/models-tabs";
import { useLocale } from "@/lib/i18n";

export default function ModelsPage() {
  const { t } = useLocale();

  return (
    <div>
      <Header title={t.models.title} />
      <div className="p-8">
        <ModelsTabs />
      </div>
    </div>
  );
}
