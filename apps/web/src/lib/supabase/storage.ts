/**
 * Server-side Supabase client authenticated with the service role key.
 *
 * Used for privileged operations such as uploading export artifacts into
 * private storage buckets. Do not import this from any client code.
 *
 * The `exports` bucket must exist and be private. Create it manually:
 *
 *   supabase storage create-bucket exports --public false
 *
 * (Or via the dashboard: Storage → New bucket → "exports", Private.)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseServiceClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.",
    );
  }
  cached = createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const EXPORTS_BUCKET = "exports";
