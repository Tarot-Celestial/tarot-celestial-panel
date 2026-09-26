import { NextResponse } from 'next/server';
import { getAdminClient, normalizeMonthKey, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });

    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get('month'));
    const admin = getAdminClient();

    const [financialResult, attendanceResult] = await Promise.all([
      admin
        .from('incidents')
        .select('id, worker_id, month_key, title, amount, reason, kind, status, meta, evidence_note, decided_at, created_at')
        .eq('worker_id', me.id)
        .or('kind.is.null,kind.neq.attendance_info')
        .eq('month_key', month)
        .order('created_at', { ascending: false }),
      admin
        .from('v_attendance_incidents')
        .select('id,worker_id,invoice_month,incident_date,missed_start,missed_end,missed_minutes,recovered_minutes,justified_minutes,pending_minutes,reason_code,reason_detail,notes,status,created_at')
        .eq('worker_id', me.id)
        .eq('invoice_month', month)
        .order('incident_date', { ascending: false }),
    ]);
    if (financialResult.error) throw financialResult.error;
    if (attendanceResult.error) throw attendanceResult.error;

    const attendance = (attendanceResult.data || []).map((item: any) => ({
      id: item.id,
      worker_id: item.worker_id,
      month_key: item.invoice_month,
      title: `Incidencia de jornada · ${item.incident_date}`,
      amount: 0,
      reason: item.reason_code,
      kind: 'attendance_jornada',
      status: item.status,
      evidence_note: item.notes,
      created_at: item.created_at,
      meta: {
        type: 'attendance_jornada',
        incident_date: item.incident_date,
        missed_start: item.missed_start,
        missed_end: item.missed_end,
        missed_minutes: item.missed_minutes,
        recovered_minutes: item.recovered_minutes,
        justified_minutes: item.justified_minutes,
        pending_minutes: item.pending_minutes,
        reason_detail: item.reason_detail,
      },
    }));

    const incidents = [...(financialResult.data || []), ...attendance]
      .sort((a: any, b: any) => Date.parse(String(b.created_at || '')) - Date.parse(String(a.created_at || '')));

    return NextResponse.json({ ok: true, incidents });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
