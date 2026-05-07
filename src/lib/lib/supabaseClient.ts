import { createClient } from "@supabase/supabase-js";
import { supabaseBrowser } from "@/lib/supabase-browser";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

// En navegador usamos el singleton real para evitar múltiples GoTrueClient.
// En rutas API/servidor no persistimos sesión ni refrescamos token.
export const supabase =
  typeof window !== "undefined"
    ? supabaseBrowser()
    : createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
