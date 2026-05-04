"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";

interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/v1/users/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setProfile(data.data);
          setDisplayName(data.data.displayName);
          setEmail(data.data.email || "");
        }
      });
  }, []);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/v1/users/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, email: email || null }),
    });
    const data = await res.json();
    setMessage(data.success ? { type: "success", text: "个人信息已更新" } : { type: "error", text: data.error || "更新失败" });
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const res = await fetch("/api/v1/users/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (data.success) {
      setCurrentPassword("");
      setNewPassword("");
      setMessage({ type: "success", text: "密码已修改" });
    } else {
      setMessage({ type: "error", text: data.error || "修改失败" });
    }
  }

  return (
    <div>
      <Header title="系统设置" />
      <div className="p-8 max-w-2xl">
        {message && (
          <div className={`mb-6 px-4 py-3 rounded-xl text-sm ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message.text}
          </div>
        )}

        <div className="bg-white border rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold font-display mb-4">个人信息</h2>
          <form onSubmit={handleProfileSave} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">用户名</label>
              <input className="w-full px-3.5 py-2.5 border rounded-xl text-sm bg-gray-50" value={profile?.username || ""} disabled />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">显示名称</label>
              <input className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">邮箱</label>
              <input type="email" className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可选" />
            </div>
            <button type="submit" className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all text-sm">保存</button>
          </form>
        </div>

        <div className="bg-white border rounded-2xl p-6">
          <h2 className="text-lg font-semibold font-display mb-4">修改密码</h2>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">当前密码</label>
              <input type="password" className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">新密码</label>
              <input type="password" className="w-full px-3.5 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} />
            </div>
            <button type="submit" className="px-6 py-2.5 bg-primary text-white font-semibold rounded-xl hover:bg-primary-light transition-all text-sm">修改密码</button>
          </form>
        </div>
      </div>
    </div>
  );
}
