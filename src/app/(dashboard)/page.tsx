import { Header } from "@/components/layout/header";
import { StatsCard } from "@/components/shared/stats-card";
import Link from "next/link";

export default function DashboardPage() {
  const stats = [
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /></svg>, iconClass: "bg-primary/10 text-primary", label: "文档总数", value: 0 },
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /></svg>, iconClass: "bg-green-100 text-green-600", label: "草稿数量", value: 0 },
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /></svg>, iconClass: "bg-orange-100 text-orange-600", label: "引用数量", value: 0 },
    { icon: <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4" /></svg>, iconClass: "bg-blue-100 text-blue-600", label: "Token 消耗", value: "0" },
  ];

  const quickActions = [
    { href: "/documents", label: "上传文档", desc: "上传参考资料并转换", icon: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" },
    { href: "/brainstorm", label: "开始头脑风暴", desc: "AI 辅助理清思路", icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { href: "/writing", label: "创建草稿", desc: "开始编写文档", icon: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" },
    { href: "/documents", label: "浏览文档库", desc: "搜索和管理文档", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
  ];

  return (
    <div>
      <Header title="仪表盘" />
      <div className="p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {stats.map((s) => (
            <StatsCard key={s.label} {...s} />
          ))}
        </div>

        <h2 className="text-lg font-semibold font-display mb-4">快捷操作</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {quickActions.map((a) => (
            <Link key={a.href} href={a.href} className="bg-white border rounded-2xl p-5 hover:border-primary/30 hover:shadow-md transition-all group">
              <div className="w-10 h-10 rounded-xl bg-primary/5 text-primary flex items-center justify-center mb-3 group-hover:bg-primary/10 transition-colors">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d={a.icon} /></svg>
              </div>
              <h3 className="font-semibold text-sm mb-1">{a.label}</h3>
              <p className="text-xs text-muted-foreground">{a.desc}</p>
            </Link>
          ))}
        </div>

        <h2 className="text-lg font-semibold font-display mb-4">最近文档</h2>
        <div className="bg-white border rounded-2xl p-12 flex flex-col items-center justify-center text-center">
          <svg className="w-16 h-16 text-muted-foreground/40 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /></svg>
          <h3 className="font-semibold text-lg mb-2">暂无文档</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-[400px]">上传参考资料，开始您的第一个文档创作</p>
          <Link href="/documents" className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all text-sm">上传文档</Link>
        </div>
      </div>
    </div>
  );
}
