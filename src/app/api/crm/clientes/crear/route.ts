import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

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
    .select("id, user_id, display_name, role, team, state, is_active")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

function workerIsEnabled(worker: any) {
  const state = String(worker?.state || "").trim().toLowerCase();
  return worker?.is_active !== false && !["inactive", "inactivo", "disabled", "desactivado", "baja"].includes(state);
}

export async function GET(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const admin = adminClient();
    if (worker.role === "central") {
      if (!workerIsEnabled(worker)) return NextResponse.json({ ok: false, error: "WORKER_INACTIVO" }, { status: 403 });
      return NextResponse.json({
        ok: true,
        can_assign: false,
        current_worker_id: worker.id,
        workers: [{ id: worker.id, display_name: worker.display_name, team: worker.team, role: worker.role, is_active: true }],
      });
    }

    const { data: workers, error } = await admin
      .from("workers")
      .select("id, display_name, team, role, state, is_active")
      .eq("role", "central")
      .or("is_active.is.null,is_active.eq.true")
      .order("display_name", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      can_assign: true,
      current_worker_id: null,
      workers: (workers || []).filter(workerIsEnabled),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

function normalizePhone(v: any) {
  return String(v || "").replace(/[^\d+]/g, "").trim();
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const nombre = String(body?.nombre || "").trim();
    const apellido = String(body?.apellido || "").trim();
    const telefono = normalizePhone(body?.telefono);
    const telefono_normalizado = telefono.replace(/\D/g, "");
    const pais = String(body?.pais || "").trim();
    const email = String(body?.email || "").trim();
    const notas = String(body?.notas || "").trim();
    const requestedBrand = String(body?.brand || "").trim().toLowerCase() === "orion" ? "orion" : "celestial";
    const requestedOrigin = String(body?.origen || "manual").trim();
    const source = String(body?.source || "").trim();
    const requestedResponsibleId = String(body?.responsible_worker_id || "").trim();
    const origen = worker.role === "central"
      ? (requestedBrand === "orion" ? "tarot_orion" : "tarot_celestial")
      : requestedOrigin;
    const etiquetaIds = Array.from(new Set(
      (Array.isArray(body?.etiquetas) ? body.etiquetas : []).map((value: unknown) => String(value || "").trim()).filter(Boolean)
    ));

    const deuda_pendiente = Number(body?.deuda_pendiente || 0) || 0;
    const minutos_free_pendientes = Number(body?.minutos_free_pendientes || 0) || 0;
    const minutos_normales_pendientes = Number(body?.minutos_normales_pendientes || 0) || 0;

    if (!nombre) {
      return NextResponse.json({ ok: false, error: "FALTA_NOMBRE" }, { status: 400 });
    }

    if (!telefono) {
      return NextResponse.json({ ok: false, error: "FALTA_TELEFONO" }, { status: 400 });
    }

    const admin = adminClient();

    let responsibleWorker: any = null;
    if (worker.role === "central") {
      if (requestedResponsibleId && requestedResponsibleId !== String(worker.id)) {
        return NextResponse.json({ ok: false, error: "NO_PUEDE_ASIGNAR_OTRA_TELEFONISTA" }, { status: 403 });
      }
      if (!workerIsEnabled(worker)) return NextResponse.json({ ok: false, error: "WORKER_INACTIVO" }, { status: 403 });
      responsibleWorker = worker;
    } else if (requestedResponsibleId) {
      const { data: candidate, error: candidateError } = await admin
        .from("workers")
        .select("id, display_name, team, role, state, is_active")
        .eq("id", requestedResponsibleId)
        .maybeSingle();
      if (candidateError) throw candidateError;
      if (!candidate || String(candidate.role || "") !== "central" || !workerIsEnabled(candidate)) {
        return NextResponse.json({ ok: false, error: "RESPONSABLE_NO_VALIDO" }, { status: 400 });
      }
      responsibleWorker = candidate;
    } else if (source === "mis_clientas") {
      return NextResponse.json({ ok: false, error: "FALTA_RESPONSABLE" }, { status: 400 });
    }

    const targetIsOrion = String(origen || "").toLowerCase().includes("orion");
    const { data: existingRows, error: existingError } = await admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, origen, captured_by_worker_id")
      .or(`telefono.eq.${telefono},telefono_normalizado.eq.${telefono_normalizado}`);

    if (existingError) throw existingError;

    const sameBrand = (existingRows || []).find((row: any) => {
      const rowIsOrion = String(row?.origen || "").toLowerCase().includes("orion");
      return rowIsOrion === targetIsOrion;
    });

    if (sameBrand) {
      return NextResponse.json(
        { ok: false, error: "CLIENTE_YA_EXISTE_EN_ESTA_MARCA", cliente: sameBrand },
        { status: 409 }
      );
    }

    const otherBrandClients = (existingRows || []).filter((row: any) => {
      const rowIsOrion = String(row?.origen || "").toLowerCase().includes("orion");
      return rowIsOrion !== targetIsOrion;
    });

    let crossBrandInfo: any = null;
    if (otherBrandClients.length) {
      const otherIds = otherBrandClients.map((row: any) => String(row.id));
      const [{ data: rels }, { data: tags }] = await Promise.all([
        admin.from("crm_cliente_etiquetas").select("cliente_id, etiqueta_id").in("cliente_id", otherIds),
        admin.from("crm_etiquetas").select("id, nombre"),
      ]);
      const tagNameById = new Map((tags || []).map((tag: any) => [String(tag.id), String(tag.nombre || "")]));
      const etiquetas = Array.from(new Set((rels || []).map((rel: any) => tagNameById.get(String(rel.etiqueta_id))).filter(Boolean)));
      const other = otherBrandClients[0];
      crossBrandInfo = {
        brand: targetIsOrion ? "celestial" : "orion",
        cliente_id: other.id,
        nombre: [other.nombre, other.apellido].filter(Boolean).join(" ").trim(),
        etiquetas,
      };
    }

     const payload: any = {
    nombre,
    apellido: apellido || null,
    telefono,
    telefono_normalizado,
    pais: pais || null,
    email: email || null,
    notas: notas || null,
    origen: origen || "manual",
    deuda_pendiente,
    minutos_free_pendientes,
    minutos_normales_pendientes,
  };

    const { data: cliente, error } = await admin
      .from("crm_clientes")
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    let tagWarning: string | null = null;
    if (etiquetaIds.length) {
      const { data: validTags, error: validTagsError } = await admin
        .from("crm_etiquetas")
        .select("id")
        .in("id", etiquetaIds);
      if (validTagsError) {
        tagWarning = "NO_SE_PUDIERON_VALIDAR_LAS_ETIQUETAS";
      } else {
        const validIds = (validTags || []).map((tag: any) => String(tag.id));
        if (validIds.length) {
          const { error: tagError } = await admin.from("crm_cliente_etiquetas").insert(
            validIds.map((etiqueta_id) => ({ cliente_id: cliente.id, etiqueta_id }))
          );
          if (tagError) tagWarning = "CLIENTA_CREADA_SIN_ETIQUETAS";
        }
      }
    }

    if (responsibleWorker) {
      const { error: assignmentError } = await admin.from("crm_client_capture_assignments").insert({
        client_id: cliente.id,
        business: requestedBrand,
        created_by_worker_id: responsibleWorker.id,
        responsible_worker_id: responsibleWorker.id,
        status: "pending",
      });
      if (assignmentError) throw assignmentError;
    }

    return NextResponse.json({
      ok: true,
      cliente,
      msg: "Cliente creado correctamente",
      cross_brand_warning: crossBrandInfo,
      tag_warning: tagWarning,
      xp_event: null,
      capture_status: responsibleWorker ? "pending_first_valid_contact" : "pending_review",
      responsable: responsibleWorker ? { id: responsibleWorker.id, display_name: responsibleWorker.display_name, team: responsibleWorker.team } : null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
