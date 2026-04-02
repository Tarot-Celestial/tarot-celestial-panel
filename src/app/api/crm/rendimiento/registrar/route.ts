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

// 🔥 NUEVO: GENERADOR DE NOTA PRO
function buildNota({
  clienteCompra,
  importe,
  formaPago,
  guardadosFree,
  guardadosNormales,
  usedFree,
  usedNormales,
  tarotistaNombre,
}: any) {
  let nota = "";

  if (clienteCompra) {
    nota += `Compra registrada por ${Number(importe).toFixed(2)} € vía ${formaPago || "—"}. `;
  }

  if (guardadosFree || guardadosNormales) {
    nota += `Guarda ${guardadosFree || 0} free y ${guardadosNormales || 0} normales. `;
  }

  if (usedFree || usedNormales) {
    nota += `Uso actual: ${usedFree || 0} free · ${usedNormales || 0} cliente. `;
  }

  if (tarotistaNombre) {
    nota += `Tarotista: ${tarotistaNombre}.`;
  }

  return nota.trim();
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

    const admin = adminClient();

    const { data: cliente } = await admin
      .from("crm_clientes")
      .select("*")
      .eq("id", clienteId)
      .maybeSingle();

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

    const notaTexto = buildNota({
      clienteCompra,
      importe,
      formaPago,
      guardadosFree,
      guardadosNormales,
      usedFree,
      usedNormales,
      tarotistaNombre,
    });

    // 🔥 NOTA NUEVA
    await admin.from("crm_client_notes").insert({
      cliente_id: clienteId,
      texto: notaTexto,
      author_name: me.display_name || "Central",
    });

    return NextResponse.json({ ok: true });

  } catch (e: any) {
    console.error("🔥 ERROR GENERAL:", e);
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
