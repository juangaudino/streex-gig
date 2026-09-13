# Streex Gig read-only MCP over Supabase OAuth

This branch contains a deliberately narrow MCP bridge for ChatGPT/Sofi. It
exposes one tool, `get_daily_ops_summary`, backed by the existing deterministic
`daily-ops-summary` Edge Function. It does not call OpenAI, write data, expose
coordinates/routes/addresses, or deploy `ask-my-data`.

## Endpoint and contract

After deployment, the MCP endpoint is:

```text
https://ywbrovislvqkfzsyqpiv.supabase.co/functions/v1/mcp
```

The tool accepts one argument, `{ "date": "YYYY-MM-DD" }`, and returns the
same owner-scoped aggregate response documented in
[`DAILY_OPS_SUMMARY.md`](DAILY_OPS_SUMMARY.md). The MCP server returns only the
JSON summary as tool text; bearer tokens remain in the authenticated request
and are never returned to the model or logged.

## Supabase Dashboard setup (one time)

In the active project `ywbrovislvqkfzsyqpiv`:

1. Open **Authentication → OAuth Server** and enable the OAuth 2.1 server.
2. Keep the Site URL on the production app (`https://gig.getstreex.com`) and
   set the Authorization Path to `/oauth/consent`.
3. Enable dynamic client registration if the MCP connector will register its
   own OAuth client. Otherwise create a dedicated OAuth App and enter the
   connector's exact callback URL; never guess or reuse a callback from a
   different environment.
4. Review the requested scopes and keep the grant limited to the authenticated
   user. The access token is a normal Supabase Auth JWT, so existing RLS still
   applies.
5. Use an asymmetric signing key (RS256 or ES256) if the connector requests
   OIDC identity tokens or validates the project JWKS directly.

The consent page is implemented at `/oauth/consent` in this branch. It shows
the requesting client and scopes, requires the owner to be signed in, and
offers explicit Allow/Deny actions. It must be available at the configured
Site URL before an external connector can complete its first authorization.

## Deployment from the isolated branch

Deploy only these two functions from this branch, after OAuth Server is
enabled:

```bash
supabase functions deploy daily-ops-summary \
  --project-ref ywbrovislvqkfzsyqpiv --use-api
supabase functions deploy mcp \
  --project-ref ywbrovislvqkfzsyqpiv --use-api
```

Do not pass `--no-verify-jwt` to `daily-ops-summary`. The MCP function has
`verify_jwt = false` only so its OAuth protected-resource metadata and 401
challenge can be served; `withSupabase({ auth: "user" })` still rejects every
tool request without a valid user token. No service-role secret is required.

The frontend consent route and the MCP function are intentionally separate
from the normal product release. If the branch remains isolated, publish the
small consent-route change to the production app (or host an equivalent
consent page at the configured Site URL) before connecting ChatGPT. Do not
replace the production app with a preview deployment just to expose this
route.

## Discovery and security URLs

Supabase's OAuth authorization-server discovery URL is:

```text
https://ywbrovislvqkfzsyqpiv.supabase.co/.well-known/oauth-authorization-server/auth/v1
```

The protected-resource metadata is served alongside the MCP function by the
Supabase middleware at the function's `oauth-protected-resource` metadata path.
The connector should use discovery rather than hard-coded token endpoints.

## Verification checklist

- Authenticate through the consent page and approve the connector.
- Call `get_daily_ops_summary` for a populated date and compare with Gig.
- Call it for an empty date and confirm zero/null fields.
- Confirm missing/invalid bearer tokens receive 401 and invalid dates receive a
  deterministic validation error.
- Confirm only the authenticated owner's rows are visible under RLS.
- Revoke the OAuth grant in Supabase Auth and confirm subsequent calls fail.

Local source validation cannot prove remote OAuth configuration or authenticated
production behavior. Those require the Dashboard settings, deployment, and a
real connector authorization flow.
