import { getAdminClient, isSpecialCallName, normalizeText, rateForCode, roundMoney } from '@/lib/server/auth-worker';

type RendimientoRow = {
  id?: string | null;
  fecha?: string | null;
  fecha_hora?: string | null;
  cliente_id?: string | null;
  cliente_nombre?: string | null;
  telefonista_worker_id?: string | null;
  telefonista_nombre?: string | null;
  tarotista_worker_id?: string | null;
  tarotista_nombre?: string | null;
  tarotista_manual_call?: string | null;
  llamada_call?: boolean | null;
  resumen_codigo?: string | null;
  tiempo?: number | string | null;
  importe?: number | string | null;
  captado?: boolean | null;
  recuperado?: boolean | null;
  promo?: boolean | null;
  tipo_registro?: string | null;
  cliente_compra_minutos?: boolean | null;
  usa_7_free?: boolean | null;
  codigo_1?: string | null;
  minutos_1?: number | string | null;
  codigo_2?: string | null;
  minutos_2?: number | string | null;
};

type WorkerLite = {
  id: string;
  display_name?: string | null;
  role?: string | null;
  team?: string | null;
};

type ParsedBreakdown = {
  free: number;
  rueda: number;
  cliente: number;
  repite: number;
  call_fixed: number;
  otros: number;
};

function emptyBreakdown(): ParsedBreakdown {
  return { free: 0, rueda: 0, cliente: 0, repite: 0, call_fixed: 0, otros: 0 };
}

function breakdownTotal(parsed: ParsedBreakdown) {
  return Object.values(parsed).reduce((acc, n) => acc + (Number(n || 0) || 0), 0);
}

function classifyCode(raw: unknown): keyof ParsedBreakdown | null {
  const code = normalizeText(raw).replace(/\s+/g, '');
  const text = normalizeText(raw);
  if (!code && !text) return null;
  if (code === 'free' || code === '7free' || text.includes('free')) return 'free';
  if (text.includes('rueda')) return 'rueda';
  if (text.includes('cliente')) return 'cliente';
  if (text.includes('repite')) return 'repite';
  if (text.includes('call')) return 'call_fixed';
  return 'otros';
}

function addToBreakdown(target: ParsedBreakdown, code: keyof ParsedBreakdown | null, minutes: number) {
  const safeMinutes = Number(minutes || 0) || 0;
  if (!safeMinutes) return;
  target[code || 'otros'] = roundMoney(Number(target[code || 'otros'] || 0) + safeMinutes);
}

export function parseResumenCodigo(resumen: unknown, fallbackTiempo = 0, fallbackTipo = '') {
  const result = emptyBreakdown();
  const raw = String(resumen || '').trim();
  const safeFallback = Number(fallbackTiempo || 0) || 0;

  if (!raw) {
    const typeCode = classifyCode(fallbackTipo);
    if (safeFallback > 0) addToBreakdown(result, typeCode, safeFallback);
    return result;
  }

  const parts = raw
    .split(/·|\+|,|\n|;/)
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  for (const part of parts) {
    const txt = normalizeText(part);
    const code = classifyCode(part);
    const numberMatch = part.match(/\d+(?:[\.,]\d+)?/);
    let mins = Number(numberMatch?.[0]?.replace(',', '.') || 0) || 0;

    // Casos habituales: "Cliente", "Repite", "Rueda", "Free", "Call" sin número.
    // En esos casos el minuto real es el campo tiempo del registro.
    if (!mins && parts.length === 1 && safeFallback > 0 && code) mins = safeFallback;

    // "7 free" debe contar 7 minutos free, pero "free" sin número usa tiempo.
    if (!mins) continue;
    if (txt.includes('free')) addToBreakdown(result, 'free', mins);
    else if (txt.includes('rueda')) addToBreakdown(result, 'rueda', mins);
    else if (txt.includes('cliente')) addToBreakdown(result, 'cliente', mins);
    else if (txt.includes('repite')) addToBreakdown(result, 'repite', mins);
    else if (txt.includes('call')) addToBreakdown(result, 'call_fixed', mins);
    else addToBreakdown(result, code, mins);
  }

  if (breakdownTotal(result) === 0 && safeFallback > 0) {
    addToBreakdown(result, classifyCode(raw) || classifyCode(fallbackTipo), safeFallback);
  }

  return result;
}

function parseCodeSlot(rawCode: unknown, rawMinutes: unknown, fallbackMinutes = 0) {
  const result = emptyBreakdown();
  const hasCode = String(rawCode || '').trim().length > 0;
  const minsFromSlot = Number(rawMinutes || 0) || 0;
  const mins = minsFromSlot || (hasCode ? Number(fallbackMinutes || 0) || 0 : 0);
  if (!mins) return result;
  addToBreakdown(result, classifyCode(rawCode), mins);
  return result;
}

function sumParsed(a: ParsedBreakdown, b: ParsedBreakdown) {
  return {
    free: roundMoney((a.free || 0) + (b.free || 0)),
    rueda: roundMoney((a.rueda || 0) + (b.rueda || 0)),
    cliente: roundMoney((a.cliente || 0) + (b.cliente || 0)),
    repite: roundMoney((a.repite || 0) + (b.repite || 0)),
    call_fixed: roundMoney((a.call_fixed || 0) + (b.call_fixed || 0)),
    otros: roundMoney((a.otros || 0) + (b.otros || 0)),
  };
}

function parseRowBreakdown(row: RendimientoRow) {
  const tiempo = Number(row.tiempo || 0) || 0;
  const code1 = String(row.codigo_1 || '').trim();
  const code2 = String(row.codigo_2 || '').trim();
  const mins1 = Number(row.minutos_1 || 0) || 0;
  const mins2 = Number(row.minutos_2 || 0) || 0;

  // Si viene código por columnas, respetamos esos minutos. Si solo hay un código sin minutos,
  // usamos tiempo para que coincida con lo que se ve manualmente en Rendimiento.
  const onlyOneCodeWithoutMinutes = Boolean((code1 && !code2 && !mins1 && !mins2) || (code2 && !code1 && !mins1 && !mins2));
  const fromSlots = sumParsed(
    parseCodeSlot(row.codigo_1, row.minutos_1, onlyOneCodeWithoutMinutes && code1 ? tiempo : 0),
    parseCodeSlot(row.codigo_2, row.minutos_2, onlyOneCodeWithoutMinutes && code2 ? tiempo : 0)
  );

  const slotTotal = breakdownTotal(fromSlots);
  if (slotTotal > 0) return fromSlots;

  return parseResumenCodigo(row.resumen_codigo, tiempo, String(row.tipo_registro || ''));
}

export function resolveTarotistaWorkerId(row: RendimientoRow, workerIdByName: Map<string, string>) {
  if (row.tarotista_worker_id) return String(row.tarotista_worker_id);
  const byName = workerIdByName.get(normalizeText(row.tarotista_nombre));
  if (byName) return byName;
  const byManualName = workerIdByName.get(normalizeText(row.tarotista_manual_call));
  if (byManualName) return byManualName;
  return null;
}

export async function listTarotistaWorkers() {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('workers')
    .select('id, display_name, role, team')
    .eq('role', 'tarotista');
  if (error) throw error;
  return (data || []) as WorkerLite[];
}

export async function listRendimientoRows(start: string, endExclusive: string) {
  const admin = getAdminClient();
  const startIso = `${start}T00:00:00.000Z`;
  const endIso = `${endExclusive}T00:00:00.000Z`;
  const pageSize = 1000;
  const allRows: RendimientoRow[] = [];

  for (let from = 0; from < 50000; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await admin
      .from('rendimiento_llamadas')
      .select('*')
      .gte('fecha_hora', startIso)
      .lt('fecha_hora', endIso)
      .order('fecha_hora', { ascending: true })
      .range(from, to);
    if (error) throw error;
    const chunk = (data || []) as RendimientoRow[];
    allRows.push(...chunk);
    if (chunk.length < pageSize) break;
  }

  return allRows;
}

export function aggregateRendimientoByTarotista(rows: RendimientoRow[], workers: WorkerLite[]) {
  const workerIdByName = new Map<string, string>();
  const rowsMap = new Map<string, any>();

  for (const w of workers || []) {
    const wid = String(w.id);
    workerIdByName.set(normalizeText(w.display_name), wid);
    rowsMap.set(wid, {
      worker_id: wid,
      display_name: w.display_name || '—',
      team: w.team || null,
      role: w.role || 'tarotista',
      minutes_total: 0,
      calls_total: 0,
      captadas_total: 0,
      recuperados_total: 0,
      promo_total: 0,
      minutes_free: 0,
      minutes_rueda: 0,
      minutes_cliente: 0,
      minutes_repite: 0,
      minutes_call_fixed: 0,
      minutes_otros: 0,
      pay_minutes: 0,
      bonus_captadas: 0,
      pct_cliente: 0,
      pct_repite: 0,
      revenue_total: 0,
      by_code: {} as Record<string, { minutes: number; amount: number }>,
    });
  }

  for (const row of rows || []) {
    const special = Boolean(row.llamada_call) || isSpecialCallName(row.tarotista_manual_call) || isSpecialCallName(row.tarotista_nombre);
    const resolvedWorkerId = resolveTarotistaWorkerId(row, workerIdByName);
    if (!resolvedWorkerId || !rowsMap.has(resolvedWorkerId)) continue;

    const agg = rowsMap.get(resolvedWorkerId);
    const importe = Number(row.importe || 0) || 0;
    const parsed = parseRowBreakdown(row);
    if (special) {
      const totalParsedMinutes = breakdownTotal(parsed);
      const fallbackCall = Number(row.tiempo || 0) || 0;
      const callMinutes = roundMoney(totalParsedMinutes > 0 ? totalParsedMinutes : fallbackCall);
      parsed.free = 0;
      parsed.rueda = 0;
      parsed.cliente = 0;
      parsed.repite = 0;
      parsed.otros = 0;
      parsed.call_fixed = callMinutes;
    }

    const entries = Object.entries(parsed) as Array<[keyof ParsedBreakdown, number]>;
    const rowMinutes = entries.reduce((acc, [, mins]) => acc + Number(mins || 0), 0);

    agg.calls_total += 1;
    agg.minutes_total = roundMoney(agg.minutes_total + rowMinutes);
    agg.revenue_total = roundMoney(agg.revenue_total + importe);
    if (row.captado) agg.captadas_total += 1;
    if (row.recuperado) agg.recuperados_total += 1;
    if (row.promo) agg.promo_total += 1;

    for (const [code, minsRaw] of entries) {
      const mins = roundMoney(minsRaw);
      if (!mins) continue;
      const rate = rateForCode(code, code === 'call_fixed');
      const amount = roundMoney(mins * rate);
      if (code === 'free') agg.minutes_free = roundMoney(agg.minutes_free + mins);
      else if (code === 'rueda') agg.minutes_rueda = roundMoney(agg.minutes_rueda + mins);
      else if (code === 'cliente') agg.minutes_cliente = roundMoney(agg.minutes_cliente + mins);
      else if (code === 'repite') agg.minutes_repite = roundMoney(agg.minutes_repite + mins);
      else if (code === 'call_fixed') agg.minutes_call_fixed = roundMoney(agg.minutes_call_fixed + mins);
      else agg.minutes_otros = roundMoney(agg.minutes_otros + mins);

      agg.pay_minutes = roundMoney(agg.pay_minutes + amount);
      if (!agg.by_code[code]) agg.by_code[code] = { minutes: 0, amount: 0 };
      agg.by_code[code].minutes = roundMoney(agg.by_code[code].minutes + mins);
      agg.by_code[code].amount = roundMoney(agg.by_code[code].amount + amount);
    }
  }

  return Array.from(rowsMap.values()).map((row) => {
    const denom = Number(row.minutes_total || 0) || 0;
    return {
      ...row,
      pct_cliente: denom ? roundMoney((Number(row.minutes_cliente || 0) / denom) * 100) : 0,
      pct_repite: denom ? roundMoney((Number(row.minutes_repite || 0) / denom) * 100) : 0,
    };
  });
}

export function summarizeRendimientoRows(rows: RendimientoRow[]) {
  const total = rows.length;
  const total_importe = roundMoney(rows.reduce((acc, row) => acc + (Number(row.importe || 0) || 0), 0));
  const total_minutos = roundMoney(
    rows.reduce((acc, row) => {
      const parsed = parseRowBreakdown(row);
      return acc + breakdownTotal(parsed);
    }, 0)
  );
  const total_captadas = rows.filter((row) => Boolean(row.captado)).length;
  const total_recuperados = rows.filter((row) => Boolean(row.recuperado)).length;
  const total_promos = rows.filter((row) => Boolean(row.promo)).length;
  const total_compras = rows.filter((row) => (Number(row.importe || 0) || 0) > 0 || Boolean(row.cliente_compra_minutos)).length;

  return {
    total,
    total_importe,
    total_minutos,
    total_captadas,
    total_recuperados,
    total_promos,
    total_compras,
  };
}
