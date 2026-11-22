import { officeAccess, officeError, officeJson } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const [settings, lines] = await Promise.all([
      access.admin.from("office_capture_settings").select("enabled,last_round_at,last_round").eq("id", true).single(),
      access.admin.from("office_capture_lines").select("country,phone,enabled").order("country"),
    ]);
    if (settings.error || lines.error) throw Error();
    return officeJson({ ...settings.data, lines: lines.data });
  } catch { return officeError("No se pudo consultar la configuración de Captación.", 503); }
}

export async function POST(req: Request) {
  try {
    const access = await officeAccess(req);
    if (!access.ok) return access.response;
    const body = await req.json().catch(() => null);
    if (typeof body?.enabled !== "boolean") return officeError("Elige el estado de las respuestas o de la línea.", 400);
    if (body.country !== undefined && (typeof body.country !== "string" || !/^[A-Z]{2}$/.test(body.country))) return officeError("País no válido.", 400);
    const result = body.country
      ? await access.admin.from("office_capture_lines").update({ enabled: body.enabled }).eq("country", body.country).select("country").maybeSingle()
      : await access.admin.from("office_capture_settings").update({ enabled: body.enabled, actor_user_id: access.authUserId }).eq("id", true).select("id").maybeSingle();
    if (result.error) throw Error();
    return result.data ? officeJson({ ok: true }) : officeError("La configuración ya no está disponible.", 404);
  } catch { return officeError("No se pudo guardar el cambio de Captación.", 503); }
}
