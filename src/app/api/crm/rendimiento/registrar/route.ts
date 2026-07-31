
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";

const MONTH_TAGS = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

async function syncClienteMonthTag(admin: any, clienteId: string) {
  const fecha = new Date();

const monthName = `${MONTH_TAGS[fecha.getMonth()]} ${fecha.getFullYear()}`;

  const { data: allTags } = await admin
    .from("crm_etiquetas")
    .select("id,nombre");

  const monthTags = (allTags || []).filter((t: any) =>
    MONTH_TAGS.some((m) =>   String(t?.nombre || '').toLowerCase().startsWith(m.toLowerCase()) )
  );

  let currentMonthTag = monthTags.find((t: any) =>
    String(t?.nombre || '').toLowerCase() === monthName.toLowerCase()
  );

  if (!currentMonthTag) {
    const { data: createdTag } = await admin
      .from("crm_etiquetas")
      .insert({ nombre: monthName })
      .select("id,nombre")
      .single();

    currentMonthTag = createdTag;
  }

  const monthTagIds = monthTags
    .map((t: any) => t.id)
    .filter(Boolean);

  if (monthTagIds.length > 0) {
    await admin
      .from("crm_cliente_etiquetas")
      .delete()
      .eq("cliente_id", clienteId)
      .in("etiqueta_id", monthTagIds);
  }

  if (currentMonthTag?.id) {
    await admin
      .from("crm_cliente_etiquetas")
      .upsert({
        cliente_id: clienteId,
        etiqueta_id: currentMonthTag.id,
      }, {
        onConflict: 'cliente_id,etiqueta_id'
      });
  }
}


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

  const { data } = getAuthUserFromRequest(req);
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return UUID_PATTERN.test(String(value ?? "").trim());
}

function clientIdentificationError() {
  return NextResponse.json(
    { ok: false, error: "CLIENTE_UUID_INVALID" },
    { status: 400 }
  );
}

function joinClienteName(cliente: any) {
  return [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || cliente?.telefono || "Cliente";
}

function codigoText(mins: number, code: string | null) {
  if (!mins || mins <= 0 || !code) return "";
  return `${mins} ${String(code).toLowerCase()}`;
}

function pointsFromAmount(amount: number) {
  return Math.max(0, Math.floor(Number(amount || 0) * 10));
}

function buildNota({
  clienteCompra,
  usoTipo,
  importe,
  formaPago,
  guardadosFree,
  guardadosNormales,
  resumenCodigo,
  tarotistaNombre,
  nextFree,
  nextNormales,
  origenColaborador,
}: any) {
  const origen = origenColaborador ? ` Origen: ${origenColaborador}.` : "";
  if (!clienteCompra && usoTipo === "7free") {
    return `Cliente usa 7 free con ${tarotistaNombre || "tarotista sin indicar"}.${origen}`;
  }
  if (!clienteCompra && usoTipo === "minutos") {
    return `Cliente usa ${resumenCodigo || "minutos"} con ${tarotistaNombre || "tarotista sin indicar"}. Pendiente CRM: ${nextFree || 0} free y ${nextNormales || 0} normales.${origen}`;
  }
  const partes = [
    `Compra registrada por ${Number(importe || 0).toFixed(2)} € vía ${formaPago || "sin método"}.`,
    `Guarda ${guardadosFree || 0} free y ${guardadosNormales || 0} normales.`,
  ];
  if (resumenCodigo) partes.push(`Uso actual: ${resumenCodigo}.`);
  partes.push(`Tarotista: ${tarotistaNombre || "sin indicar"}.`);
  if (origenColaborador) partes.push(`Origen: ${origenColaborador}.`);
  return partes.join(" ").replace(/\s+/g, " ").trim();
}

export async function POST(req: Request) {
  try {
    const me = await workerFromReq(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const requestedClienteId = String(body?.cliente_id || "").trim();
    if (!requestedClienteId) return NextResponse.json({ ok: false, error: "CLIENTE_REQUIRED" }, { status: 400 });
    if (!isUuid(requestedClienteId)) {
      console.error("[CRM registrar llamada] cliente_id recibido no es un UUID válido", {
        cliente_id: requestedClienteId,
        collaborator_source: body?.collaborator_source || null,
      });
      return clientIdentificationError();
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
    const collaboratorSource = cleanText(body?.collaborator_source);
    const formaPago = cleanText(body?.forma_pago);
    const importe = toNum(body?.importe);
    const clasificacion = String(body?.clasificacion || "nada").trim();

    if (!clienteCompra && usoTipo !== "minutos" && usoTipo !== "7free") {
      return NextResponse.json({ ok: false, error: "USO_TIPO_INVALIDO" }, { status: 400 });
    }
    if (clienteCompra && !(formaPago && importe > 0)) {
      return NextResponse.json({ ok: false, error: "PAGO_REQUIRED" }, { status: 400 });
    }
    if (collaboratorSource && collaboratorSource !== "CALL_MARIO") {
      return NextResponse.json({ ok: false, error: "COLLABORATOR_SOURCE_INVALID" }, { status: 400 });
    }
    if (collaboratorSource === "CALL_MARIO" && !tarotistaWorkerId) {
      return NextResponse.json({ ok: false, error: "MARIO_TAROTISTA_REQUIRED" }, { status: 400 });
    }

    const admin = adminClient();
    const { data: cliente, error: clienteError } = await admin
      .from("crm_clientes")
.select("id, nombre, apellido, telefono, minutos_free_pendientes, minutos_normales_pendientes, puntos")
      .eq("id", requestedClienteId)
      .maybeSingle();
    if (clienteError) {
      console.error("[CRM registrar llamada] error resolviendo el cliente", clienteError);
      return clientIdentificationError();
    }
    if (!cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404 });

    // A partir de aquí se usa exclusivamente el ID devuelto por crm_clientes.
    // Así cliente, colaborador y tarotista nunca comparten el mismo identificador.
    const clienteId = String(cliente.id || "").trim();
    if (!isUuid(clienteId)) {
      console.error("[CRM registrar llamada] crm_clientes devolvió un ID no UUID", { cliente_id: clienteId });
      return clientIdentificationError();
    }

    let billingCollaboratorId: string | null = null;
    let sourceTagId: string | null = null;
    let collaboratorDisplayName: string | null = null;

    if (collaboratorSource === "CALL_MARIO") {
      const { data: activeCollaborators, error: collaboratorError } = await admin
        .from("billing_collaborators")
        .select("id, display_name, tag_id, is_active")
        .eq("is_active", true);
      if (collaboratorError) throw collaboratorError;

      const configuredTagIds = Array.from(new Set(
        (activeCollaborators || []).map((row: any) => String(row?.tag_id || "")).filter(Boolean)
      ));
      if (!configuredTagIds.length) {
        return NextResponse.json({ ok: false, error: "MARIO_COLLABORATOR_NOT_CONFIGURED" }, { status: 409 });
      }

      const { data: marioTags, error: marioTagError } = await admin
        .from("crm_etiquetas")
        .select("id, nombre")
        .in("id", configuredTagIds)
        .ilike("nombre", "CALL MARIO")
        .limit(1);
      if (marioTagError) throw marioTagError;

      const marioTag = marioTags?.[0] || null;
      if (!marioTag?.id) {
        return NextResponse.json({ ok: false, error: "CALL_MARIO_TAG_NOT_CONFIGURED" }, { status: 409 });
      }

      const collaborator = (activeCollaborators || []).find(
        (row: any) => String(row?.tag_id || "") === String(marioTag.id)
      );
      if (!collaborator?.id) {
        return NextResponse.json({ ok: false, error: "MARIO_COLLABORATOR_NOT_CONFIGURED" }, { status: 409 });
      }

      billingCollaboratorId = String(collaborator.id);
      sourceTagId = String(marioTag.id);
      collaboratorDisplayName = String(collaborator.display_name || marioTag.nombre || "Mario");
    }

    let tarotistaNombre: string | null = null;
    if (tarotistaWorkerId) {
      const { data: tarotista, error: tarotistaError } = await admin
        .from("workers")
        .select("display_name, is_active, role")
        .eq("id", tarotistaWorkerId)
        .maybeSingle();
      if (tarotistaError) throw tarotistaError;
      if (!tarotista || tarotista.is_active === false || String(tarotista.role || "") !== "tarotista") {
        return NextResponse.json({ ok: false, error: "TAROTISTA_INACTIVA" }, { status: 400 });
      }
      tarotistaNombre = tarotista?.display_name || null;
    }
    if (!tarotistaNombre && tarotistaManualCall) tarotistaNombre = tarotistaManualCall;

    const currentFree = toNum(cliente?.minutos_free_pendientes);
    const currentNormales = toNum(cliente?.minutos_normales_pendientes);
    const usedFree = (codigo1 === "FREE" ? minutos1 : 0) + (codigo2 === "FREE" ? minutos2 : 0);
    const usedNormales = (codigo1 && codigo1 !== "FREE" ? minutos1 : 0) + (codigo2 && codigo2 !== "FREE" ? minutos2 : 0);

    let nextFree = currentFree;
    let nextNormales = currentNormales;
    if (clienteCompra) {
      nextFree = Boolean(body?.guarda_minutos) ? guardadosFree : 0;
      nextNormales = Boolean(body?.guarda_minutos) ? guardadosNormales : 0;
    } else if (usoTipo === "minutos") {
      nextFree = Math.max(0, currentFree - usedFree);
      nextNormales = Math.max(0, currentNormales - usedNormales);
    }

    const tiempo = !clienteCompra && usoTipo === "7free" ? 7 : minutos1 + minutos2;
    const resumenCodigo = [codigoText(minutos1, codigo1), codigoText(minutos2, codigo2)].filter(Boolean).join(" · ") || (!clienteCompra && usoTipo === "7free" ? "7 free" : null);
    const clienteNombre = joinClienteName(cliente);
    const esCall = Boolean(tarotistaManualCall);
    const promo = clasificacion === "promo";
    const captado = clasificacion === "captado";
    const recuperado = clasificacion === "recuperado";
    const mismaCompra = Boolean(body?.misma_compra);

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
        billing_collaborator_id: billingCollaboratorId,
        source_tag_id: sourceTagId,
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
      console.error("[CRM registrar llamada] fallo insertando rendimiento_llamadas", {
        message: insertError.message,
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
        cliente_id: clienteId,
        billing_collaborator_id: billingCollaboratorId,
        source_tag_id: sourceTagId,
      });
      if (/cliente_id/i.test(String(insertError.message || "")) && /uuid/i.test(String(insertError.message || ""))) {
        return clientIdentificationError();
      }
      return NextResponse.json({ ok: false, error: "CALL_REGISTER_FAILED" }, { status: 500 });
    }

    const { error: updateError } = await admin
      .from("crm_clientes")
      .update({
        minutos_free_pendientes: nextFree,
        minutos_normales_pendientes: nextNormales,
        updated_at: new Date().toISOString(),
      })
      .eq("id", clienteId);
    if (updateError) throw updateError;

    await syncClienteMonthTag(admin, clienteId);

    const notaTexto = buildNota({
      clienteCompra,
      usoTipo,
      importe,
      formaPago,
      guardadosFree,
      guardadosNormales,
      resumenCodigo,
      tarotistaNombre,
      nextFree,
      nextNormales,
      origenColaborador: collaboratorDisplayName ? "CALL MARIO" : null,
    });
    const { error: noteError } = await admin.from("crm_client_notes").insert({
      cliente_id: clienteId,
      texto: notaTexto,
      author_user_id: me.user_id || null,
      author_name: me.display_name || me.email || "Central",
      author_email: me.email || null,
      is_pinned: false,
    });
    if (noteError) throw noteError;

    if (clienteCompra && importe > 0) {
      const puntosGanados = pointsFromAmount(importe);
      if (puntosGanados > 0) {
        const puntosActuales = Number((cliente as any)?.puntos || 0);
        await admin
          .from("crm_clientes")
          .update({
            puntos: puntosActuales + puntosGanados,
            updated_at: new Date().toISOString(),
          })
          .eq("id", clienteId);

        await admin.from("cliente_puntos_historial").insert({
          cliente_id: clienteId,
          tipo: "ganado",
          puntos: puntosGanados,
          descripcion: `Compra registrada desde rendimiento por ${importe.toFixed(2)} € vía ${formaPago || "sin método"}.`,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      data: inserted,
      message: collaboratorDisplayName
        ? "✅ Llamada registrada y vinculada a CALL MARIO"
        : "✅ Llamada registrada correctamente",
    });
  } catch (e: any) {
    console.error("🔥 ERROR GENERAL:", e);
    const technicalMessage = String(e?.message || "");
    if (/cliente_id/i.test(technicalMessage) && /uuid/i.test(technicalMessage)) {
      return clientIdentificationError();
    }
    return NextResponse.json({ ok: false, error: "CALL_REGISTER_FAILED" }, { status: 500 });
  }
}

