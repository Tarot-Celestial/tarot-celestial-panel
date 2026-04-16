import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function getAdminClient(): SupabaseClient {
  return createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export async function authFromBearer(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { uid: null as string | null, email: null as string | null };

  const userClient = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data, error } = await userClient.auth.getUser();
  if (error) throw error;
  return {
    uid: data.user?.id || null,
    email: data.user?.email || null,
  };
}

export async function workerFromRequest(req: Request) {
  const { uid, email } = await authFromBearer(req);
  if (!uid && !email) return null;

  const admin = getAdminClient();
  let me: any = null;

  if (uid) {
    const byUid = await admin
      .from('workers')
      .select('id, user_id, role, display_name, email, team, is_active')
      .eq('user_id', uid)
      .maybeSingle();
    if (byUid.error) throw byUid.error;
    me = byUid.data;
  }

  if (!me && email) {
    const byEmail = await admin
      .from('workers')
      .select('id, user_id, role, display_name, email, team, is_active')
      .eq('email', email)
      .maybeSingle();
    if (byEmail.error) throw byEmail.error;
    me = byEmail.data;
  }

  if (!me) return null;
  return { ...me, resolved_uid: uid || null, resolved_email: email || null };
}

export function normalizeMonthKey(raw: any) {
  const value = String(raw || '').trim();
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('INVALID_MONTH_KEY');
  return value;
}

export function monthRange(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  const start = `${monthKey}-01`;
  const endExclusive = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  return { start, endExclusive };
}

export function roundMoney(n: any) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function normalizeText(val: unknown): string {
  return String(val || '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function toNumber(val: unknown): number {
  if (val == null) return 0;
  return Number(String(val).replace('€', '').replace(',', '.').trim()) || 0;
}

export function isSpecialCallName(val: unknown): boolean {
  return /^call\d+/i.test(String(val || '').trim()) || String(val || '').trim().toLowerCase() === 'call';
}

export function rateForCode(rawCode: unknown, specialCall = false): number {
  if (specialCall) return 0.12;
  const code = normalizeText(rawCode);
  if (code === 'free' || code === '7free') return 0.04;
  if (code === 'rueda') return 0.08;
  if (code === 'cliente') return 0.10;
  if (code === 'repite') return 0.12;
  return 0;
}

export function captadasTier(captadas: number) {
  if (captadas >= 30) return 2;
  if (captadas >= 20) return 1.5;
  if (captadas >= 10) return 1;
  return 0.5;
}
