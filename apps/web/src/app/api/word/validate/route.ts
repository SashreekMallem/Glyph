import { type NextRequest } from "next/server";

import {
  jsonWithCors,
  parseBody,
  preflight,
  requireUser,
  runValidation,
} from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (auth instanceof Response) return auth;

  const body = await parseBody(req);
  if (body instanceof Response) return body;

  const outcome = runValidation(body);
  return jsonWithCors(req, {
    extracted: outcome.extracted,
    errors: outcome.errors,
    valid: outcome.valid,
  });
}
