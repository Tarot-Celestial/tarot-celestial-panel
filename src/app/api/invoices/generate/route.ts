import { NextResponse } from "next/server";

type Line = {
  label: string;
  amount: number;
  meta: {
    code: string;
    minutes: number;
    rate: number;
  };
};

function toNum(value: any) {
  const n = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function buildMinuteLine(label: string, code: string, minutes: number, rate: number): Line | null {
  const safeMinutes = toNum(minutes);
  if (safeMinutes <= 0) return null;

  return {
    label: `${label} ${safeMinutes} x ${rate}`,
    amount: roundMoney(safeMinutes * rate),
    meta: { code, minutes: safeMinutes, rate },
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    const minutos_free = toNum(body?.minutos_free);
    const minutos_rueda = toNum(body?.minutos_rueda);
    const minutos_cliente = toNum(body?.minutos_cliente);
    const minutos_repite = toNum(body?.minutos_repite);
    const minutos_call = toNum(body?.minutos_call);
    const tipo = String(body?.tipo || "normal").trim().toLowerCase();

    const lines: Line[] = [];

    const lineFree = buildMinuteLine("Minutos Free", "free", minutos_free, 0.04);
    const lineRueda = buildMinuteLine("Minutos Rueda", "rueda", minutos_rueda, 0.08);
    const lineCliente = buildMinuteLine("Minutos Cliente", "cliente", minutos_cliente, 0.10);
    const lineRepite = buildMinuteLine("Minutos Repite", "repite", minutos_repite, 0.12);

    if (tipo === "call") {
      // En facturas tipo call NO se debe mezclar todo en una sola línea,
      // porque así desaparecen minutos por concepto y no se ve el desglose real.
      if (lineFree) lines.push(lineFree);
      if (lineRueda) lines.push(lineRueda);
      if (lineCliente) lines.push(lineCliente);
      if (lineRepite) lines.push(lineRepite);

      // Compatibilidad por si en algún flujo antiguo aún llega un bloque "call" separado.
      const lineCall = buildMinuteLine("Minutos Call", "call", minutos_call, 0.12);
      if (lineCall) lines.push(lineCall);
    } else {
      if (lineFree) lines.push(lineFree);
      if (lineRueda) lines.push(lineRueda);
      if (lineCliente) lines.push(lineCliente);
      if (lineRepite) lines.push(lineRepite);
    }

    const total = roundMoney(lines.reduce((acc, line) => acc + toNum(line.amount), 0));

    if (lines.length === 0) {
      lines.push({
        label: "Sin producción en el periodo",
        amount: 0,
        meta: { code: "none", minutes: 0, rate: 0 },
      });
    }

    return NextResponse.json({
      ok: true,
      lines,
      total,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "INVOICE_ERROR" },
      { status: 500 }
    );
  }
}
