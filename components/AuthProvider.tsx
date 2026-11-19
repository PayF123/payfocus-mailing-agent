"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase-browser";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  getGoogleTokens: () => { accessToken: string | null; refreshToken: string | null };
  signInWithGoogle: () => Promise<{ error: Error | null }>;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  getGoogleTokens: () => ({ accessToken: null, refreshToken: null }),
  signInWithGoogle: async () => ({ error: null }),
  signInWithEmail: async () => ({ error: null }),
  signUpWithEmail: async () => ({ error: null }),
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const persistProviderTokens = (sess: Session | null) => {
    if (!sess?.user?.email || typeof window === "undefined") return;
    const emailKey = sess.user.email.toLowerCase();
    if (sess.provider_token) {
      localStorage.setItem(`payfocus_gtoken_${emailKey}`, sess.provider_token);
    }
    if (sess.provider_refresh_token) {
      localStorage.setItem(`payfocus_grtoken_${emailKey}`, sess.provider_refresh_token);
    }
  };

  useEffect(() => {
    const supabase = getBrowserSupabase();

    // 1. Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      persistProviderTokens(session);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    }).catch((err) => {
      console.warn("Error fetching Supabase session:", err);
      setLoading(false);
    });

    // 2. Listen to auth state transitions
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      persistProviderTokens(session);
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const getGoogleTokens = () => {
    if (!user?.email || typeof window === "undefined") {
      return { accessToken: session?.provider_token ?? null, refreshToken: session?.provider_refresh_token ?? null };
    }
    const emailKey = user.email.toLowerCase();
    return {
      accessToken: session?.provider_token || localStorage.getItem(`payfocus_gtoken_${emailKey}`),
      refreshToken: session?.provider_refresh_token || localStorage.getItem(`payfocus_grtoken_${emailKey}`),
    };
  };

  const signInWithGoogle = async () => {
    try {
      const supabase = getBrowserSupabase();
      const redirectUrl = typeof window !== "undefined"
        ? `${window.location.origin}/auth/callback`
        : "/auth/callback";

      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: redirectUrl,
          queryParams: {
            access_type: "offline",
            prompt: "select_account consent",
          },
          scopes: "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send email profile",
        },
      });

      return { error: error as Error | null };
    } catch (err: any) {
      return { error: err };
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    try {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      return { error: error as Error | null };
    } catch (err: any) {
      return { error: err };
    }
  };

  const signUpWithEmail = async (email: string, password: string) => {
    try {
      const supabase = getBrowserSupabase();
      const { error } = await supabase.auth.signUp({
        email,
        password,
      });
      return { error: error as Error | null };
    } catch (err: any) {
      return { error: err };
    }
  };

  const signOut = async () => {
    try {
      const supabase = getBrowserSupabase();
      await supabase.auth.signOut({ scope: "local" });
      if (typeof window !== "undefined") {
        Object.keys(localStorage)
          .filter((k) => k.startsWith("sb-"))
          .forEach((k) => localStorage.removeItem(k));
        sessionStorage.clear();
      }
      setUser(null);
      setSession(null);
    } catch (err) {
      console.error("Sign out error:", err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        getGoogleTokens,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

