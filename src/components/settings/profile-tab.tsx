"use client";

import { useState, useEffect, useRef } from "react";
import { CardSelector } from "@/components/shared/card-selector";

interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  avatarUrl?: string | null;
  role?: string;
  createdAt?: string;
}

type Tab = "profile" | "auth" | "storage" | "database" | "rag";
type AuthMode = "local" | "appwrite";

export function ProfileTab({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("local");

  useEffect(() => {
    fetch("/api/v1/users/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setProfile(data.data);
          setDisplayName(data.data.displayName);
          setEmail(data.data.email || "");
          setAvatarUrl(data.data.avatarUrl || null);
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

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: "File too large. Maximum size is 5MB." });
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setMessage({ type: "error", text: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF." });
      return;
    }

    setUploadingAvatar(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("avatar", file);

      const res = await fetch("/api/v1/users/avatar", {
        method: "PUT",
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        setAvatarUrl(data.data.avatarUrl);
        setMessage({ type: "success", text: "Avatar updated successfully." });
      } else {
        setMessage({ type: "error", text: data.error || "Upload failed." });
      }
    } catch {
      setMessage({ type: "error", text: "Failed to upload avatar." });
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
    <>
      {message && (
        <div className={`mb-6 px-4 py-3 rounded-lg text-sm ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {message.text}
        </div>
      )}

      {tab === "profile" && (
        <div className="grid grid-cols-[320px_1fr] gap-6 items-start">
          <div className="bg-white border rounded-[16px]">
            <div className="p-6 text-center">
              <div className="relative w-[120px] h-[120px] mx-auto mb-5 group">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Avatar" className="w-full h-full rounded-full object-cover" />
                ) : (
                  <div className="w-full h-full rounded-full bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center text-white font-bold text-[36px] tracking-tight">
                    {initials}
                  </div>
                )}
                <div
                  className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingAvatar ? (
                    <svg className="w-6 h-6 text-white animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8" />
                    </svg>
                  ) : (
                    <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
                    </svg>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatarUpload} />
              </div>
              <div className="text-xl font-bold mb-1">{displayName || profile?.username || "User"}</div>
              <div className="text-sm text-muted-foreground mb-3">{email || "No email set"}</div>
              <div className="flex flex-col items-center gap-2 mb-6">
                <span className="inline-flex items-center gap-1 bg-primary-100 text-primary px-2.5 py-1 rounded-full text-xs font-medium">Admin</span>
                <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Member since {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  {uploadingAvatar ? "Uploading..." : "Change Avatar"}
                </button>
                <button onClick={() => setTab("auth")} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-gray-50 rounded-lg transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  Change Password
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white border rounded-[16px]">
            <div className="p-6">
              <div className="text-lg font-bold mb-6">Edit Profile</div>
              <form onSubmit={handleProfileSave} className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Username</label>
                    <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm bg-[#F4F2EF] text-muted-foreground cursor-not-allowed" value={profile?.username || ""} disabled />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Display Name</label>
                    <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">Email</label>
                  <div className="relative">
                    <input type="email" className="w-full px-3.5 py-2.5 pr-10 border rounded-lg text-sm bg-[#F4F2EF] text-muted-foreground cursor-not-allowed" value={email} disabled />
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

      {tab === "auth" && (
        <div className="space-y-6">
          <div className="bg-white border rounded-[16px]">
            <div className="flex items-center justify-between px-6 py-5 border-b">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                <h3 className="text-base font-semibold">Authentication Mode</h3>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4">
                <CardSelector
                  selected={authMode === "local"}
                  onSelect={() => setAuthMode("local")}
                  icon={<div className="w-10 h-10 rounded-lg bg-primary-100 text-primary flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg></div>}
                  title="Local Authentication"
                  description="Username and password stored locally. Best for offline deployment."
                />
                <CardSelector
                  selected={authMode === "appwrite"}
                  onSelect={() => setAuthMode("appwrite")}
                  icon={<div className="w-10 h-10 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center"><svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg></div>}
                  title="Appwrite Cloud Auth"
                  description="OAuth, social login, MFA via Appwrite. Best for team collaboration."
                />
              </div>
            </div>
          </div>

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
                            <div key={i} className={`flex-1 h-1 rounded-full ${i <= strength.score ? strength.color : "bg-[#F4F2EF]"}`} />
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

          {authMode === "appwrite" && (
            <div className="bg-white border rounded-[16px]">
              <div className="flex items-center justify-between px-6 py-5 border-b">
                <div className="flex items-center gap-2.5">
                  <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" /></svg>
                  <h3 className="text-base font-semibold">Appwrite Configuration</h3>
                </div>
              </div>
              <div className="p-6">
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
                    <button type="button" className="flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                      Test Connection
                    </button>
                    <button type="button" className="px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">Save Configuration</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
