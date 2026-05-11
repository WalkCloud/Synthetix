"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const FEATURES = [
  {
    title: "Smart Drafting",
    description: "AI generates structured drafts from your outline in seconds, not hours.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-[22px] h-[22px] text-white"
      >
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    title: "Reference Management",
    description:
      "Organize citations and references with automatic linking and formatting.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-[22px] h-[22px] text-white"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
  },
  {
    title: "Model Management",
    description:
      "Switch between AI models and fine-tune output to match your style.",
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-[22px] h-[22px] text-white"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
] as const;

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
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
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error, please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen min-h-[100dvh]">
      {/* Left decorative panel */}
      <div
        className="hidden lg:flex w-1/2 flex-col justify-center p-16 relative overflow-hidden"
        style={{
          background:
            "radial-gradient(ellipse at 20% 80%, rgba(91, 79, 181, 0.3) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(58, 46, 133, 0.12) 0%, transparent 50%), linear-gradient(135deg, #3A2E85 0%, #5B4FB5 50%, #2A1F6E 100%)",
        }}
      >
        {/* Floating circle: top-right */}
        <div
          className="absolute -top-[120px] -right-[120px] w-[500px] h-[500px] rounded-full animate-float pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(255,255,255,0.12) 0%, transparent 70%)",
          }}
        />
        {/* Floating circle: bottom-left */}
        <div
          className="absolute -bottom-[80px] -left-[80px] w-[350px] h-[350px] rounded-full animate-float-delayed pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)",
          }}
        />

        {/* Brand */}
        <div className="relative z-10 flex items-center gap-3.5 mb-12 animate-fade-in-up">
          <svg
            className="w-10 h-10 text-white shrink-0"
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
          <span className="text-[26px] font-bold text-white font-display tracking-tight">
            Synthetix
          </span>
        </div>

        {/* Tagline */}
        <h2 className="relative z-10 text-[32px] font-bold text-white/90 font-display leading-tight mb-3 tracking-tight animate-fade-in-up-2">
          AI-Powered Document Authoring
        </h2>

        {/* Subtitle */}
        <p className="relative z-10 text-base text-white/70 mb-12 max-w-[440px] leading-relaxed animate-fade-in-up-3">
          Write, organize, and publish professional documents with intelligent
          assistance at every step.
        </p>

        {/* Features */}
        <div className="relative z-10 flex flex-col gap-6">
          {FEATURES.map((feature, index) => (
            <div
              key={feature.title}
              className={`flex items-start gap-4 animate-fade-in-up-${index + 4}`}
            >
              <div className="w-11 h-11 rounded-lg bg-white/[0.12] backdrop-blur-sm border border-white/[0.15] flex items-center justify-center shrink-0">
                {feature.icon}
              </div>
              <div>
                <h4 className="text-[15px] font-semibold text-white font-display mb-0.5">
                  {feature.title}
                </h4>
                <p className="text-[13px] text-white/65 leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right form panel */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center p-12 bg-gradient-to-b from-white to-[#FAFAF8]">
        <div className="w-full max-w-[400px]">
          <h2 className="text-2xl font-extrabold font-display mb-2 tracking-tight animate-fade-in-up-2">
            Welcome back
          </h2>
          <p className="text-sm text-muted-foreground mb-8 animate-fade-in-up-3">
            Sign in to your Synthetix account to continue.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email field */}
            <div className="animate-fade-in-up-4">
              <label
                className="block text-[13px] font-medium text-muted-foreground mb-1.5"
                htmlFor="email"
              >
                Email
              </label>
              <div className="relative">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground pointer-events-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
                <input
                  id="email"
                  type="text"
                  className="w-full pl-[42px] pr-3.5 py-2.5 border border-input rounded-lg text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  placeholder="admin"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Password field */}
            <div className="animate-fade-in-up-5">
              <label
                className="block text-[13px] font-medium text-muted-foreground mb-1.5"
                htmlFor="password"
              >
                Password
              </label>
              <div className="relative">
                <svg
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-muted-foreground pointer-events-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                <input
                  id="password"
                  type="password"
                  className="w-full pl-[42px] pr-3.5 py-2.5 border border-input rounded-lg text-sm bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Remember me */}
            <div className="flex items-center gap-2 animate-fade-in-up-6">
              <input
                type="checkbox"
                id="remember"
                className="w-4 h-4 accent-primary cursor-pointer"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <label
                htmlFor="remember"
                className="text-[13px] text-muted-foreground cursor-pointer"
              >
                Remember me
              </label>
            </div>

            {/* Error message */}
            {error && <p className="text-sm text-destructive">{error}</p>}

            {/* Login button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5 transition-all disabled:opacity-40 animate-fade-in-up"
              style={{ animationDelay: "0.35s" }}
            >
              {loading ? "Signing in..." : "Login"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
