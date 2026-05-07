// src/lib/supabase-browser.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line no-var
  var __tcSupabaseBrowserClient: SupabaseClient | undefined;
}

let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (client) return client;
  if (globalThis.__tcSupabaseBrowserClient) {
    client = globalThis.__tcSupabaseBrowserClient;
    return client;
  }

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

  // Evita llamadas repetidas a /auth/v1/user desde el navegador.
  // Para el panel basta la sesión local; las APIs siguen validando roles con service role.
  const originalGetUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = (async (jwt?: string) => {
    if (jwt) return originalGetUser(jwt);
    const { data, error } = await client!.auth.getSession();
    return { data: { user: data.session?.user ?? null }, error } as any;
  }) as any;

  globalThis.__tcSupabaseBrowserClient = client;
  return client;
}
