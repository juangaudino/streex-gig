// Read-only MCP bridge for Streex Gig.
//
// OAuth discovery/protected-resource metadata is handled by Supabase's
// middleware. The inner withSupabase user gate still requires a valid
// Supabase Auth access token and keeps all data access owner-scoped.

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { z } from "npm:zod@4.1.13";
import {
  withOAuthProtectedResource,
  withSupabase,
} from "npm:@supabase/server@1.6.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_PUBLISHABLE_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY")!;
const DAILY_OPS_URL = `${SUPABASE_URL}/functions/v1/daily-ops-summary`;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must use YYYY-MM-DD");

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function readDailySummary(date: string, authHeader: string) {
  const response = await fetch(`${DAILY_OPS_URL}?date=${encodeURIComponent(date)}`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      apikey: SUPABASE_PUBLISHABLE_KEY,
    },
  });

  if (!response.ok) {
    // Do not forward upstream diagnostics or any response that could contain
    // implementation details. The caller only needs a generic tool error.
    throw new Error("Daily operations summary unavailable");
  }

  const body = await response.json() as Record<string, unknown>;
  return body;
}

async function handleMcpRequest(req: Request) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const server = new McpServer({
    name: "streex-gig-read-only",
    version: "1.0.0",
  });

  server.registerTool(
    "get_daily_ops_summary",
    {
      title: "Get daily operations summary",
      description:
        "Read the authenticated Streex Gig owner's aggregate operations for one calendar date. No writes, routes, addresses, coordinates, IDs, or raw provider data.",
      inputSchema: {
        date: dateSchema,
      },
    },
    async ({ date }) => {
      if (!isValidDate(date)) {
        return {
          isError: true,
          content: [{ type: "text", text: "date must be a valid YYYY-MM-DD value." }],
        };
      }

      try {
        const summary = await readDailySummary(date, authHeader);
        return {
          content: [{ type: "text", text: JSON.stringify(summary) }],
        };
      } catch {
        return {
          isError: true,
          content: [{ type: "text", text: "Daily operations summary unavailable." }],
        };
      }
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

// OAuth metadata and the protected-resource challenge must be able to reach
// this handler before a bearer token exists. The inner auth wrapper rejects
// all actual MCP tool calls without a valid user JWT.
Deno.serve(
  withOAuthProtectedResource(
    withSupabase({ auth: "user" }, handleMcpRequest),
  ),
);
