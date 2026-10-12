import { buildLearningSummary, strategyAdjustment, type LearningEpisode, type LearningSummary, type StrategyId } from '@/lib/companion-learning';
import { normalizeText, validUuid, type AssistantCard, type AssistantResult } from '@/lib/central-assistant';
import { allRows, AssistantError, checked, portfolio, type AssistantContext } from './central-assistant';

const TABLE = 'central_assistant_learning_episodes';
const DAY = 86400000;
const terminalFollowup = new Set(['completed', 'completado', 'resuelto', 'resolved']);
const cancelledFollowup = new Set(['cancelled', 'cancelado']);
const expected: Record<StrategyId, string> = {
  recovery_loyal: 'Observar una nueva llamada de duración positiva durante los siguientes 7 días. No acredita una venta ni que el contacto la haya causado.',
  recovery_recent: 'Observar una nueva llamada de duración positiva durante los siguientes 7 días. No acredita una venta ni que el contacto la haya causado.',
  followup_due: 'Comprobar que este seguimiento se marca como completado durante los siguientes 7 días.',
  incident_pending: 'Comprobar que la incidencia se cierra y sus minutos pendientes llegan a cero durante los siguientes 7 días.',
};
export type LearningCandidate = { card: AssistantCard; strategy: StrategyId; sourceKey: string; sourceId: string; clientId?: string; baseline?: Record<string, unknown> };
type LearningState = { enabled: boolean; episodes: LearningEpisode[]; summary: LearningSummary | null; message?: string; unavailable?: string[] };

// Missing installation is a feature-level limitation, never a reason to break the companion.
export async function readLearning(ctx: AssistantContext): Promise<LearningState> {
  const rows: LearningEpisode[] = [];
  for (let offset = 0; offset < 50000; offset += 500) {
    const { data, error } = await ctx.db.from(TABLE).select('*').eq('worker_id', ctx.worker.id).order('created_at').order('id').range(offset, offset + 499);
    if (error) {
      if (['42P01', 'PGRST205'].includes(error.code)) return { enabled: false, episodes: [], summary: null, message: 'La evolución necesita instalar su actualización SQL. El resto del asistente sigue disponible.' };
      throw new AssistantError('No he podido leer la experiencia de tu compañero. Reintenta la consulta.', 503);
    }
    rows.push(...(data || []) as LearningEpisode[]);
    if ((data || []).length < 500) return { enabled: true, episodes: rows, summary: buildLearningSummary(rows) };
  }
  throw new AssistantError('El historial de aprendizaje supera el límite de esta consulta. No se han calculado totales parciales.', 503);
}

export function recoveryStrategy(totalCalls: number): StrategyId { return totalCalls >= 3 ? 'recovery_loyal' : 'recovery_recent'; }
export function recoverySource(clientId: string, last: number) { return `recovery:${clientId}:${last}`; }
export function recoveryBoost(state: LearningState, strategy: StrategyId) { return strategyAdjustment(strategy, state.summary?.lessons || []); }

// Only server-constructed candidates can become missions; the browser cannot invent evidence or rewards.
export async function attachLearning(ctx: AssistantContext, candidates: LearningCandidate[]): Promise<string | null> {
  if (!candidates.length) return null;
  try {
    const current = await readLearning(ctx);
    if (!current.enabled) return 'Evolución sin instalar';
    const valid = candidates.filter(c => validUuid(c.sourceId) && (!c.clientId || validUuid(c.clientId)));
    if (!valid.length) return null;
    const records = valid.map(c => ({
      worker_id: ctx.worker.id, source_key: c.sourceKey, source_id: c.sourceId, client_id: c.clientId || null,
      strategy: c.strategy, title: c.card.title.slice(0, 180), reason: c.card.detail.slice(0, 1600), expected_outcome: expected[c.strategy], baseline: c.baseline || {},
    }));
    await checked(ctx.db.from(TABLE).upsert(records, { onConflict: 'worker_id,source_key', ignoreDuplicates: true }));
    const rows: LearningEpisode[] = await checked(ctx.db.from(TABLE).select('*').eq('worker_id', ctx.worker.id).in('source_key', valid.map(c => c.sourceKey)));
    const byKey = new Map(rows.map(e => [e.source_key, e]));
    for (const c of valid) {
      const episode = byKey.get(c.sourceKey);
      if (episode) c.card.learning = { episodeId: episode.id, strategy: episode.strategy, reason: episode.reason, expectedOutcome: episode.expected_outcome, quiet: episode.state !== 'suggested' || episode.feedback === 'not_helpful' || strategyAdjustment(episode.strategy, current.summary?.lessons || []) < 0 };
    }
    return null;
  } catch { return 'Aprendizaje: no pude guardar las propuestas; puedes reintentarlo'; }
}

export async function attachBriefLearning(ctx: AssistantContext, cards: AssistantCard[]) {
  return attachLearning(ctx, cards.flatMap(card => {
    const [kind, id] = card.id.split(':');
    if (kind !== 'followup' && kind !== 'incident') return [];
    return [{ card, strategy: kind === 'followup' ? 'followup_due' as const : 'incident_pending' as const, sourceKey: `${kind}:${id}`, sourceId: id, clientId: card.clientId }];
  }));
}

function contactAllowed(client: any) { return client.do_not_contact !== true && client.no_contactar !== true && client.marketing_opt_out !== true; }
function missingEpisode() { return new AssistantError('No encuentro esa misión en tu cuenta.', 404); }
async function ownedEpisode(ctx: AssistantContext, id: unknown) {
  if (!validUuid(id)) throw new AssistantError('Misión no válida.');
  const episode: LearningEpisode | null = await checked(ctx.db.from(TABLE).select('*').eq('worker_id', ctx.worker.id).eq('id', id).maybeSingle());
  if (!episode) throw missingEpisode();
  if (episode.client_id && !(await portfolio(ctx)).some(c => String(c.id) === episode.client_id)) throw missingEpisode();
  return episode;
}

async function startBaseline(ctx: AssistantContext, episode: LearningEpisode) {
  if (episode.strategy.startsWith('recovery_')) {
    const client = (await portfolio(ctx)).find(c => String(c.id) === episode.client_id);
    if (!client || !contactAllowed(client)) throw new AssistantError('Esta clienta ya no es elegible para una sugerencia de recuperación.', 409);
    const followups = await allRows(() => ctx.db.from('crm_client_followups').select('id,status,completed_at,business').eq('client_id', client.id).is('completed_at', null).order('id'));
    if (followups.some(f => !String(f.business || '').toLowerCase().includes('orion') && !terminalFollowup.has(normalizeText(f.status || '')) && !cancelledFollowup.has(normalizeText(f.status || '')))) throw new AssistantError('Esta clienta tiene un seguimiento abierto. Revísalo antes de iniciar otra recuperación.', 409);
    const calls = await allRows(() => ctx.db.from('rendimiento_llamadas').select('id,fecha_hora,created_at,tiempo').eq('cliente_id', client.id).gt('tiempo', 0).order('id'));
    const latest = calls.reduce((n, c) => Math.max(n, Date.parse(c.fecha_hora || c.created_at) || 0), 0);
    if (latest > Number(episode.baseline.last_call || 0)) throw new AssistantError('Ya hay una llamada más reciente. Actualiza las sugerencias para trabajar con el contexto actual.', 409);
    return { ...episode.baseline, started_with: 'client_eligible', observation_complete: false };
  }
  if (episode.strategy === 'followup_due') {
    const row = await checked(ctx.db.from('crm_client_followups').select('id,client_id,worker_id,business,status,completed_at').eq('id', episode.source_id).in('worker_id', ctx.identityIds).maybeSingle());
    if (!row || row.client_id !== episode.client_id || String(row.business || '').toLowerCase().includes('orion') || row.completed_at || terminalFollowup.has(normalizeText(row.status || '')) || cancelledFollowup.has(normalizeText(row.status || ''))) throw new AssistantError('Este seguimiento ya no está pendiente en tu cartera. Actualiza las sugerencias.', 409);
    return { status: row.status, observation_complete: false };
  }
  const row = await checked(ctx.db.from('v_attendance_incidents').select('id,pending_minutes,closed_at,status').eq('id', episode.source_id).maybeSingle());
  if (!row || row.closed_at || Number(row.pending_minutes) <= 0 || !['pending', 'partial'].includes(row.status)) throw new AssistantError('Esta incidencia ya no tiene minutos pendientes. Actualiza las sugerencias.', 409);
  return { pending_minutes: Number(row.pending_minutes), observation_complete: false };
}

export async function learningAction(ctx: AssistantContext, body: any) {
  const episode = await ownedEpisode(ctx, body.episodeId), now = new Date().toISOString();
  if (body.action === 'start') {
    if (episode.state === 'trying') return; // Network retries do not reset the measurement window.
    if (episode.state !== 'suggested') throw new AssistantError('Esta misión ya terminó. Su resultado se conserva en el diario.', 409);
    const baseline = await startBaseline(ctx, episode);
    const started = new Date().toISOString();
    const changed = await checked(ctx.db.from(TABLE).update({ state: 'trying', baseline, tried_at: started, deadline_at: new Date(Date.parse(started) + 7 * DAY).toISOString(), updated_at: started }).eq('worker_id', ctx.worker.id).eq('id', episode.id).eq('state', 'suggested').select('id'));
    if (!changed.length) throw new AssistantError('La misión cambió en otra pestaña. Actualiza su estado.', 409);
  } else if (body.action === 'dismiss') {
    if (episode.state === 'dismissed') return;
    if (!['suggested', 'trying'].includes(episode.state)) throw new AssistantError('El resultado ya registrado no se modifica al descartar una propuesta.', 409);
    await checked(ctx.db.from(TABLE).update({ state: 'dismissed', resolved_at: now, updated_at: now }).eq('worker_id', ctx.worker.id).eq('id', episode.id).eq('state', episode.state));
  } else if (body.action === 'feedback') {
    if (!['helpful', 'not_helpful'].includes(body.value)) throw new AssistantError('Elige si la propuesta te ayudó o no.');
    if (body.note != null && (typeof body.note !== 'string' || body.note.trim().length > 600)) throw new AssistantError('La corrección debe tener como máximo 600 caracteres.');
    if (episode.state === 'invalidated') throw new AssistantError('Esta misión ya no puede evaluarse con tus datos actuales.', 409);
    const note = body.note?.trim() || null;
    if (episode.feedback === body.value && episode.feedback_note === note) return;
    // Corrections remain editable; preserve the first reward timestamp and one sample per mission.
    let mutation = ctx.db.from(TABLE).update({ feedback: body.value, feedback_note: note, feedback_at: episode.feedback_at || now, updated_at: now }).eq('worker_id', ctx.worker.id).eq('id', episode.id).eq('updated_at', episode.updated_at);
    mutation = episode.feedback === null ? mutation.is('feedback', null) : mutation.eq('feedback', episode.feedback);
    mutation = episode.feedback_note === null ? mutation.is('feedback_note', null) : mutation.eq('feedback_note', episode.feedback_note);
    const changed = await checked(mutation.select('id'));
    if (!changed.length) throw new AssistantError('La misión cambió en otra pestaña. Actualiza antes de guardar tu corrección.', 409);
  } else throw new AssistantError('Acción de aprendizaje no disponible.');
}

async function rowsByIds(ctx: AssistantContext, table: string, columns: string, field: string, ids: string[]) {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 100) rows.push(...await allRows(() => ctx.db.from(table).select(columns).in(field, ids.slice(i, i + 100)).order('id')));
  return rows;
}
function within(date: unknown, episode: LearningEpisode, now: number) {
  const at = typeof date === 'string' ? Date.parse(date) : NaN;
  return Number.isFinite(at) && at > Date.parse(episode.tried_at!) && at <= Math.min(now, Date.parse(episode.deadline_at!));
}

// Reconciliation uses actual source rows. Errors, cancelled/deleted records and lost access are not failures.
export async function reviewLearning(ctx: AssistantContext): Promise<string[]> {
  const state = await readLearning(ctx);
  if (!state.enabled) return [];
  const pending = state.episodes.filter(e => e.state === 'trying').sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, 50);
  if (!pending.length) return [];
  const now = Date.now(), nowISO = new Date(now).toISOString(), unavailable: string[] = [];
  const clients = await portfolio(ctx), allowed = new Map(clients.map(c => [String(c.id), c]));
  const groups = [
    { name: 'Llamadas', keys: pending.filter(e => e.strategy.startsWith('recovery_')), table: 'rendimiento_llamadas', columns: 'id,cliente_id,fecha_hora,created_at,tiempo', field: 'cliente_id' },
    { name: 'Seguimientos', keys: pending.filter(e => e.strategy === 'followup_due'), table: 'crm_client_followups', columns: 'id,client_id,worker_id,business,status,completed_at', field: 'id' },
    { name: 'Incidencias', keys: pending.filter(e => e.strategy === 'incident_pending'), table: 'v_attendance_incidents', columns: 'id,pending_minutes,closed_at,status', field: 'id' },
  ];
  for (const group of groups) {
    if (!group.keys.length) continue;
    const eligible: LearningEpisode[] = [];
    for (const e of group.keys) {
      if (e.client_id && (!allowed.has(e.client_id) || (e.strategy.startsWith('recovery_') && !contactAllowed(allowed.get(e.client_id))))) {
        await checked(ctx.db.from(TABLE).update({ state: 'invalidated', resolved_at: nowISO, updated_at: nowISO }).eq('worker_id', ctx.worker.id).eq('id', e.id).eq('state', 'trying'));
      } else eligible.push(e);
    }
    if (!eligible.length) continue;
    let rows: any[];
    try { rows = await rowsByIds(ctx, group.table, group.columns, group.field, [...new Set(eligible.map(e => group.field === 'cliente_id' ? e.client_id! : e.source_id))]); }
    catch { unavailable.push(group.name); continue; }
    for (const e of eligible) {
      let evidence: LearningEpisode['evidence'] = null, invalidated = false, incomplete = false;
      if (e.strategy.startsWith('recovery_')) {
        const calls = rows.filter(c => String(c.cliente_id) === e.client_id && Number(c.tiempo) > 0);
        // A late-imported historic call is not a new result. A missing event date prevents a false failure.
        incomplete = calls.some(c => !Number.isFinite(Date.parse(c.fecha_hora)) && Date.parse(c.created_at) > Date.parse(e.tried_at!));
        const call = calls.filter(c => within(c.fecha_hora, e, now)).sort((a, b) => Date.parse(a.fecha_hora) - Date.parse(b.fecha_hora))[0];
        if (call) evidence = { id: call.id, kind: 'call_observed', occurredAt: call.fecha_hora, detail: `Se registró una llamada posterior de ${Number(call.tiempo)} minutos. Coincidencia temporal; no demuestra que la sugerencia causara la llamada ni una venta.` };
      } else {
        const row = rows.find(r => String(r.id) === e.source_id);
        invalidated = !row || (e.strategy === 'followup_due' && (String(row.client_id) !== e.client_id || !ctx.identityIds.includes(String(row.worker_id)) || String(row.business || '').toLowerCase().includes('orion') || cancelledFollowup.has(normalizeText(row.status || ''))));
        if (!invalidated && row) {
          const date = e.strategy === 'followup_due' ? row.completed_at : row.closed_at;
          const complete = e.strategy === 'followup_due' ? !!row.completed_at && terminalFollowup.has(normalizeText(row.status || '')) : !!row.closed_at && Number(row.pending_minutes) <= 0;
          if (complete && within(date, e, now)) evidence = { id: row.id, kind: e.strategy === 'followup_due' ? 'followup_completed' : 'incident_resolved', occurredAt: date, detail: e.strategy === 'followup_due' ? 'El seguimiento figura completado después de iniciar esta misión.' : 'La incidencia se cerró y ya no tiene minutos pendientes.' };
          else if (complete && Date.parse(date) <= Date.parse(e.tried_at!)) invalidated = true;
          else if ((complete || (e.strategy === 'followup_due' && terminalFollowup.has(normalizeText(row.status || '')))) && !Number.isFinite(Date.parse(date))) incomplete = true;
        }
      }
      const expired = now >= Date.parse(e.deadline_at!);
      if (incomplete && !evidence) { unavailable.push(`${group.name}: fecha del resultado incompleta`); continue; }
      const next = evidence ? 'observed' : invalidated ? 'invalidated' : expired ? 'no_result' : 'trying';
      const patch = { state: next, evidence, resolved_at: next === 'trying' ? null : nowISO, updated_at: nowISO, baseline: { ...e.baseline, observation_complete: expired && !invalidated } };
      const result = await ctx.db.from(TABLE).update(patch).eq('worker_id', ctx.worker.id).eq('id', e.id).eq('state', 'trying').eq('updated_at', e.updated_at);
      if (result.error?.code === '23505') {
        // Another mission already claimed this exact source event. Do not count it as a failure.
        await checked(ctx.db.from(TABLE).update({ state: 'invalidated', evidence: null, resolved_at: nowISO, updated_at: nowISO }).eq('worker_id', ctx.worker.id).eq('id', e.id).eq('state', 'trying').eq('updated_at', e.updated_at));
      } else if (result.error) throw new AssistantError('No pude guardar el resultado observado. Reintenta la revisión.', 503);
    }
  }
  return [...new Set(unavailable)];
}

export async function learningPayload(ctx: AssistantContext, unavailable: string[] = [], focusedId?: string | null) {
  const state = await readLearning(ctx);
  if (!state.enabled || !state.summary) return { ok: true, enabled: false, summary: null, message: state.message };
  // Recheck portfolio before displaying historic customer details after assignment changes.
  const visible = new Set((await portfolio(ctx)).map(c => String(c.id)));
  state.summary.recent = state.summary.recent.filter(e => !e.client_id || visible.has(e.client_id)).map(e => ({ ...e, baseline: {} }));
  if (focusedId) {
    if (!validUuid(focusedId)) throw new AssistantError('Misión no válida.');
    const focused = state.episodes.find(e => e.id === focusedId && (!e.client_id || visible.has(e.client_id)));
    // A reassigned/deleted focus must not prevent returning the newly authorized journal.
    if (focused && !state.summary.recent.some(e => e.id === focused.id)) state.summary.recent.unshift({ ...focused, baseline: {} });
  }
  return { ok: true, enabled: true, summary: state.summary, unavailable };
}

export async function learningContext(ctx: AssistantContext) {
  const state = await readLearning(ctx);
  if (!state.enabled || !state.summary) return 'Aprendizaje todavía sin instalar.';
  const visible = new Set((await portfolio(ctx)).map(c => String(c.id)));
  const corrections = state.episodes.filter(e => e.feedback_note && (!e.client_id || visible.has(e.client_id))).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).slice(0, 6).map(e => ({ strategy: e.strategy, feedback: e.feedback, correction: e.feedback_note!.slice(0, 600) }));
  return JSON.stringify({ petLevel: state.summary.level, observed: state.summary.observedCount, lessons: state.summary.lessons, corrections });
}

export async function learningAnswer(ctx: AssistantContext): Promise<AssistantResult> {
  const state = await learningPayload(ctx);
  if (!state.enabled || !state.summary) return { text: state.message || 'Evolución no disponible.', cards: [], updatedAt: new Date().toISOString(), unavailable: ['Aprendizaje'] };
  const s = state.summary;
  return { text: `Mi evolución: nivel ${s.level}, ${s.xp} XP propios del compañero. He observado ${s.observedCount} resultados y recibido ${s.feedbackCount} valoraciones. ${s.lessons.map(l => `${l.label}: ${l.explanation} Próximo ajuste: ${l.nextStep}`).join('\n')} Puedes consultar los motivos, resultados y correcciones en Evolución. Son experiencias registradas, no un reentrenamiento del modelo ni una prueba de que yo haya causado una venta.`, cards: [], updatedAt: new Date().toISOString() };
}
