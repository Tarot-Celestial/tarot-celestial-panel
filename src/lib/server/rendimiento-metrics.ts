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

function toNum(value: unknown): number {
  return Number(String(value ?? '').replace('€', '').replace(',', '.').trim()) || 0;
}

function codeBucket(rawCode: unknown): keyof ParsedBreakdown {
  const text = normalizeText(rawCode).replace(/[_-]+/g, ' ');
  const compact = text.replace(/\s+/g, '');

  if (!text) return 'otros';
  if (compact === 'free' || compact === '7free' || text.includes(' free') || text.includes('free ')) return 'free';
  if (text.includes('rueda')) return 'rueda';
  if (text.includes('repite')) return 'repite';
  if (text.includes('cliente')) return 'cliente';
  if (text.includes('call')) return 'call_fixed';
  return 'otros';
}

function addTo(result: ParsedBreakdown, rawCode: unknown, rawMinutes: unknown) {
  const minutes = roundMoney(toNum(rawMinutes));
  if (minutes <= 0) return;
  const bucket = codeBucket(rawCode);
  result[bucket] = roundMoney(Number(result[bucket] || 0) + minutes);
}

function extractMinutesFromText(part: string, bucket: keyof ParsedBreakdown): number {
  const normalized = normalizeText(part);
  const allNumbers = Array.from(String(part || '').matchAll(/\d+(?:[\.,]\d+)?/g)).map((m) => toNum(m[0]));
  if (!allNumbers.length) return 0;

  // Evita contar el "7" de etiquetas como "7 free" como si fueran minutos.
  if (bucket === 'free' && normalized.replace(/\s+/g, '').includes('7free') && allNumbers.length > 1 && allNumbers[0] === 7) {
    return allNumbers[1];
  }

  // En textos tipo "Cliente 12 min" o "12 Cliente" normalmente solo hay un número.
  return allNumbers[0];
}

export function parseResumenCodigo(resumen: unknown, fallbackTiempo = 0, fallbackTipo = '') {
  const result = emptyBreakdown();
  const raw = String(resumen || '').trim();

  if (!raw) {
    if (normalizeText(fallbackTipo) === '7free') result.free = roundMoney(fallbackTiempo);
    else if (fallbackTiempo > 0) result.otros = roundMoney(fallbackTiempo);
    return result;
  }

  const parts = raw
    .split(/·|\+|,|\n|;/)
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  for (const part of parts) {
    const bucket = codeBucket(part);
    const minutes = extractMinutesFromText(part, bucket);
    if (!minutes) continue;
    result[bucket] = roundMoney(Number(result[bucket] || 0) + minutes);
  }

  const parsedTotal = Object.values(result).reduce((acc, n) => acc + Number(n || 0), 0);
  if (parsedTotal === 0 && fallbackTiempo > 0) {
    if (normalizeText(fallbackTipo) === '7free') result.free = roundMoney(fallbackTiempo);
    else result.otros = roundMoney(fallbackTiempo);
  }

  return result;
}

function parseCodeSlot(rawCode: unknown, rawMinutes: unknown) {
  const result = emptyBreakdown();
  addTo(result, rawCode, rawMinutes);
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
  const fromSlots = sumParsed(
    parseCodeSlot(row.codigo_1, row.minutos_1),
    parseCodeSlot(row.codigo_2, row.minutos_2)
  );

  const slotTotal = Object.values(fromSlots).reduce((acc, n) => acc + Number(n || 0), 0);
  if (slotTotal > 0) return fromSlots;

  return parseResumenCodigo(
    row.resumen_codigo,
    Number(row.tiempo || 0) || 0,
    String(row.tipo_registro || '')
  );
}

export function resolveTarotistaWorkerId(row: RendimientoRow, workerIdByName: Map<string, string>) {
  if (row.tarotista_worker_id) return String(row.tarotista_worker_id);
  const byName = workerIdByName.get(normalizeText(row.tarotista_nombre));
  if (byName) return byName;
  const byManual = workerIdByName.get(normalizeText(row.tarotista_manual_call));
  if (byManual) return byManual;
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
  const { data, error } = await admin
    .from('rendimiento_llamadas')
    .select('*')
    .gte('fecha', start)
    .lt('fecha', endExclusive)
    .order('fecha_hora', { ascending: true });
  if (error) throw error;
  return (data || []) as RendimientoRow[];
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
      const totalParsedMinutes = Object.values(parsed).reduce((acc, value) => acc + (Number(value || 0) || 0), 0);
      const fallbackCall = Number(row.tiempo || 0) || 0;
      const callMinutes = roundMoney(totalParsedMinutes > 0 ? totalParsedMinutes : fallbackCall);
      parsed.free = 0;
      parsed.rueda = 0;
      parsed.cliente = 0;
      parsed.repite = 0;
      parsed.otros = 0;
      parsed.call_fixed = callMinutes;
    }

    const entries = Object.entries(parsed) as Array<[string, number]>;
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
      return acc + Object.values(parsed).reduce((a, n) => a + Number(n || 0), 0);
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
