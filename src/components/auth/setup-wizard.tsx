"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ username: "", password: "", confirmPassword: "", displayName: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setError("");
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    if (form.password.length < 6) {
      setError("密码至少 6 个字符");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, password: form.password, displayName: form.displayName }),
      });
      const data = await res.json();
      if (data.success) {
        router.push("/");
      } else {
        setError(typeof data.error === "string" ? data.error : "设置失败");
      }
    } catch {
      setError("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-6">
            <svg className="w-10 h-10 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="text-2xl font-bold font-display">Synthetix</span>
          </div>
          <h1 className="text-xl font-bold font-display">初次使用，创建管理员账号</h1>
          <p className="text-sm text-muted-foreground mt-2">设置您的管理员账号以开始使用</p>
        </div>

        <div className="flex gap-2 mb-8">
          {[1, 2].map((s) => (
            <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? "bg-primary" : "bg-border"}`} />
          ))}
        </div>

        <form onSubmit={handleSetup} className="bg-white rounded-2xl border shadow-sm p-6 space-y-5">
          {step === 1 && (
            <>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">用户名</label>
                <input
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="至少 3 个字符"
                  value={form.username}
                  onChange={(e) => updateField("username", e.target.value)}
                  required
                  minLength={3}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">显示名称</label>
                <input
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="您的名字"
                  value={form.displayName}
                  onChange={(e) => updateField("displayName", e.target.value)}
                  required
                />
              </div>
              <button type="button" onClick={() => setStep(2)} disabled={!form.username || !form.displayName}
                className="w-full py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-40">
                下一步
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">密码</label>
                <input
                  type="password"
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="至少 6 个字符"
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">确认密码</label>
                <input
                  type="password"
                  className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="再次输入密码"
                  value={form.confirmPassword}
                  onChange={(e) => updateField("confirmPassword", e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)}
                  className="flex-1 py-3 border rounded-xl font-semibold hover:bg-gray-50 transition-colors">
                  上一步
                </button>
                <button type="submit" disabled={loading || !form.password || !form.confirmPassword}
                  className="flex-1 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all disabled:opacity-40">
                  {loading ? "创建中..." : "创建账号"}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
