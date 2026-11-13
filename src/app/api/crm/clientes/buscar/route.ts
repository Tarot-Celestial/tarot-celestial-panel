import { NextResponse } from "next/server";
import { calcClientRank, loadRolling30ClientTotals } from "@/lib/server/client-ranks";
import { normalizeClientRank } from "@/lib/server/client-rank-effective";
import { centralWorkspaceIdentity, centralWorkspaceAccessFailure } from "@/lib/server/central-workspace-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } });
}

function normalizePhoneDigits(phone: string) {
  return phone.replace(/\D/g, "");
}

function normalizeSpanishPhone(phone: string) {
  const digits = normalizePhoneDigits(phone || "");
  if (!digits) return "";
  if (digits.startsWith("0034")) return digits.slice(4);
  if (digits.startsWith("34") && digits.length > 9) return digits.slice(2);
  return digits;
}

function clientWebMeta(cliente: any) {
  const onboardingDone = Boolean(cliente?.onboarding_completado);
  const accessCount = Math.max(0, Number(cliente?.total_accesos || 0));
  const lastAccessAt = cliente?.ultimo_acceso_at || null;
  const lastActivityAt = cliente?.ultima_actividad_at || null;
  const registered = Boolean(onboardingDone || accessCount > 0 || lastAccessAt || lastActivityAt);
  return { registered, onboardingDone };
}

export async function GET(req: Request) {
  try {
    const { db: admin } = await centralWorkspaceIdentity(req);

    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get("q") || "").trim();
    const telefono = String(searchParams.get("telefono") || "").trim();
    const telefonoDigits = normalizeSpanishPhone(telefono);
    const pais = String(searchParams.get("pais") || "").trim();
    const etiqueta = String(searchParams.get("etiqueta") || searchParams.get("tag") || "").trim().toLowerCase();
    const rango = String(searchParams.get("rango") || "").trim().toLowerCase();
    const webFilter = String(searchParams.get("web_filter") || "todos").trim().toLowerCase();

    const pageSize = 120;
    const cursor = searchParams.get("cursor") || "";
    if (cursor && !UUID.test(cursor)) {
      return json({ ok: false, error: "PAGINA_INVALIDA" }, 400);
    }
    let etiquetaIdsFiltro: string[] | null = null;

    if (etiqueta) {
      const { data: etiquetasData, error: tagsErr } = await admin.from("crm_etiquetas").select("id").ilike("nombre", etiqueta);
      if (tagsErr) throw tagsErr;
      const idsEtiqueta = (etiquetasData || []).map((e: any) => String(e.id));
      if (!idsEtiqueta.length) return json({ ok: true, clientes: [] });
      etiquetaIdsFiltro = idsEtiqueta;
    }

    let query = admin
      .from("crm_clientes")
      .select("id, nombre, apellido, telefono, telefono_normalizado, email, pais, notas, origen, updated_at, created_at, onboarding_completado, total_accesos, ultimo_acceso_at, ultima_actividad_at, minutos_free_pendientes, minutos_normales_pendientes, deuda_pendiente"
        + (etiquetaIdsFiltro ? ",crm_cliente_etiquetas!inner(etiqueta_id)" : ""))
      // IDs are immutable: purchases, calls and access heartbeats cannot move
      // an existing client behind a page that Central already loaded.
      .order("id", { ascending: true })
      .range(0, pageSize);

    if (cursor) query = query.gt("id", cursor);

    if (etiquetaIdsFiltro) query = query.in("crm_cliente_etiquetas.etiqueta_id", etiquetaIdsFiltro);

    const searchQ = q.replace(/[%]/g, " ").replace(/,/g, " ").trim();
    const qDigits = normalizeSpanishPhone(searchQ);
    const qParts = searchQ.split(" ").filter(Boolean);

    if (qDigits || telefonoDigits) {
      const phoneSearch = telefonoDigits || qDigits;
      const phoneCandidates = Array.from(
        new Set(
          [
            phoneSearch,
            phoneSearch.replace(/^34/, ""),
            `34${phoneSearch.replace(/^34/, "")}`,
            `0034${phoneSearch.replace(/^34/, "")}`,
          ].filter(Boolean)
        )
      );

      const phoneOrParts: string[] = [];
      for (const candidate of phoneCandidates) {
        phoneOrParts.push(`telefono_normalizado.eq.${candidate}`);
        phoneOrParts.push(`telefono.eq.${candidate}`);
      }

      query = query.or(phoneOrParts.join(","));
    } else if (searchQ) {
      const orParts: string[] = [
        `nombre.ilike.%${searchQ}%`,
        `apellido.ilike.%${searchQ}%`,
        `email.ilike.%${searchQ}%`,
      ];

      if (qParts.length >= 2) {
        const first = qParts[0];
        const second = qParts.slice(1).join(" ");
        orParts.push(`and(nombre.ilike.%${first}%,apellido.ilike.%${second}%)`);
        orParts.push(`and(nombre.ilike.%${second}%,apellido.ilike.%${first}%)`);
      }

      query = query.or(orParts.join(","));
    }

    if (pais) query = query.ilike("pais", `%${pais}%`);

    const { data, error } = await query;
    if (error) throw error;
    const hasMore = (data || []).length > pageSize;
    let clientes: any[] = (data || []).slice(0, pageSize).map((row: any) => {
      const { crm_cliente_etiquetas: _filterRelations, ...cliente } = row;
      return cliente;
    });
    const pagination = {
      has_more: hasMore,
      next_cursor: hasMore ? String(clientes[pageSize - 1].id) : null,
      scanned_count: clientes.length,
    };

    clientes = clientes.filter((c: any) => !String(c?.origen || "").toLowerCase().includes("orion"));

    const ids = clientes.map((c: any) => String(c.id)).filter(Boolean);
    if (!ids.length) return json({ ok: true, clientes: [], ...pagination });

    const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: rels }, { data: etiquetasData }] = await Promise.all([
      admin.from("crm_cliente_etiquetas").select("cliente_id, etiqueta_id").in("cliente_id", ids),
      admin.from("crm_etiquetas").select("id, nombre"),
    ]);

    const etiquetaMap = new Map((etiquetasData || []).map((e: any) => [String(e.id), e.nombre]));
    const byCliente = new Map<string, string[]>();
    for (const r of rels || []) {
      const cid = String(r.cliente_id || "");
      const nombre = etiquetaMap.get(String(r.etiqueta_id || ""));
      if (!cid || !nombre) continue;
      const arr = byCliente.get(cid) || [];
      arr.push(nombre);
      byCliente.set(cid, Array.from(new Set(arr)));
    }

    const nowIso = new Date().toISOString();
    const [totals, overridesResult] = await Promise.all([
      loadRolling30ClientTotals(admin, clientes, sinceIso, nowIso),
      admin
        .from("client_rank_overrides")
        .select("id,client_id,assigned_rank,intervention_type,starts_at,ends_at,reason,notes,created_at")
        .in("client_id", ids)
        .eq("active", true)
        .lte("starts_at", nowIso)
        .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
        .order("created_at", { ascending: false }),
    ]);

    if (overridesResult.error && overridesResult.error.code !== "42P01") throw overridesResult.error;

    // Una sola consulta para todos los resultados: evita N+1 y mantiene el mismo
    // criterio de vigencia utilizado por loadEffectiveClientRank().
    const overrideByClient = new Map<string, any>();
    for (const item of overridesResult.data || []) {
      const clientId = String(item?.client_id || "");
      const assignedRank = normalizeClientRank(item?.assigned_rank);
      if (!clientId || !assignedRank || overrideByClient.has(clientId)) continue;
      overrideByClient.set(clientId, { ...item, assigned_rank: assignedRank });
    }

    clientes = clientes
      .map((c: any) => {
        const clientId = String(c.id);
        const rankInfo = totals.get(clientId) || { total: 0, compras: 0 };
        const automaticRank = normalizeClientRank(calcClientRank(rankInfo.total));
        const override = overrideByClient.get(clientId) || null;
        const effectiveRank = override?.assigned_rank || automaticRank;
        return {
          ...c,
          etiquetas: byCliente.get(clientId) || [],
          // Compatibilidad: los listados existentes leen rango_actual.
          rango_actual: effectiveRank,
          rango_automatico: automaticRank,
          rango_efectivo: effectiveRank,
          has_manual_override: Boolean(override),
          override_type: override?.intervention_type || null,
          override_starts_at: override?.starts_at || null,
          override_expires_at: override?.ends_at || null,
          override_reason: override?.reason || null,
          rango_gasto_mes_anterior: Number(rankInfo.total.toFixed(2)),
          rango_compras_mes_anterior: rankInfo.compras,
          rango_actual_desde: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          rango_actual_hasta: new Date().toISOString().slice(0, 10),
        };
      })
      .filter((c: any) => {
        if (rango && ["bronce", "plata", "oro", "diamante"].includes(rango) && c.rango_efectivo !== rango) return false;
        const web = clientWebMeta(c);
        if (webFilter === "registrados") return web.registered;
        if (webFilter === "no_registrados") return !web.registered;
        if (webFilter === "onboarding_pendiente") return web.registered && !web.onboardingDone;
        return true;
      });

    return json({ ok: true, clientes, ...pagination });
  } catch (e: any) {
    const accessFailure = centralWorkspaceAccessFailure(e);
    if (accessFailure) return accessFailure;
    return json({ ok: false, error: e?.message || "ERR" }, 500);
  }
}
