import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { login as loginApi } from "@/lib/api";

export interface User {
  id: string;
  username: string;
  role: string;
  name: string;
  permissions?: string[];
}

const STORAGE_KEY = "retail_pos_user";

function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setStoredUser(user: User | null) {
  if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  else localStorage.removeItem(STORAGE_KEY);
}

interface AuthContextValue {
  user: User | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser);

  useEffect(() => {
    setStoredUser(user);
  }, [user]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const data = await loginApi(username, password);
      setUser({
        id: data.id,
        username: data.username,
        role: data.role,
        name: data.name,
        permissions: data.permissions,
      });
      return true;
    } catch {
      return false;
    }
  }, []);

  const logout = useCallback(() => setUser(null), []);

  const value: AuthContextValue = {
    user,
    login,
    logout,
    isAdmin: user?.role === "admin",
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
