import {
  getAdminClient,
  monthRange,
  normalizeText,
  rateForCode,
  roundMoney,
  isSpecialCallName,
} from '@/lib/server/auth-worker';

type WorkerLite = {
  id: string;
  display_name: string | null;
  role?: string | null;
  team?: string | null;
};

type RendimientoRow = {
  id?: string;
  fecha?: string | null;
  fecha_hora?: string | null;
  cliente_nombre?: string | null;
  telefonista_nombre?: string | null;
  tarotista_worker_id?: string | null;
  tarotista_nombre?: string | null;
  tarotista_manual_call?: string | null;
  llamada_call?: boolean | null;
  tiempo?: number | string | null;
  resumen_codigo?: string | null;
  forma_pago?: string | null;
  importe?: number | string | null;
  promo?: boolean | null;
  captado?: boolean | null;
  recuperado?: boolean | null;
  tipo_registro?: string | null;
};

type ParsedCode = {
  code: string;
  minutes: number;
  specialCall: boolean;
};

export async function listTarotistaWorkers() {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from('workers')
    .select('id, display_name, role, team')
    .eq('role', 'tarotista');
  if (error) throw error;
  return (data || []) as WorkerLite[];
}

export async function listMonthlyRendimiento(month: string) {
  const admin = getAdminClient();
  const { start, endExclusive } = monthRange(month);
  const { data, error } = await admin
    .from('rendimiento_llamadas')
    .select('id, fecha, fecha_hora, cliente_nombre, telefonista_nombre, tarotista_worker_id, tarotista_nombre, tarotista_manual_call, llamada_call, tiempo, resumen_codigo, forma_pago, importe, promo, captado, recuperado, tipo_registro')
    .gte('fecha', start)
    .lt('fecha', endExclusive)
    .order('fecha_hora', { ascending: false });
  if (error) throw error;
  return (data || []) as RendimientoRow[];
}

export function buildWorkerMaps(workers: WorkerLite[]) {
  const workerById = new Map<string, WorkerLite>();
  const workerIdByName = new Map<string, string>();

  for (const worker of workers || []) {
    const id = String(worker.id);
    workerById.set(id, worker);
    if (worker.display_name) {
      workerIdByName.set(normalizeText(worker.display_name), id);
    }
  }

  return { workerById, workerIdByName };
}

function parseSingleToken(token: string, fallbackMinutes: number, specialCall: boolean): ParsedCode | null {
  const clean = String(token || '').trim();
  if (!clean) return null;

  const m = clean.match(/(\d+(?:[.,]\d+)?)\s*([a-záéíóúüñ0-9_ ]+)/i);
  let minutes = fallbackMinutes;
  let rawCode = clean;

  if (m) {
    minutes = Number(String(m[1]).replace(',', '.')) || fallbackMinutes;
    rawCode = m[2] || clean;
  }

  const codeText = normalizeText(rawCode);
  let code = 'cliente';
  if (specialCall || codeText === 'call' || codeText.includes('call')) code = 'call_fixed';
  else if (codeText.includes('7free') || codeText.includes('free')) code = 'free';
  else if (codeText.includes('rueda')) code = 'rueda';
  else if (codeText.includes('repite')) code = 'repite';
  else if (codeText.includes('cliente')) code = 'cliente';

  return { code, minutes: Number(minutes || 0), specialCall };
}

export function parseRendimientoCodes(row: RendimientoRow): ParsedCode[] {
  const totalMinutes = Number(row.tiempo || 0) || 0;
  const specialCall = Boolean(row.llamada_call) || isSpecialCallName(row.tarotista_manual_call || row.tarotista_nombre);
  const raw = String(row.resumen_codigo || '').trim();
  const tipo = normalizeText(row.tipo_registro || '');

  if (!raw) {
    if (totalMinutes <= 0) return [];
    if (tipo === '7free') return [{ code: 'free', minutes: totalMinutes, specialCall }];
    return [{ code: specialCall ? 'call_fixed' : 'cliente', minutes: totalMinutes, specialCall }];
  }

  const normalized = raw
    .replace(/\s+[·•]\s+/g, '|')
    .replace(/\s+-\s+/g, '|')
    .replace(/\s*,\s*/g, '|')
    .replace(/\s*\/\s*/g, '|');

  const tokens = normalized.split('|').map((x) => x.trim()).filter(Boolean);
  const parsed = tokens
    .map((token) => parseSingleToken(token, totalMinutes, specialCall))
    .filter(Boolean) as ParsedCode[];

  if (!parsed.length && totalMinutes > 0) {
    return [{ code: specialCall ? 'call_fixed' : 'cliente', minutes: totalMinutes, specialCall }];
  }

  return parsed;
}

export function resolveTarotistaWorkerId(
  row: RendimientoRow,
  workerIdByName: Map<string, string>
): string | null {
  if (row.tarotista_worker_id) return String(row.tarotista_worker_id);

  const names = [row.tarotista_nombre, row.tarotista_manual_call]
    .map((x) => normalizeText(x || ''))
    .filter(Boolean);

  for (const key of names) {
    const found = workerIdByName.get(key);
    if (found) return found;
  }

  return null;
}

export function accumulateRendimientoByWorker(rows: RendimientoRow[], workers: WorkerLite[]) {
  const { workerById, workerIdByName } = buildWorkerMaps(workers);
  const rowsMap = new Map<string, any>();

  for (const worker of workers) {
    rowsMap.set(String(worker.id), {
      worker_id: String(worker.id),
      display_name: worker.display_name || '—',
      team: worker.team || null,
      role: worker.role || 'tarotista',
      minutes_total: 0,
      calls_total: 0,
      captadas_total: 0,
      minutes_free: 0,
      minutes_rueda: 0,
      minutes_cliente: 0,
      minutes_repite: 0,
      pay_minutes: 0,
      bonus_captadas: 0,
      pct_cliente: 0,
      pct_repite: 0,
      revenue_total: 0,
    });
  }

  for (const row of rows) {
    const workerId = resolveTarotistaWorkerId(row, workerIdByName);
    if (!workerId || !rowsMap.has(workerId)) continue;

    const target = rowsMap.get(workerId);
    const totalMinutes = Number(row.tiempo || 0) || 0;
    const parsedCodes = parseRendimientoCodes(row);

    target.calls_total += 1;
    target.minutes_total = roundMoney(target.minutes_total + totalMinutes);
    target.revenue_total = roundMoney(target.revenue_total + (Number(row.importe || 0) || 0));
    if (row.captado) target.captadas_total += 1;

    for (const part of parsedCodes) {
      const minutes = Number(part.minutes || 0) || 0;
      if (minutes <= 0) continue;
      const pay = roundMoney(minutes * rateForCode(part.code, part.code === 'call_fixed' || part.specialCall));
      if (part.code === 'free') target.minutes_free = roundMoney(target.minutes_free + minutes);
      if (part.code === 'rueda') target.minutes_rueda = roundMoney(target.minutes_rueda + minutes);
      if (part.code === 'cliente' || part.code === 'call_fixed') target.minutes_cliente = roundMoney(target.minutes_cliente + minutes);
      if (part.code === 'repite') target.minutes_repite = roundMoney(target.minutes_repite + minutes);
      target.pay_minutes = roundMoney(target.pay_minutes + pay);
    }
  }

  const rowsOut = Array.from(rowsMap.values()).map((row) => {
    const denom = Number(row.minutes_total || 0) || 0;
    const pctCliente = denom ? (Number(row.minutes_cliente || 0) / denom) * 100 : 0;
    const pctRepite = denom ? (Number(row.minutes_repite || 0) / denom) * 100 : 0;
    return {
      ...row,
      pct_cliente: roundMoney(pctCliente),
      pct_repite: roundMoney(pctRepite),
    };
  });

  return { rows: rowsOut, workerById };
}

export function buildInvoiceTotalsFromRendimiento(rows: RendimientoRow[], workers: WorkerLite[]) {
  const { workerIdByName } = buildWorkerMaps(workers);
  const totalsByWorker = new Map<string, {
    worker_id: string;
    minutes_total: number;
    total: number;
    by_code: Record<string, { minutes: number; amount: number }>;
  }>();
  let skippedWithoutWorker = 0;

  for (const row of rows) {
    const workerId = resolveTarotistaWorkerId(row, workerIdByName);
    if (!workerId) {
      skippedWithoutWorker += 1;
      continue;
    }

    const parsedCodes = parseRendimientoCodes(row);
    if (!parsedCodes.length) continue;

    const current = totalsByWorker.get(workerId) || {
      worker_id: workerId,
      minutes_total: 0,
      total: 0,
      by_code: {},
    };

    for (const part of parsedCodes) {
      const codeKey = part.code;
      const minutes = Number(part.minutes || 0) || 0;
      if (minutes <= 0) continue;
      const amount = roundMoney(minutes * rateForCode(codeKey, codeKey === 'call_fixed' || part.specialCall));

      current.minutes_total = roundMoney(current.minutes_total + minutes);
      current.total = roundMoney(current.total + amount);
      if (!current.by_code[codeKey]) current.by_code[codeKey] = { minutes: 0, amount: 0 };
      current.by_code[codeKey].minutes = roundMoney(current.by_code[codeKey].minutes + minutes);
      current.by_code[codeKey].amount = roundMoney(current.by_code[codeKey].amount + amount);
    }

    totalsByWorker.set(workerId, current);
  }

  return { totalsByWorker, skippedWithoutWorker };
}
