"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: React.ReactNode;
}

interface NavGroup {
  readonly group: string;
  readonly items: readonly NavItem[];
}

const navGroups: readonly NavGroup[] = [
  {
    group: "Workspace",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: (
          <>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </>
        ),
      },
      {
        href: "/documents",
        label: "Document Init",
        icon: (
          <>
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </>
        ),
      },
      {
        href: "/library",
        label: "Document Library",
        icon: (
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        ),
      },
      {
        href: "/brainstorm",
        label: "Mind Organization",
        icon: (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </>
        ),
      },
    ],
  },
  {
    group: "Authoring",
    items: [
      {
        href: "/writing",
        label: "Document Writing",
        icon: (
          <>
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </>
        ),
      },
      {
        href: "/topology",
        label: "Document Topology",
        icon: (
          <>
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </>
        ),
      },
    ],
  },
  {
    group: "Settings",
    items: [
      {
        href: "/models",
        label: "Model Management",
        icon: (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </>
        ),
      },
      {
        href: "/settings",
        label: "User Management",
        icon: (
          <>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </>
        ),
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("");
  const [initials, setInitials] = useState("");

  useEffect(() => {
    fetch("/api/v1/users/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.data) {
          const name = data.data.displayName || data.data.username || "";
          setDisplayName(name);
          setInitials(
            name
              ? name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
              : "U"
          );
        }
      })
      .catch(() => {});
  }, []);

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[260px] bg-white border-r flex flex-col z-50">
      {/* Brand */}
      <div className="h-16 shrink-0 flex items-center gap-3 px-6 border-b border-border">
        <svg
          className="w-[30px] h-[30px] text-primary shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
        <h1 className="text-xl font-bold font-display tracking-tight">Synthetix</h1>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-3 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.group} className="mb-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 px-3 mb-1.5">
              {group.group}
            </div>
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={`${group.group}-${item.label}`}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-primary-50 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  <svg
                    className="w-[18px] h-[18px] shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {item.icon}
                  </svg>
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User Footer */}
      <div className="p-3 border-t border-border/[0.6]">
        <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl cursor-pointer hover:bg-secondary transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-light flex items-center justify-center text-white font-semibold text-xs shrink-0">
            {initials || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold truncate">{displayName || "User"}</div>
            <div className="text-[11px] text-muted-foreground">Admin</div>
          </div>
          <svg
            className="w-3.5 h-3.5 text-muted-foreground shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </div>
      </div>
    </aside>
  );
}
