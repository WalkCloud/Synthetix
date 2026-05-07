"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/layout/header";

interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
}

type Tab = "profile" | "auth" | "storage" | "database";
type AuthMode = "local" | "appwrite";
type StorageMode = "local" | "s3";


const tabs: { id: Tab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "auth", label: "Authentication Settings" },
  { id: "storage", label: "Storage Settings" },
  { id: "database", label: "Database Settings" },
];

interface MigrationEntry {
  migration_name: string;
  finished_at: string | null;
  rolled_back_at: string | null;
}

function MigrationHistory() {
  const [migrations, setMigrations] = useState<MigrationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/system/migrations")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setMigrations(data.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="text-sm text-muted-foreground py-4">Loading migrations...</div>;
  }

  if (migrations.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">No migrations found. Run migrations to initialize the database schema.</div>;
  }

  return (
    <div className="border rounded-[16px] overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b bg-[#EEEEE9]">
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Migration</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Status</th>
            <th className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-4 py-3">Applied</th>
          </tr>
        </thead>
        <tbody>
          {migrations.map((m) => {
            const applied = m.finished_at && !m.rolled_back_at;
            return (
              <tr key={m.migration_name} className="border-b last:border-0 hover:bg-primary-50">
                <td className="px-4 py-3 text-[13px] font-mono">{m.migration_name}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${applied ? "bg-[#DCFCE7] text-[#16A34A]" : "bg-[#FFF7ED] text-[#EA580C]"}`}>
                    {applied ? "Applied" : "Pending"}
                  </span>
                </td>
                <td className="px-4 py-3 text-[13px] text-muted-foreground">
                  {m.finished_at ? new Date(m.finished_at).toLocaleString() : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [authMode, setAuthMode] = useState<AuthMode>("local");
  const [storageMode, setStorageMode] = useState<StorageMode>("local");

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
    setMessage(data.success ? { type: "success", text: "Profile updated" } : { type: "error", text: data.error || "Update failed" });
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
      setConfirmPassword("");
      setMessage({ type: "success", text: "Password updated" });
    } else {
      setMessage({ type: "error", text: data.error || "Update failed" });
    }
  }

  function getPasswordStrength(pw: string): { score: number; label: string; color: string } {
    if (!pw) return { score: 0, label: "", color: "" };
    let s = 0;
    if (pw.length >= 6) s++;
    if (pw.length >= 10) s++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
    if (/[0-9]/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    if (s <= 2) return { score: 2, label: "Weak", color: "bg-[#DC2626]" };
    if (s <= 3) return { score: 3, label: "Medium", color: "bg-[#D97706]" };
    return { score: 4, label: "Strong", color: "bg-[#16A34A]" };
  }

  const strength = getPasswordStrength(newPassword);
  const initials = displayName ? displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : profile?.username?.slice(0, 2).toUpperCase() || "U";

  return (
    <div>
      <Header title="User Management" />
      <div className="p-8">
        {message && (
          <div className={`mb-6 px-4 py-3 rounded-lg text-sm ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
            {message.text}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 border-b border-border mb-6">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`py-3 px-5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id ? "text-primary border-primary font-semibold" : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Profile Tab */}
        {tab === "profile" && (
          <div className="grid grid-cols-[320px_1fr] gap-6 items-start">
            {/* Left: Summary */}
            <div className="bg-white border rounded-[16px]">
              <div className="p-6 text-center">
                <div className="relative w-[120px] h-[120px] mx-auto mb-5 group">
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white font-bold text-[36px] tracking-tight">
                    {initials}
                  </div>
                  <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                </div>
                <div className="text-xl font-bold mb-1">{displayName || profile?.username || "User"}</div>
                <div className="text-sm text-muted-foreground mb-3">{email || "No email set"}</div>
                <div className="flex flex-col items-center gap-2 mb-6">
                  <span className="inline-flex items-center gap-1 bg-primary-100 text-primary px-2.5 py-1 rounded-full text-xs font-medium">Admin</span>
                  <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    Member since Jan 15, 2026
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                    Change Avatar
                  </button>
                  <button onClick={() => setTab("auth")} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-50 rounded-lg transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    Change Password
                  </button>
                </div>
              </div>
            </div>

            {/* Right: Edit Form */}
            <div className="bg-white border rounded-[16px]">
              <div className="p-6">
                <div className="text-lg font-bold mb-6">Edit Profile</div>
                <form onSubmit={handleProfileSave} className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Username</label>
                      <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm bg-[#EEEEE9] text-muted-foreground cursor-not-allowed" value={profile?.username || ""} disabled />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Display Name</label>
                      <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Email</label>
                    <div className="relative">
                      <input type="email" className="w-full px-3.5 py-2.5 pr-10 border rounded-lg text-sm bg-[#EEEEE9] text-muted-foreground cursor-not-allowed" value={email} disabled />
                      <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 block">Email cannot be changed. Contact your administrator if needed.</span>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Bio</label>
                    <textarea className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y min-h-[80px]" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell us about yourself..." />
                  </div>
                  <div className="flex gap-3 mt-2">
                    <button type="submit" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                      Save Changes
                    </button>
                    <button type="button" className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-50 rounded-lg transition-colors">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Auth Settings Tab */}
        {tab === "auth" && (
          <div className="space-y-6">
            {/* Auth Mode Selection */}
            <div className="bg-white border rounded-[16px]">
              <div className="flex items-center justify-between px-6 py-5 border-b">
                <div className="flex items-center gap-2.5">
                  <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                  <h3 className="text-base font-semibold">Authentication Mode</h3>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => setAuthMode("local")} className={`relative border-2 rounded-[16px] p-5 text-left transition-colors cursor-pointer ${authMode === "local" ? "border-primary bg-primary-50" : "border-[#F0F0F0] hover:border-primary-light hover:bg-primary-50"}`}>
                    <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${authMode === "local" ? "bg-primary border-primary" : "border-border"}`}>
                      <svg className={`w-3 h-3 text-white ${authMode === "local" ? "opacity-100" : "opacity-0"} transition-opacity`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <div className="flex items-center gap-3 mb-2.5">
                      <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary flex items-center justify-center">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                      </div>
                      <div className="text-[15px] font-semibold">Local Authentication</div>
                    </div>
                    <div className="text-[13px] text-muted-foreground leading-relaxed">Username and password stored locally. Best for offline deployment.</div>
                  </button>
                  <button onClick={() => setAuthMode("appwrite")} className={`relative border-2 rounded-[16px] p-5 text-left transition-colors cursor-pointer ${authMode === "appwrite" ? "border-primary bg-primary-50" : "border-[#F0F0F0] hover:border-primary-light hover:bg-primary-50"}`}>
                    <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${authMode === "appwrite" ? "bg-primary border-primary" : "border-border"}`}>
                      <svg className={`w-3 h-3 text-white ${authMode === "appwrite" ? "opacity-100" : "opacity-0"} transition-opacity`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <div className="flex items-center gap-3 mb-2.5">
                      <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
                      </div>
                      <div className="text-[15px] font-semibold">Appwrite Cloud Auth</div>
                    </div>
                    <div className="text-[13px] text-muted-foreground leading-relaxed">OAuth, social login, MFA via Appwrite. Best for team collaboration.</div>
                  </button>
                </div>
              </div>
            </div>

            {/* Password Settings (Local mode) */}
            {authMode === "local" && (
              <div className="bg-white border rounded-[16px]">
                <div className="flex items-center justify-between px-6 py-5 border-b">
                  <div className="flex items-center gap-2.5">
                    <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    <h3 className="text-base font-semibold">Password Settings</h3>
                  </div>
                </div>
                <div className="p-6">
                  <form onSubmit={handlePasswordChange} className="space-y-5">
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Current Password</label>
                      <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" required />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">New Password</label>
                      <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" required />
                      {newPassword && (
                        <div className="mt-3">
                          <div className="flex gap-1 mb-1.5">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className={`flex-1 h-1 rounded-full ${i <= strength.score ? strength.color : "bg-[#F0F0F0]"}`} />
                            ))}
                          </div>
                          <span className={`text-xs font-medium ${strength.label === "Weak" ? "text-[#DC2626]" : strength.label === "Medium" ? "text-[#D97706]" : "text-[#16A34A]"}`}>{strength.label}</span>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Confirm Password</label>
                      <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm new password" required />
                    </div>
                    <div className="flex gap-3 mt-2">
                      <button type="submit" className="px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">Update Password</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Appwrite Config */}
            {authMode === "appwrite" && (
              <div className="bg-white border rounded-[16px]">
                <div className="flex items-center justify-between px-6 py-5 border-b">
                  <div className="flex items-center gap-2.5">
                    <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
                    <h3 className="text-base font-semibold">Appwrite Configuration</h3>
                  </div>
                </div>
                <div className="p-6 opacity-50 pointer-events-auto">
                  <div className="space-y-5">
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Appwrite Endpoint</label>
                      <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" defaultValue="https://cloud.appwrite.io/v1" />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Project ID</label>
                      <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter Project ID" />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">API Key</label>
                      <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter API Key" />
                    </div>
                    <div className="flex gap-3">
                      <button type="button" className="flex items-center gap-2 px-5 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                        Test Connection
                      </button>
                      <button type="button" className="px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">Save Configuration</button>
                    </div>
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-white/80 px-4 py-2 rounded-lg text-[13px] text-muted-foreground font-medium">Enable Appwrite Auth to configure</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Storage Settings Tab */}
        {tab === "storage" && (
          <div className="space-y-6">
            {/* Storage Mode */}
            <div className="bg-white border rounded-[16px]">
              <div className="flex items-center justify-between px-6 py-5 border-b">
                <div className="flex items-center gap-2.5">
                  <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                  <h3 className="text-base font-semibold">Document Storage Mode</h3>
                </div>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => setStorageMode("local")} className={`relative border-2 rounded-[16px] p-5 text-left transition-colors cursor-pointer ${storageMode === "local" ? "border-primary bg-primary-50" : "border-[#F0F0F0] hover:border-primary-light hover:bg-primary-50"}`}>
                    <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${storageMode === "local" ? "bg-primary border-primary" : "border-border"}`}>
                      <svg className={`w-3 h-3 text-white ${storageMode === "local" ? "opacity-100" : "opacity-0"} transition-opacity`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <div className="flex items-center gap-3 mb-2.5">
                      <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary flex items-center justify-center">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2" /><line x1="7" y1="2" x2="7" y2="22" /><line x1="17" y1="2" x2="17" y2="22" /><line x1="2" y1="12" x2="22" y2="12" /></svg>
                      </div>
                      <div className="text-[15px] font-semibold">Local Storage</div>
                    </div>
                    <div className="text-[13px] text-muted-foreground leading-relaxed">Store documents on your local file system. Best for offline deployment.</div>
                  </button>
                  <button onClick={() => setStorageMode("s3")} className={`relative border-2 rounded-[16px] p-5 text-left transition-colors cursor-pointer ${storageMode === "s3" ? "border-primary bg-primary-50" : "border-[#F0F0F0] hover:border-primary-light hover:bg-primary-50"}`}>
                    <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${storageMode === "s3" ? "bg-primary border-primary" : "border-border"}`}>
                      <svg className={`w-3 h-3 text-white ${storageMode === "s3" ? "opacity-100" : "opacity-0"} transition-opacity`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <div className="flex items-center gap-3 mb-2.5">
                      <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
                        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
                      </div>
                      <div className="text-[15px] font-semibold">S3 Object Storage</div>
                    </div>
                    <div className="text-[13px] text-muted-foreground leading-relaxed">S3-compatible storage (AWS S3, MinIO). Best for cloud deployment.</div>
                  </button>
                </div>
              </div>
            </div>

            {/* Local Storage Config */}
            {storageMode === "local" && (
              <div className="bg-white border rounded-[16px]">
                <div className="flex items-center justify-between px-6 py-5 border-b">
                  <div className="flex items-center gap-2.5">
                    <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                    <h3 className="text-base font-semibold">Local Storage Path</h3>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Document Root Directory</label>
                    <div className="flex gap-2.5">
                      <input className="flex-1 px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" defaultValue="/Users/kevin/synthetix/documents" />
                      <button type="button" className="flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shrink-0">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                        Browse
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 block">All converted Markdown documents and assets will be stored here.</span>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Cache Directory</label>
                    <div className="flex gap-2.5">
                      <input className="flex-1 px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" defaultValue="/Users/kevin/synthetix/.cache" />
                      <button type="button" className="flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors shrink-0">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>
                        Browse
                      </button>
                    </div>
                    <span className="text-xs text-muted-foreground mt-1 block">Temporary files and processing cache. Can be safely deleted.</span>
                  </div>
                  {/* Storage Usage */}
                  <div className="mt-5 p-4 bg-[#EEEEE9] rounded-[16px]">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-sm font-semibold">Storage Usage</span>
                      <span className="text-[13px] text-muted-foreground">2.4 GB / 50 GB</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#F0F0F0] rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: "4.8%" }} />
                    </div>
                    <div className="flex gap-5 mt-3 text-[13px] text-muted-foreground">
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" /> Documents: 1.8 GB</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-primary-light inline-block" /> Cache: 0.6 GB</span>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-5">
                    <button type="button" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                      Save Storage Settings
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* S3 Config */}
            {storageMode === "s3" && (
              <div className="bg-white border rounded-[16px]">
                <div className="flex items-center justify-between px-6 py-5 border-b">
                  <div className="flex items-center gap-2.5">
                    <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
                    <h3 className="text-base font-semibold">S3 Object Storage Configuration</h3>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">S3 Endpoint</label>
                      <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="https://s3.amazonaws.com" />
                      <span className="text-xs text-muted-foreground mt-1 block">Leave empty for AWS S3 default.</span>
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Region</label>
                      <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" defaultValue="us-east-1" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Bucket Name</label>
                    <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="synthetix-documents" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Access Key ID</label>
                      <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="AKIAIOSFODNN7EXAMPLE" />
                    </div>
                    <div>
                      <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Secret Access Key</label>
                      <input type="password" className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" placeholder="Enter secret access key" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Path Prefix (Optional)</label>
                    <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" defaultValue="documents/" />
                    <span className="text-xs text-muted-foreground mt-1 block">Subdirectory path within the bucket.</span>
                  </div>
                  <div className="flex gap-3 mt-5">
                    <button type="button" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                      Save S3 Settings
                    </button>
                    <button type="button" className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-50 rounded-lg transition-colors">Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Database Settings Tab */}
        {tab === "database" && (
          <div className="space-y-5">
            {/* Current Connection */}
            <div className="bg-white border rounded-[16px]">
              <div className="flex items-center justify-between px-6 py-5 border-b">
                <div className="flex items-center gap-2.5">
                  <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
                  <h3 className="text-base font-semibold">Current Database</h3>
                </div>
              </div>
              <div className="p-6">
                <div className="p-4 bg-primary-50 border border-primary/10 rounded-[16px] flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-primary-100 text-primary flex items-center justify-center shrink-0">
                    <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-semibold">SQLite (Local File)</div>
                    <div className="text-[13px] text-muted-foreground font-mono mt-0.5">file:./dev.db</div>
                    <div className="text-[12px] text-muted-foreground mt-1">
                      Synthetix uses SQLite for local/single-user deployment. To switch to PostgreSQL, update the <code className="bg-base-gray px-1 py-0.5 rounded text-[11px]">DATABASE_URL</code> environment variable and restart the server.
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-[#DCFCE7] text-[#16A34A] rounded-full text-xs font-semibold">
                    <span className="w-2 h-2 rounded-full bg-[#16A34A]" />
                    Active
                  </div>
                </div>
              </div>
            </div>

            {/* Migration History */}
            <div className="bg-white border rounded-[16px]">
              <div className="flex items-center justify-between px-6 py-5 border-b">
                <div className="flex items-center gap-2.5">
                  <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" /><polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" /><line x1="4" y1="4" x2="9" y2="9" /></svg>
                  <h3 className="text-base font-semibold">Database Migration</h3>
                </div>
              </div>
              <div className="p-6">
                <div className="flex gap-3 mb-5">
                  <button type="button" className="flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                    Run Migrations
                  </button>
                  <button type="button" className="flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Export Schema
                  </button>
                </div>
                <div className="text-sm font-semibold mb-3">Migration History</div>
                <MigrationHistory />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
