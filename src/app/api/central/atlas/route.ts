import { assistantAuth, AssistantError } from '@/lib/server/central-assistant';
import { recoveryJson } from '@/lib/server/recovery-access';
import { validUuid } from '@/lib/central-assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const JOB_FIELDS = 'id,worker_id,kind,title,description,client_ids,lead_ids,status,result,due_at,created_at,updated_at';
const publicJob = (row: Record<string, unknown>) => Object.fromEntries(JOB_FIELDS.split(',').map(field => [field, row?.[field]]));
async function identity(req: Request) {
  const ctx = await assistantAuth(req);
  if (ctx.worker.role !== 'central') throw new AssistantError('Este espacio pertenece a una central activa.', 403);
  return ctx;
}
function failure(error: any) {
  if (error instanceof AssistantError) return recoveryJson({ ok: false, error: error.message }, error.status);
  const messages: Record<string, [number, string]> = {
    FORBIDDEN: [403, 'Este encargo no está asignado a tu central.'],
    JOB_NOT_FOUND: [404, 'El encargo ya no está disponible.'], JOB_CLOSED: [409, 'El encargo ya se cerró. Actualiza la lista.'],
    INVALID_JOB_STATUS: [400, 'Selecciona un estado válido.'], FOLLOWUP_DATE_REQUIRED: [400, 'El seguimiento necesita una fecha futura.'],
    INVALID_STATUS: [400, 'Selecciona un estado válido.'], INVALID_TRANSITION: [409, 'El encargo ya se cerró. Actualiza la lista.'],
    RESULT_REQUIRED: [400, 'Explica el resultado o qué ayuda necesitas.'],
    NOT_FOUND: [404, 'El encargo ya no está disponible.'], OPERATION_CONFLICT: [409, 'Este registro ya se guardó con otros datos.'],
    INVALID_OUTCOME: [400, 'Selecciona un resultado de contacto válido.'], INVALID_CHANNEL: [400, 'Selecciona el canal utilizado.'],
    CLIENT_NOT_ASSIGNED: [403, 'El cliente no pertenece a este encargo.'],
  };
  const known = messages[String(error?.message || '')];
  if (known) return recoveryJson({ ok: false, error: known[1] }, known[0]);
  console.error('[central-atlas]', { code: error?.code, message: error?.message });
  return recoveryJson({ ok: false, error: 'No se pudo guardar o consultar Atlas. Actualiza y vuelve a intentarlo.' }, 503);
}
export async function GET(req: Request) {
  try {
    const { db, worker } = await identity(req);
    const [jobsResult, eventsResult] = await Promise.all([
      db.from('atlas_admin_jobs').select(JOB_FIELDS).eq('worker_id', worker.id)
        .in('status', ['pending', 'in_progress', 'blocked']).order('created_at').limit(100),
      db.rpc('tc_central_purchase_celebrations', { p_user: worker.user_id, p_event: null }),
    ]);
    if (jobsResult.error) throw jobsResult.error;
    if (eventsResult.error) throw eventsResult.error;
    const jobs = jobsResult.data || [];
    const ids = [...new Set(jobs.flatMap(job => Array.isArray(job.client_ids) ? job.client_ids.filter(validUuid) : []))];
    const names = new Map<string, string>();
    if (ids.length) {
      // Keep PostgREST URLs bounded, including a central with many open jobs.
      for (let start = 0; start < ids.length; start += 200) {
        const result = await db.from('crm_clientes').select('id,nombre,apellido').in('id', ids.slice(start, start + 200));
        if (result.error) throw result.error;
        result.data?.forEach(client => names.set(client.id, [client.nombre, client.apellido].filter(Boolean).join(' ') || 'Cliente'));
      }
    }
    return recoveryJson({ ok: true, worker_id: worker.id,
      jobs: jobs.map(job => ({ ...job, clients: (job.client_ids || []).map((id: string) => ({ id, name: names.get(id) || 'Cliente' })) })),
      events: eventsResult.data?.events || [], truncated: jobs.length === 100, updated_at: new Date().toISOString() });
  } catch (error) { return failure(error); }
}
export async function POST(req: Request) {
  try {
    const { db, worker } = await identity(req);
    const body = await req.json().catch(() => null);
    if (body?.action === 'claim_celebration' && validUuid(body.event_id)) {
      const { data, error } = await db.rpc('tc_central_purchase_celebrations', { p_user: worker.user_id, p_event: body.event_id });
      if (error) throw error;
      return recoveryJson({ ok: true, event: data?.event || null });
    }
    if (body?.action === 'update_job' && validUuid(body.job_id) && ['in_progress', 'completed', 'blocked'].includes(body.status)) {
      const result = String(body.result || '').trim().slice(0, 2000);
      if (['completed', 'blocked'].includes(body.status) && !result) throw new AssistantError('Explica el resultado o qué ayuda necesitas.', 400);
      const { data, error } = await db.rpc('tc_atlas_update_job', { p_user: worker.user_id, p_job: body.job_id, p_status: body.status, p_result: result });
      if (error) throw error;
      return recoveryJson({ ok: true, job: publicJob(data) });
    }
    if (body?.action === 'record_outcome' && validUuid(body.job_id) && validUuid(body.client_id) && validUuid(body.request_id)) {
      if (!['responded', 'interested', 'no_answer', 'followup'].includes(body.outcome)
        || !['whatsapp', 'phone', 'email', 'other'].includes(body.channel)) throw new AssistantError('Elige el resultado y el canal de contacto.', 400);
      const next = body.next_contact_at ? new Date(body.next_contact_at) : null;
      if (next && !Number.isFinite(next.getTime())) throw new AssistantError('La fecha de seguimiento no es válida.', 400);
      if (body.outcome === 'followup' && !next) throw new AssistantError('Indica cuándo se acordó el seguimiento.', 400);
      const { data, error } = await db.rpc('tc_atlas_record_outcome', { p_user: worker.user_id, p_job: body.job_id,
        p_client: body.client_id, p_channel: body.channel, p_outcome: body.outcome,
        p_note: String(body.note || '').trim().slice(0, 2000), p_next_contact_at: next?.toISOString() || null, p_request: body.request_id });
      if (error) throw error;
      return recoveryJson({ ok: true, outcome: data });
    }
    throw new AssistantError('Acción de Atlas no válida.', 400);
  } catch (error) { return failure(error); }
}
