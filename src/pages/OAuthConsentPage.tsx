import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AuthPage from "./AuthPage";
import { Button } from "@/components/ui/button";
import type { AuthActionResult } from "@/hooks/useAuth";
import type { User } from "@supabase/supabase-js";

interface OAuthConsentPageProps {
  user: User | null;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<AuthActionResult>;
  signUp: (email: string, password: string, captchaToken?: string) => Promise<AuthActionResult>;
}

type AuthorizationDetails = {
  authorization_id?: string;
  client?: { name?: string; client_name?: string };
  client_name?: string;
  redirect_uri?: string;
  scope?: string;
  scopes?: string[];
  redirect_url?: string;
};

export default function OAuthConsentPage({ user, signIn, signUp }: OAuthConsentPageProps) {
  const authorizationId = useMemo(
    () => new URLSearchParams(window.location.search).get("authorization_id")?.trim() ?? "",
    [],
  );
  const [details, setDetails] = useState<AuthorizationDetails | null>(null);
  const [loading, setLoading] = useState(Boolean(user && authorizationId));
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !authorizationId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (result.error || !result.data) {
        setError("This authorization request is no longer available. Start the connection again.");
        setLoading(false);
        return;
      }
      const next = result.data as AuthorizationDetails;
      if (next.redirect_url && !next.authorization_id) {
        window.location.assign(next.redirect_url);
        return;
      }
      setDetails(next);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [authorizationId, user]);

  if (!user) return <AuthPage signIn={signIn} signUp={signUp} />;

  async function respond(action: "approve" | "deny") {
    if (!authorizationId) return;
    setBusy(action);
    setError(null);
    const result = action === "approve"
      ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
      : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
    if (result.error || !result.data?.redirect_url) {
      setBusy(null);
      setError("Supabase could not complete this authorization. Start the connection again.");
      return;
    }
    window.location.assign(result.data.redirect_url);
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? details?.client_name ?? "ChatGPT";
  const scopes = Array.isArray(details?.scopes)
    ? details.scopes
    : (details?.scope ?? "").split(" ").filter(Boolean);

  return (
    <div className="streex-premium-shell min-h-screen flex items-center justify-center px-5 py-8 sm:px-6">
      <div className="w-full max-w-lg space-y-6 rounded-[1.35rem] border border-white/10 bg-black/25 p-6 text-white shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-md">
        <div className="flex items-start gap-4">
          <div className="rounded-2xl bg-[#E6CE20]/15 p-3 text-[#E6CE20]"><ShieldCheck className="h-6 w-6" /></div>
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-[#E6CE20]">Streex Gig</p>
            <h1 className="text-2xl font-bold">Authorize read-only access</h1>
            <p className="text-sm leading-relaxed text-white/70">Review what this connection can read before continuing.</p>
          </div>
        </div>
        {!authorizationId && <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/75">No active authorization request was provided.</p>}
        {loading && <p className="flex items-center gap-2 text-sm text-white/70"><Loader2 className="h-4 w-4 animate-spin" /> Loading authorization details…</p>}
        {error && <p className="rounded-xl border border-red-300/25 bg-red-400/10 p-4 text-sm text-red-100">{error}</p>}
        {details && !loading && (
          <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div><p className="text-xs uppercase tracking-[0.18em] text-white/50">Application</p><p className="mt-1 text-lg font-semibold">{clientName}</p></div>
            {details.redirect_uri && <div className="flex items-start gap-2 text-sm text-white/70"><ExternalLink className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-all">{details.redirect_uri}</span></div>}
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-white/50">This connection can read</p>
              <ul className="mt-2 space-y-1 text-sm text-white/80">{(scopes.length ? scopes : ["Your read-only daily operations summary"]).map((scope) => <li key={scope}>• {scope}</li>)}</ul>
            </div>
            <p className="text-xs leading-relaxed text-white/50">It cannot change your data, access another account, or read credentials, routes, addresses, or coordinates.</p>
          </div>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" disabled={Boolean(busy) || !authorizationId} onClick={() => void respond("deny")} className="border-white/15 bg-white/5 text-white hover:bg-white/10"><X className="mr-2 h-4 w-4" /> Deny</Button>
          <Button type="button" disabled={Boolean(busy) || !details} onClick={() => void respond("approve")} className="bg-[#E6CE20] text-black hover:bg-[#f3dc27]"><Check className="mr-2 h-4 w-4" /> {busy === "approve" ? "Authorizing…" : "Allow read-only access"}</Button>
        </div>
      </div>
    </div>
  );
}
