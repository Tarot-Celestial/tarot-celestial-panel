// src/lib/supabase-browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_URL");
  if (!anon) throw new Error("Missing env NEXT_PUBLIC_SUPABASE_ANON_KEY");

  client = createClient(url, anon, {
    auth: {
      // ✅ Mantén refresh y persistencia
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,

      // ✅ Recomendado en SPA / Next.js client
      flowType: "pkce",

      // ❌ NO storageKey personalizado (ok como lo tenías)
    },
  });

  return client;
}
