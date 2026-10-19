import type { SupabaseClient } from '@supabase/supabase-js';

export type AtlasOperationsContext = { db: SupabaseClient; worker: { id: string; user_id: string; role: string; display_name: string } };
export type AtlasDispatchKind = 'capture' | 'recovery' | 'task';
export type AtlasDispatchPayload = {
  kind: AtlasDispatchKind; title: string; description: string; due_at: string | null;
  items: Array<{ worker_id: string; client_id: string; lead_id?: string }>;
  worker_ids?: string[];
  due_by_worker?: Record<string, string>;
};
type Row = Record<string, any>;
export class AtlasOperationsError extends Error { constructor(message: string, public status = 400) { super(message); } }
const ZONE = 'America/Guayaquil';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OPEN = ['pending', 'in_progress', 'blocked'];

function admin(ctx: AtlasOperationsContext) {
  if (ctx.worker.role !== 'admin' || !UUID.test(ctx.worker.id) || !UUID.test(ctx.worker.user_id)) throw new AtlasOperationsError('Solo administración puede consultar Atlas.', 403);
}
async function checked(query: PromiseLike<any>) {
  const { data, error } = await query;
  if (error) {
    const messages: Record<string, string> = {
      CANDIDATE_CHANGED: 'Un contacto cambió de estado o responsable. Prepara de nuevo la selección.',
      MISSION_FULL: 'La central ya tiene su misión de 30 clientes. Selecciona contactos que ya pertenezcan a esa misión.',
      RECOVERY_WEEKDAYS_ONLY: 'Las misiones de recuperación se organizan de lunes a viernes, en Ecuador.',
      INVALID_WORKER: 'La central ya no está activa o no está disponible para esta tarea.',
      OPERATION_CONFLICT: 'Ese identificador ya se usó para una operación distinta.',
    };
    const code = Object.keys(messages).find(key => String(error.message || '').includes(key));
    if (code) throw new AtlasOperationsError(messages[code], 409);
    console.error('[atlas-operations]', error.code || 'DB_ERROR');
    throw new AtlasOperationsError('No pude comprobar esta fuente. Revisa la conexión y la instalación de Atlas.', 503);
  }
  return data;
}
async function rows(make: () => any, cap = 50000): Promise<Row[]> {
  const result: Row[] = [];
  for (let offset = 0; offset < cap; offset += 500) {
    const chunk = await checked(make().range(offset, offset + 499)); result.push(...chunk);
    if (chunk.length < 500) return result;
  }
  throw new AtlasOperationsError('El análisis supera el límite de registros. Acota el período para no mostrar cifras parciales.', 422);
}
async function byIds(ctx: AtlasOperationsContext, table: string, columns: string, field: string, ids: string[]) {
  const result: Row[] = [];
  for (let index = 0; index < ids.length; index += 100) {
    const chunk = ids.slice(index, index + 100);
    result.push(...await rows(() => ctx.db.from(table).select(columns).in(field, chunk).order('id')));
  }
  return result;
}
export function ecuadorDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function startOf(day: string) { return `${day}T05:00:00.000Z`; }
function shiftedDay(day: string, shift: number) { return new Date(Date.parse(`${day}T12:00:00Z`) + shift * 86400000).toISOString().slice(0, 10); }
const cents = (amount: unknown) => Math.round(Number(amount || 0) * 100);
const money = (values: Row[]) => values.reduce((n, p) => n + cents(p.importe), 0) / 100;
const unique = (values: unknown[]) => [...new Set(values.filter(Boolean).map(String))];
const validPayment = (p: Row) => p.estado === 'completed' && Number(p.importe) > 0 && String(p.moneda || '').toUpperCase() === 'EUR';
async function businessPayments(ctx: AtlasOperationsContext, start: string, end: string) {
  const payments = await rows(() => ctx.db.from('crm_cliente_pagos').select('id,cliente_id,importe,moneda,estado,metodo,pack_name,created_at').eq('estado', 'completed').gte('created_at', start).lte('created_at', end).order('id'));
  // Production has no payment->client foreign key, so PostgREST embedding is not available.
  const clients = await byIds(ctx, 'crm_clientes', 'id,origen', 'id', unique(payments.map(p => p.cliente_id)));
  const celestialIds = new Set(clients.filter(c => !String(c.origen || '').toLowerCase().includes('orion')).map(c => c.id));
  return payments.filter(p => celestialIds.has(p.cliente_id));
}

/** Pure aggregation: examples never contribute to production totals. */
export function productionSummary(payments: Row[], captures: Row[], contacts: Row[], recoveries: Row[], outcomes: Row[], now = new Date()) {
  const day = ecuadorDay(now), month = day.slice(0, 7), firstDay = shiftedDay(day, -29), recentDay = shiftedDay(day, -6);
  const confirmed = payments.filter(validPayment);
  const history = Array.from({ length: 30 }, (_, n) => {
    const d = shiftedDay(firstDay, n), daily = confirmed.filter(p => ecuadorDay(new Date(p.created_at)) === d);
    return { day: d, revenue: money(daily), purchases: daily.length,
      captures: captures.filter(c => ecuadorDay(new Date(c.first_purchase_at || c.captured_at)) === d).length,
      managed: contacts.filter(c => c.counted && c.mission_day === d).length,
      recovered: recoveries.filter(r => r.mission_day === d).length };
  });
  const today = history.at(-1)!;
  const groupPayments = (key: (p: Row) => string, source: Row[]) => {
    const grouped = new Map<string, Row[]>();
    for (const payment of source) { const name = key(payment), group = grouped.get(name) || []; group.push(payment); grouped.set(name, group); }
    return [...grouped].map(([label, p]) => ({ label, purchases: p.length, revenue: money(p), average: Math.round(money(p) / p.length * 100) / 100 })).sort((a, b) => b.revenue - a.revenue);
  };
  const periods = [7, 30].map(days => {
    const start = startOf(days === 7 ? recentDay : firstDay), paid = confirmed.filter(p => p.created_at >= start);
    return { days, purchases: paid.length, revenue: money(paid), byHour: groupPayments(p => new Intl.DateTimeFormat('es-ES', { timeZone: ZONE, hour: '2-digit', hourCycle: 'h23' }).format(new Date(p.created_at)), paid),
      byMethod: groupPayments(p => p.metodo || 'Sin canal de pago registrado', paid), byPack: groupPayments(p => p.pack_name || 'Sin pack registrado', paid) };
  });
  const reported = unique(outcomes.map(o => o.client_id));
  const responded = unique(outcomes.filter(o => ['responded', 'interested', 'followup'].includes(o.outcome)).map(o => o.client_id));
  const interested = unique(outcomes.filter(o => o.outcome === 'interested').map(o => o.client_id));
  // Conversion is observed only when the purchase follows a recorded contact.
  const bought = reported.filter(id => {
    const first = outcomes.filter(o => o.client_id === id).map(o => String(o.created_at)).sort()[0];
    return confirmed.some(p => p.cliente_id === id && p.created_at >= first);
  });
  const channelGroups = unique(outcomes.map(o => o.channel)).map(channel => {
    const events = outcomes.filter(o => o.channel === channel), clients = unique(events.map(e => e.client_id));
    const converted = clients.filter(id => confirmed.some(p => p.cliente_id === id && p.created_at >= events.filter(e => e.client_id === id).map(e => String(e.created_at)).sort()[0]));
    return { channel, clients: clients.length, buyers: converted.length, sampleEnough: clients.length >= 20 };
  });
  return { today, month, monthCaptures: captures.filter(c => ecuadorDay(new Date(c.first_purchase_at || c.captured_at)).startsWith(month)).length,
    history, periods, funnel: { contactsWithResult: reported.length, responded: responded.length, interested: interested.length, bought: bought.length, channels: channelGroups,
      note: 'Resultados declarados por las centrales; las compras se verifican en pagos. Los clientes pueden aparecer en varios canales. No demuestra causalidad.' } };
}

export async function overview(ctx: AtlasOperationsContext, now = new Date()) {
  admin(ctx);
  const day = ecuadorDay(now), month = day.slice(0, 7), firstDay = shiftedDay(day, -29), start = startOf(firstDay < `${month}-01` ? firstDay : `${month}-01`);
  const labels = ['Misiones', 'Pagos confirmados', 'Captaciones', 'Gestiones', 'Recuperaciones', 'Encargos', 'Resultados de contactos', 'Seguimientos', 'Centrales', 'Objetivos', 'Incidencias', 'Seguimientos de Atlas'];
  const sources = await Promise.allSettled([
    checked(ctx.db.rpc('tc_recovery_mission_overview', { p_user: ctx.worker.user_id })),
    businessPayments(ctx, start, now.toISOString()),
    rows(() => ctx.db.from('crm_client_capture_assignments').select('client_id,captured_at,captured_by_worker_id,status,business').eq('status', 'confirmed').eq('business', 'celestial').gte('captured_at', start).lte('captured_at', now.toISOString()).order('client_id')),
    rows(() => ctx.db.from('crm_recovery_contact_events').select('id,worker_id,client_id,mission_day,channel,contacted_at,counted,reason').gte('mission_day', firstDay).lte('mission_day', day).order('id')),
    rows(() => ctx.db.from('crm_recovery_daily_results').select('client_id,worker_id,mission_day,payment_id,recovered_at').gte('mission_day', firstDay).lte('mission_day', day).order('client_id')),
    rows(() => ctx.db.from('atlas_admin_jobs').select('id,worker_id,kind,title,description,client_ids,lead_ids,status,result,due_at,created_at,updated_at,completed_at').or(`status.in.(${OPEN.join(',')}),created_at.gte.${start}`).order('id')),
    rows(() => ctx.db.from('atlas_admin_job_outcomes').select('id,job_id,worker_id,client_id,channel,outcome,next_contact_at,created_at').gte('created_at', start).lte('created_at', now.toISOString()).order('id')),
    rows(() => ctx.db.from('crm_client_followups').select('id,worker_id,client_id,business,reason,status,reminder_at,scheduled_at,completed_at').eq('business', 'celestial').is('completed_at', null).order('id')),
    rows(() => ctx.db.from('workers').select('id,display_name,role,is_active').eq('role', 'central').eq('is_active', true).order('id')),
    checked(ctx.db.from('atlas_admin_settings').select('timezone,daily_revenue_goal,monthly_capture_goal').eq('singleton', true).single()),
    rows(() => ctx.db.from('v_attendance_incidents').select('id,worker_id,worker_name,pending_minutes,status,incident_date').in('status', ['pending', 'partial']).order('id')),
    rows(() => ctx.db.from('atlas_current_followups').select('id,job_id,worker_id,client_id,channel,next_contact_at,created_at').order('id')),
  ]);
  const unavailable = sources.flatMap((s, i) => s.status === 'rejected' ? [labels[i]] : []);
  const value = (i: number): any => sources[i].status === 'fulfilled' ? (sources[i] as PromiseFulfilledResult<any>).value : null;
  const payments: Row[] = value(1) || [], captures: Row[] = value(2) || [], contacts: Row[] = value(3) || [], recoveries: Row[] = value(4) || [], jobs: Row[] = value(5) || [], outcomes: Row[] = value(6) || [];
  let verifiedCaptures: Row[] | null = null;
  try {
    const capturePayments = await byIds(ctx, 'crm_cliente_pagos', 'id,cliente_id,estado,importe,created_at', 'cliente_id', captures.map(c => c.client_id));
    const earliest = new Map<string, string>();
    for (const p of capturePayments.filter(p => p.estado === 'completed' && Number(p.importe) > 0)) if (!earliest.has(p.cliente_id) || p.created_at < earliest.get(p.cliente_id)!) earliest.set(p.cliente_id, p.created_at);
    verifiedCaptures = captures.filter(c => earliest.has(c.client_id)).map(c => ({ ...c, first_purchase_at: earliest.get(c.client_id) }));
  } catch { unavailable.push('Validación de primeras compras'); }
  const summary = productionSummary(payments, verifiedCaptures || [], contacts, recoveries, outcomes, now);
  const settings = value(9), missions: Row[] = value(0)?.missions || [], workers: Row[] = value(8) || [];
  const revenue = { today: value(1) === null ? null : summary.today.revenue, goal: settings ? Number(settings.daily_revenue_goal) : null,
    met: value(1) !== null && settings ? summary.today.revenue > Number(settings.daily_revenue_goal) : null, currency: 'EUR', comparison: 'gt',
    source: 'Pagos completed de importe positivo, moneda EUR y clientes de Tarot Celestial; conjunto del negocio, sin sumar otra vez el registro de llamada.' };
  const acquisition = { month, count: value(2) === null || verifiedCaptures === null ? null : summary.monthCaptures, goal: settings ? Number(settings.monthly_capture_goal) : null,
    met: value(2) !== null && verifiedCaptures !== null && settings ? summary.monthCaptures >= Number(settings.monthly_capture_goal) : null,
    source: 'Captaciones confirmed de Tarot Celestial con primera compra positiva completed verificada; fecha de la primera compra en Ecuador.' };
  const alerts: Array<{ id: string; title: string; description: string; severity: 'info' | 'attention' | 'critical'; href?: string; prompt?: string; evidence?: string[] }> = [];
  for (const mission of missions) {
    const elapsed = now.getTime() - Date.parse(mission.notice_at || '');
    if (mission.active && elapsed >= 40 * 60000 && mission.managed < mission.expected_managed) alerts.push({ id: `pace:${mission.worker_id}`, title: `${mission.worker_name}: revisar avance`,
      description: `${mission.managed}/30 gestiones registradas; referencia de avance ${mission.expected_managed}. No acredita inactividad ni que esté en llamada.`, severity: 'attention', prompt: `Atlas, revisa los pendientes de ${mission.worker_name}` });
    if (mission.active && Number(mission.shortage) > 0) alerts.push({ id: `shortage:${mission.worker_id}`, title: `${mission.worker_name}: misión por preparar`, description: `Tiene ${mission.assigned_count} clientes asignados de 30. Comprueba la disponibilidad antes de interpretar el avance.`, severity: 'info' });
  }
  for (const job of jobs.filter(j => j.status === 'blocked' || OPEN.includes(j.status) && j.due_at && j.due_at < now.toISOString()).slice(0, 20)) alerts.push({ id: `job:${job.id}`, title: job.status === 'blocked' ? `Encargo bloqueado: ${job.title}` : `Encargo vencido: ${job.title}`, description: job.result || 'Revisa el resultado con la central.', severity: 'attention' });
  const openFollowups: Row[] = [
    ...(value(7) || []).filter((f: Row) => !['completed', 'completado', 'cancelado', 'cancelled', 'resuelto', 'resolved'].includes(f.status)).map((f: Row) => ({ ...f, source: 'crm_client_followups', next_contact_at: f.reminder_at || f.scheduled_at })),
    ...(value(11) || []).map((f: Row) => ({ ...f, source: 'atlas_current_followups', status: 'pending' })),
  ].map((f: Row) => ({ ...f, due: f.next_contact_at ? Date.parse(f.next_contact_at) <= now.getTime() : false }));
  const overdue = openFollowups.filter(f => f.due), upcoming = openFollowups.filter(f => f.next_contact_at && !f.due);
  const followupSummary = { total: openFollowups.length, overdue: overdue.length, upcoming: upcoming.length, partial: value(7) === null || value(11) === null,
    byWorker: unique(openFollowups.map(f => f.worker_id)).map(worker_id => ({ worker_id, total: openFollowups.filter(f => f.worker_id === worker_id).length,
      overdue: overdue.filter(f => f.worker_id === worker_id).length, upcoming: upcoming.filter(f => f.worker_id === worker_id).length })) };
  const followupEvidence = (entries: Row[]) => entries.slice(0, 20).map(f => `${workers.find(w => w.id === f.worker_id)?.display_name || 'Responsable por revisar'} · ${new Date(f.next_contact_at).toLocaleString('es-EC', { timeZone: ZONE, hourCycle: 'h23' })} Ecuador · Clienta ${f.client_id} · ${f.source === 'atlas_current_followups' ? 'Acuerdo de Atlas' : 'Seguimiento del CRM'} · Registro ${f.id}`);
  if (overdue.length) alerts.push({ id: 'overdue-followups', title: `${overdue.length} seguimientos vencidos`, description: 'Compromisos pendientes con fecha anterior a la consulta. Revisa la ficha antes de contactar.', severity: 'attention', evidence: followupEvidence(overdue), href: '/admin?tab=crm' });
  if (upcoming.length) alerts.push({ id: 'upcoming-followups', title: `${upcoming.length} seguimientos próximos`, description: 'Hay compromisos con fecha futura. Los acuerdos vigentes de Atlas conservan su fecha antes de volver a priorizar el contacto.', severity: 'info', evidence: followupEvidence(upcoming), href: '/admin?tab=crm' });
  const workerIds = new Set(workers.map(w => w.id)), incidents = (value(10) || []).filter((i: Row) => workerIds.has(i.worker_id));
  if (incidents.length) alerts.push({ id: 'attendance-incidents', title: `${incidents.length} incidencias pendientes de centrales`, description: 'El control horario tiene registros por revisar; no demuestra actividad comercial.', severity: 'attention', href: '/admin?tab=incidencias' });
  const anomalies: Row[] = [];
  for (const worker of workers) {
    const activity = contacts.filter(e => e.worker_id === worker.id).sort((a, b) => Date.parse(a.contacted_at) - Date.parse(b.contacted_at));
    for (let n = 4; n < activity.length; n++) if (Date.parse(activity[n].contacted_at) - Date.parse(activity[n - 4].contacted_at) <= 60000) {
      anomalies.push({ id: `burst:${worker.id}`, kind: 'registration_burst', title: `${worker.display_name}: registros próximos`, description: 'Hay al menos cinco registros de gestión en un minuto. Puede ser una carga agrupada; requiere revisar evidencia, no prueba una irregularidad.', evidence: activity.slice(n - 4, n + 1).map(e => ({ id: e.id, client_id: e.client_id, contacted_at: e.contacted_at })) }); break;
    }
  }
  if (verifiedCaptures && captures.length > verifiedCaptures.length) anomalies.push({ id: 'captures-without-payment', kind: 'unverified_captures', title: 'Captaciones sin primera compra verificable', description: `${captures.length - verifiedCaptures.length} registros confirmed quedan fuera del objetivo hasta comprobar un pago positivo completed.`, evidence: captures.filter(c => !verifiedCaptures!.some(v => v.client_id === c.client_id)).slice(0, 20).map(c => ({ client_id: c.client_id, captured_at: c.captured_at })) });
  for (const anomaly of anomalies) alerts.push({ id: anomaly.id, title: anomaly.title, description: anomaly.description, severity: 'attention', prompt: `Atlas, revisa la evidencia de «${anomaly.title}»` });
  const insights: Array<{ id: string; title: string; description: string; evidence: string[] }> = [];
  if (value(11)?.length) insights.push({ id: 'atlas-followups', title: 'Seguimientos acordados con las centrales', description: `${value(11).length} acuerdos vigentes de Atlas. Se conserva el último resultado de cada clienta y se excluyen los que ya tienen una compra posterior confirmada.`, evidence: value(11).slice(0, 3).map((f: Row) => `Resultado ${f.id}; registrado ${f.created_at}; próximo contacto ${f.next_contact_at}; encargo ${f.job_id}`) });
  if (value(1) !== null) for (const period of summary.periods) {
    const pack = period.byPack[0], hour = period.byHour[0];
    insights.push({ id: `sales:${period.days}`, title: `Últimos ${period.days} días: ${period.revenue.toFixed(2)} € confirmados`,
      description: `${period.purchases} compras. ${pack ? `El pack/grupo con mayor facturación registrada es «${pack.label}»: ${pack.revenue.toFixed(2)} € en ${pack.purchases} compras.` : 'Aún no hay compras para comparar.'} ${period.purchases < 20 ? 'Muestra pequeña: no basta para recomendar un cambio estable.' : 'Es una asociación descriptiva; no demuestra qué práctica causó la venta.'}`,
      evidence: [`crm_cliente_pagos.estado=completed; moneda=EUR; ${period.purchases} pagos`, ...(hour ? [`Franja con mayor facturación registrada: ${hour.label}:00 Ecuador, ${hour.purchases} compras`] : [])] });
  }
  if (value(6) !== null) insights.push({ id: 'funnel', title: 'De la gestión a la compra', description: `${summary.funnel.contactsWithResult} clientes con resultado registrado, ${summary.funnel.responded} con respuesta, ${summary.funnel.interested} con interés declarado y ${value(1) === null ? 'compras sin verificar' : `${summary.funnel.bought} con compra posterior verificada`}. ${summary.funnel.note}`, evidence: ['atlas_admin_job_outcomes', 'crm_cliente_pagos'] });
  const history = summary.history.map(h => ({ ...h, revenue: value(1) === null ? null : h.revenue, purchases: value(1) === null ? null : h.purchases,
    captures: value(2) === null || verifiedCaptures === null ? null : h.captures, managed: value(3) === null ? null : h.managed, recovered: value(4) === null ? null : h.recovered }));
  return { updatedAt: now.toISOString(), timezone: ZONE, revenue, acquisition, missions: value(0) === null ? null : missions, alerts, insights, anomalies,
    pendingJobs: value(5) === null ? null : jobs.filter(j => OPEN.includes(j.status)), jobs, workers, history,
    patterns: { periods: value(1) === null ? null : summary.periods, funnel: value(6) === null || value(1) === null ? null : summary.funnel },
    followups: openFollowups.sort((a, b) => Number(b.due) - Number(a.due) || String(a.next_contact_at || '').localeCompare(String(b.next_contact_at || ''))).slice(0, 100), followupSummary, incidents, unavailable,
    limitations: ['No se detecta una llamada real ni actividad fuera del panel.', 'Un contacto registrado no demuestra respuesta: se distinguen los resultados declarados y los pagos comprobados.', 'No se consultan memorias ni conversaciones privadas de las mascotas.'] };
}

export async function candidates(ctx: AtlasOperationsContext, kind: 'capture' | 'recovery', count = 10, workerId?: string) {
  admin(ctx);
  if (!['capture', 'recovery'].includes(kind) || !Number.isInteger(count) || count < 1 || count > 100 || workerId && !UUID.test(workerId)) throw new AtlasOperationsError('Indica captación o recuperación y entre 1 y 100 contactos.');
  return checked(ctx.db.rpc('tc_atlas_candidates', { p_user: ctx.worker.user_id, p_kind: kind, p_count: count, p_worker: workerId || null }));
}
export function nextWorkerDeadline(startTime: string, endTime: string, now = new Date()) {
  let day = ecuadorDay(now);
  const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
  if (now.getTime() >= Date.parse(`${day}T${endTime.slice(0, 5)}:00-05:00`)) day = shiftedDay(day, 1);
  while ([0, 6].includes(weekday(day))) day = shiftedDay(day, 1);
  return new Date(`${day}T${endTime.slice(0, 5)}:00-05:00`).toISOString();
}
export async function prepareDispatch(ctx: AtlasOperationsContext, kind: 'capture' | 'recovery', count = 10, workerId?: string) {
  admin(ctx);
  const selection = await candidates(ctx, kind, count, workerId);
  const [workers, schedules] = await Promise.all([
    rows(() => ctx.db.from('workers').select('id,display_name,role,is_active').eq('role', 'central').eq('is_active', true).order('id')),
    checked(ctx.db.from('crm_recovery_mission_schedules').select('worker_id,start_time,end_time,enabled').eq('enabled', true)),
  ]);
  const now = new Date(), day = ecuadorDay(now);
  const available = workers.filter(w => schedules.some((s: Row) => s.worker_id === w.id && (kind !== 'recovery' || Date.parse(`${day}T${String(s.end_time).slice(0, 5)}:00-05:00`) > now.getTime())) && (!workerId || w.id === workerId));
  if (!available.length) throw new AtlasOperationsError('No hay centrales con turno configurado para distribuir este encargo.', 409);
  const loads = new Map(available.map(w => [w.id, 0]));
  const items: AtlasDispatchPayload['items'] = [], selected: Row[] = [];
  for (const row of selection.candidates || []) {
    const target = row.worker_id ? available.find(w => w.id === row.worker_id) : [...available].sort((a, b) => loads.get(a.id)! - loads.get(b.id)! || a.id.localeCompare(b.id))[0];
    if (!target) continue;
    loads.set(target.id, loads.get(target.id)! + 1);
    items.push({ worker_id: target.id, client_id: row.client_id, ...(row.lead_id ? { lead_id: row.lead_id } : {}) });
    selected.push({ ...row, worker_id: target.id, worker_name: target.display_name });
  }
  if (!items.length) throw new AtlasOperationsError('No hay contactos elegibles y disponibles. Se respetan las asignaciones, los seguimientos futuros y los encargos abiertos.', 409);
  const dueByWorker: Record<string, string> = Object.fromEntries(available.filter(w => items.some(i => i.worker_id === w.id)).map(w => { const s = schedules.find((x: Row) => x.worker_id === w.id); return [w.id, nextWorkerDeadline(s.start_time, s.end_time, now)]; }));
  const deadlines = Object.values(dueByWorker);
  const payload: AtlasDispatchPayload = { kind, title: `${kind === 'capture' ? 'Captación' : 'Recuperación'}: ${items.length} contactos priorizados`,
    description: 'Revisa cada ficha y registra el canal, el resultado y el siguiente paso. La selección respeta los pendientes y asignaciones; no garantiza una compra.',
    due_at: deadlines.sort().at(-1) || null, due_by_worker: dueByWorker, items };
  return { payload, candidates: selected, requested: count, available: items.length, shortfall: Math.max(0, count - items.length), criterion: selection.criterion, updatedAt: new Date().toISOString() };
}
export async function prepareTask(ctx: AtlasOperationsContext, title: string, description: string, workerIds: string[], dueAt?: string) {
  admin(ctx);
  if (!title.trim() || title.length > 200 || description.length > 4000 || !workerIds.length || workerIds.length > 20 || workerIds.some(id => !UUID.test(id))) throw new AtlasOperationsError('Indica un encargo y sus centrales.');
  const schedules = await checked(ctx.db.from('crm_recovery_mission_schedules').select('worker_id,start_time,end_time,enabled').in('worker_id', workerIds).eq('enabled', true));
  const dueByWorker = Object.fromEntries(schedules.map((s: Row) => [s.worker_id, dueAt || nextWorkerDeadline(s.start_time, s.end_time)]));
  const due = dueAt || (Object.values(dueByWorker) as string[]).sort().at(-1);
  if (!due || !Number.isFinite(Date.parse(due)) || Date.parse(due) <= Date.now()) throw new AtlasOperationsError('Indica una fecha futura para el encargo.');
  return { payload: { kind: 'task', title: title.trim(), description: description.trim(), due_at: new Date(due).toISOString(), due_by_worker: dueByWorker, items: [], worker_ids: unique(workerIds) } as AtlasDispatchPayload };
}
export async function dispatch(ctx: AtlasOperationsContext, payload: AtlasDispatchPayload, operationId: string) {
  admin(ctx); if (!UUID.test(operationId)) throw new AtlasOperationsError('Falta el identificador del encargo.');
  return checked(ctx.db.rpc('tc_atlas_dispatch', { p_user: ctx.worker.user_id, p_payload: payload, p_operation: operationId }));
}
export async function memories(ctx: AtlasOperationsContext) {
  admin(ctx); return checked(ctx.db.from('atlas_admin_memories').select('id,content,active,created_at,updated_at').eq('worker_id', ctx.worker.id).eq('active', true).order('created_at', { ascending: false }).limit(100));
}
export async function history(ctx: AtlasOperationsContext, limit = 40) {
  admin(ctx); return checked(ctx.db.from('atlas_admin_messages').select('id,role,content,result,created_at').eq('worker_id', ctx.worker.id).order('created_at', { ascending: false }).order('id').limit(Math.min(100, Math.max(1, limit))));
}
