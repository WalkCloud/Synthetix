"use client";

import { useRouter } from "next/navigation";

interface HeaderProps {
  title: string;
}

export function Header({ title }: HeaderProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-40 bg-base/85 backdrop-blur-xl border-b px-8 h-16 flex items-center justify-between">
      <h1 className="text-[22px] font-semibold font-display">{title}</h1>
      <div className="flex items-center gap-3">
        <button className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-gray-50 transition-colors text-muted-foreground">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <button onClick={handleLogout} className="w-10 h-10 rounded-xl flex items-center justify-center hover:bg-gray-50 transition-colors text-muted-foreground" title="退出登录">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </header>
  );
}
