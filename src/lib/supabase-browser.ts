import { createClient } from "@supabase/supabase-js";

let client: ReturnType<typeof createClient> | null = null;

export function supabaseBrowser() {
  if (client) return client;

  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // ✅ Mantén refresh y persistencia
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // ❌ NO storageKey personalizado
      },
    }
  );

  return client;
}
