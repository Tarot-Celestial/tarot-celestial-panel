import { NextResponse } from 'next/server';
import { DEFAULT_PREFERENCES, dayKey, validUuid, type PetId } from '@/lib/central-assistant';
import { assistantAuth, AssistantError, brief, checked, currentResults, runTool } from '@/lib/server/central-assistant';
import { answer } from '@/lib/server/central-assistant-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) { return json({ ok: false, error: error instanceof AssistantError ? error.message : 'No se pudo completar la operación. Vuelve a intentarlo.' }, error instanceof AssistantError ? error.status : 500); }
function text(value: unknown, max: number) { const s = typeof value === 'string' ? value.trim() : ''; if (!s || s.length > max) throw new AssistantError(`Introduce un texto de 1 a ${max} caracteres.`); return s; }

export async function GET(req: Request) {
  try {
    const ctx = await assistantAuth(req), db = ctx.db, id = ctx.worker.id;
    const [profile, memories, tasks, history, runs] = await Promise.all([
      checked(db.from('central_assistant_profiles').select('*').eq('worker_id', id).maybeSingle()),
      checked(db.from('central_assistant_memories').select('*').eq('worker_id', id).order('updated_at', { ascending: false }).limit(100)),
      checked(db.from('central_assistant_tasks').select('*').eq('worker_id', id).order('created_at', { ascending: false }).limit(100)),
      checked(db.from('central_assistant_messages').select('id,question,result,created_at').eq('worker_id', id).eq('status', 'completed').order('created_at', { ascending: false }).limit(15)),
      checked(db.from('central_assistant_task_runs').select('id,result,created_at').eq('worker_id', id).order('created_at', { ascending: false }).limit(10)),
    ]);
    const records=[...tasks,...history,...runs];const filtered=await currentResults(ctx,records.map(r=>r.result));records.forEach((r,i)=>{r.result=filtered[i];});
    return json({ ok: true, worker: { id, name: ctx.worker.display_name }, profile, preferences: { ...DEFAULT_PREFERENCES, ...profile?.preferences }, memories, tasks, history: history.reverse(), runs, mode: process.env.OPENAI_API_KEY && process.env.CENTRAL_ASSISTANT_MODEL ? 'ai' : 'guided', schedulerConfigured: Boolean(process.env.CENTRAL_ASSISTANT_CRON_SECRET) });
  } catch (e) { return failure(e); }
}
export async function POST(req: Request) {
  try {
    const ctx = await assistantAuth(req), db = ctx.db, worker_id = ctx.worker.id;
    if (Number(req.headers.get('content-length') || 0) > 18000) throw new AssistantError('Petición demasiado grande.', 413);
    const body = await req.json();
    if (body.action === 'monitor') {
      const profile=await checked(db.from('central_assistant_profiles').select('preferences').eq('worker_id',worker_id).maybeSingle());
      if(profile?.preferences?.proactive===false)return json({ok:true,notice:null});
      const poll=await db.from('central_assistant_deliveries').insert({worker_id,key:`monitor:${Math.floor(Date.now()/300000)}`});
      if(poll.error?.code==='23505')return json({ok:true,notice:null});
      if(poll.error)throw new AssistantError('Monitor no disponible.',503);
      const result=await brief(ctx);
      const runs=await checked(db.from('central_assistant_task_runs').select('id,created_at').eq('worker_id',worker_id).order('created_at',{ascending:false}).limit(5));
      const candidates=[...runs.map((r:any)=>({id:`run:${r.id}`,title:'Una tarea está terminada',detail:'Abre Tareas para revisar el resultado.',tab:'central',priority:'info' as const})),...result.cards.filter(c=>c.id.startsWith('incident:')||c.id.startsWith('bonus:')||c.id.startsWith('client:')||c.id.startsWith('review:'))];
      for(const card of candidates.slice(0,12)){
        const inserted=await db.from('central_assistant_deliveries').insert({worker_id,key:card.id});
        if(inserted.error?.code==='23505')continue;
        if(inserted.error)throw new AssistantError('No pude registrar el aviso.',503);
        return json({ok:true,notice:card,result});
      }
      return json({ok:true,notice:null,result});
    }
    if (body.action === 'brief') {
      const period = dayKey();
      if (!body.manual) {
        const exists = await checked(db.from('central_assistant_briefings').select('period').eq('worker_id', worker_id).eq('period', period).maybeSingle());
        if (exists) return json({ ok: true, delivered: false });
      }
      const result = await brief(ctx);
      if (!body.manual) {
        const inserted = await db.from('central_assistant_briefings').insert({ worker_id, period, result });
        if (inserted.error?.code === '23505') return json({ ok: true, delivered: false });
        if (inserted.error) throw new AssistantError('No pude guardar el resumen. Inténtalo de nuevo.', 503);
      }
      return json({ ok: true, delivered: true, result, basis: 'Primer acceso del día, Europe/Madrid' });
    }
    if (body.action === 'query' || body.action === 'chat') {
      if (!validUuid(body.requestId)) throw new AssistantError('Identificador de petición no válido.');
      const previous = await checked(db.from('central_assistant_messages').select('result,status').eq('worker_id', worker_id).eq('request_id', body.requestId).maybeSingle());
      if (previous?.status === 'completed') return json({ ok: true, result: (await currentResults(ctx,[previous.result]))[0] });
      if (previous) throw new AssistantError('Esta petición ya se está procesando o falló. Inicia una nueva consulta.', 409);
      const quota = await checked(db.rpc('central_assistant_take_quota', { p_worker: worker_id }));
      if (!quota) throw new AssistantError('Has alcanzado las 30 consultas de esta hora. Tus tareas y recuerdos siguen disponibles.', 429);
      const question = body.action === 'chat' ? text(body.question, 2000) : 'Consulta rápida de clientes';
      const lock = await db.from('central_assistant_messages').insert({ worker_id, request_id: body.requestId, question });
      if (lock.error) throw new AssistantError('Petición duplicada o servicio no disponible.', 409);
      try {
        const profile = await checked(db.from('central_assistant_profiles').select('pet,preferences').eq('worker_id', worker_id).maybeSingle());
        const response = body.action === 'query' ? { result: await runTool(ctx, 'clients', body.query), mode: 'guided', model: null, inputTokens: 0, outputTokens: 0 } : await answer(ctx, question, String(body.tab || ''), (profile?.pet || 'draco') as PetId, profile?.preferences?.humor !== false);
        if(response.result.proposal)response.result.proposal.operationId=body.requestId;
        await checked(db.from('central_assistant_messages').update({ result: response.result, status: 'completed', model: response.model, input_tokens: response.inputTokens, output_tokens: response.outputTokens }).eq('worker_id', worker_id).eq('request_id', body.requestId));
        return json({ ok: true, ...response });
      } catch (e) {
        await db.from('central_assistant_messages').update({ status: 'failed' }).eq('worker_id', worker_id).eq('request_id', body.requestId);
        throw e;
      }
    }
    if (body.action === 'preferences') {
      const old = await checked(db.from('central_assistant_profiles').select('*').eq('worker_id', worker_id).maybeSingle());
      const preferences = { ...DEFAULT_PREFERENCES, ...old?.preferences };
      for (const key of Object.keys(DEFAULT_PREFERENCES)) if (typeof body.preferences?.[key] === 'boolean') preferences[key] = body.preferences[key];
      await checked(db.from('central_assistant_profiles').upsert({ worker_id, pet: old?.pet || 'draco', preferences, updated_at: new Date().toISOString() }));
      return json({ ok: true });
    }
    if (body.action === 'memory_save') {
      const topic = text(body.topic, 80), content = text(body.content, 1000);
      const existing = await checked(db.from('central_assistant_memories').select('id,content').eq('worker_id', worker_id).eq('topic', topic).maybeSingle());
      if (existing && existing.content !== content && body.replace !== true) throw new AssistantError('Ya existe un recuerdo con ese tema. Edita el recuerdo existente para sustituirlo.', 409);
      if (body.id && (!validUuid(body.id) || existing?.id !== body.id)) throw new AssistantError('Recuerdo no encontrado.', 404);
      await checked(db.from('central_assistant_memories').upsert({ worker_id, topic, content, source: 'explicit_instruction', updated_at: new Date().toISOString() }, { onConflict: 'worker_id,topic' }));
      return json({ ok: true });
    }
    if (body.action === 'memory_delete') {
      if (!validUuid(body.id)) throw new AssistantError('Recuerdo no válido.');
      await checked(db.from('central_assistant_memories').delete().eq('worker_id', worker_id).eq('id', body.id)); return json({ ok: true });
    }
    if (body.action === 'task_create') {
      if (!validUuid(body.requestId)) throw new AssistantError('Petición no válida.');
      if (!['reminder', 'inactive', 'opportunities'].includes(body.kind) || !['none', 'daily', 'weekly'].includes(body.recurrence)) throw new AssistantError('Tipo de tarea no válido.');
      const date = Date.parse(body.due_at), days = Number(body.days || 30);
      if (!Number.isFinite(date) || date < Date.now() - 60000 || date > Date.now() + 366 * 86400000 || !Number.isInteger(days) || days < 1 || days > 3650) throw new AssistantError('Revisa la fecha y el período de análisis.');
      await checked(db.from('central_assistant_tasks').upsert({ worker_id, request_id: body.requestId, title: text(body.title, 200), kind: body.kind, due_at: new Date(date).toISOString(), recurrence: body.recurrence, days }, { onConflict: 'worker_id,request_id', ignoreDuplicates: true })); return json({ ok: true });
    }
    if (body.action === 'task_cancel' || body.action === 'task_reschedule') {
      if (!validUuid(body.id)) throw new AssistantError('Tarea no válida.');
      const values: any = { status: 'cancelled', lease_token: null, lease_until: null, updated_at: new Date().toISOString() };
      if (body.action === 'task_reschedule') {
        const date = Date.parse(body.due_at); if (!Number.isFinite(date) || date < Date.now()) throw new AssistantError('Elige una fecha futura.');
        Object.assign(values, { status: 'scheduled', due_at: new Date(date).toISOString(), attempts: 0, last_error: null, retry_at:null });
      }
      await checked(db.from('central_assistant_tasks').update(values).eq('worker_id', worker_id).eq('id', body.id)); return json({ ok: true });
    }
    if (body.action === 'alert') {
      const key = text(body.key, 200); if (!['dismiss', 'snooze'].includes(body.operation)) throw new AssistantError('Acción no válida.');
      await checked(db.from('central_assistant_alerts').upsert({ worker_id, key, dismissed: body.operation === 'dismiss', snoozed_until: body.operation === 'snooze' ? new Date(Date.now() + 3600000).toISOString() : null, updated_at: new Date().toISOString() }));
      if(body.operation==='snooze')await checked(db.from('central_assistant_deliveries').delete().eq('worker_id',worker_id).eq('key',key));
      return json({ ok: true });
    }
    if (body.action === 'history_delete') { await checked(db.from('central_assistant_messages').delete().eq('worker_id', worker_id)); return json({ ok: true }); }
    throw new AssistantError('Acción no disponible.');
  } catch (e) { return failure(e); }
}
