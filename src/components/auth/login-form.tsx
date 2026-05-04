"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/v1/system/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.data?.initialized) router.push("/setup");
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        router.push("/");
      } else {
        setError(data.error || "登录失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Left decorative panel */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-primary via-primary-dark to-[#2B45C8] flex-col justify-center p-16 relative overflow-hidden">
        <div className="absolute top-[-120px] right-[-120px] w-[500px] h-[500px] rounded-full bg-white/[0.12] animate-pulse" />
        <div className="absolute bottom-[-80px] left-[-80px] w-[350px] h-[350px] rounded-full bg-white/[0.08] animate-pulse" />
        <div className="relative z-10">
          <div className="flex items-center gap-3.5 mb-12">
            <svg className="w-10 h-10 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            <span className="text-[26px] font-bold text-white font-display">Synthetix</span>
          </div>
          <h2 className="text-[32px] font-bold text-white/90 font-display leading-tight mb-3">
            AI-Powered Document Authoring
          </h2>
          <p className="text-base text-white/70 mb-12 max-w-[440px] leading-relaxed">
            Write, organize, and publish professional documents with intelligent assistance at every step.
          </p>
          <div className="flex flex-col gap-6">
            {[
              { title: "Smart Drafting", desc: "AI generates structured drafts from your outline in seconds, not hours." },
              { title: "Reference Management", desc: "Organize citations and references with automatic linking and formatting." },
              { title: "Model Management", desc: "Switch between AI models and fine-tune output to match your style." },
            ].map((feature) => (
              <div key={feature.title} className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-white/[0.12] backdrop-blur-sm border border-white/[0.15] flex items-center justify-center shrink-0">
                  <svg className="w-5.5 h-5.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /></svg>
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-white font-display">{feature.title}</h4>
                  <p className="text-[13px] text-white/65 leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-12 bg-gradient-to-b from-white to-[#FAFAF8]">
        <div className="w-full max-w-[400px]">
          <h2 className="text-2xl font-extrabold font-display mb-2">Welcome back</h2>
          <p className="text-sm text-muted-foreground mb-8">Sign in to your Synthetix account to continue.</p>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5" htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all disabled:opacity-40"
            >
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
