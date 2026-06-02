import { NextResponse } from 'next/server';
import { getAdminClient, normalizeText, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function cleanDate(value: string | null) {
  const raw = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

export async function GET(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (!['admin', 'central'].includes(String(me.role || ''))) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(req.url);
    const from = cleanDate(url.searchParams.get('from'));
    const to = cleanDate(url.searchParams.get('to'));
    const tarotista = normalizeText(url.searchParams.get('tarotista'));
    const telefonista = normalizeText(url.searchParams.get('telefonista'));
    const codigo = normalizeText(url.searchParams.get('codigo'));
    const limitParam = Math.min(Math.max(Number(url.searchParams.get('limit') || 10000) || 10000, 1), 50000);

    const admin = getAdminClient();
    const pageSize = 1000;
    const allRows: any[] = [];

    for (let offset = 0; offset < limitParam; offset += pageSize) {
      let query = admin
        .from('rendimiento_llamadas')
        .select('*')
        .order('fecha_hora', { ascending: false });

      if (from) query = query.gte('fecha_hora', `${from}T00:00:00.000Z`);
      if (to) query = query.lt('fecha_hora', `${addDays(to, 1)}T00:00:00.000Z`);

      const { data, error } = await query.range(offset, Math.min(offset + pageSize - 1, limitParam - 1));
      if (error) throw error;
      const chunk = data || [];
      allRows.push(...chunk);
      if (chunk.length < pageSize) break;
    }

    const filtered = allRows.filter((row: any) => {
      const tarotistaText = normalizeText([row.tarotista_nombre, row.tarotista_manual_call].filter(Boolean).join(' '));
      const telefonistaText = normalizeText(row.telefonista_nombre);
      const codigoText = normalizeText([row.resumen_codigo, row.codigo_1, row.codigo_2, row.tipo_registro].filter(Boolean).join(' '));
      return (
        (!tarotista || tarotistaText.includes(tarotista)) &&
        (!telefonista || telefonistaText.includes(telefonista)) &&
        (!codigo || codigoText.includes(codigo))
      );
    });

    return NextResponse.json({
      ok: true,
      data: filtered,
      loaded: allRows.length,
      returned: filtered.length,
      filters: { from, to, tarotista, telefonista, codigo, limit: limitParam },
      viewer: {
        role: me.role || null,
        worker_id: me.id || null,
        mode: String(me.role) === 'central' ? 'central' : 'admin',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
