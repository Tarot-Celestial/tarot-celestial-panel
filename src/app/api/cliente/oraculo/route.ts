import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { answerOracleFollowup, pickDailyOracle } from "@/lib/server/cliente-platform";

export const runtime = "nodejs";

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const tema = String(searchParams.get("tema") || "general").trim().toLowerCase();
    const hoy = dayKey();

    let { data: lectura, error } = await gate.admin
      .from("cliente_oraculo_diario")
      .select("*")
      .eq("cliente_id", gate.cliente.id)
      .eq("fecha", hoy)
      .eq("tema", tema)
      .maybeSingle();
    if (error) throw error;

    if (!lectura) {
      const oracle = pickDailyOracle(tema, gate.cliente.id, gate.cliente.rango_actual);
      const payload = {
        cliente_id: gate.cliente.id,
        fecha: hoy,
        tema,
        titulo: oracle.titulo,
        prediccion: `${oracle.titulo} ${oracle.energia} ${oracle.cierre}`,
        energia: oracle.energia,
        cierre: oracle.cierre,
        created_at: new Date().toISOString(),
      };
      const inserted = await gate.admin.from("cliente_oraculo_diario").insert(payload).select("*").single();
      if (inserted.error) throw inserted.error;
      lectura = inserted.data;
    }

    const { data: mensajes, error: msgError } = await gate.admin
      .from("cliente_oraculo_mensajes")
      .select("id, role, contenido, created_at")
      .eq("cliente_id", gate.cliente.id)
      .eq("fecha", hoy)
      .eq("tema", tema)
      .order("created_at", { ascending: true })
      .limit(30);
    if (msgError) throw msgError;

    return NextResponse.json({ ok: true, lectura, mensajes: mensajes || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ORACULO" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const tema = String(body?.tema || "general").trim().toLowerCase();
    const pregunta = String(body?.pregunta || "").trim();
    if (!pregunta) {
      return NextResponse.json({ ok: false, error: "PREGUNTA_REQUIRED" }, { status: 400 });
    }

    const hoy = dayKey();
    const respuesta = answerOracleFollowup(pregunta, tema, gate.cliente.rango_actual);
    const nowIso = new Date().toISOString();

    const insertUser = await gate.admin.from("cliente_oraculo_mensajes").insert({
      cliente_id: gate.cliente.id,
      fecha: hoy,
      tema,
      role: "user",
      contenido: pregunta,
      created_at: nowIso,
    });
    if (insertUser.error) throw insertUser.error;

    const insertAssistant = await gate.admin.from("cliente_oraculo_mensajes").insert({
      cliente_id: gate.cliente.id,
      fecha: hoy,
      tema,
      role: "assistant",
      contenido: respuesta,
      created_at: new Date(Date.now() + 1).toISOString(),
    });
    if (insertAssistant.error) throw insertAssistant.error;

    const { data: mensajes, error: msgError } = await gate.admin
      .from("cliente_oraculo_mensajes")
      .select("id, role, contenido, created_at")
      .eq("cliente_id", gate.cliente.id)
      .eq("fecha", hoy)
      .eq("tema", tema)
      .order("created_at", { ascending: true })
      .limit(30);
    if (msgError) throw msgError;

    return NextResponse.json({ ok: true, respuesta, mensajes: mensajes || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_CLIENTE_ORACULO_SEND" }, { status: 500 });
  }
}
