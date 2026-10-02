import { createClient, type User } from "@supabase/supabase-js";
export type FastAuthUser = User;
export function getBearerToken(req: Request): string {
  return req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
const requests = new WeakMap<Request, Promise<{ data: { user: User | null }; error: Error | null }>>();
/** Request-local deduplication; identity is verified by Supabase Auth, never decoded on trust. */
export function getAuthUserFromRequest(req: Request) {
  let result = requests.get(req);
  if (!result) {
    result = (async () => {
      const token = getBearerToken(req);
      if (!token) return { data: { user: null }, error: new Error("UNAUTHENTICATED") };
      const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.getUser(token);
      return { data: { user: data.user }, error };
    })();
    requests.set(req, result);
  }
  return result;
}
export async function getAuthUserIdFromRequest(req: Request): Promise<string | null> {
  return (await getAuthUserFromRequest(req)).data.user?.id || null;
}
