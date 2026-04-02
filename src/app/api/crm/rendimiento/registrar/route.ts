import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data } = await sb.auth.getUser();
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;
  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, role, display_name, email")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function toNum(v: any) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function cleanText(v: any) {
  const s = String(v ?? "").trim();
  return s || null;
}

function joinClienteName(cliente: any) {
  return [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || cliente?.telefono || "Cliente";
}

function codigoText(mins: number, code: string | null) {
  if (!mins || mins <= 0 || !code) return "";
  return `${mins} ${String(code).toLowerCase()}`;
}

export async function POST(req: Request) {
  try {
    const me = await workerFromReq(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    if (!["admin", "central"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const clienteId = String(body?.cliente_id || "").trim();

    if (!clienteId) {
      return NextResponse.json({ ok: false, error: "CLIENTE_REQUIRED" }, { status: 400 });
    }

    const clienteCompra = Boolean(body?.cliente_compra_minutos);
    const usoTipo = String(body?.uso_tipo || "").trim();

    const codigo1 = cleanText(body?.codigo_1);
    const codigo2 = cleanText(body?.codigo_2);

    const minutos1 = toNum(body?.minutos_1);
    const minutos2 = toNum(body?.minutos_2);

    const guardadosFree = toNum(body?.guardados_free);
    const guardadosNormales = toNum(body?.guardados_normales);

    const tarotistaWorkerId = cleanText(body?.tarotista_worker_id);
    const tarotistaManualCall = cleanText(body?.tarotista_manual_call);

    const formaPago = cleanText(body?.forma_pago);
    const importe = toNum(body?.importe);
    const clasificacion = String(body?.clasificacion || "nada").trim();

    if (!clienteCompra && usoTipo !== "minutos" && usoTipo !== "7free") {
      return NextResponse.json({ ok: false, error: "USO_TIPO_INVALIDO" }, { status: 400 });
    }

    if (clienteCompra && !(formaPago && importe > 0)) {
      return NextResponse.json({ ok: false, error: "PAGO_REQUIRED" }, { status: 400 });
    }

    const admin = adminClient();

    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, minutos_free_pendientes, minutos_normales_pendientes")
      .eq("id", clienteId)
      .maybeSingle();

    if (clienteError) throw clienteError;
    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });
    }

    let tarotistaNombre: string | null = null;

    if (tarotistaWorkerId) {
      const { data: tarotista } = await admin
        .from("workers")
        .select("display_name")
        .eq("id", tarotistaWorkerId)
        .maybeSingle();

      tarotistaNombre = tarotista?.display_name || null;
    }

    if (!tarotistaNombre && tarotistaManualCall) {
      tarotistaNombre = tarotistaManualCall;
    }

    const currentFree = toNum(cliente?.minutos_free_pendientes);
    const currentNormales = toNum(cliente?.minutos_normales_pendientes);

    const usedFree =
      (codigo1 === "FREE" ? minutos1 : 0) +
      (codigo2 === "FREE" ? minutos2 : 0);

    const usedNormales =
      (codigo1 && codigo1 !== "FREE" ? minutos1 : 0) +
      (codigo2 && codigo2 !== "FREE" ? minutos2 : 0);

    let nextFree = currentFree;
    let nextNormales = currentNormales;

    if (clienteCompra) {
      nextFree = Boolean(body?.guarda_minutos) ? guardadosFree : 0;
      nextNormales = Boolean(body?.guarda_minutos) ? guardadosNormales : 0;
    } else if (usoTipo === "minutos") {
      nextFree = Math.max(0, currentFree - usedFree);
      nextNormales = Math.max(0, currentNormales - usedNormales);
    }

    const tiempo =
      !clienteCompra && usoTipo === "7free"
        ? 7
        : minutos1 + minutos2;

    const resumenCodigo =
      [codigoText(minutos1, codigo1), codigoText(minutos2, codigo2)]
        .filter(Boolean)
        .join(" · ") ||
      (!clienteCompra && usoTipo === "7free" ? "7 free" : null);

    const clienteNombre = joinClienteName(cliente);
    const esCall = Boolean(tarotistaManualCall);

    const promo = clasificacion === "promo";
    const captado = clasificacion === "captado";
    const recuperado = clasificacion === "recuperado";

    const mismaCompra = Boolean(body?.misma_compra);

    // 🔥 INSERT CORREGIDO
    const { data: inserted, error: insertError } = await admin
      .from("rendimiento_llamadas")
      .insert([{
        fecha: new Date().toISOString().slice(0, 10),
        fecha_hora: new Date().toISOString(),

        cliente_id: clienteId,
        cliente_nombre: clienteNombre,

        telefonista_worker_id: me.id,
        telefonista_nombre: me.display_name || me.email || "Central",

        tarotista_worker_id: tarotistaWorkerId,
        tarotista_nombre: tarotistaNombre,
        tarotista_manual_call: tarotistaManualCall,

        llamada_call: esCall,

        tipo_registro: clienteCompra ? "compra" : usoTipo,
        cliente_compra_minutos: clienteCompra,

        usa_7_free: !clienteCompra && usoTipo === "7free",
        usa_minutos: !clienteCompra && usoTipo === "minutos",

        misma_compra: mismaCompra,

        guarda_minutos: Boolean(body?.guarda_minutos),
        minutos_guardados_free: guardadosFree,
        minutos_guardados_normales: guardadosNormales,

        codigo_1: codigo1,
        minutos_1: minutos1,

        codigo_2: codigo2,
        minutos_2: minutos2,

        resumen_codigo: resumenCodigo,
        tiempo,

        forma_pago: formaPago,
        importe,

        promo,
        captado,
        recuperado,
      }])
      .select();

    if (insertError) {
      console.error("❌ ERROR INSERT RENDIMIENTO:", insertError);
      return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
    }

    console.log("✅ INSERT OK:", inserted);

    // UPDATE CRM
    await admin
      .from("crm_clientes")
      .update({
        minutos_free_pendientes: nextFree,
        minutos_normales_pendientes: nextNormales,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clienteId);

    // NOTA CRM
    await admin.from("crm_client_notes").insert({
      cliente_id: clienteId,
      texto: "Llamada registrada automáticamente desde sistema rendimiento",
      author_name: me.display_name || "Central",
    });

    return NextResponse.json({
      ok: true,
      data: inserted,
    });

  } catch (e: any) {
    console.error("🔥 ERROR GENERAL:", e);
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
