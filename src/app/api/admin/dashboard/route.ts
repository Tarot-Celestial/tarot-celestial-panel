import { NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const admin = getAdminClient();
    const month = new Date().toISOString().slice(0, 7);

    const { data: pagos, error: pagosError } = await admin
      .from('crm_cliente_pagos')
      .select('importe, created_at');
    if (pagosError) throw pagosError;

    const total = (pagos || [])
      .filter((p: any) => String(p.created_at || '').startsWith(month))
      .reduce((a: number, p: any) => a + Number(p.importe || 0), 0);

    const [{ count: clientes }, { count: llamadas }, { count: workers }] = await Promise.all([
      admin.from('crm_clientes').select('*', { count: 'exact', head: true }),
      admin.from('calls').select('*', { count: 'exact', head: true }),
      admin.from('workers').select('*', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({ ok: true, total, clientes, reservas: llamadas, tarotistas: workers });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
