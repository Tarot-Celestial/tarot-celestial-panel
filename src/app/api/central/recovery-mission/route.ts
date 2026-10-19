import { recoveryIdentity, recoveryJson, recoveryFailure } from '@/lib/server/recovery-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const overview = new URL(req.url).searchParams.get('overview') === '1';
    const { db, uid } = await recoveryIdentity(req, overview);
    const { data, error } = overview
      ? await db.rpc('tc_recovery_mission_overview', { p_user: uid })
      : await db.rpc('tc_recovery_mission_state', { p_user: uid, p_assign: false });
    if (error) throw error;
    return recoveryJson(overview ? { ok: true, missions: data } : { ok: true, mission: data });
  } catch (error) { return recoveryFailure(error); }
}

export async function POST(req: Request) {
  try {
    const { db, uid } = await recoveryIdentity(req);
    const body = await req.json().catch(() => null);
    if (body?.action !== 'prepare') return recoveryJson({ ok: false, error: 'Acción de misión no válida.' }, 400);
    const { data, error } = await db.rpc('tc_recovery_mission_state', { p_user: uid, p_assign: true });
    if (error) throw error;
    return recoveryJson({ ok: true, mission: data });
  } catch (error) { return recoveryFailure(error); }
}
