"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useUser } from "@/lib/user-context";
import { useLocale, type Locale } from "@/lib/i18n";
import type { TranslationSchema } from "@/lib/i18n/types";
import { useTheme } from "next-themes";
import { logout } from "@/lib/auth/logout";
import { AboutDialog } from "@/components/layout/about-dialog";
import { UpdateReminderButton } from "@/components/layout/update-reminder-button";

type SidebarKeys = keyof TranslationSchema["layout"]["sidebar"];

interface NavItem {
  readonly href: string;
  readonly labelKey: SidebarKeys;
  readonly icon: React.ReactNode;
}

interface NavGroup {
  readonly groupKey: SidebarKeys;
  readonly items: readonly NavItem[];
}

const navGroups: readonly NavGroup[] = [
  {
    groupKey: "workspace",
    items: [
      {
        href: "/",
        labelKey: "dashboard",
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
        labelKey: "documentInit",
        icon: (
          <>
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
          </>
        ),
      },
      {
        href: "/library",
        labelKey: "documentLibrary",
        icon: (
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        ),
      },
      {
        href: "/search",
        labelKey: "knowledgeSearch",
        icon: (
          <>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </>
        ),
      },
      {
        href: "/wiki",
        labelKey: "knowledgeWiki",
        icon: (
          <>
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </>
        ),
      },
    ],
  },
  {
    groupKey: "authoring",
    items: [
      {
        href: "/brainstorm",
        labelKey: "mindOrganization",
        icon: (
          <>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </>
        ),
      },
      {
        href: "/writing",
        labelKey: "documentWriting",
        icon: (
          <>
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
          </>
        ),
      },
      {
        href: "/topology",
        labelKey: "documentTopology",
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
    groupKey: "settings",
    items: [
      {
        href: "/models",
        labelKey: "modelManagement",
        icon: (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </>
        ),
      },
      {
        href: "/settings",
        labelKey: "userManagement",
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
  const router = useRouter();
  const { user } = useUser();
  const { locale, t, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const [aboutOpen, setAboutOpen] = useState(false);
  // Detect macOS at runtime (client-only) so we can pad the top bar to clear
  // the native traffic-light buttons (close/minimize/zoom) which sit at the
  // top-left on darwin and would overlap the logo. window.synthetix.platform
  // is exposed by electron/preload.ts; in a plain browser it's undefined and
  // we fall back to the user-agent check. Defaults to false during SSR.
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const platform = typeof window !== "undefined" ? window.synthetix?.platform : undefined;
    setIsMac(platform === "darwin" || (/Mac/.test(navigator.userAgent) && !platform));
  }, []);

  const displayName = useMemo(() => user?.displayName || user?.username || "User", [user]);
  const initials = useMemo(
    () => displayName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2),
    [displayName],
  );
  const avatarUrl = user?.avatarUrl ?? null;
  const roleLabel = user?.role ?? "Admin";

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[260px] bg-white dark:bg-sidebar border-r flex flex-col z-50">
      {/* Top brand block doubles as the window drag handle (titleBarStyle:hidden
          overlay mode). The Image/h1 are non-interactive so the whole bar drags.
          On macOS, add left padding so the logo clears the traffic-light buttons
          (~78px: 3 buttons × ~12px + margins). Windows keeps px-6 (buttons are
          on the overlay at top-right, no conflict). */}
      <div className={`app-drag h-16 shrink-0 flex items-center gap-3 border-b border-border ${isMac ? "pl-[78px] pr-6" : "px-6"}`}>
        <Image
          src="/logo.png"
          alt="Synthetix"
          width={30}
          height={30}
          className="shrink-0"
          priority
        />
        <h1 className="text-xl font-bold font-display tracking-tight">Synthetix</h1>
      </div>

      <nav className="flex-1 py-3 px-3 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.groupKey} className="mb-6">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 px-3 mb-1.5">
              {t.layout.sidebar[group.groupKey]}
            </div>
            {group.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(item.href));
              return (
                <Link
                  key={`${group.groupKey}-${item.labelKey}`}
                  href={item.href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors ${
                    isActive
                      ? "bg-primary-50 text-primary font-semibold dark:bg-primary/10"
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
                  {t.layout.sidebar[item.labelKey]}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-border/[0.6] relative">
        {/* Update reminder — hidden unless the Electron bridge reports an
            actionable update state. Uses <button> (not <a>) so it does not
            increment the `aside a` count asserted by e2e NAV-01. */}
        <UpdateReminderButton onOpenAbout={() => setAboutOpen(true)} />
        <UserMenuTrigger
          displayName={displayName}
          initials={initials}
          avatarUrl={avatarUrl}
          roleLabel={roleLabel}
          router={router}
          theme={theme}
          setTheme={setTheme}
          locale={locale}
          setLocale={setLocale}
          t={t}
          onAbout={() => setAboutOpen(true)}
        />
      </div>

      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </aside>
  );
}

function UserMenuTrigger({
  displayName,
  initials,
  avatarUrl,
  roleLabel,
  router,
  theme,
  setTheme,
  locale,
  setLocale,
  t,
  onAbout,
}: {
  displayName: string;
  initials: string;
  avatarUrl: string | null;
  roleLabel: string;
  router: ReturnType<typeof useRouter>;
  theme: string | undefined;
  setTheme: (t: string) => void;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TranslationSchema;
  onAbout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setOpen(false);
      setLangOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open, handleClickOutside]);

  return (
    <div ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl cursor-pointer hover:bg-secondary transition-colors text-left bg-transparent border-none"
      >
        <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-primary to-primary-light flex items-center justify-center text-white font-semibold text-xs shrink-0 overflow-hidden">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" fill sizes="32px" className="object-cover" unoptimized />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold truncate">{displayName}</div>
          <div className="text-[11px] text-muted-foreground capitalize">{roleLabel}</div>
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
      </button>

      {open && (
        <div className="absolute bottom-full left-3 right-3 mb-1 z-50 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 duration-100">
          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary transition-colors text-left bg-transparent border-none cursor-pointer"
            onClick={() => { setOpen(false); router.push("/settings"); }}
          >
            <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            {t.layout.userMenu.userSettings}
          </button>

          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary transition-colors text-left bg-transparent border-none cursor-pointer"
            onClick={() => { setTheme(theme === "dark" ? "light" : "dark"); }}
          >
            {theme === "dark" ? (
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" /><path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" /><path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
              </svg>
            ) : (
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
              </svg>
            )}
            {theme === "dark" ? t.layout.userMenu.lightMode : t.layout.userMenu.darkMode}
          </button>

          <div className="relative">
            <button
              type="button"
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary transition-colors text-left bg-transparent border-none cursor-pointer"
              onClick={() => setLangOpen((v) => !v)}
            >
              <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
              {t.layout.userMenu.language}
              <svg className="size-3 ml-auto shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>

            {langOpen && (
              <div className="absolute left-full bottom-0 ml-1 z-50 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 min-w-[120px] animate-in fade-in-0 zoom-in-95 duration-100">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary transition-colors text-left bg-transparent border-none cursor-pointer"
                  onClick={() => { setLocale("en"); setLangOpen(false); }}
                >
                  {locale === "en" && (
                    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                  <span className={locale !== "en" ? "pl-5.5" : ""}>{t.language.en}</span>
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary transition-colors text-left bg-transparent border-none cursor-pointer"
                  onClick={() => { setLocale("zh-CN"); setLangOpen(false); }}
                >
                  {locale === "zh-CN" && (
                    <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  )}
                  <span className={locale !== "zh-CN" ? "pl-5.5" : ""}>{t.language.zhCN}</span>
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-secondary transition-colors text-left bg-transparent border-none cursor-pointer"
            onClick={() => { setOpen(false); onAbout(); }}
          >
            <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" />
              <path d="M12 8h.01" />
            </svg>
            {t.layout.userMenu.about}
          </button>

          <div className="my-1 h-px bg-border" />

          <button
            type="button"
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-destructive/10 hover:text-destructive transition-colors text-left bg-transparent border-none cursor-pointer text-destructive"
            onClick={() => { setOpen(false); logout(); }}
          >
            <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {t.layout.userMenu.logout}
          </button>
        </div>
      )}
    </div>
  );
}
