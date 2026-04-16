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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      minutos_free = 0,
      minutos_rueda = 0,
      minutos_cliente = 0,
      minutos_repite = 0,
      tipo = "normal",
    } = body;

    let lines: Line[] = [];

    if (tipo === "call") {
      const totalMin = minutos_free + minutos_rueda + minutos_cliente + minutos_repite;
      const rate = 0.12;

      lines.push({
        label: `Minutos Call ${totalMin} x ${rate}`,
        amount: totalMin * rate,
        meta: { code: "call", minutes: totalMin, rate },
      });
    } else {
      lines = [
        {
          label: `Minutos Free ${minutos_free} x 0.04`,
          amount: minutos_free * 0.04,
          meta: { code: "free", minutes: minutos_free, rate: 0.04 },
        },
        {
          label: `Minutos Rueda ${minutos_rueda} x 0.08`,
          amount: minutos_rueda * 0.08,
          meta: { code: "rueda", minutes: minutos_rueda, rate: 0.08 },
        },
        {
          label: `Minutos Cliente ${minutos_cliente} x 0.10`,
          amount: minutos_cliente * 0.10,
          meta: { code: "cliente", minutes: minutos_cliente, rate: 0.10 },
        },
        {
          label: `Minutos Repite ${minutos_repite} x 0.12`,
          amount: minutos_repite * 0.12,
          meta: { code: "repite", minutes: minutos_repite, rate: 0.12 },
        },
      ];
    }

    const total = lines.reduce((acc, l) => acc + l.amount, 0);

    // fallback cuando no hay nada
    if (total === 0) {
      lines = [
        {
          label: "Sin producción en el periodo",
          amount: 0,
          meta: { code: "none", minutes: 0, rate: 0 }, // 🔥 FIX
        },
      ];
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
