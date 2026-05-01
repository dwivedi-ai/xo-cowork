"use client";

import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import { API } from "@/lib/constants";

function CallbackHandler() {
  const params = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const code = params.get("code");
    const state = params.get("state");
    const error = params.get("error");
    const errorDescription = params.get("error_description");

    const notify = (msg: Record<string, unknown>) => {
      if (window.opener) {
        window.opener.postMessage(msg, window.location.origin);
      }
    };

    if (error || !code || !state) {
      notify({
        type: "vercel_oauth_error",
        error: errorDescription || error || "Missing authorization code or state.",
      });
      window.close();
      return;
    }

    api
      .post(API.VERCEL.OAUTH_EXCHANGE, { code, state })
      .then(() => {
        notify({ type: "vercel_oauth_success" });
        window.close();
      })
      .catch((err: unknown) => {
        notify({
          type: "vercel_oauth_error",
          error: err instanceof Error ? err.message : "Token exchange failed.",
        });
        window.close();
      });
  }, [params]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] p-6">
      <div className="flex flex-col items-center gap-4 text-center max-w-xs">
        <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-white/60" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-white">Completing authorization…</p>
          <p className="text-xs text-white/50">This window will close automatically.</p>
        </div>
      </div>
    </div>
  );
}

export default function VercelCallbackPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="h-6 w-6 animate-spin text-white/60" />
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
