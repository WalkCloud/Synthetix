"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useLocale } from "@/lib/i18n";
import { useUser } from "@/lib/user-context";

type Tab = "profile" | "auth" | "storage" | "database" | "rag";

export function ProfileTab({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const { t, format } = useLocale();
  const { user, refreshUser } = useUser();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailLocked, setEmailLocked] = useState(true);
  const [bio, setBio] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setEmail(user.email || "");
      setEmailLocked(!!user.email);
      setAvatarUrl(user.avatarUrl);
    }
  }, [user]);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const normalizedEmail = email.trim();
    if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setMessage({ type: "error", text: t.settings.profile.emailInvalid });
      return;
    }
    const res = await fetch("/api/v1/users/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, email: normalizedEmail || null }),
    });
    const data = await res.json();
    if (data.success) {
      setMessage({ type: "success", text: t.settings.profile.profileUpdated });
      if (normalizedEmail) setEmailLocked(true);
      refreshUser();
    } else {
      const errorText = data.code === "invalidInput" && data.error === "emailAlreadyUsed"
        ? t.settings.profile.emailAlreadyUsed
        : data.code === "invalidInput" && data.error === "emailInvalid"
          ? t.settings.profile.emailInvalid
          : data.error || t.settings.profile.updateFailed;
      setMessage({ type: "error", text: errorText });
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setMessage({ type: "error", text: t.settings.profile.passwordsMismatch });
      return;
    }
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
      setMessage({ type: "success", text: t.settings.profile.passwordUpdated });
    } else {
      setMessage({ type: "error", text: data.error || t.settings.profile.updateFailed });
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: t.settings.profile.fileTooLarge });
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      setMessage({ type: "error", text: t.settings.profile.invalidFileType });
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
        setMessage({ type: "success", text: t.settings.profile.avatarUpdated });
        refreshUser();
      } else {
        setMessage({ type: "error", text: data.error || t.settings.profile.avatarFailed });
      }
    } catch {
      setMessage({ type: "error", text: t.settings.profile.avatarFailed });
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
    if (s <= 2) return { score: 2, label: t.settings.profile.passwordStrength.weak, color: "bg-red-500" };
    if (s <= 3) return { score: 3, label: t.settings.profile.passwordStrength.medium, color: "bg-amber-500" };
    return { score: 4, label: t.settings.profile.passwordStrength.strong, color: "bg-emerald-500" };
  }

  const strength = getPasswordStrength(newPassword);
  const initials = displayName ? displayName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : user?.username?.slice(0, 2).toUpperCase() || "U";

  return (
    <>
      {message && (
        <div className={`mb-6 px-4 py-3 rounded-lg text-sm ${message.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {message.text}
        </div>
      )}

      {tab === "profile" && (
        <div className="grid grid-cols-[320px_1fr] gap-6 items-start">
          <div className="bg-card border rounded-[16px]">
            <div className="p-6 text-center">
              <div className="relative w-[120px] h-[120px] mx-auto mb-5 group">
                {avatarUrl ? (
                  <Image src={avatarUrl} alt="Avatar" fill sizes="80px" className="rounded-full object-cover" unoptimized />
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
              <div className="text-xl font-bold mb-1">{displayName || user?.username || t.settings.profile.userFallback}</div>
              <div className="text-sm text-muted-foreground mb-3">{email || t.settings.profile.noEmail}</div>
              <div className="flex flex-col items-center gap-2 mb-6">
                <span className="inline-flex items-center gap-1 bg-primary-100 text-primary px-2.5 py-1 rounded-full text-xs font-medium">{t.settings.profile.admin}</span>
                <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  {t.settings.profile.memberSince} {user?.createdAt ? format.date(user.createdAt) : "-"}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <button onClick={() => fileInputRef.current?.click()} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium hover:bg-secondary/70 transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  {uploadingAvatar ? t.settings.profile.uploading : t.settings.profile.changeAvatar}
                </button>
                <button onClick={() => setTab("auth")} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/70 rounded-lg transition-colors">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                  {t.settings.profile.changePassword}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-card border rounded-[16px]">
            <div className="p-6">
              <div className="text-lg font-bold mb-6">{t.settings.profile.editProfile}</div>
              <form onSubmit={handleProfileSave} className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.settings.profile.username}</label>
                    <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm bg-muted text-muted-foreground cursor-not-allowed" value={user?.username || ""} disabled />
                  </div>
                  <div>
                    <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.settings.profile.displayName}</label>
                    <input className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.settings.profile.email}</label>
                  <div className="relative">
                    <input type="email"
                      disabled={emailLocked}
                      className={`w-full px-3.5 py-2.5 pr-10 border rounded-lg text-sm ${emailLocked ? "bg-muted text-muted-foreground cursor-not-allowed" : "focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"}`}
                      value={email} onChange={(e) => setEmail(e.target.value)} />
                    <button type="button" onClick={() => setEmailLocked(!emailLocked)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      tabIndex={-1}
                      title={emailLocked ? "Click to unlock" : "Click to lock"}>
                      {emailLocked ? (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                          <path d="M7 11V7a5 5 0 0 1 5-5 5 5 0 0 1 5 5" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <span className="text-xs text-muted-foreground mt-1 block">{t.settings.profile.emailUsageHint}</span>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.settings.profile.bio}</label>
                  <textarea className="w-full px-3.5 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y min-h-[80px]" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t.settings.profile.tellUsAboutYourself} />
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="submit" className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                    {t.settings.profile.saveChanges}
                  </button>
                  <button type="button" className="px-5 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/70 rounded-lg transition-colors">{t.common.actions.cancel}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {tab === "auth" && (
        <div className="space-y-6">
          <div className="bg-card border rounded-[16px]">
            <div className="flex items-center justify-between px-6 py-5 border-b">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                <h3 className="text-base font-semibold text-foreground">{t.settings.profile.localAuth}</h3>
              </div>
            </div>
            <div className="p-6">
              <p className="text-[13px] text-muted-foreground">
                {t.settings.profile.localAuthDesc}
              </p>
            </div>
          </div>

          <div className="bg-card border rounded-[16px]">
            <div className="flex items-center justify-between px-6 py-5 border-b">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                <h3 className="text-base font-semibold text-foreground">{t.settings.profile.passwordSettings}</h3>
              </div>
            </div>
            <div className="p-6">
              <form onSubmit={handlePasswordChange} className="space-y-5">
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.settings.profile.currentPassword}</label>
                  <div className="relative">
                    <input type={showCurrentPassword ? "text" : "password"} className="w-full px-3.5 py-2.5 pr-11 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder={t.settings.profile.enterCurrentPassword} required />
                    <button type="button" onClick={() => setShowCurrentPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1} aria-label={showCurrentPassword ? t.common.actions.hide : t.common.actions.view}>
                      {showCurrentPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.settings.profile.newPassword}</label>
                  <div className="relative">
                    <input type={showNewPassword ? "text" : "password"} className="w-full px-3.5 py-2.5 pr-11 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t.settings.profile.enterNewPassword} required />
                    <button type="button" onClick={() => setShowNewPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1} aria-label={showNewPassword ? t.common.actions.hide : t.common.actions.view}>
                      {showNewPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                  {newPassword && (
                    <div className="mt-3">
                      <div className="flex gap-1 mb-1.5">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className={`flex-1 h-1 rounded-full ${i <= strength.score ? strength.color : "bg-muted"}`} />
                        ))}
                      </div>
                      <span className={`text-xs font-medium ${strength.color === "bg-red-500" ? "text-red-600 dark:text-red-400" : strength.color === "bg-amber-500" ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}>{strength.label}</span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-muted-foreground mb-1.5">{t.settings.profile.confirmPassword}</label>
                  <div className="relative">
                    <input type={showConfirmPassword ? "text" : "password"} className="w-full px-3.5 py-2.5 pr-11 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder={t.settings.profile.confirmNewPassword} required />
                    <button type="button" onClick={() => setShowConfirmPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" tabIndex={-1} aria-label={showConfirmPassword ? t.common.actions.hide : t.common.actions.view}>
                      {showConfirmPassword ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px]"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                      )}
                    </button>
                  </div>
                </div>
                <div className="flex gap-3 mt-2">
                  <button type="submit" className="px-5 py-2.5 bg-primary text-white font-semibold rounded-lg hover:bg-primary-light transition-all text-sm">{t.settings.profile.updatePassword}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
