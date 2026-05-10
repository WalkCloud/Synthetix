"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface DraftSummary {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  progress?: { completed: number; total: number };
}

interface DocumentSummary {
  id: string;
  originalName: string;
  status: string;
  createdAt: string;
}

interface TaskItem {
  id: string;
  type: string;
  status: string;
  progress: number;
  createdAt: string;
  error: string | null;
}

interface DashboardStats {
  docCount: number;
  draftCount: number;
  totalTokens: number;
  activeTasks: number;
}

const statusLabels: Record<string, string> = {
  drafting: "In Progress",
  assembling: "Assembling",
  completed: "Completed",
};

const statusColors: Record<string, string> = {
  drafting: "bg-[#FFF7ED] text-[#D97706]",
  assembling: "bg-[#EFF6FF] text-[#2563EB]",
  completed: "bg-[#DCFCE7] text-[#16A34A]",
};

const docStatusColors: Record<string, { bg: string; text: string; label: string }> = {
  uploaded: { bg: "bg-[#FFF7ED]", text: "text-[#EA580C]", label: "Uploaded" },
  converting: { bg: "bg-[#EFF6FF]", text: "text-[#2563EB]", label: "Converting" },
  converted: { bg: "bg-[#DCFCE7]", text: "text-[#16A34A]", label: "Converted" },
  indexed: { bg: "bg-[#DCFCE7]", text: "text-[#16A34A]", label: "Indexed" },
  failed: { bg: "bg-[#FEE2E2]", text: "text-[#DC2626]", label: "Failed" },
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats>({
    docCount: 0,
    draftCount: 0,
    totalTokens: 0,
    activeTasks: 0,
  });
  const [recentDrafts, setRecentDrafts] = useState<DraftSummary[]>([]);
  const [recentDocs, setRecentDocs] = useState<DocumentSummary[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [draftsRes, docsRes, usageRes] = await Promise.all([
          fetch("/api/v1/drafts?limit=5"),
          fetch("/api/v1/documents?limit=5"),
          fetch("/api/v1/models/usage?days=30"),
        ]);

        const draftsData = await draftsRes.json();
        const docsData = await docsRes.json();
        const usageData = await usageRes.json();

        const drafts: DraftSummary[] = draftsData.success ? draftsData.data : [];
        const docs: DocumentSummary[] = docsData.success ? docsData.data : [];

        setRecentDrafts(drafts.slice(0, 5));
        setRecentDocs(docs.slice(0, 5));
        setStats({
          docCount: docsData.total ?? docs.length,
          draftCount: draftsData.total ?? drafts.length,
          totalTokens: usageData.success
            ? (usageData.data.summary?.totalInputTokens ?? 0) + (usageData.data.summary?.totalOutputTokens ?? 0)
            : 0,
          activeTasks: 0,
        });

        // Fetch running tasks count
        fetch("/api/v1/tasks")
          .then((r) => r.json())
          .then((d) => {
            if (d.success) {
              setStats((prev) => ({
                ...prev,
                activeTasks: d.data.filter(
                  (t: { status: string }) => t.status === "running" || t.status === "pending"
                ).length,
              }));
            }
          })
          .catch(() => {});
      } catch {
        // swallow — empty state renders
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const draftsInProgress = recentDrafts.filter((d) => d.status === "drafting").length;

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
              Welcome back 👋
            </h3>
            <p className="text-[14px] text-muted-foreground mb-4">
              {draftsInProgress > 0
                ? `You have ${draftsInProgress} draft${draftsInProgress > 1 ? "s" : ""} in progress. Here's your workspace overview.`
                : "Here's your workspace overview."}
            </p>
            <Link
              href="/documents"
              className="inline-block px-5 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:bg-primary-light transition-colors cursor-pointer"
            >
              Upload New Document
            </Link>
          </div>

          <div className="flex gap-6">
            <StatCard value={String(stats.docCount)} label="Documents" />
            <StatCard value={String(stats.draftCount)} label="Drafts" />
            <StatCard value={formatTokenCount(stats.totalTokens)} label="Tokens" />
            <StatCard value={String(stats.activeTasks)} label="Active Tasks" />
          </div>
        </div>

        {/* Quick Actions Row */}
        <div className="grid grid-cols-4 gap-[14px] mb-6">
          <QuickAction
            href="/documents"
            label="Upload Docs"
            desc="Import & convert files"
            iconBg="bg-primary-100"
            iconColor="text-primary"
            animationClass="animate-fade-in-up-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </QuickAction>
          <QuickAction
            href="/brainstorm"
            label="Brainstorm"
            desc="Organize ideas with AI"
            iconBg="bg-[#EFF6FF]"
            iconColor="text-[#2563EB]"
            animationClass="animate-fade-in-up-3"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
          </QuickAction>
          <QuickAction
            href="/writing"
            label="New Draft"
            desc="Start writing a document"
            iconBg="bg-[#DCFCE7]"
            iconColor="text-[#16A34A]"
            animationClass="animate-fade-in-up-4"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </QuickAction>
          <QuickAction
            href="/library"
            label="Browse Library"
            desc="Search your knowledge"
            iconBg="bg-[#FFF7ED]"
            iconColor="text-[#EA580C]"
            animationClass="animate-fade-in-up-5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px]">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </QuickAction>
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
                href="/library"
                className="text-[13px] text-primary font-medium no-underline"
              >
                View all →
              </Link>
            </div>
            <div className="bg-base-white border border-[#F0F0F0] rounded-[16px] overflow-hidden">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
              ) : recentDocs.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No documents yet. Upload your first document to get started.
                </div>
              ) : (
                recentDocs.map((doc, i) => {
                  const sc = docStatusColors[doc.status] ?? docStatusColors.uploaded;
                  return (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-base-gray transition-colors duration-150 cursor-pointer ${
                        i < recentDocs.length - 1 ? "border-b border-[#F0F0F0]" : ""
                      }`}
                      onClick={() => router.push(`/library/${doc.id}`)}
                    >
                      <div className="w-9 h-9 rounded-[12px] flex items-center justify-center flex-shrink-0 bg-[#EFF6FF] text-[#2563EB]">
                        <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold text-foreground truncate">
                          {doc.originalName}
                        </div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">
                          {formatTimeAgo(doc.createdAt)}
                        </div>
                      </div>
                      <span className={`text-[12px] font-medium px-2.5 py-1 rounded-full ${sc.bg} ${sc.text}`}>
                        {sc.label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Drafts */}
          <div>
            <div className="flex items-center justify-between mb-[14px]">
              <h3 className="font-display text-[16px] font-semibold text-foreground tracking-[-0.02em]">
                Recent Drafts
              </h3>
              <Link href="/writing" className="text-[13px] text-primary font-medium no-underline">
                View all →
              </Link>
            </div>
            <div className="bg-base-white border border-[#F0F0F0] rounded-[16px] overflow-hidden">
              {loading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>
              ) : recentDrafts.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No drafts yet. Start by brainstorming an outline.
                </div>
              ) : (
                recentDrafts.map((draft, i) => {
                  const progress = draft.progress ?? { completed: 0, total: 0 };
                  return (
                    <div
                      key={draft.id}
                      className={`flex items-center gap-3 p-[14px_16px] cursor-pointer hover:bg-base-gray transition-colors duration-150 ${
                        i < recentDrafts.length - 1 ? "border-b border-[#F0F0F0]" : ""
                      }`}
                      onClick={() => router.push(`/writing/${draft.id}`)}
                    >
                      <div
                        className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          draft.status === "drafting"
                            ? "bg-primary animate-task-pulse"
                            : draft.status === "completed"
                              ? "bg-[#16A34A]"
                              : "bg-[#2563EB]"
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-foreground truncate">
                          {draft.title}
                        </div>
                        <div className="text-[12px] text-muted-foreground mt-px">
                          {progress.completed}/{progress.total} sections · {formatTimeAgo(draft.updatedAt)}
                        </div>
                        {draft.status === "drafting" && progress.total > 0 && (
                          <div className="w-full h-1 bg-base-gray rounded mt-1.5 overflow-hidden">
                            <div
                              className="h-full bg-primary rounded transition-[width] duration-300"
                              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                            />
                          </div>
                        )}
                      </div>
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusColors[draft.status] ?? ""}`}
                      >
                        {statusLabels[draft.status] ?? draft.status}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center bg-white/80 backdrop-blur-xl border border-primary/[0.08] rounded-[16px] p-4 px-6 min-w-[90px]">
      <div className="font-display text-[24px] font-bold text-primary tracking-[-0.02em]">
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground uppercase tracking-[0.5px] mt-0.5">
        {label}
      </div>
    </div>
  );
}

function QuickAction({
  href,
  label,
  desc,
  iconBg,
  iconColor,
  animationClass,
  children,
}: {
  href: string;
  label: string;
  desc: string;
  iconBg: string;
  iconColor: string;
  animationClass: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-[14px] p-[18px_20px] bg-base-white border border-[#F0F0F0] rounded-[16px] hover:border-primary/25 hover:shadow-md hover:-translate-y-[2px] transition-all duration-200 no-underline ${animationClass}`}
    >
      <div className={`w-11 h-11 rounded-[16px] flex items-center justify-center flex-shrink-0 ${iconBg} ${iconColor}`}>
        {children}
      </div>
      <div>
        <h4 className="text-[14px] font-semibold text-foreground mb-0.5">{label}</h4>
        <span className="text-[12px] text-muted-foreground">{desc}</span>
      </div>
    </Link>
  );
}
