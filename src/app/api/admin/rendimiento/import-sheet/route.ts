import { NextResponse } from 'next/server';
import { getAdminClient, monthRange, normalizeMonthKey, workerFromRequest } from '@/lib/server/auth-worker';

export const runtime = 'nodejs';

const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vSLT1yIj5KRXABYpubiiM_9DQLqAT3zriTsW44S-SBvz_ZhjKJJu35pP9F4j-sT6Pt0hmRGsnqlulyM/pub?gid=1587355871&single=true&output=csv';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let inside = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inside && next === '"') {
        value += '"';
        i++;
      } else {
        inside = !inside;
      }
      continue;
    }
    if (ch === ',' && !inside) {
      row.push(value);
      value = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inside) {
      if (ch === '\r' && next === '\n') i++;
      row.push(value);
      if (row.some((x) => String(x || '').trim() !== '')) rows.push(row);
      row = [];
      value = '';
      continue;
    }
    value += ch;
  }
  row.push(value);
  if (row.some((x) => String(x || '').trim() !== '')) rows.push(row);
  return rows;
}

function findIndex(headers: string[], names: string[]) {
  return headers.findIndex((h) => names.some((n) => h.includes(n)));
}

function clean(v: any) {
  return String(v ?? '').trim();
}

function toBool(v: any) {
  const s = clean(v).toLowerCase();
  return ['1', 'true', 'si', 'sí', 'x', 'yes'].includes(s);
}

function toNum(v: any) {
  return Number(clean(v).replace(/€/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

function parseDateTime(raw: string) {
  const s = clean(raw);
  if (!s) return null;
  const [datePart, timePart = '12:00'] = s.split(/\s+/);
  if (/^\d{4}-\d{2}-\d{2}/.test(datePart)) return `${datePart}T${timePart.length <= 5 ? `${timePart}:00` : timePart}`;
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const date = `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const time = /^\d{1,2}:\d{2}/.test(timePart) ? timePart : '12:00';
  return `${date}T${time.length <= 5 ? `${time}:00` : time}`;
}

function buildKey(row: any) {
  return [
    row.id_unico || '',
    row.fecha || '',
    row.cliente_nombre || '',
    row.telefonista_nombre || '',
    row.tarotista_nombre || '',
    row.tiempo || 0,
    row.resumen_codigo || '',
    row.importe || 0,
  ].join('|');
}

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: 'NO_AUTH' }, { status: 401 });
    if (me.role !== 'admin') return NextResponse.json({ ok: false, error: 'FORBIDDEN' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const month = normalizeMonthKey(body?.month || new Date().toISOString().slice(0, 7));
    const { start, endExclusive } = monthRange(month);

    const res = await fetch(SHEET_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`SHEET_HTTP_${res.status}`);
    const csv = await res.text();
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new Error('CSV_EMPTY');

    const headers = rows[0].map((h) => clean(h).toLowerCase());
    const iFecha = findIndex(headers, ['fecha']);
    const iIdUnico = findIndex(headers, ['id_unico', 'id unico']);
    const iTelefonista = findIndex(headers, ['telefonista']);
    const iCliente = findIndex(headers, ['clientes', 'cliente']);
    const iTarotista = findIndex(headers, ['tarotista']);
    const iTiempo = findIndex(headers, ['tiempo']);
    const iCall = findIndex(headers, ['llamada call', 'call']);
    const iCodigo = findIndex(headers, ['codigo', 'código']);
    const iMismaCompra = findIndex(headers, ['misma compra']);
    const iFormaPago = findIndex(headers, ['forma de pago']);
    const iImporte = findIndex(headers, ['importe']);
    const iPromo = findIndex(headers, ['promo']);
    const iFree = findIndex(headers, ['3 pases free', '7 free', 'free']);
    const iCaptado = findIndex(headers, ['captado']);
    const iRecuperado = findIndex(headers, ['recuperado']);

    const admin = getAdminClient();
    const { data: existing, error: existingError } = await admin
      .from('rendimiento_llamadas')
      .select('id_unico, fecha, cliente_nombre, telefonista_nombre, tarotista_nombre, tiempo, resumen_codigo, importe')
      .gte('fecha', start)
      .lt('fecha', endExclusive);
    if (existingError) throw existingError;

    const existingKeys = new Set((existing || []).map(buildKey));
    const payload: any[] = [];

    for (const cols of rows.slice(1)) {
      const fechaHora = parseDateTime(cols[iFecha]);
      if (!fechaHora) continue;
      const fecha = fechaHora.slice(0, 10);
      if (fecha < start || fecha >= endExclusive) continue;

      const importe = toNum(cols[iImporte]);
      const tiempo = toNum(cols[iTiempo]);
      const resumenCodigo = clean(cols[iCodigo]) || null;
      const usaFree = toBool(cols[iFree]);
      const tipo_registro = importe > 0 ? 'compra' : usaFree ? '7free' : 'minutos';
      const row = {
        fecha,
        fecha_hora: fechaHora,
        id_unico: clean(cols[iIdUnico]) || null,
        cliente_nombre: clean(cols[iCliente]) || 'Cliente',
        telefonista_nombre: clean(cols[iTelefonista]) || 'Central',
        tarotista_nombre: clean(cols[iTarotista]) || null,
        tarotista_manual_call: toBool(cols[iCall]) ? clean(cols[iTarotista]) || null : null,
        llamada_call: toBool(cols[iCall]),
        tipo_registro,
        cliente_compra_minutos: importe > 0,
        usa_7_free: usaFree,
        usa_minutos: !importe && !usaFree,
        misma_compra: toBool(cols[iMismaCompra]),
        guarda_minutos: false,
        minutos_guardados_free: 0,
        minutos_guardados_normales: 0,
        codigo_1: resumenCodigo,
        minutos_1: tiempo,
        codigo_2: null,
        minutos_2: 0,
        resumen_codigo: resumenCodigo,
        tiempo,
        forma_pago: clean(cols[iFormaPago]) || null,
        importe,
        promo: toBool(cols[iPromo]),
        captado: toBool(cols[iCaptado]),
        recuperado: toBool(cols[iRecuperado]),
      };
      const key = buildKey(row);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      payload.push(row);
    }

    if (!payload.length) {
      return NextResponse.json({ ok: true, month, inserted: 0, skipped: rows.length - 1, message: 'No había filas nuevas para importar.' });
    }

    const { error: insertError } = await admin.from('rendimiento_llamadas').insert(payload);
    if (insertError) throw insertError;

    return NextResponse.json({ ok: true, month, inserted: payload.length, skipped: rows.length - 1 - payload.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'ERR' }, { status: 500 });
  }
}
