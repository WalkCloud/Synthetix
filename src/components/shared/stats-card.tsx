interface StatsCardProps {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string | number;
  change?: string;
  changeType?: "up" | "down";
}

export function StatsCard({ icon, iconClass, label, value, change, changeType }: StatsCardProps) {
  return (
    <div className="bg-white border rounded-2xl p-6 flex items-start gap-4 hover:border-gray-300 hover:shadow-md transition-all">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${iconClass}`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-[13px] text-muted-foreground mb-1">{label}</div>
        <div className="font-display text-[28px] font-bold leading-tight">{value}</div>
        {change && (
          <div className={`text-xs font-medium mt-1 ${changeType === "up" ? "text-green-600" : "text-red-600"}`}>
            {change}
          </div>
        )}
      </div>
    </div>
  );
}
