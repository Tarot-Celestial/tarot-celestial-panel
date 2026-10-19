import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { atlasContext, AtlasError, atlasChecked as checked, type AtlasContext } from '@/lib/server/atlas-access';
import { atlasAnswer, atlasAiConfigured } from '@/lib/server/atlas-chat';
import { atlasProposalView, assertClientAccount } from '@/lib/server/atlas-tools';
import { overview, AtlasOperationsError } from '@/lib/server/atlas-operations';
import { atlasUuid, type AtlasMessage } from '@/lib/atlas';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
function failure(error: unknown) {
  if (error instanceof AtlasError || error instanceof AtlasOperationsError) return reply({ ok: false, error: error.message }, error.status);
  const message = error instanceof Error ? error.message : String((error as any)?.message || '');
  const known: [string, string][] = [['PROMOTION_CHANGED', 'La promoción cambió desde que preparaste la operación. Pide una propuesta nueva.'], ['PROPOSAL_UNAVAILABLE', 'La propuesta caducó o ya no está pendiente. Pide una propuesta nueva.'], ['PROMOTION_EXPIRED', 'La vigencia de la promoción ha terminado.'], ['NO_ELIGIBLE', 'No hay suficientes contactos elegibles. Actualiza la selección.'], ['CONTACT_CHANGED', 'La asignación de un contacto cambió. Prepara de nuevo el envío.'], ['CANDIDATE_CHANGED', 'Un contacto ya no cumple las condiciones del envío. Pide una selección nueva.'], ['MISSION_FULL', 'La central ya tiene cubierta su misión de recuperación. Revisa sus encargos pendientes.'], ['RECOVERY_WEEKDAYS_ONLY', 'Los encargos de recuperación se realizan de lunes a viernes. Prepara el próximo turno.'], ['INVALID_DUE_DATE', 'El plazo ya no corresponde al turno de la central. Prepara una propuesta nueva.'], ['INVALID_WORKER', 'La central seleccionada ya no está disponible. Prepara una propuesta nueva.']];
  const match = known.find(([key]) => message.includes(key));
  return reply({ ok: false, error: match?.[1] || 'No pude completar la operación. Comprueba la conexión y reintenta con la misma solicitud.' }, match ? 409 : 503);
}
async function history(ctx: AtlasContext) {
  return checked<any[]>(ctx.db.from('atlas_admin_messages').select('id,role,content,result,created_at,request_id').eq('worker_id', ctx.worker.id).order('created_at', { ascending: false }).limit(60));
}
async function messageView(ctx: AtlasContext, rows: any[]) {
  const ids = rows.map(r => r.result?.proposal?.id).filter(atlasUuid);
  const proposals = ids.length ? await checked<any[]>(ctx.db.from('atlas_admin_proposals').select('*').eq('worker_id', ctx.worker.id).in('id', ids)) : [];
  const byId = new Map(proposals.map(p => [p.id, p]));
  return rows.slice().reverse().map(r => ({ id: r.id, role: r.role, text: r.role === 'assistant' ? r.result?.text || r.content : r.content, cards: r.result?.cards || [], proposal: byId.has(r.result?.proposal?.id) ? atlasProposalView(byId.get(r.result.proposal.id)) : undefined, created_at: r.created_at, sensitiveFollowup: r.result?.sensitiveFollowup === true }));
}
export async function GET(req: Request) {
  try {
    const ctx = await atlasContext(req);
    const summary = await overview(ctx);
    if (new URL(req.url).searchParams.get('overview') === '1') return reply({ ok: true, overview: summary, jobs: (summary as any).jobs || [] });
    const [rows, memories, jobs] = await Promise.all([
      history(ctx), checked<any[]>(ctx.db.from('atlas_admin_memories').select('id,content,created_at,updated_at').eq('worker_id', ctx.worker.id).eq('active', true).order('updated_at', { ascending: false }).limit(100)),
      checked<any[]>(ctx.db.from('atlas_admin_jobs').select('*').order('created_at', { ascending: false }).limit(100)),
    ]);
    return reply({ ok: true, overview: summary, messages: await messageView(ctx, rows), memories, jobs, aiConfigured: atlasAiConfigured() });
  } catch (error) { return failure(error); }
}
async function execute(ctx: AtlasContext, id: string, password: unknown) {
  const proposal = await checked<any>(ctx.db.from('atlas_admin_proposals').select('*').eq('id', id).eq('worker_id', ctx.worker.id).maybeSingle());
  if (!proposal) throw new AtlasError('No encuentro esa propuesta en tu cuenta.', 404);
  let receipt: any;
  if (proposal.kind !== 'change_password') receipt = await checked<any>(ctx.db.rpc('tc_atlas_execute_action', { p_user: ctx.worker.user_id, p_proposal: id }));
  else if (proposal.status === 'completed') receipt = { replayed: true, result: proposal.result };
  else {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new AtlasError('Introduce una contraseña de entre 8 y 128 caracteres en el campo protegido.');
    const p = proposal.payload;
    const client = await checked<any>(ctx.db.from('crm_clientes').select('id,auth_user_id').eq('id', p.client_id).maybeSingle());
    if (!client || client.auth_user_id !== p.auth_user_id) throw new AtlasError('El vínculo de acceso de esta clienta cambió. Prepara una nueva solicitud.', 409);
    await assertClientAccount(ctx, p.client_id, p.auth_user_id);
    const claim = await checked<any>(ctx.db.rpc('tc_atlas_claim', { p_user: ctx.worker.user_id, p_proposal: id }));
    if (!claim.claimed) throw new AtlasError('Esta solicitud ya se está procesando. Actualiza el historial antes de repetirla.', 409);
    try {
      const { error } = await ctx.db.auth.admin.updateUserById(p.auth_user_id, { password });
      if (error) throw error;
      receipt = { result: { changed: true, client_id: p.client_id }, replayed: false };
      await checked(ctx.db.rpc('tc_atlas_finish', { p_user: ctx.worker.user_id, p_proposal: id, p_result: receipt.result, p_error: null }));
    } catch {
      await ctx.db.rpc('tc_atlas_finish', { p_user: ctx.worker.user_id, p_proposal: id, p_result: { needs_review: true }, p_error: 'No se pudo verificar el resultado del cambio de contraseña. Revisar la cuenta antes de repetir.' });
      throw new AtlasError('No pude verificar el resultado del cambio de contraseña. Revisa el acceso web antes de preparar otro cambio.', 409);
    }
  }
  const evidence = proposal.kind === 'grant_coins' ? `Saldo después del ajuste: ${receipt.result?.balance ?? 'consultar ficha'} Coins.`
    : proposal.kind === 'grant_spins' ? `Giros pendientes de nivel ${proposal.payload.level}: ${receipt.result?.before_count ?? '—'} → ${receipt.result?.after_count ?? '—'}.`
    : ['dispatch_contacts', 'create_task'].includes(proposal.kind) ? `${receipt.result?.jobs?.length ?? 0} encargos creados para las centrales. ${receipt.result?.assigned ?? 0} contactos incluidos.`
    : proposal.kind === 'change_password' ? 'La contraseña de la cuenta vinculada se ha actualizado. No se guarda en el historial.'
    : proposal.kind === 'save_memory' ? 'Recuerdo guardado. Puedes revisarlo o eliminarlo en Memoria.'
    : `Promoción: ${receipt.result?.name || proposal.title} · ${receipt.result?.status === 'active' ? 'Activa' : 'Inactiva'}.`;
  const message: AtlasMessage = { id: randomUUID(), role: 'assistant', text: `${receipt.replayed ? 'Esta operación ya estaba completada; no la he repetido.' : 'Operación completada.'} ${proposal.title}.`, cards: [{ id, kind: 'evidence', title: 'Resultado comprobado', description: evidence }], proposal: atlasProposalView({ ...proposal, status: 'completed' }) };
  await checked(ctx.db.from('atlas_admin_messages').insert({ id: message.id, worker_id: ctx.worker.id, role: 'assistant', content: message.text, result: message }));
  return message;
}
export async function POST(req: Request) {
  try {
    const ctx = await atlasContext(req);
    const raw = await req.text(); if (raw.length > 18000) throw new AtlasError('La solicitud es demasiado larga.', 413);
    let body: any; try { body = JSON.parse(raw); } catch { throw new AtlasError('Solicitud no válida.'); }
    if (body.action === 'execute') {
      if (!atlasUuid(body.proposalId)) throw new AtlasError('Propuesta no válida.');
      return reply({ ok: true, message: await execute(ctx, body.proposalId, body.password) });
    }
    if (body.action === 'cancel_proposal') {
      if (!atlasUuid(body.proposalId)) throw new AtlasError('Propuesta no válida.');
      const row = await checked<any>(ctx.db.from('atlas_admin_proposals').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', body.proposalId).eq('worker_id', ctx.worker.id).eq('status', 'pending').select('id').maybeSingle());
      if (!row) throw new AtlasError('La propuesta ya no está pendiente.', 409);
      await checked(ctx.db.from('atlas_admin_messages').insert({ worker_id: ctx.worker.id, role: 'assistant', content: 'Propuesta cancelada. No se ha ejecutado la acción.', result: { text: 'Propuesta cancelada. No se ha ejecutado la acción.', cards: [], sensitiveFollowup: false } }));
      return reply({ ok: true });
    }
    if (body.action === 'delete_memory') {
      if (!atlasUuid(body.id)) throw new AtlasError('Recuerdo no válido.');
      await checked(ctx.db.from('atlas_admin_memories').update({ active: false, updated_at: new Date().toISOString() }).eq('id', body.id).eq('worker_id', ctx.worker.id));
      return reply({ ok: true });
    }
    if (body.action !== 'chat' || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 3000 || !atlasUuid(body.requestId)) throw new AtlasError('Escribe una petición de hasta 3000 caracteres.');
    const previous = await history(ctx);
    let user = await checked<any>(ctx.db.from('atlas_admin_messages').select('id,content,result,created_at').eq('worker_id', ctx.worker.id).eq('request_id', body.requestId).eq('role', 'user').maybeSingle());
    const prior = previous.find(r => r.role === 'assistant')?.result;
    const question = body.message.trim(), secretRequest = user?.result?.sensitive === true || /contrase[nñ]a|password|\bclave\b/i.test(question) || prior?.context?.tool === 'prepare_password' || prior?.sensitiveFollowup === true || (prior?.proposal?.kind === 'change_password' && prior.proposal.status === 'pending');
    const safeQuestion = secretRequest ? '[Solicitud de cambio de contraseña: datos del mensaje omitidos. Usar formulario protegido.]' : question;
    const processing = (status: string) => ({ status, sensitive: secretRequest });
    if (user && user.content !== safeQuestion) throw new AtlasError('La solicitud de reintento no coincide con el mensaje original.', 409);
    const existing = await checked<any>(ctx.db.from('atlas_admin_messages').select('id,role,content,result,created_at').eq('worker_id', ctx.worker.id).eq('request_id', body.requestId).eq('role', 'assistant').maybeSingle());
    if (existing) return reply({ ok: true, message: (await messageView(ctx, [existing]))[0] });
    if (user) {
      if (user.result?.status !== 'failed' && Date.now() - Date.parse(user.created_at) < 120000) throw new AtlasError('Atlas todavía está preparando esta respuesta. Espera unos segundos y actualiza.', 409);
      const locked = await checked<any>(ctx.db.from('atlas_admin_messages').update({ result: processing('processing'), created_at: new Date().toISOString() }).eq('id', user.id).eq('created_at', user.created_at).select('id').maybeSingle());
      if (!locked) throw new AtlasError('Esta petición ya se está procesando.', 409);
    } else {
      const inserted = await ctx.db.from('atlas_admin_messages').insert({ worker_id: ctx.worker.id, request_id: body.requestId, role: 'user', content: safeQuestion, result: processing('processing') }).select('id').single();
      if (inserted.error?.code === '23505') throw new AtlasError('Esta petición ya se está procesando.', 409);
      if (inserted.error) throw inserted.error; user = inserted.data;
    }
    try {
      const answer = await atlasAnswer(ctx, question, previous);
      const message: AtlasMessage = { ...answer, id: randomUUID(), role: 'assistant' };
      await checked(ctx.db.from('atlas_admin_messages').insert({ id: message.id, worker_id: ctx.worker.id, request_id: body.requestId, role: 'assistant', content: message.text, result: answer }));
      await checked(ctx.db.from('atlas_admin_messages').update({ result: processing('completed') }).eq('id', user.id));
      return reply({ ok: true, message });
    } catch (error) {
      await ctx.db.from('atlas_admin_messages').update({ result: processing('failed') }).eq('id', user.id);
      throw error;
    }
  } catch (error) { return failure(error); }
}
