"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";
import { LoadingState } from "@/components/shared/loading-state";
import { EmptyState } from "@/components/shared/empty-state";
import { getDashboardDocumentStatusDisplay } from "@/lib/dashboard/document-status";
import { draftStatusLabels as statusLabels, draftStatusColors as statusColors } from "@/lib/text/status-labels";
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

interface DashboardStats {
  docCount: number;
  draftCount: number;
  totalTokens: number;
  activeTasks: number;
}

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

      <div className="p-8 max-w-7xl mx-auto space-y-8">
        {/* Welcome Hero */}
        <div className="bg-mesh border border-border rounded-2xl p-8 relative overflow-hidden shadow-soft flex items-center justify-between animate-fade-in-up">
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary-400/10 blur-[80px] rounded-full pointer-events-none"></div>
          
          <div className="relative z-10 max-w-md">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-card border border-border rounded-full text-xs font-semibold text-primary mb-4 shadow-sm">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              AI Workspace Active
            </div>
            <h2 className="text-3xl font-bold text-foreground mb-2">Welcome back 👋</h2>
            <p className="text-muted-foreground text-sm mb-6">
              {draftsInProgress > 0
                ? `You have ${draftsInProgress} draft${draftsInProgress > 1 ? "s" : ""} in progress. Here's your workspace overview.`
                : "Here's your workspace overview."}
            </p>
            
            <Link
              href="/documents"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors shadow-md font-medium text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5v14" />
              </svg>
              Upload New Document
            </Link>
          </div>

          <div className="relative z-10 flex gap-4">
            <StatCard value={String(stats.docCount)} label="Documents" />
            <StatCard value={String(stats.draftCount)} label="Drafts" />
            <StatCard value={formatTokenCount(stats.totalTokens)} label="Tokens" />
            <StatCard value={String(stats.activeTasks)} label="Active Tasks" isPrimary />
          </div>
        </div>

        {/* Quick Actions Row */}
        <div className="grid grid-cols-4 gap-4">
          <QuickAction
            href="/documents"
            label="Upload Docs"
            desc="Import & convert files"
            iconBg="bg-muted/50 group-hover:bg-primary-50"
            iconColor="text-muted-foreground group-hover:text-primary"
            hoverBorderClass="hover:border-primary-200"
            animationClass="animate-fade-in-up-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          </QuickAction>
          <QuickAction
            href="/brainstorm"
            label="Brainstorm"
            desc="Organize ideas with AI"
            iconBg="bg-muted/50 group-hover:bg-blue-50"
            iconColor="text-muted-foreground group-hover:text-blue-600"
            hoverBorderClass="hover:border-blue-200"
            animationClass="animate-fade-in-up-3"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              <path d="M9 18h6" />
              <path d="M10 22h4" />
              <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1.45.62 2.84 1.5 3.5.76.75 1.23 1.51 1.41 2.5" />
            </svg>
          </QuickAction>
          <QuickAction
            href="/writing"
            label="New Draft"
            desc="Start writing a document"
            iconBg="bg-muted/50 group-hover:bg-green-50"
            iconColor="text-muted-foreground group-hover:text-green-600"
            hoverBorderClass="hover:border-green-200"
            animationClass="animate-fade-in-up-4"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
          </QuickAction>
          <QuickAction
            href="/library"
            label="Browse Library"
            desc="Search your knowledge"
            iconBg="bg-muted/50 group-hover:bg-orange-50"
            iconColor="text-muted-foreground group-hover:text-orange-600"
            hoverBorderClass="hover:border-orange-200"
            animationClass="animate-fade-in-up-5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </QuickAction>
        </div>

        {/* Two-Column: Recent Docs + Active Tasks */}
        <div className="grid grid-cols-2 gap-6 animate-fade-in-up-6">

          {/* Recent Documents */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-foreground">Recent Documents</h3>
              <Link href="/library" className="text-sm font-medium text-primary hover:text-primary-700">
                View all &rarr;
              </Link>
            </div>
            <div className="bg-card border border-border rounded-2xl shadow-soft overflow-hidden">
              {loading ? (
                <LoadingState />
              ) : recentDocs.length === 0 ? (
                <EmptyState title="No documents yet" description="Upload your first document to get started." />
              ) : (
                recentDocs.map((doc, i) => {
                  const sc = getDashboardDocumentStatusDisplay(doc.status);
                  return (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-secondary/70 transition-colors cursor-pointer group ${
                        i < recentDocs.length - 1 ? "border-b border-border" : ""
                      }`}
                      onClick={() => router.push(`/library/${doc.id}`)}
                    >
                      <div className="w-8 h-8 rounded-lg bg-secondary text-muted-foreground flex items-center justify-center group-hover:bg-primary-50 group-hover:text-primary transition-colors flex-shrink-0">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-foreground text-sm truncate">{doc.originalName}</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">{formatTimeAgo(doc.createdAt)}</p>
                      </div>
                      <div className={`flex items-center gap-1.5 px-2 py-0.5 ${sc.bg} ${sc.text} rounded-md text-[10px] font-semibold border ${sc.border}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${sc.dot} ${doc.status === 'converting' ? 'animate-pulse' : ''}`}></div>
                        {sc.label}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Recent Drafts */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg text-foreground">Recent Drafts</h3>
              <Link href="/writing" className="text-sm font-medium text-primary hover:text-primary-700">
                View all &rarr;
              </Link>
            </div>
            <div className="bg-card border border-border rounded-2xl shadow-soft overflow-hidden">
              {loading ? (
                <LoadingState />
              ) : recentDrafts.length === 0 ? (
                <EmptyState title="No drafts yet" description="Start by brainstorming an outline." />
              ) : (
                recentDrafts.map((draft, i) => {
                  const progress = draft.progress ?? { completed: 0, total: 0 };
                  return (
                    <div
                      key={draft.id}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-secondary/70 transition-colors cursor-pointer group ${
                        i < recentDrafts.length - 1 ? "border-b border-border" : ""
                      }`}
                      onClick={() => router.push(`/writing/${draft.id}`)}
                    >
                      <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                        <div
                          className={`w-2 h-2 rounded-full ${
                            draft.status === "drafting"
                              ? "bg-primary animate-pulse"
                              : draft.status === "completed"
                                ? "bg-green-500"
                                : "bg-blue-500"
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center">
                          <h4 className="font-medium text-foreground text-sm truncate">{draft.title}</h4>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ml-2 flex-shrink-0 ${statusColors[draft.status] ?? ""}`}>
                            {statusLabels[draft.status] ?? draft.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {progress.completed}/{progress.total} sections · {formatTimeAgo(draft.updatedAt)}
                        </p>
                        {draft.status === "drafting" && progress.total > 0 && (
                          <div className="w-full h-1 bg-secondary rounded-full overflow-hidden mt-1.5">
                            <div
                              className="h-full bg-primary rounded-full transition-all duration-300"
                              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
                            />
                          </div>
                        )}
                      </div>
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

function StatCard({ value, label, isPrimary }: { value: string; label: string; isPrimary?: boolean }) {
  if (isPrimary) {
    return (
      <div className="glass-card border-primary-200 bg-primary-50/50 rounded-xl p-5 w-32 flex flex-col items-center justify-center text-center shadow-sm">
        <span className="text-3xl font-bold text-primary-600 mb-1">{value}</span>
        <span className="text-xs font-semibold text-primary-600 uppercase tracking-wider">{label}</span>
      </div>
    );
  }
  return (
    <div className="glass-card rounded-xl p-5 w-32 flex flex-col items-center justify-center text-center shadow-sm">
      <span className="text-3xl font-bold text-foreground mb-1">{value}</span>
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
    </div>
  );
}

function QuickAction({
  href,
  label,
  desc,
  iconBg,
  iconColor,
  hoverBorderClass,
  animationClass,
  children,
}: {
  href: string;
  label: string;
  desc: string;
  iconBg: string;
  iconColor: string;
  hoverBorderClass: string;
  animationClass: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`group bg-card p-5 rounded-2xl border border-border shadow-soft hover:shadow-hover hover:-translate-y-1 transition-all flex items-start gap-4 ${hoverBorderClass} ${animationClass}`}
    >
      <div className={`w-12 h-12 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center transition-colors`}>
        {children}
      </div>
      <div>
        <h4 className="font-semibold text-foreground mb-0.5">{label}</h4>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </Link>
  );
}
