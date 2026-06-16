"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  createdAt: string;
}

interface UserContextValue {
  user: UserProfile | null;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/users/profile");
      const data = await res.json();
      if (data.success) {
        setUser(data.data);
      }
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  return (
    <UserContext.Provider value={{ user, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return ctx;
}
