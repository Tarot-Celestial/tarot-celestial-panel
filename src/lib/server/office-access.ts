import { requireAdmin } from "@/lib/admin/require-admin";
import { OFFICE_FILE_LIMIT } from "@/features/office/model";

export const officeHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
export const officeJson = (body: unknown, status = 200) => Response.json(body, { status, headers: officeHeaders });
export const officeError = (message: string, status: number) => officeJson({ ok: false, error: message }, status);
export const officeUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export async function officeAccess(req: Request) {
  const gate = await requireAdmin(req);
  if (gate.ok) return gate;
  return { ok: false as const, response: gate.error === "NO_AUTH"
    ? officeError("Inicia sesión para entrar en la Oficina.", 401)
    : officeError("La Oficina requiere acceso de administración.", 403) };
}

export function officeDatabaseError(error: { code?: string; message?: string }) {
  if (error.message === "OFFICE_RUN_ACTIVE") return officeError("Este encargo ya tiene una ejecución activa.", 409);
  if (error.message === "OFFICE_RUN_ALREADY_DELIVERED") return officeError("El borrador ya está entregado. Puedes solicitar una corrección desde Revisiones.", 409);
  if (error.message === "OFFICE_OFFER_UNAVAILABLE") return officeError("La oferta o la moneda seleccionada ya no están disponibles.", 409);
  if (error.message === "OFFICE_FORBIDDEN") return officeError("Se requiere acceso de administración.", 403);
  if (error.message === "OFFICE_NOT_FOUND") return officeError("El registro solicitado ya no está disponible.", 404);
  if (error.message === "OFFICE_CONFLICT") return officeError("El registro ha cambiado. Actualiza la Oficina antes de continuar.", 409);
  if (error.message === "OFFICE_INVALID" || error.code?.startsWith("22") || error.code?.startsWith("23")) {
    return officeError("Revisa los datos del encargo, el responsable y la versión seleccionada.", 400);
  }
  return officeError("No se pudo consultar la Oficina. Comprueba que su migración esté disponible.", 503);
}

class InputError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

const MAX_BODY_BYTES = 3 * 1024 * 1024;
async function readBody(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new InputError("Envía los datos en formato JSON.", 415);
  }
  const tooLarge = () => new InputError("El archivo supera el tamaño permitido.", 413);
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) throw tooLarge();
  const reader = req.body?.getReader();
  if (!reader) throw new InputError("Faltan los datos de la operación.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) { await reader.cancel(); throw tooLarge(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { throw new InputError("Los datos de la operación son ilegibles."); }
}

type Input = Record<string, unknown>;
function validFile(input: Input) {
  const { file_name: name, file_type: type, file_base64: base64 } = input;
  if (name == null && type == null && base64 == null) return false;
  if (typeof name !== "string" || !name.trim() || name.length > 180 || /[/\\:*?"<>|\x00-\x1f\x7f]/.test(name) ||
      typeof base64 !== "string" || !base64.length || base64.length > 4 * Math.ceil(OFFICE_FILE_LIMIT / 3)) {
    throw new InputError("Adjunta un archivo válido de hasta 2 MiB.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > OFFICE_FILE_LIMIT || bytes.toString("base64") !== base64) throw new InputError("El archivo es inválido o supera los 2 MiB.");
  const ext = name.split(".").pop()?.toLowerCase();
  const sig = (hex: string) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex,"hex"));
  let accepted = false;
  switch (type) {
    case "application/pdf": accepted = ext === "pdf" && sig("255044462d"); break;
    case "image/png": accepted = ext === "png" && sig("89504e470d0a1a0a"); break;
    case "image/jpeg": accepted = (ext === "jpeg" || ext === "jpg") && sig("ffd8ff"); break;
    case "image/webp": accepted = ext === "webp" && sig("52494646") && bytes.subarray(8,12).toString("ascii") === "WEBP"; break;
    case "text/plain":
      try { new TextDecoder("utf-8",{ fatal:true }).decode(bytes); accepted = ext === "txt" && !bytes.includes(0); } catch { /* Invalid UTF-8. */ }
      break;
  }
  if (!accepted) throw new InputError("El contenido debe coincidir con la extensión PDF, PNG, JPG, WEBP o TXT.");
  return true;
}

const nonempty = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const revision = (v: unknown, min = 1) => typeof v === "number" && Number.isSafeInteger(v) && v >= min;
const oneOf = (v: unknown, values: string[]) => typeof v === "string" && values.includes(v);
const nullableId = (v: unknown) => v === null || officeUuid(v);
const requiredText = (v: unknown, max: number) => typeof v === "string" && v.length <= max;
function validTask(i: Input) {
  return nonempty(i.department_id,80) && nonempty(i.objective,4000) && nonempty(i.expected_delivery,4000) &&
    oneOf(i.priority,["baja","media","alta"]) && oneOf(i.status,["pendiente","en_curso","en_revision","completado","cancelado"]) &&
    nonempty(i.time_zone,100) && (i.due_at === null || (typeof i.due_at === "string" && i.due_at.length < 60 &&
      /^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/i.test(i.due_at) && Number.isFinite(Date.parse(i.due_at)))) &&
    nullableId(i.assignee_worker_id) && (i.assignee_role === null || oneOf(i.assignee_role,["atlas","departamento"])) &&
    !(i.assignee_worker_id && i.assignee_role);
}

export async function officeInput(req: Request): Promise<{ data: Input } | { response: Response }> {
  try {
    const raw = await readBody(req);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new InputError("Revisa los datos de la operación.");
    const i = raw as Input;
    if (!officeUuid(i.request_id)) throw new InputError("Falta el identificador de la solicitud.");
    let valid = false;
    switch (i.action) {
      case "create_task": valid = validTask(i); break;
      case "update_task": valid = validTask(i) && officeUuid(i.id) && revision(i.revision); break;
      case "set_lead": valid = nonempty(i.department_id,80) && nullableId(i.lead_worker_id) && revision(i.revision); break;
      case "add_note": valid = officeUuid(i.task_id) && nonempty(i.note,4000); break;
      case "add_version": {
        const hasFile = validFile(i);
        valid = officeUuid(i.task_id) && nullableId(i.deliverable_id) && revision(i.base_version,0) &&
          nonempty(i.title,200) && requiredText(i.body,32000) && (hasFile || nonempty(i.body,32000));
        break;
      }
      case "review_version": valid = officeUuid(i.id) && oneOf(i.decision,["aprobado","cambios","rechazado"]) && requiredText(i.note,4000); break;
    }
    if (!valid) throw new InputError("Completa los datos del encargo o del entregable.");
    return { data: i };
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    return { response: officeError(e.message,e.status) };
  }
}
