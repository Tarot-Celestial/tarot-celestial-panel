import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

function dayRange(mode: string, dateValue: string | null) {
  const now = new Date();

  if (mode === 'ayer') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return { start, end };
  }

  if (mode === 'fecha' && dateValue) {
    const [y, m, d] = dateValue.split('-').map(Number);
    const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
    const end = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
    return { start, end };
  }

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  return { start, end };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = String(searchParams.get('mode') || 'hoy');
    const dateValue = searchParams.get('date');

    const { start, end } = dayRange(mode, dateValue);
    const supabase = adminClient();

    const { data: rendimiento, error } = await supabase
      .from('rendimiento_llamadas')
      .select('id, cliente_id, cliente_nombre, fecha_hora, fecha, importe, cliente_compra_minutos')
      .gte('fecha_hora', start.toISOString())
      .lte('fecha_hora', end.toISOString())
      .or('cliente_compra_minutos.eq.true,importe.gt.0')
      .order('fecha_hora', { ascending: false });

    if (error) throw error;

    const allRows = Array.isArray(rendimiento) ? rendimiento : [];
    const latestByKey = new Map<string, any>();

    for (const row of allRows) {
      const key = String(row?.cliente_id || '').trim() || String(row?.cliente_nombre || '').trim().toLowerCase();
      if (!key) continue;
      if (!latestByKey.has(key)) latestByKey.set(key, row);
    }

    const rows = Array.from(latestByKey.values()).map((row: any) => ({
      id: row?.cliente_id || row?.id,
      nombre: row?.cliente_nombre || 'Cliente',
      telefono: '—',
      ultima_compra: row?.fecha_hora || row?.fecha || null,
    }));

    const totals = {
      total_clientes: rows.length,
      total_pagos: allRows.length,
      total_importe: allRows.reduce((acc: number, row: any) => acc + (Number(row?.importe) || 0), 0),
    };

    return NextResponse.json({ ok: true, rows, totals });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Error cargando diario' }, { status: 500 });
  }
}
