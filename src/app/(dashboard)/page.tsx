"use client";

import { Header } from "@/components/layout/header";
import Link from "next/link";

interface HeroStat {
  value: string;
  label: string;
}

interface QuickAction {
  href: string;
  label: string;
  desc: string;
  iconBg: string;
  iconColor: string;
  iconPath: string;
  polyline?: string;
  lines?: { x1: string; y1: string; x2: string; y2: string }[];
}

interface Document {
  name: string;
  category: string;
  time: string;
  iconBg: string;
  iconColor: string;
  tagBg: string;
  tagColor: string;
  tagLabel: string;
}

interface Task {
  name: string;
  desc: string;
  time: string;
  status: "active" | "done" | "fail";
  progress?: number;
  retryLink?: boolean;
}

const heroStats: HeroStat[] = [
  { value: "156", label: "Documents" },
  { value: "12", label: "Drafts" },
  { value: "89", label: "References" },
  { value: "245K", label: "Tokens" },
];

const quickActions: QuickAction[] = [
  {
    href: "/documents",
    label: "Upload Docs",
    desc: "Import & convert files",
    iconBg: "bg-primary-100",
    iconColor: "text-primary",
    iconPath: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",
    polyline: "17 8 12 3 7 8",
    lines: [{ x1: "12", y1: "3", x2: "12", y2: "15" }],
  },
  {
    href: "/brainstorm",
    label: "Brainstorm",
    desc: "Organize ideas with AI",
    iconBg: "bg-[#EFF6FF]",
    iconColor: "text-[#2563EB]",
    iconPath: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z",
  },
  {
    href: "/writing",
    label: "New Draft",
    desc: "Start writing a document",
    iconBg: "bg-[#DCFCE7]",
    iconColor: "text-[#16A34A]",
    iconPath: "",
    lines: [
      { x1: "12", y1: "5", x2: "12", y2: "19" },
      { x1: "5", y1: "12", x2: "19", y2: "12" },
    ],
  },
  {
    href: "/documents",
    label: "Browse Library",
    desc: "Search your knowledge",
    iconBg: "bg-[#FFF7ED]",
    iconColor: "text-[#EA580C]",
    iconPath: "",
    lines: [],
  },
];

const documents: Document[] = [
  {
    name: "Quarterly Business Review",
    category: "Report",
    time: "2 hours ago",
    iconBg: "bg-[#FEE2E2]",
    iconColor: "text-[#DC2626]",
    tagBg: "bg-[#DCFCE7]",
    tagColor: "text-[#16A34A]",
    tagLabel: "Completed",
  },
  {
    name: "API Design Specification",
    category: "Technical",
    time: "5 hours ago",
    iconBg: "bg-[#EFF6FF]",
    iconColor: "text-[#2563EB]",
    tagBg: "bg-[#EFF6FF]",
    tagColor: "text-[#2563EB]",
    tagLabel: "Writing",
  },
  {
    name: "User Research Findings",
    category: "Research",
    time: "Yesterday",
    iconBg: "bg-[#DCFCE7]",
    iconColor: "text-[#16A34A]",
    tagBg: "bg-[#DCFCE7]",
    tagColor: "text-[#16A34A]",
    tagLabel: "Completed",
  },
  {
    name: "Marketing Strategy 2026",
    category: "Strategy",
    time: "2 days ago",
    iconBg: "bg-base-gray",
    iconColor: "text-muted-foreground",
    tagBg: "bg-[#EEEEE9]",
    tagColor: "text-[#52525B]",
    tagLabel: "Draft",
  },
  {
    name: "System Architecture Overview",
    category: "Technical",
    time: "3 days ago",
    iconBg: "bg-[#EFF6FF]",
    iconColor: "text-[#2563EB]",
    tagBg: "bg-[#EFF6FF]",
    tagColor: "text-[#2563EB]",
    tagLabel: "Writing",
  },
];

const tasks: Task[] = [
  {
    name: "Converting security-audit.pdf",
    desc: "MarkItDown → Markdown",
    time: "2m ago",
    status: "active",
    progress: 65,
  },
  {
    name: "Generating Chapter 3",
    desc: "API Design Specification",
    time: "5m ago",
    status: "active",
    progress: 30,
  },
  {
    name: "Indexed research-findings.pdf",
    desc: "LightRAG vectorization complete",
    time: "12m ago",
    status: "done",
  },
  {
    name: "Chapter 5 generation failed",
    desc: "Token limit exceeded · Retry",
    time: "18m ago",
    status: "fail",
    retryLink: true,
  },
];

function DocIcon({ colorClass }: { colorClass: string }) {
  return (
    <svg
      className={`w-[18px] h-[18px] ${colorClass}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function QuickActionIcon({ action }: { action: QuickAction }) {
  return (
    <svg
      className="w-[22px] h-[22px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      {action.iconPath && <path d={action.iconPath} />}
      {action.polyline && <polyline points={action.polyline} />}
      {action.lines?.map((line, i) => (
        <line key={i} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
      ))}
      {/* Browse Library specific: circle + line for search icon */}
      {action.label === "Browse Library" && (
        <>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </>
      )}
    </svg>
  );
}

export default function DashboardPage() {
  return (
    <div>
      <Header title="Dashboard" />

      <div className="p-8">
        {/* Welcome Hero */}
        <div
          className="mb-6 flex items-center justify-between rounded-[22px] border border-[#E4E4E7] p-8 px-9 animate-fade-in-up"
          style={{
            background:
              "linear-gradient(135deg, #EEF0FD 0%, #F5F6FE 30%, #F7F6F3 60%, #FFFFFF 100%)",
          }}
        >
          <div>
            <h3 className="font-display text-[24px] font-bold text-foreground mb-1">
              Good morning, Kevin 👋
            </h3>
            <p className="text-[14px] text-muted-foreground mb-4">
              You have 2 drafts in progress and 1 document converting.
              Here&apos;s your workspace overview.
            </p>
            <Link
              href="/documents"
              className="inline-block px-5 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary-light transition-colors cursor-pointer"
            >
              Upload New Document
            </Link>
          </div>

          <div className="flex gap-6">
            {heroStats.map((stat) => (
              <div
                key={stat.label}
                className="text-center bg-white/80 backdrop-blur-xl border border-primary/[0.08] rounded-[16px] p-4 px-6 min-w-[90px]"
              >
                <div className="font-display text-[24px] font-bold text-primary tracking-[-0.02em]">
                  {stat.value}
                </div>
                <div className="text-[11px] text-muted-foreground uppercase tracking-[0.5px] mt-0.5">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions Row */}
        <div className="grid grid-cols-4 gap-[14px] mb-6">
          {quickActions.map((action, i) => (
            <Link
              key={action.label}
              href={action.href}
              className={`flex items-center gap-[14px] p-[18px_20px] bg-base-white border border-[#F0F0F0] rounded-[16px] hover:border-primary/25 hover:shadow-md hover:-translate-y-[2px] transition-all duration-200 no-underline animate-fade-in-up-${i + 2}`}
            >
              <div
                className={`w-11 h-11 rounded-[16px] flex items-center justify-center flex-shrink-0 ${action.iconBg} ${action.iconColor}`}
              >
                <QuickActionIcon action={action} />
              </div>
              <div>
                <h4 className="text-[14px] font-semibold text-foreground mb-0.5">
                  {action.label}
                </h4>
                <span className="text-[12px] text-muted-foreground">
                  {action.desc}
                </span>
              </div>
            </Link>
          ))}
        </div>

        {/* Two-Column: Recent Docs + Active Tasks */}
        <div className="grid grid-cols-[1fr_340px] gap-5 animate-fade-in-up-6">
          {/* Recent Documents */}
          <div>
            <div className="flex items-center justify-between mb-[14px]">
              <h3 className="font-display text-[16px] font-semibold text-foreground tracking-[-0.02em]">
                Recent Documents
              </h3>
              <Link
                href="/documents"
                className="text-[13px] text-primary font-medium no-underline"
              >
                View all →
              </Link>
            </div>
            <div className="bg-base-white border border-[#F0F0F0] rounded-[16px] overflow-hidden">
              {documents.map((doc, i) => (
                <div
                  key={doc.name}
                  className={`flex items-center gap-3 px-4 py-3 hover:bg-base-gray transition-colors duration-150 ${
                    i < documents.length - 1
                      ? "border-b border-[#F0F0F0]"
                      : ""
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0 ${doc.iconBg} ${doc.iconColor}`}
                  >
                    <DocIcon colorClass="" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-semibold text-foreground truncate">
                      {doc.name}
                    </div>
                    <div className="flex gap-2 text-[12px] text-muted-foreground mt-0.5">
                      <span>{doc.category}</span>
                      <span>·</span>
                      <span>{doc.time}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[12px] font-medium px-2.5 py-1 rounded-full ${doc.tagBg} ${doc.tagColor}`}
                  >
                    {doc.tagLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Tasks */}
          <div>
            <div className="flex items-center justify-between mb-[14px]">
              <h3 className="font-display text-[16px] font-semibold text-foreground tracking-[-0.02em]">
                Active Tasks
              </h3>
              <span className="text-[12px] text-muted-foreground">
                3 tasks
              </span>
            </div>
            <div className="bg-base-white border border-[#F0F0F0] rounded-[16px] overflow-hidden">
              {tasks.map((task, i) => (
                <div
                  key={task.name}
                  className={`flex items-center gap-3 p-[14px_16px] ${
                    i < tasks.length - 1
                      ? "border-b border-[#F0F0F0]"
                      : ""
                  }`}
                >
                  <div
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      task.status === "active"
                        ? "bg-primary animate-task-pulse"
                        : task.status === "done"
                        ? "bg-[#16A34A]"
                        : "bg-[#DC2626]"
                    }`}
                  />
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-foreground">
                      {task.name}
                    </div>
                    <div className="text-[12px] text-muted-foreground mt-px">
                      {task.retryLink ? (
                        <>
                          Token limit exceeded ·{" "}
                          <Link
                            href="#"
                            className="text-primary font-medium no-underline"
                          >
                            Retry
                          </Link>
                        </>
                      ) : (
                        task.desc
                      )}
                    </div>
                    {task.progress != null && (
                      <div className="w-full h-1 bg-base-gray rounded mt-1.5 overflow-hidden">
                        <div
                          className="h-full bg-primary rounded transition-[width] duration-300"
                          style={{ width: `${task.progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground flex-shrink-0">
                    {task.time}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
