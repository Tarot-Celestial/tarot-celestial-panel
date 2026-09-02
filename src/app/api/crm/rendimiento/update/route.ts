import { NextResponse } from 'next/server';
import { getAdminClient, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

const ALLOWED_FIELDS = [
  'cliente_nombre',
  'tiempo',
  'resumen_codigo',
  'forma_pago',
  'importe',
  'llamada_call',
  'promo',
  'captado',
  'recuperado',
] as const;

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH', message: 'Tu sesión ha caducado. Vuelve a iniciar sesión.' }, { status: 401 });
    if (!['admin', 'central'].includes(String(me.role || ''))) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    const rawUpdates = body?.updates && typeof body.updates === 'object' ? body.updates : {};
    if (!id) return NextResponse.json({ ok: false, error: 'ID_REQUIRED' }, { status: 400 });

    const updates: Record<string, any> = {};
    for (const key of ALLOWED_FIELDS) {
      if (key in rawUpdates) updates[key] = rawUpdates[key];
    }
    if (!Object.keys(updates).length) {
      return NextResponse.json({ ok: false, message: 'No hay cambios para guardar.' }, { status: 400 });
    }
    for (const key of ['tiempo', 'importe']) {
      if (!(key in updates)) continue;
      const value = updates[key];
      const normalized = typeof value === 'string' ? value.trim().replace(',', '.') : String(value);
      if (!['string', 'number'].includes(typeof value) || !/^\d+(\.\d{1,2})?$/.test(normalized) || !Number.isFinite(Number(normalized))) {
        return NextResponse.json({ ok: false, message: 'Tiempo e importe deben ser cifras válidas, sin negativos y con hasta dos decimales.' }, { status: 400 });
      }
      updates[key] = Number(normalized);
    }
    for (const [key, max] of [['cliente_nombre', 300], ['resumen_codigo', 1000], ['forma_pago', 100]] as const) {
      if (!(key in updates)) continue;
      if (typeof updates[key] !== 'string' || updates[key].length > max || (key === 'cliente_nombre' && !updates[key].trim())) {
        return NextResponse.json({ ok: false, message: 'Revisa el nombre, el código y el método de pago.' }, { status: 400 });
      }
      updates[key] = updates[key].trim();
    }
    for (const key of ['llamada_call', 'promo', 'captado', 'recuperado']) {
      if (key in updates && typeof updates[key] !== 'boolean') {
        return NextResponse.json({ ok: false, message: 'El indicador enviado no es válido.' }, { status: 400 });
      }
    }

    const admin = getAdminClient();
    let ownership = admin.from('rendimiento_llamadas').select('id').eq('id', id);
    if (String(me.role) === 'central') ownership = ownership.eq('telefonista_worker_id', String(me.id));
    const owned = await ownership.maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) return NextResponse.json({ ok: false, error: 'FORBIDDEN_RECORD', message: 'No tienes permiso para editar este registro o ya no existe. Cada central puede corregir sus propios registros; un administrador puede corregir todos.' }, { status: 403 });

    let mutation = admin
      .from('rendimiento_llamadas')
      .update(updates)
      .eq('id', id);
    // Keep the ownership restriction on the write, not only on the preceding read.
    if (String(me.role) === 'central') mutation = mutation.eq('telefonista_worker_id', String(me.id));
    const { data, error } = await mutation.select('id').maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json({ ok: false, message: 'El registro cambió o ya no está disponible. Actualiza la tabla antes de reintentarlo.' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
