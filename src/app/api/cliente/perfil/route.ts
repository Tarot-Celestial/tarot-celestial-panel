import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate", Pragma: "no-cache", Expires: "0", Vary: "Authorization" };
const AVATAR_BUCKET = "client-profile-photos";

function cleanText(value: unknown, max = 120): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function cleanEmail(value: unknown): { value: string | null; error: string | null } {
  const email = String(value ?? "").trim().toLowerCase();
  if (!email) return { value: null, error: null };
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { value: null, error: "Introduce un email válido." };
  return { value: email, error: null };
}

function cleanDate(value: unknown): { value: string | null; error: string | null } {
  const text = String(value ?? "").trim();
  if (!text) return { value: null, error: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return { value: null, error: "La fecha introducida no es válida." };
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const valid = parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
  if (!valid || parsed.getTime() > Date.now()) return { value: null, error: "La fecha de nacimiento no es válida." };
  return { value: text, error: null };
}

function isInternalEmail(value: unknown) {
  return String(value || "").toLowerCase().endsWith("@auth.tarotcelestial.local");
}

async function signedAvatarUrl(admin: any, avatarPath: string | null | undefined) {
  if (!avatarPath) return null;
  const { data, error } = await admin.storage.from(AVATAR_BUCKET).createSignedUrl(avatarPath, 60 * 60);
  return error ? null : data?.signedUrl || null;
}


export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401, headers });
    if (!gate.cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers });

    const [{ data: freshCliente, error: freshClienteError }, { data: authData }, snapshotResult] = await Promise.all([
      gate.admin.from("crm_clientes").select("*").eq("id", gate.cliente.id).maybeSingle(),
      gate.admin.auth.admin.getUserById(gate.uid),
      gate.admin.rpc("tc_client_state_snapshot_diamond_v1", { p_cliente_id: gate.cliente.id }),
    ]);
    if (freshClienteError) throw freshClienteError;
    if (!freshCliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers });

    const authUser = authData?.user || null;
    const authEmail = String(authUser?.email || "");
    const authPhone = String(authUser?.phone || "");
    if (snapshotResult.error) throw snapshotResult.error;
    const snapshot = snapshotResult.data || {};
    const cliente = freshCliente;
    const avatarUrl = await signedAvatarUrl(gate.admin, cliente.avatar_path);
    const effectiveRank = String(snapshot.effective_rank || cliente.rango_actual || "sin_rango");

    return NextResponse.json({
      ok: true,
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre || "",
        apellido: cliente.apellido || "",
        email: cliente.email || gate.email || "",
        pais: cliente.pais || "",
        fecha_nacimiento: cliente.fecha_nacimiento || "",
        telefono: cliente.telefono || cliente.telefono_normalizado || gate.phone || "",
        telefono_normalizado: cliente.telefono_normalizado || "",
        onboarding_completado: Boolean(cliente.onboarding_completado),
        created_at: cliente.created_at || null,
        updated_at: cliente.updated_at || null,
        avatar_url: avatarUrl,
        rango_actual: effectiveRank,
        puntos: Math.max(0, Number(snapshot.coins || 0)),
        minutos_totales: Math.max(0, Number(snapshot.minutes_total || 0)),
        giros_totales: Math.max(0, Number(snapshot.spins?.total || 0)),
        tiradas_oraculo: Math.max(0, Number(snapshot.oracle_credits || 0)),
      },
      verification: {
        phone: Boolean(authUser?.phone_confirmed_at && authPhone),
        email: Boolean(authUser?.email_confirmed_at && authEmail && !isInternalEmail(authEmail)),
        profile: Boolean(cliente.onboarding_completado),
        password_access: Boolean(authUser?.email || authUser?.phone),
      },
    }, { headers });
  } catch (error: any) {
    console.error("[cliente-perfil:get]", { code: error?.code, message: error?.message });
    return NextResponse.json({ ok: false, error: "No hemos podido cargar tu perfil. Inténtalo de nuevo." }, { status: 500, headers });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401, headers });
    if (!gate.cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers });

    const body = await req.json().catch(() => ({}));
    const birthDate = cleanDate(body?.fecha_nacimiento);
    const email = cleanEmail(body?.email);
    if (birthDate.error || email.error) return NextResponse.json({ ok: false, error: birthDate.error || email.error }, { status: 400, headers });
    const nombre = cleanText(body?.nombre, 80);
    if (!nombre) return NextResponse.json({ ok: false, error: "Introduce tu nombre." }, { status: 400, headers });

    const patch = {
      nombre,
      apellido: cleanText(body?.apellido, 100),
      email: email.value,
      pais: cleanText(body?.pais, 80),
      fecha_nacimiento: birthDate.value,
      onboarding_completado: Boolean(gate.cliente.onboarding_completado || (nombre && birthDate.value)),
      updated_at: new Date().toISOString(),
    };
    const { data: updated, error } = await gate.admin
      .from("crm_clientes")
      .update(patch)
      .eq("id", gate.cliente.id)
      .select("id,nombre,apellido,email,pais,fecha_nacimiento,telefono,telefono_normalizado,onboarding_completado,created_at,updated_at,avatar_path,rango_actual,puntos,minutos_free_pendientes,minutos_normales_pendientes")
      .maybeSingle();
    if (error) throw error;
    if (!updated?.id) return NextResponse.json({ ok: false, error: "No se ha podido actualizar tu perfil." }, { status: 500, headers });

    const currentAuth = await gate.admin.auth.admin.getUserById(gate.uid);
    const { error: authError } = await gate.admin.auth.admin.updateUserById(gate.uid, {
      user_metadata: {
        ...(currentAuth.data?.user?.user_metadata || {}),
        crm_email: email.value,
        display_name: [nombre, patch.apellido].filter(Boolean).join(" "),
      },
    });
    if (authError) console.warn("[cliente-perfil:auth-metadata]", authError.message);

    return NextResponse.json({ ok: true, cliente: updated }, { headers });
  } catch (error: any) {
    console.error("[cliente-perfil:post]", { code: error?.code, message: error?.message });
    const duplicate = String(error?.code || "") === "23505";
    return NextResponse.json({ ok: false, error: duplicate ? "Este email ya está asociado a otra cuenta." : "No se ha podido guardar el perfil. Inténtalo de nuevo." }, { status: duplicate ? 409 : 500, headers });
  }
}
