"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getBrowserSupabase } from "@/lib/supabase-browser";
import { Loader2, CheckCircle2 } from "lucide-react";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"processing" | "success" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabase();

    // Parse provider_token & provider_refresh_token directly from URL hash if present
    let hashProviderToken: string | null = null;
    let hashProviderRefreshToken: string | null = null;
    if (typeof window !== "undefined" && window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.substring(1));
      hashProviderToken = hashParams.get("provider_token");
      hashProviderRefreshToken = hashParams.get("provider_refresh_token");
    }

    const saveTokensForSession = (session: any) => {
      if (!session?.user?.email || typeof window === "undefined") return;
      const emailKey = session.user.email.toLowerCase();
      const pToken = session.provider_token || hashProviderToken;
      const pRefresh = session.provider_refresh_token || hashProviderRefreshToken;
      if (pToken) localStorage.setItem(`payfocus_gtoken_${emailKey}`, pToken);
      if (pRefresh) localStorage.setItem(`payfocus_grtoken_${emailKey}`, pRefresh);
    };

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
        setStatus("error");
        setErrorMessage(error.message);
        return;
      }

      if (session) {
        saveTokensForSession(session);
        setStatus("success");
        setTimeout(() => {
          router.replace("/");
        }, 900);
      } else {
        setTimeout(() => {
          supabase.auth.getSession().then(({ data: { session } }) => {
            if (session) {
              saveTokensForSession(session);
              setStatus("success");
              setTimeout(() => router.replace("/"), 900);
            } else {
              router.replace("/");
            }
          });
        }, 1200);
      }
    });
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#f6f7f9] px-4 text-slate-800">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-7 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white font-semibold text-xs">
          PF
        </div>

        {status === "processing" && (
          <>
            <h2 className="text-base font-semibold text-slate-900 mb-1">Connecting account...</h2>
            <p className="text-xs text-slate-500 mb-5">
              Completing sign-in and syncing your mailbox access.
            </p>
            <div className="flex items-center justify-center gap-2 text-slate-600 text-xs font-medium">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Please wait...</span>
            </div>
          </>
        )}

        {status === "success" && (
          <>
            <h2 className="text-base font-semibold text-emerald-700 mb-1">Account connected</h2>
            <p className="text-xs text-slate-500 mb-4">
              Opening your mail workspace...
            </p>
            <div className="flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <h2 className="text-base font-semibold text-rose-700 mb-1">Sign-in error</h2>
            <p className="text-xs text-slate-500 mb-5">
              {errorMessage || "Unable to complete sign-in."}
            </p>
            <button
              onClick={() => router.push("/login")}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition"
            >
              Return to sign in
            </button>
          </>
        )}
      </div>
    </div>
  );
}
