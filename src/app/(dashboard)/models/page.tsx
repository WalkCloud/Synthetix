import { Header } from "@/components/layout/header";
import { ModelsTabs } from "@/components/models/models-tabs";

export default function ModelsPage() {
  return (
    <div>
      <Header title="模型管理" />
      <div className="p-8">
        <ModelsTabs />
      </div>
    </div>
  );
}
