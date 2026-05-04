import { Header } from "@/components/layout/header";
import { ModelsTabs } from "@/components/models/models-tabs";

export default function ModelsPage() {
  return (
    <div>
      <Header title="Model Management" />
      <div className="p-8">
        <ModelsTabs />
      </div>
    </div>
  );
}
