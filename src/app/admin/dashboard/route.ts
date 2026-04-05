import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/server/auth-worker';
import { summarizeRendimientoRows } from '@/lib/server/rendimiento-metrics';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const admin = getAdminClient();
    const month = new Date().toISOString().slice(0, 7);
    const start = `${month}-01`;
    const [year, mm] = month.split('-').map(Number);
    const endExclusive = new Date(Date.UTC(year, mm, 1)).toISOString().slice(0, 10);

    const [{ count: clientes }, { count: workers }, rendimientoRes] = await Promise.all([
      admin.from('crm_clientes').select('*', { count: 'exact', head: true }),
      admin.from('workers').select('*', { count: 'exact', head: true }),
      admin.from('rendimiento_llamadas').select('*').gte('fecha', start).lt('fecha', endExclusive),
    ]);

    if (rendimientoRes.error) throw rendimientoRes.error;
    const resumen = summarizeRendimientoRows((rendimientoRes.data || []) as any[]);

    return NextResponse.json({ ok: true, total: resumen.total_importe, clientes, reservas: resumen.total, tarotistas: workers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
