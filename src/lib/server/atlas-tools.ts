import { randomUUID } from 'node:crypto';
import type { AtlasAnswer, AtlasCard, AtlasProposal } from '@/lib/atlas';
import { atlasNormalize, atlasUuid } from '@/lib/atlas';
import { atlasChecked as checked, AtlasError, type AtlasContext } from './atlas-access';
import { effectivePromotionStatus } from './client-promotions';
import { overview, candidates, prepareDispatch, prepareTask, ecuadorDay } from './atlas-operations';
import { atlasMinuteWatches } from './atlas-minute-watches';

const clientColumns = 'id,nombre,apellido,telefono,email,auth_user_id';
const clientName = (c: any) => [c.nombre, c.apellido].filter(Boolean).join(' ') || 'Clienta sin nombre';
const money = (v: unknown, currency = 'EUR') => `${Number(v).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${currency}`;
const date = (v: unknown) => v ? new Date(String(v)).toLocaleString('es-EC', { timeZone: 'America/Guayaquil', hourCycle: 'h23' }) : 'Fecha no disponible';
const result = (text: string, cards: AtlasCard[] = []): AtlasAnswer => ({ text, cards });
const detail = (label: string, value: unknown) => ({ label, value: String(value) });
async function operationalPlan(ctx: AtlasContext, request: string, workers: any[]) {
  const normalized = atlasNormalize(request), kind = /captacion|captar/.test(normalized) ? 'capture' : 'recovery';
  const sources = await Promise.allSettled([overview(ctx), ...workers.map(w => candidates(ctx, kind, 5, w.id))]);
  const summary: any = sources[0].status === 'fulfilled' ? sources[0].value : null;
  const lines = [`Plan de ${kind === 'capture' ? 'captación' : 'recuperación'}. Fuentes consultadas: ${date(summary?.updatedAt || new Date().toISOString())} · Ecuador.`];
  if (summary?.revenue?.goal != null && summary?.acquisition?.goal != null) lines.push(`Objetivos compartidos: superar ${money(summary.revenue.goal)} diarios y lograr al menos ${summary.acquisition.goal} captaciones al mes entre todas las centrales.`);
  workers.forEach((worker, index) => {
    const mission = summary?.missions?.find((m: any) => m.worker_id === worker.id);
    const selection = sources[index + 1];
    const eligible = selection.status === 'fulfilled' ? (selection.value as any).candidates || [] : null;
    const following = summary?.followupSummary && !summary.followupSummary.partial ? summary.followupSummary.byWorker.find((f: any) => f.worker_id === worker.id) || { overdue: 0, upcoming: 0 } : null;
    const reasons = eligible ? [...new Set<string>(eligible.flatMap((c: any) => c.reasons || []).map(String))].slice(0, 3) : [];
    lines.push(`${worker.display_name}: ${mission?.enabled ? `turno ${date(mission.starts_at)}–${date(mission.ends_at)} (consulta actual). ${mission.active ? `${mission.managed}/30 gestiones y ${mission.recovered}/5 recuperaciones registradas.` : 'Empezar en su próximo turno de lunes a viernes; no exigir recuperación en descanso.'}` : 'Revisar su turno antes de comenzar.'} ${following ? `${following.overdue} seguimientos vencidos y ${following.upcoming} próximos.` : 'Seguimientos sin verificar en esta consulta.'} ${eligible ? `${eligible.length} candidatos elegibles en una muestra de hasta 5; no se han reservado.` : 'Candidatos sin verificar; consultar el listado al empezar.'}${reasons.length ? ` Prioridad: ${reasons.join('; ')}.` : ''}`);
  });
  lines.push(kind === 'recovery'
    ? '1. Al comenzar el turno, abrir Recuperar clientes y preparar o revisar la misión propia. Atender primero los seguimientos que ya correspondan; conservar las asignaciones y no repetir contactos del día.'
    : '1. Abrir Captación y revisar los contactos propios pendientes. Atender primero seguimientos vencidos y pendientes posteriores a la consulta gratuita; excluir bajas, cerrados y seguimientos futuros.');
  lines.push('2. Antes de contactar, leer la ficha y el último resultado. Registrar el canal real, respuesta o interés, bloqueos y el siguiente contacto acordado. Si corresponde un recordatorio del CRM, guardarlo en la ficha.');
  lines.push(kind === 'recovery'
    ? '3. Completar 30 gestiones distintas dentro de cada turno entre semana. Una recuperación solo cuenta con compra confirmada; las 5 recuperaciones y las 30 gestiones son resultados separados. No hay cuotas de recuperación en fin de semana.'
    : '3. Distinguir respuesta, interés y captación. Confirmar la primera compra antes de clasificar una captación; revisar la meta mensual conjunta de 10 sin convertirla en una cuota individual.');
  lines.push('4. Antes del plazo, cerrar este encargo con gestiones realizadas, respuestas, compras comprobadas, bloqueos y pendientes para el relevo. Si falta una fuente o no hay suficientes contactos, marcar el encargo como bloqueado y explicar el motivo.');
  lines.push('Este encargo organiza el trabajo y no reserva ni reasigna clientes. La selección se vuelve a consultar al empezar; para un reparto concreto, pedir a Atlas que prepare el envío de contactos.');
  return { description: lines.join('\n\n').slice(0, 4000), weekly: /semana|semanal/.test(normalized), kind };
}
function weeklyDeadlines(payload: any) {
  const deadlines: Record<string, string> = payload.due_by_worker || {};
  const latest = Object.values(deadlines).sort().at(-1);
  if (!latest) return;
  const localDay = ecuadorDay(new Date(latest)), weekday = new Date(`${localDay}T12:00:00Z`).getUTCDay();
  const friday = new Date(Date.parse(`${localDay}T12:00:00Z`) + ((5 - weekday + 7) % 7) * 86400000).toISOString().slice(0, 10);
  for (const [worker, deadline] of Object.entries(deadlines)) {
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(deadline));
    deadlines[worker] = new Date(`${friday}T${time}-05:00`).toISOString();
  }
  payload.due_at = Object.values(deadlines).sort().at(-1);
}
const promoState: Record<string,string> = { active: 'Activa', inactive: 'Inactiva', draft: 'Borrador', scheduled: 'Programada', finished: 'Finalizada', archived: 'Archivada' };
export async function atlasClients(ctx: AtlasContext, raw: string) {
  if (atlasUuid(raw)) return checked<any[]>(ctx.db.from('crm_clientes').select(clientColumns).eq('id', raw));
  const query = String(raw || '').replace(/[^\p{L}\p{N}\s@+.\-]/gu, ' ').trim().slice(0, 120);
  if (query.length < 2) return [];
  let req = ctx.db.from('crm_clientes').select(clientColumns);
  for (const token of query.split(/\s+/).slice(0, 5)) req = req.or(`nombre.ilike.%${token}%,apellido.ilike.%${token}%,telefono.ilike.%${token}%,telefono_normalizado.ilike.%${token}%,email.ilike.%${token}%`);
  return checked<any[]>(req.order('nombre').limit(15));
}
function clientChoices(clients: any[], prompt: (id: string) => string) {
  return clients.map(c => ({ id: c.id, kind: 'client', title: clientName(c), description: [c.telefono, c.email].filter(Boolean).join(' · '), prompt: prompt(c.id) }));
}
async function resolveClient(ctx: AtlasContext, query: string, prompt: (id: string) => string) {
  const clients = await atlasClients(ctx, query);
  if (clients.length !== 1) return { answer: result(clients.length ? 'Encontré varias fichas. Selecciona la clienta exacta para continuar.' : 'Dime el nombre, teléfono o correo de la clienta. No he encontrado una coincidencia única.', clientChoices(clients, prompt)), client: null };
  return { client: clients[0], answer: null };
}
export function atlasProposalView(row: any): AtlasProposal {
  return { id: row.id, kind: row.kind, title: row.title, description: row.payload?.description || 'Revisa los datos antes de aplicar el cambio.', details: row.payload?.details || [], requiresPassword: row.kind === 'change_password', status: row.status };
}
export async function atlasPropose(ctx: AtlasContext, kind: string, title: string, payload: Record<string, any>): Promise<AtlasAnswer> {
  const row = await checked<any>(ctx.db.from('atlas_admin_proposals').insert({ id: randomUUID(), worker_id: ctx.worker.id, kind, title, payload, status: 'pending' }).select('*').single());
  return { ...result('He preparado la operación. Revisa los datos y pulsa «Ejecutar esta acción» para confirmarla.'), proposal: atlasProposalView(row) };
}
export async function atlasOverviewAnswer(ctx: AtlasContext) {
  const data: any = await overview(ctx);
  const cards: AtlasCard[] = [];
  if (data.revenue) cards.push({ id: 'revenue', kind: 'metric', title: 'Facturación del conjunto', description: `${data.revenue.today == null ? 'No disponible' : money(data.revenue.today)} · objetivo: superar ${money(data.revenue.goal || 300)}. ${data.revenue.source || ''}` });
  if (data.acquisition) cards.push({ id: 'capture', kind: 'metric', title: 'Captaciones del mes', description: `${data.acquisition.count ?? 'No disponible'} / ${data.acquisition.goal || 10} · conjunto de centrales.` });
  for (const m of data.missions || []) cards.push({ id: m.worker_id, kind: 'metric', title: m.worker_name || m.display_name || 'Central', description: `${m.managed ?? '—'}/30 gestiones · ${m.recovered ?? '—'}/5 recuperaciones · ${m.awarded_xp ?? '—'} XP. ${m.active ? 'En horario de misión.' : 'Fuera del horario de misión.'}` });
  for (const a of data.alerts || []) cards.push({ id: a.id, kind: 'evidence', title: a.title, description: a.description, href: a.href });
  for (const i of data.insights || []) cards.push({ id: i.id, kind: 'evidence', title: i.title, description: `${i.description}${i.evidence ? ` ${typeof i.evidence === 'string' ? i.evidence : JSON.stringify(i.evidence)}` : ''}` });
  for (const a of data.anomalies || []) cards.push({ id: a.id, kind: 'evidence', title: a.title, description: `${a.description} Evidencia: ${JSON.stringify(a.evidence || []).slice(0, 2200)}`, href: a.href });
  return result(`Este es el estado registrado del equipo. Actualizado: ${date(data.updatedAt)} (Ecuador). Los patrones describen asociaciones observadas; no demuestran qué causó una compra.`, cards);
}
export async function atlasRunTool(ctx: AtlasContext, name: string, args: Record<string, any>): Promise<AtlasAnswer> {
  if (name === 'overview' || name === 'patterns') return atlasOverviewAnswer(ctx);
  if (name === 'minute_watches') {
    let client: any = null;
    if (String(args.query || '').trim()) {
      const resolved = await resolveClient(ctx, String(args.query), id => `Atlas, consulta los avisos de minutos de cliente ${id}`);
      if (resolved.answer) return resolved.answer;
      client = resolved.client;
    }
    const data = await atlasMinuteWatches(ctx);
    const watches = client ? data.watches.filter(w => w.clientId === client.id) : data.watches;
    const configuration = 'Esta consulta no configura ni cambia avisos. Un recuerdo guardado tampoco activa el seguimiento. Los seguimientos existentes se pausan o reanudan en «Clientas en el radar».';
    if (!watches.length) return result(`${client ? clientName(client) + ' no tiene' : 'Todavía no tienes'} un aviso de minutos configurado en tu cuenta. Hace falta registrar el seguimiento para recibir avisos. ${configuration}`);
    const cards: AtlasCard[] = watches.map(watch => {
      const balance = watch.balance;
      const amount = balance.state === 'known' ? `${balance.total} min registrados (${balance.free} FREE + ${balance.normal} normales)` : 'Saldo sin comprobar; no se interpreta como cero';
      const low = balance.state === 'known' && balance.total <= watch.threshold;
      const pending = Boolean(watch.enabled && watch.alert && !watch.alert.acknowledgedAt);
      const alert = pending ? 'Aviso pendiente de revisar' : !watch.enabled ? 'No se emitirán avisos mientras esté en pausa' : watch.alert?.acknowledgedAt ? 'Aviso ya visto' : 'Sin aviso pendiente';
      return { id: watch.id, kind: 'minute_watch', title: watch.clientName, description: `${amount}. Umbral: ${watch.threshold} min o menos, incluido cero. Seguimiento ${watch.enabled ? 'activo' : 'en pausa'}. ${alert}.${low ? ' El saldo actual está dentro del límite.' : ''}${balance.state === 'known' && balance.observedAt ? ` Comprobado: ${date(balance.observedAt)} (Ecuador).` : ''}` };
    });
    cards.push({ id: 'minute-watch-promotions', kind: 'promotion', title: 'Ver promociones', description: 'Las promociones se activan para el panel de clientes en general. Este aviso no activa una oferta individual ni envía mensajes a la clienta.', prompt: 'Atlas, muéstrame las promociones disponibles' });
    return result(`Este es el estado comprobado de ${watches.length === 1 ? 'tu seguimiento' : 'tus seguimientos'} de minutos. Los saldos proceden del CRM.${args.configurationRequested ? ` ${configuration}` : ''}`, cards);
  }
  if (name === 'find_client') {
    const clients = await atlasClients(ctx, args.query);
    return result(clients.length ? 'Estas son las fichas que coinciden.' : 'No encuentro esa clienta. Prueba con su teléfono o correo.', clientChoices(clients, id => `Atlas, consulta la última compra de cliente ${id}`));
  }
  if (['last_purchase', 'last_call', 'prepare_reward', 'prepare_password'].includes(name)) {
    const retry = (id: string) => name === 'last_purchase' ? `Última compra de cliente ${id}` : name === 'last_call' ? `Último registro de llamada de cliente ${id}` : name === 'prepare_password' ? `Cambia la contraseña de cliente ${id}` : `Agrega ${args.amount || ''} ${args.reward === 'coins' ? 'coins' : `giros de nivel ${args.level || ''}`} a cliente ${id}`;
    const { client, answer } = await resolveClient(ctx, String(args.query || ''), retry);
    if (answer) return answer;
    if (name === 'last_purchase') {
      const rows = await checked<any[]>(ctx.db.from('crm_cliente_pagos').select('id,importe,moneda,estado,metodo,created_at,pack_name,source_rendimiento_id').eq('cliente_id', client.id).eq('estado', 'completed').gt('importe', 0).order('created_at', { ascending: false }).limit(1));
      if (!rows.length) return result(`${clientName(client)} no tiene compras confirmadas registradas en pagos del CRM.`);
      const p = rows[0];
      return result(`La última compra confirmada de ${clientName(client)} fue de ${money(p.importe, p.moneda)} el ${date(p.created_at)} (Ecuador).`, [{ id: p.id, kind: 'evidence', title: p.pack_name || 'Compra confirmada', description: `Método: ${p.metodo || 'sin especificar'} · Pago: ${p.id}${p.source_rendimiento_id ? ` · Registro de llamada: ${p.source_rendimiento_id}` : ''}`, href: '/admin?tab=diario' }]);
    }
    if (name === 'last_call') {
      const [calls, notes] = await Promise.all([
        checked<any[]>(ctx.db.from('rendimiento_llamadas').select('id,fecha_hora,created_at,tipo_registro,cliente_compra_minutos,importe,telefonista_nombre,resumen_codigo,captado,recuperado').eq('cliente_id', client.id).order('fecha_hora', { ascending: false }).limit(1)),
        checked<any[]>(ctx.db.from('crm_client_notes').select('id,texto,author_name,created_at,event_type').eq('cliente_id', client.id).order('created_at', { ascending: false }).limit(1)),
      ]);
      const cards: AtlasCard[] = [];
      if (calls[0]) { const c = calls[0]; cards.push({ id: c.id, kind: 'evidence', title: c.cliente_compra_minutos ? 'Última llamada con compra registrada' : 'Último registro de llamada', description: `${date(c.fecha_hora || c.created_at)} · ${c.telefonista_nombre || 'Sin operadora'} · ${c.tipo_registro || 'registro'} · Importe registrado: ${c.importe ?? 0}. ${c.resumen_codigo || ''} · ID: ${c.id}`, href: '/admin?tab=rendimiento' }); }
      if (notes[0]) { const n = notes[0]; cards.push({ id: n.id, kind: 'evidence', title: 'Última nota del CRM', description: `${date(n.created_at)} · ${n.author_name || 'Sin autor'}: ${String(n.texto || '').slice(0, 1800)}`, href: '/admin?tab=crm' }); }
      return result(cards.length ? `Estos son el último registro y la última nota disponibles de ${clientName(client)}. Una nota no confirma una compra.` : `${clientName(client)} no tiene llamadas ni notas registradas.`, cards);
    }
    if (name === 'prepare_password') {
      if (!atlasUuid(client.auth_user_id)) return result('Esta ficha no tiene una cuenta web vinculada. Revisa el acceso web de la clienta antes de cambiar su contraseña.');
      await assertClientAccount(ctx, client.id, client.auth_user_id);
      return atlasPropose(ctx, 'change_password', `Cambiar contraseña de ${clientName(client)}`, { client_id: client.id, auth_user_id: client.auth_user_id, description: 'Introduce la nueva contraseña en el campo protegido. No se guardará en la conversación ni se enviará al modelo.', details: [detail('Clienta', clientName(client)), detail('Teléfono', client.telefono || 'No registrado'), detail('Ficha', client.id)] });
    }
    const amount = Number(args.amount), reward = args.reward;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > (reward === 'coins' ? 1000000 : 100)) return result(`¿Cuántos ${reward === 'coins' ? 'Coins' : 'giros'} deseas añadir a ${clientName(client)}?`);
    const level = Number(args.level);
    if (reward !== 'coins' && (!Number.isInteger(level) || level < 1 || level > 5)) return result('¿De qué nivel serán los giros? Puedes elegir del 1 al 5.');
    const reason = String(args.reason || 'Obsequio solicitado por administración mediante Atlas').trim().slice(0, 500);
    return atlasPropose(ctx, reward === 'coins' ? 'grant_coins' : 'grant_spins', `Añadir ${amount} ${reward === 'coins' ? 'Coins' : `giros de nivel ${level}`}`, { client_id: client.id, amount, level: reward === 'coins' ? undefined : level, reason, description: level === 5 && reward !== 'coins' ? 'El nivel 5 mantiene los requisitos de acceso Diamante.' : 'El ajuste quedará registrado en el historial de la clienta.', details: [detail('Clienta', clientName(client)), detail('Teléfono', client.telefono || 'No registrado'), detail('Cantidad', amount), detail('Beneficio', reward === 'coins' ? 'Coins' : `Giros nivel ${level}`), detail('Motivo', reason)] });
  }
  if (name === 'promotions' || name === 'prepare_promotion') {
    const promotions = await checked<any[]>(ctx.db.from('tc_client_promotions').select('id,name,status,starts_at,ends_at,active_until_disabled,updated_at').eq('promotion_kind', 'standard').neq('status', 'archived').order('created_at', { ascending: false }).limit(100));
    const packages = promotions.length ? await checked<any[]>(ctx.db.from('tc_client_promotion_packages').select('id,promotion_id,name,price,currency,paid_minutes,free_minutes,is_active,updated_at').in('promotion_id', promotions.map(p => p.id))) : [];
    const pQuery = atlasNormalize(String(args.query || '')), activate = args.activate !== false;
    const matches = promotions.filter(p => p.id === args.query || atlasNormalize(p.name) === pQuery);
    if (name === 'promotions' || !pQuery || matches.length !== 1) return result(`¿Qué promoción deseas ${activate ? 'activar' : 'desactivar'}? Estas son las promociones generales del panel de clientes; su activación no es exclusiva para una clienta.`, promotions.map(p => ({ id: p.id, kind: 'promotion', title: p.name, description: `${promoState[effectivePromotionStatus(p)] || 'Estado sin verificar'} · ${packages.filter(x => x.promotion_id === p.id && x.is_active).map(x => `${x.name}: ${money(x.price, x.currency)}`).join(' · ') || 'Sin packs activos'}`, prompt: `${activate ? 'Activa' : 'Desactiva'} la promoción ${p.id}` })));
    const p = matches[0];
    if (activate && !packages.some(x => x.promotion_id === p.id && x.is_active && Number(x.price) > 0)) return result('Esta promoción no tiene packs activos. Configura sus packs antes de activarla.');
    if (activate && !p.active_until_disabled && p.ends_at && Date.parse(p.ends_at) <= Date.now()) return result('Esta promoción tiene una fecha de fin vencida. Actualiza su vigencia en Promociones antes de activarla.', [{ id: p.id, kind: 'promotion', title: p.name, description: `Finalizó: ${date(p.ends_at)}`, href: '/admin?tab=precios-hoy' }]);
    const active = promotions.filter(x => x.status === 'active' && x.id !== p.id).map(x => x.name);
    return atlasPropose(ctx, activate ? 'activate_promotion' : 'deactivate_promotion', `${activate ? 'Activar' : 'Desactivar'} ${p.name}`, { promotion_id: p.id, updated_at: p.updated_at, previous_active: promotions.filter(x => x.status === 'active' && x.id !== p.id).map(x => x.id).sort(), package_versions: packages.filter(x => x.promotion_id === p.id && x.is_active).map(x => ({ id: x.id, updated_at: x.updated_at })).sort((a,b) => a.id.localeCompare(b.id)), description: activate ? 'La promoción se activará para el panel de clientes en general con sus packs y beneficios actuales; no será exclusiva para una clienta.' : 'La promoción dejará de ofrecerse a nuevas compras en el panel de clientes en general.', details: [detail('Promoción', p.name), detail('Alcance', 'General para el panel de clientes; no individual'), detail('Vigencia', p.active_until_disabled ? 'Hasta desactivarla' : date(p.ends_at)), ...(activate && active.length ? [detail('Se desactivarán', active.join(', '))] : [])] });
  }
  if (name === 'candidates' || name === 'prepare_dispatch') {
    const kind = args.kind === 'capture' ? 'capture' : 'recovery', count = Math.min(30, Math.max(1, Number(args.count) || 10));
    const requested = String(args.worker_id || args.worker || '').trim();
    let workerId: string | undefined;
    if (requested) {
      const workers = await checked<any[]>(ctx.db.from('workers').select('id,display_name').eq('role', 'central').neq('is_active', false));
      const matches = workers.filter(w => atlasUuid(requested) ? w.id === requested : atlasNormalize(w.display_name) === atlasNormalize(requested));
      if (matches.length !== 1) return result(`No encuentro una central activa única para «${requested}». Indica su nombre exacto; conservaré ese destino antes de preparar el envío.`);
      if (args.worker_id && args.worker && atlasNormalize(String(args.worker)) !== atlasNormalize(matches[0].display_name) && args.worker !== matches[0].id) return result('El nombre y el identificador de la central no coinciden. Indica un único destinatario antes de preparar el envío.');
      workerId = matches[0].id;
    }
    if (name === 'candidates') {
      const data: any = await candidates(ctx, kind, count, workerId);
      const rows = Array.isArray(data) ? data : data.candidates || data.items || [];
      return result('Prioridad basada en datos registrados; no es una probabilidad calculada de compra.', rows.map((c: any) => ({ id: c.id || c.client_id, kind: 'candidate', title: c.name || c.client_name || c.client_id, description: (c.reasons || []).join(' · ') })));
    }
    const prepared: any = await prepareDispatch(ctx, kind, count, workerId), payload = prepared.payload;
    if (!payload?.items?.length) return result('No hay contactos elegibles disponibles para este envío. Puedes revisar los encargos abiertos o preparar otra misión.');
    const workers = await checked<any[]>(ctx.db.from('workers').select('id,display_name').in('id', [...new Set<string>(payload.items.map((i: any) => i.worker_id))]));
    return atlasPropose(ctx, 'dispatch_contacts', `Enviar contactos para ${kind === 'capture' ? 'captación' : 'recuperación'}`, { ...payload, details: [detail('Solicitados', count), detail('Contactos elegibles', payload.items.length), ...workers.map(w => detail(w.display_name, `${payload.items.filter((i:any)=>i.worker_id===w.id).length} contactos · plazo ${date(payload.due_by_worker?.[w.id] || payload.due_at)}`)), ...((prepared.candidates || []).slice(0, 30).map((c: any) => detail(c.name || c.client_id, (c.reasons || []).join(' · '))))], description: 'Las mascotas recibirán un encargo con los contactos seleccionados. La elegibilidad se vuelve a comprobar al confirmar.' });
  }
  if (name === 'prepare_task') {
    const workers = await checked<any[]>(ctx.db.from('workers').select('id,display_name').eq('role', 'central').neq('is_active', false));
    const wanted = atlasNormalize(String(args.worker || ''));
    const selected = wanted ? workers.filter(w => atlasNormalize(w.display_name) === wanted || w.id === args.worker) : workers.filter(w => ['isa', 'maria'].includes(atlasNormalize(w.display_name)));
    if (!selected.length || wanted && selected.length !== 1) return result('No encuentro una central activa única con ese nombre. Indica Isa, María o ambas.');
    let title = String(args.title || 'Revisar seguimientos pendientes').slice(0, 150), description = String(args.description || title).slice(0, 2000);
    const requestedPlan = atlasNormalize(`${title} ${description}`);
    const generalPlan = /recupera|captacion|captar/.test(requestedPlan) && (/\b(?:plan|mision)\b/.test(requestedPlan) || /organiza.*(?:trabajo|equipo|recupera|captacion)/.test(requestedPlan) || /encargo/.test(requestedPlan) && /mejorar|semana|equipo|centrales/.test(requestedPlan));
    let plan: Awaited<ReturnType<typeof operationalPlan>> | undefined;
    if (generalPlan) {
      plan = await operationalPlan(ctx, `${title} ${description}`, selected);
      description = plan.description;
      title = `Plan ${plan.weekly ? 'semanal' : 'del turno'} de ${plan.kind === 'capture' ? 'captación' : 'recuperación'}`;
    }
    const due = args.due_at && Number.isFinite(Date.parse(args.due_at)) ? new Date(args.due_at).toISOString() : undefined;
    const prepared = await prepareTask(ctx, title, description, selected.map(w => w.id), due);
    if (plan?.weekly && !due) weeklyDeadlines(prepared.payload);
    return atlasPropose(ctx, 'create_task', title, { ...prepared.payload, details: [detail('Encargo', description), ...selected.map(w => detail(w.display_name, `Plazo: ${date(prepared.payload.due_by_worker?.[w.id] || prepared.payload.due_at)} · Ecuador`))] });
  }
  if (name === 'prepare_memory') {
    const content = String(args.content || '').trim().slice(0, 2000);
    if (!content) return result('Dime qué decisión o preferencia quieres que recuerde.');
    return atlasPropose(ctx, 'save_memory', 'Guardar en la memoria de Atlas', { content, description: 'Este recuerdo será privado de tu cuenta de administración y podrás borrarlo.', details: [detail('Recuerdo', content)] });
  }
  if (name === 'memories') {
    const memories = await checked<any[]>(ctx.db.from('atlas_admin_memories').select('id,content,updated_at').eq('worker_id', ctx.worker.id).eq('active', true).order('updated_at', { ascending: false }).limit(100));
    return result(memories.length ? 'Estos son los recuerdos guardados contigo.' : 'Aún no hemos guardado recuerdos. Puedes decirme «recuerda que…».', memories.map(m => ({ id: m.id, kind: 'memory', title: date(m.updated_at), description: m.content })));
  }
  if (name === 'jobs') {
    const jobs = await checked<any[]>(ctx.db.from('atlas_admin_jobs').select('id,title,description,status,due_at,result').order('created_at', { ascending: false }).limit(50));
    return result('Estos son los encargos registrados y su último estado.', jobs.map(j => ({ id: j.id, kind: 'task', title: j.title, description: `${j.status} · ${j.description || ''} · ${j.result ? JSON.stringify(j.result) : 'Sin resultado todavía'}` })));
  }
  throw new AtlasError('Atlas no tiene esa herramienta habilitada.');
}
export async function assertClientAccount(ctx: AtlasContext, clientId: string, authId: string) {
  const [linked, worker] = await Promise.all([
    checked<any[]>(ctx.db.from('crm_clientes').select('id').eq('auth_user_id', authId)),
    checked<any[]>(ctx.db.from('workers').select('id').eq('user_id', authId).limit(1)),
  ]);
  if (worker.length || linked.length !== 1 || linked[0].id !== clientId) throw new AtlasError('El acceso web está compartido o vinculado a otra identidad. Revisa la ficha antes de cambiar la contraseña.', 409);
  const { data, error } = await ctx.db.auth.admin.getUserById(authId);
  if (error || !data.user) throw new AtlasError('No se pudo verificar la cuenta web vinculada.', 409);
}
