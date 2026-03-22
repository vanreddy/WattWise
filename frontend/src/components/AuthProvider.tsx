"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { fetchMe, logout as doLogout, type AuthUser } from "@/lib/auth";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => void;
  refreshUser: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  logout: () => {},
  refreshUser: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then((u) => setUser(u))
      .finally(() => setIsLoading(false));
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    doLogout();
  }, []);

  const refreshUser = useCallback(() => {
    fetchMe().then((u) => setUser(u));
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
