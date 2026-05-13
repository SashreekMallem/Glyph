/**
 * OAuth 2.1 authorization endpoint.
 *
 * GET  — validates the auth request, then redirects the user through
 *        sign-in if needed and finally to the consent page.
 * POST — the consent page submits here ("Allow" or "Deny"). On Allow we
 *        mint a short-lived authorization code bound to the user, client,
 *        redirect_uri, and PKCE challenge, then 302 back to the client's
 *        redirect_uri with `?code=...&state=...`.
 *
 * PKCE is required (no `code_verifier` flow without it).
 */

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { oauthClients, oauthCodes } from "@/db/schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CODE_TTL_MS = 10 * 60 * 1000;

function redirectError(
  redirectUri: string,
  error: string,
  description: string,
  state?: string,
) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  return NextResponse.redirect(u, 302);
}

interface ParsedRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  state?: string;
  scope?: string;
}

async function parseAndValidate(
  params: URLSearchParams,
): Promise<{ ok: true; req: ParsedRequest } | { ok: false; res: NextResponse }> {
  const responseType = params.get("response_type");
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method") ?? "S256";
  const state = params.get("state") ?? undefined;
  const scope = params.get("scope") ?? undefined;

  if (responseType !== "code") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "unsupported_response_type" },
        { status: 400 },
      ),
    };
  }
  if (!clientId || !redirectUri || !codeChallenge) {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "invalid_request", error_description: "Missing required parameters" },
        { status: 400 },
      ),
    };
  }
  if (codeChallengeMethod !== "S256") {
    return {
      ok: false,
      res: NextResponse.json(
        { error: "invalid_request", error_description: "Only S256 is supported" },
        { status: 400 },
      ),
    };
  }

  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);

  if (!client) {
    return {
      ok: false,
      res: NextResponse.json({ error: "unauthorized_client" }, { status: 400 }),
    };
  }
  if (!client.redirectUris.includes(redirectUri)) {
    return {
      ok: false,
      res: NextResponse.json(
        {
          error: "invalid_redirect_uri",
          error_description: "redirect_uri not registered for this client",
        },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    req: { clientId, redirectUri, codeChallenge, codeChallengeMethod, state, scope },
  };
}

function consentPage(req: ParsedRequest, clientName: string, csrf: string) {
  const params = new URLSearchParams({
    client_id: req.clientId,
    redirect_uri: req.redirectUri,
    code_challenge: req.codeChallenge,
    code_challenge_method: req.codeChallengeMethod,
    csrf,
  });
  if (req.state) params.set("state", req.state);
  if (req.scope) params.set("scope", req.scope);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Authorize ${escapeHtml(clientName)} · Glyph</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #fafafa; color: #111; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
  .card { background: white; border-radius: 16px; padding: 2.5rem; max-width: 440px; width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.04); }
  h1 { margin: 0 0 .5rem; font-size: 1.5rem; font-weight: 600; letter-spacing: -0.01em; }
  .sub { color: #666; font-size: .95rem; margin: 0 0 1.5rem; line-height: 1.5; }
  .perm { background: #f6f6f6; border-radius: 10px; padding: 1rem 1.25rem; font-size: .9rem; color: #333; margin-bottom: 1.5rem; }
  .perm strong { color: #111; }
  .perm ul { margin: .5rem 0 0; padding-left: 1.25rem; line-height: 1.6; }
  .row { display: flex; gap: .75rem; }
  button { flex: 1; padding: .75rem 1rem; border-radius: 10px; font-size: .95rem; font-weight: 500; cursor: pointer; border: none; font-family: inherit; }
  .deny { background: #f0f0f0; color: #444; }
  .deny:hover { background: #e6e6e6; }
  .allow { background: #111; color: white; }
  .allow:hover { background: #000; }
  .logo { width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #111, #444); margin-bottom: 1rem; }
</style>
</head>
<body>
  <div class="card">
    <div class="logo"></div>
    <h1>Authorize ${escapeHtml(clientName)}</h1>
    <p class="sub"><strong>${escapeHtml(clientName)}</strong> wants to connect to your Glyph account.</p>
    <div class="perm">
      <strong>This will let it:</strong>
      <ul>
        <li>Generate signed documents on your behalf</li>
        <li>Read signed Glyph documents you receive</li>
        <li>Discover and propose schema blocks</li>
      </ul>
    </div>
    <form method="POST" action="/api/mcp/oauth/authorize" class="row">
      ${[...params.entries()].map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`).join("")}
      <button class="deny" name="decision" value="deny" type="submit">Deny</button>
      <button class="allow" name="decision" value="allow" type="submit">Allow</button>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const parsed = await parseAndValidate(url.searchParams);
  if (!parsed.ok) return parsed.res;

  // Require a signed-in Glyph user. Bounce through /sign-in if missing.
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    const next = `/api/mcp/oauth/authorize?${url.searchParams.toString()}`;
    const signIn = new URL("/sign-in", url.origin);
    signIn.searchParams.set("next", next);
    return NextResponse.redirect(signIn, 302);
  }

  const [client] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, parsed.req.clientId))
    .limit(1);

  // CSRF token tied to the user's session. Verified on POST.
  const csrf = randomBytes(16).toString("hex");
  const html = consentPage(parsed.req, client?.clientName ?? "MCP Client", csrf);

  const res = new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
  res.cookies.set("glyph_oauth_csrf", csrf, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 600,
    path: "/api/mcp/oauth",
  });
  return res;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const form = await req.formData();
  const decision = form.get("decision");
  const submittedCsrf = form.get("csrf");
  const cookieCsrf = req.cookies.get("glyph_oauth_csrf")?.value;

  if (!submittedCsrf || !cookieCsrf || submittedCsrf !== cookieCsrf) {
    return NextResponse.json({ error: "invalid_request", error_description: "CSRF" }, { status: 403 });
  }

  const params = new URLSearchParams();
  for (const [k, v] of form.entries()) {
    if (typeof v === "string" && k !== "decision" && k !== "csrf") params.set(k, v);
  }
  const parsed = await parseAndValidate(params);
  if (!parsed.ok) return parsed.res;

  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) {
    return NextResponse.json({ error: "access_denied" }, { status: 401 });
  }

  if (decision !== "allow") {
    return redirectError(
      parsed.req.redirectUri,
      "access_denied",
      "User denied the request",
      parsed.req.state,
    );
  }

  const code = randomBytes(32).toString("hex");
  await db.insert(oauthCodes).values({
    code,
    clientId: parsed.req.clientId,
    userId: userData.user.id,
    redirectUri: parsed.req.redirectUri,
    codeChallenge: parsed.req.codeChallenge,
    codeChallengeMethod: parsed.req.codeChallengeMethod,
    scope: parsed.req.scope ?? null,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  const u = new URL(parsed.req.redirectUri);
  u.searchParams.set("code", code);
  if (parsed.req.state) u.searchParams.set("state", parsed.req.state);
  return NextResponse.redirect(u, 302);
}
