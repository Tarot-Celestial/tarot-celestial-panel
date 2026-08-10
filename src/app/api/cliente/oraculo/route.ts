import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import { getOracleCreditBalance, ORACLE_PACKS } from "@/lib/server/oracle-premium";
import { consumeOracleQuestion, getOracleQuestionBalance, ORACLE_QUESTION_PACK } from "@/lib/server/oracle-questions";
import {
  TAROT_CARDS,
  answerTarotFollowup,
  buildPositionReading,
  buildTarotReading,
  normalizeOracleTopic,
  resolveTarotCard,
  resolveTarotSpreadCard,
} from "@/lib/server/oracle-tarot";

export const runtime = "nodejs";

const SPREADS: Record<string, { label: string; topic: "general" | "amor" | "dinero" | "energia"; positions: string[] }> = {
  daily: { label: "Carta del día", topic: "general", positions: ["Mensaje"] },
  yes_no: { label: "Tirada Sí o No", topic: "general", positions: ["Respuesta"] },
  choice: { label: "Tirada de Elección", topic: "general", positions: ["Camino A", "Camino B", "Consejo"] },
  love: { label: "Tirada del Amor", topic: "amor", positions: ["Situación actual", "Energía afectiva", "Consejo"] },
  relationships: { label: "Tirada de Relaciones", topic: "amor", positions: ["Situación actual", "Fortaleza", "Obstáculo", "Consejo", "Respuesta"] },
  question: { label: "Tirada de Pregunta", topic: "general", positions: ["Situación actual", "Consejo", "Respuesta"] },
  monthly: { label: "Tirada Mensual", topic: "general", positions: ["Amor", "Trabajo", "Dinero", "Bienestar"] },
};

function madridDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function serializeDraw(row: Record<string, any> | null) {
  if (!row?.card_id) return null;
  return {
    id: String(row.id || ""), tema: String(row.tema || "general"), fecha: String(row.fecha || ""),
    cardId: String(row.card_id || ""), cardName: String(row.card_name || row.titulo || ""), cardImage: String(row.card_image || ""),
    keyword: String(row.keyword || row.energia || ""), advice: String(row.advice || row.cierre || ""), message: String(row.reading_short || row.prediccion || ""),
    isFree: Boolean(row.is_free), revealedAt: String(row.revealed_at || row.created_at || ""), selectedPosition: Number(row.selected_position || 0),
    drawType: String(row.draw_type || "daily"), question: String(row.question || ""), context: String(row.context || ""),
    cards: Array.isArray(row.cards_json) ? row.cards_json : [], conclusion: String(row.conclusion || ""), creditConsumed: Boolean(row.credit_consumed), includedQuestionUsed: Boolean(row.included_question_used_at),
  };
}

async function getLatestDraw(admin: any, clientId: string) {
  const { data, error } = await admin.from("cliente_oraculo_diario")
    .select("id,fecha,tema,titulo,prediccion,energia,cierre,created_at,card_id,card_name,card_image,keyword,advice,reading_short,is_free,revealed_at,selected_position,draw_type,question,context,cards_json,conclusion,credit_consumed,included_question_used_at")
    .eq("cliente_id", clientId).not("card_id", "is", null).order("revealed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data || null;
}

async function getFreeDrawState(admin: any, clientId: string) {
  const serverNow = new Date();
  const { data, error } = await admin.from("cliente_oraculo_diario")
    .select("id,revealed_at,created_at")
    .eq("cliente_id", clientId).eq("is_free", true)
    .order("created_at", { ascending: false }).limit(20);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const lastMs = rows.reduce((max: number, row: any) => Math.max(max, new Date(row?.revealed_at || row?.created_at || 0).getTime() || 0), 0);
  const lastIso = lastMs ? new Date(lastMs).toISOString() : null;
  const nextMs = lastMs ? lastMs + 24 * 60 * 60 * 1000 : 0;
  const available = !lastMs || serverNow.getTime() >= nextMs;
  return {
    available,
    serverNow: serverNow.toISOString(),
    lastFreeAt: lastIso ? new Date(lastIso).toISOString() : null,
    nextFreeAt: available || !nextMs ? null : new Date(nextMs).toISOString(),
    remainingSeconds: available || !nextMs ? 0 : Math.max(0, Math.ceil((nextMs - serverNow.getTime()) / 1000)),
  };
}

async function loadMessages(admin: any, clientId: string, draw: Record<string, any> | null) {
  if (!draw) return [];
  const byDraw = await admin.from("cliente_oraculo_mensajes").select("id, role, contenido, created_at, question_source, message_order")
    .eq("cliente_id", clientId).eq("draw_id", String(draw.id)).order("created_at", { ascending: true }).limit(40);
  if (!byDraw.error && Array.isArray(byDraw.data) && byDraw.data.length) return byDraw.data;
  const legacy = await admin.from("cliente_oraculo_mensajes").select("id, role, contenido, created_at")
    .eq("cliente_id", clientId).eq("fecha", String(draw.fecha || "")).eq("tema", String(draw.tema || "general")).order("created_at", { ascending: true }).limit(30);
  if (legacy.error) throw legacy.error;
  return legacy.data || [];
}

async function getActivePremiumSession(admin: any, clientId: string) {
  const { data, error } = await admin.from("cliente_oracle_draw_sessions").select("*").eq("cliente_id", clientId).in("status", ["created","started","in_progress","failed"]).order("updated_at", { ascending:false }).limit(1).maybeSingle();
  if (error) { if (error.code === "42P01") return null; throw error; }
  return data || null;
}

function serializeSession(row: any) {
  if (!row?.id) return null;
  return { id:String(row.id), drawKey:String(row.draw_key), drawType:String(row.draw_type), shuffleId:String(row.shuffle_id), question:String(row.question||""), context:String(row.context||""), cards:Array.isArray(row.cards_json)?row.cards_json:[], requiredCards:Number(row.required_cards||0), status:String(row.status||"in_progress") };
}

async function getQuestionState(admin: any, clientId: string, draw: Record<string, any> | null) {
  const extra = await getOracleQuestionBalance(admin, clientId);
  return { includedAvailable: Boolean(draw?.id && !draw?.included_question_used_at), includedUsed: Boolean(draw?.included_question_used_at), extra, total: extra + (draw?.id && !draw?.included_question_used_at ? 1 : 0) };
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const [latestDraw, freeState, credits, activeSession] = await Promise.all([
      getLatestDraw(gate.admin, gate.cliente.id), getFreeDrawState(gate.admin, gate.cliente.id), getOracleCreditBalance(gate.admin, gate.cliente.id), getActivePremiumSession(gate.admin, gate.cliente.id),
    ]);
    const [messages, questionState] = await Promise.all([loadMessages(gate.admin, gate.cliente.id, latestDraw), getQuestionState(gate.admin, gate.cliente.id, latestDraw)]);
    return NextResponse.json({ ok: true, freeAvailable: freeState.available, freeDailyAvailable: freeState.available, freeState, premiumCredits: credits, totalAvailable: credits + (freeState.available ? 1 : 0), creditsConfigured: true, credits, packs: ORACLE_PACKS, questionPack: ORACLE_QUESTION_PACK, questionState, latestDraw: serializeDraw(latestDraw), activeSession: serializeSession(activeSession), mensajes: messages, deckSize: TAROT_CARDS.length });
  } catch (error: any) {
    console.error("[cliente/oraculo][GET]", { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint });
    return NextResponse.json({ ok: false, error: "No hemos podido cargar el Oráculo. Inténtalo de nuevo." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as Record<string, any>;
    const action = String(body.action || "question").trim().toLowerCase();

    if (action === "shuffle") {
      const [freeState, credits] = await Promise.all([getFreeDrawState(gate.admin, gate.cliente.id), getOracleCreditBalance(gate.admin, gate.cliente.id)]);
      return NextResponse.json({ ok: true, shuffleId: randomUUID(), canReveal: freeState.available || credits > 0, freeAvailable: freeState.available, freeState, creditsConfigured: true, credits, deckSize: TAROT_CARDS.length });
    }

    if (action === "reveal") {
      const tema = normalizeOracleTopic(body.tema);
      const position = Number(body.position);
      const shuffleId = String(body.shuffleId || "").trim();
      if (!shuffleId || !Number.isInteger(position) || position < 0 || position > 20) return NextResponse.json({ ok: false, error: "INVALID_CARD_SELECTION" }, { status: 400 });
      const freeState = await getFreeDrawState(gate.admin, gate.cliente.id);
      if (!freeState.available) return NextResponse.json({ ok: false, error: "FREE_DRAW_RECHARGING", message: "Tu tirada gratuita todavía se está recargando.", freeState }, { status: 409 });

      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "oracle";
      const card = resolveTarotCard({ clientId: gate.cliente.id, shuffleId, position, topic: tema, secret });
      const reading = buildTarotReading(card, tema);
      const nowIso = new Date().toISOString();
      const fecha = madridDateKey();
      const payload = { cliente_id: gate.cliente.id, fecha, tema, titulo: card.name, prediccion: reading.message, energia: card.keyword, cierre: card.advice, created_at: nowIso, card_id: card.id, card_name: card.name, card_image: card.image, keyword: card.keyword, advice: card.advice, reading_short: reading.message, is_free: true, revealed_at: nowIso, selected_position: position, draw_type: "free_daily", cards_json: [{ position: "Mensaje", ...card, interpretation: reading.message }], conclusion: reading.message, credit_consumed: false };
      const inserted = await gate.admin.from("cliente_oraculo_diario").insert(payload).select("id,fecha,tema,titulo,prediccion,energia,cierre,created_at,card_id,card_name,card_image,keyword,advice,reading_short,is_free,revealed_at,selected_position,draw_type,question,context,cards_json,conclusion,credit_consumed,included_question_used_at").single();
      if (inserted.error) {
        // 23P01 = exclusion constraint: otra petición/pestaña ya consumió la gratuita dentro de las 24 h.
        if (inserted.error.code === "23P01" || inserted.error.code === "23505" || (inserted.error.code === "P0001" && /FREE_DRAW_RECHARGING/i.test(inserted.error.message || ""))) {
          const currentState = await getFreeDrawState(gate.admin, gate.cliente.id);
          console.warn("[cliente/oraculo][FREE_DRAW_RACE]", { code: inserted.error.code, message: inserted.error.message, details: inserted.error.details, hint: inserted.error.hint, clientId: gate.cliente.id });
          return NextResponse.json({ ok: false, error: "FREE_DRAW_RECHARGING", message: "Tu tirada gratuita ya fue utilizada y se está recargando.", freeState: currentState }, { status: 409 });
        }
        throw inserted.error;
      }
      return NextResponse.json({ ok: true, draw: serializeDraw(inserted.data), freeAvailable: false, credits: await getOracleCreditBalance(gate.admin, gate.cliente.id) });
    }

    if (action === "premium_start") {
      const drawType=String(body.drawType||"").trim(); const spread=SPREADS[drawType];
      const question=String(body.question||"").trim().slice(0,400); const context=String(body.context||"").trim().slice(0,160);
      if(!spread||!question) return NextResponse.json({ok:false,error:"INVALID_PREMIUM_START"},{status:400});
      const existing=await getActivePremiumSession(gate.admin,gate.cliente.id);
      if(existing) return NextResponse.json({ok:true,resumed:true,session:serializeSession(existing),credits:await getOracleCreditBalance(gate.admin,gate.cliente.id)});
      const creditsBefore=await getOracleCreditBalance(gate.admin,gate.cliente.id); if(creditsBefore<1)return NextResponse.json({ok:false,error:"NO_ORACLE_CREDITS"},{status:409});
      const drawKey=randomUUID(), shuffleId=randomUUID();
      const reserved=await gate.admin.rpc("reserve_cliente_oracle_draw",{p_cliente_id:gate.cliente.id,p_draw_key:drawKey,p_draw_type:drawType,p_shuffle_id:shuffleId,p_question:question,p_context:context,p_required_cards:spread.positions.length,p_notes:`Reserva tirada premium · ${spread.label}`});
      if(reserved.error) throw reserved.error; const payload=reserved.data||{};
      return NextResponse.json({ok:true,resumed:Boolean(payload.resumed),session:serializeSession(payload.session),credits:Number(payload.balance||0)});
    }

    if (action === "premium_retry") {
      const drawKey=String(body.drawKey||"").trim();
      const {data:session,error}=await gate.admin.from("cliente_oracle_draw_sessions").select("*").eq("cliente_id",gate.cliente.id).eq("draw_key",drawKey).maybeSingle();
      if(error)throw error; if(!session)return NextResponse.json({ok:false,error:"DRAW_NOT_STARTED"},{status:409});
      const spread=SPREADS[String(session.draw_type||"")]; const cards=Array.isArray(session.cards_json)?session.cards_json:[];
      if(!spread||cards.length!==spread.positions.length)return NextResponse.json({ok:false,error:"DRAW_NOT_READY"},{status:409});
      const existing=await gate.admin.from("cliente_oraculo_diario").select("id,fecha,tema,titulo,prediccion,energia,cierre,created_at,card_id,card_name,card_image,keyword,advice,reading_short,is_free,revealed_at,selected_position,draw_type,question,context,cards_json,conclusion,credit_consumed,included_question_used_at").eq("cliente_id",gate.cliente.id).eq("draw_key",drawKey).maybeSingle();
      if(existing.error)throw existing.error; if(existing.data){await gate.admin.from("cliente_oracle_draw_sessions").update({status:"completed",completed_draw_id:existing.data.id,completed_at:new Date().toISOString()}).eq("id",session.id);return NextResponse.json({ok:true,completed:true,draw:serializeDraw(existing.data),credits:await getOracleCreditBalance(gate.admin,gate.cliente.id)});}
      const last=cards[cards.length-1]; const conclusion=`La tirada ${spread.label} reúne una energía centrada en ${cards.map((x:any)=>x.keyword||x.cardName).slice(0,3).join(", ")}. ${last.advice||""}`; const nowIso=new Date().toISOString();
      const row=await gate.admin.from("cliente_oraculo_diario").insert({cliente_id:gate.cliente.id,fecha:madridDateKey(),tema:spread.topic,titulo:spread.label,prediccion:conclusion,energia:last.keyword,cierre:last.advice,created_at:nowIso,card_id:last.cardId,card_name:last.cardName,card_image:last.cardImage,keyword:last.keyword,advice:last.advice,reading_short:conclusion,is_free:false,revealed_at:nowIso,selected_position:last.selectedPosition,draw_type:session.draw_type,question:session.question||null,context:session.context||null,cards_json:cards,conclusion,credit_consumed:true,draw_key:drawKey}).select("id,fecha,tema,titulo,prediccion,energia,cierre,created_at,card_id,card_name,card_image,keyword,advice,reading_short,is_free,revealed_at,selected_position,draw_type,question,context,cards_json,conclusion,credit_consumed,included_question_used_at").single();
      if(row.error)throw row.error; await gate.admin.from("cliente_oracle_draw_sessions").update({status:"completed",completed_draw_id:row.data.id,completed_at:nowIso,updated_at:nowIso}).eq("id",session.id);
      return NextResponse.json({ok:true,completed:true,draw:serializeDraw(row.data),credits:await getOracleCreditBalance(gate.admin,gate.cliente.id)});
    }

    if (action === "premium_pick") {
      const drawKey=String(body.drawKey||"").trim(); const position=Number(body.position);
      if(!drawKey||!Number.isInteger(position)||position<0||position>20)return NextResponse.json({ok:false,error:"INVALID_PREMIUM_SELECTION"},{status:400});
      const {data:session,error:sessionError}=await gate.admin.from("cliente_oracle_draw_sessions").select("*").eq("cliente_id",gate.cliente.id).eq("draw_key",drawKey).maybeSingle();
      if(sessionError)throw sessionError; if(!session)return NextResponse.json({ok:false,error:"DRAW_NOT_STARTED"},{status:409});
      if(session.status==="completed") return NextResponse.json({ok:false,error:"DRAW_ALREADY_COMPLETED"},{status:409});
      const spread=SPREADS[String(session.draw_type||"")]; if(!spread)return NextResponse.json({ok:false,error:"INVALID_DRAW_TYPE"},{status:400});
      let cards=Array.isArray(session.cards_json)?session.cards_json:[]; const pickIndex=cards.length;
      if(pickIndex>=spread.positions.length)return NextResponse.json({ok:false,error:"DRAW_READY_TO_COMPLETE"},{status:409});
      if(cards.some((c:any)=>Number(c.selectedPosition)===position))return NextResponse.json({ok:false,error:"CARD_ALREADY_SELECTED"},{status:409});
      const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY||"oracle";
      const card=resolveTarotSpreadCard({clientId:gate.cliente.id,shuffleId:String(session.shuffle_id),position,pickIndex,topic:spread.topic,secret});
      const positionLabel=spread.positions[pickIndex]; const interpretation=buildPositionReading({card,topic:spread.topic,position:positionLabel,question:String(session.question||""),context:String(session.context||"")});
      const cardResult={position:positionLabel,cardId:card.id,cardName:card.name,cardImage:card.image,keyword:card.keyword,advice:card.advice,interpretation,selectedPosition:position}; cards=[...cards,cardResult];
      const saved=await gate.admin.from("cliente_oracle_draw_sessions").update({cards_json:cards,status:"in_progress",updated_at:new Date().toISOString()}).eq("id",session.id).eq("cliente_id",gate.cliente.id).select("id").single(); if(saved.error)throw saved.error;
      const credits=await getOracleCreditBalance(gate.admin,gate.cliente.id);
      if(cards.length<spread.positions.length)return NextResponse.json({ok:true,card:cardResult,completed:false,session:{...serializeSession(session),cards},credits});
      const conclusion=`La tirada ${spread.label} reúne una energía centrada en ${cards.map((item:any)=>item.keyword||item.cardName).slice(0,3).join(", ")}. ${card.advice}`; const nowIso=new Date().toISOString();
      const row=await gate.admin.from("cliente_oraculo_diario").insert({cliente_id:gate.cliente.id,fecha:madridDateKey(),tema:spread.topic,titulo:spread.label,prediccion:conclusion,energia:card.keyword,cierre:card.advice,created_at:nowIso,card_id:card.id,card_name:card.name,card_image:card.image,keyword:card.keyword,advice:card.advice,reading_short:conclusion,is_free:false,revealed_at:nowIso,selected_position:position,draw_type:session.draw_type,question:session.question||null,context:session.context||null,cards_json:cards,conclusion,credit_consumed:true,draw_key:drawKey}).select("id,fecha,tema,titulo,prediccion,energia,cierre,created_at,card_id,card_name,card_image,keyword,advice,reading_short,is_free,revealed_at,selected_position,draw_type,question,context,cards_json,conclusion,credit_consumed,included_question_used_at").single();
      if(row.error){await gate.admin.from("cliente_oracle_draw_sessions").update({status:"failed",updated_at:new Date().toISOString()}).eq("id",session.id);throw row.error;}
      const done=await gate.admin.from("cliente_oracle_draw_sessions").update({status:"completed",completed_draw_id:row.data.id,completed_at:nowIso,updated_at:nowIso}).eq("id",session.id); if(done.error)throw done.error;
      return NextResponse.json({ok:true,card:cardResult,completed:true,draw:serializeDraw(row.data),credits});
    }

    const pregunta = String(body.pregunta || "").trim().slice(0, 500);
    const requestedDrawId = String(body.drawId || "").trim();
    if (!pregunta) return NextResponse.json({ ok: false, error: "PREGUNTA_REQUIRED" }, { status: 400 });
    const latestDraw = await getLatestDraw(gate.admin, gate.cliente.id);
    if (!latestDraw?.card_id || (requestedDrawId && requestedDrawId !== String(latestDraw.id))) return NextResponse.json({ ok: false, error: "DRAW_REQUIRED", message: "No hemos encontrado la tirada activa." }, { status: 409 });
    const card = TAROT_CARDS.find((item) => item.id === String(latestDraw.card_id));
    if (!card) return NextResponse.json({ ok: false, error: "CARD_NOT_FOUND" }, { status: 500 });
    const history = await loadMessages(gate.admin, gate.cliente.id, latestDraw);
    let consumed;
    try { consumed = await consumeOracleQuestion(gate.admin, { clienteId: gate.cliente.id, drawId: String(latestDraw.id) }); }
    catch (consumeError: any) {
      if (/NO_ORACLE_QUESTIONS/i.test(String(consumeError?.message || ""))) {
        return NextResponse.json({ ok: false, error: "NO_ORACLE_QUESTIONS", message: "Has utilizado las preguntas disponibles para esta tirada.", questionState: await getQuestionState(gate.admin, gate.cliente.id, latestDraw) }, { status: 409 });
      }
      throw consumeError;
    }
    const tema = normalizeOracleTopic(latestDraw.tema);
    const respuesta = answerTarotFollowup({ question: pregunta, topic: tema, card, reading: String(latestDraw.reading_short || latestDraw.prediccion || ""), cards: Array.isArray(latestDraw.cards_json) ? latestDraw.cards_json : [], initialQuestion: String(latestDraw.question || ""), context: String(latestDraw.context || ""), history });
    const fecha = String(latestDraw.fecha || madridDateKey());
    const nowIso = new Date().toISOString();
    const orderBase = Date.now() * 10;
    const insertUser = await gate.admin.from("cliente_oraculo_mensajes").insert({ cliente_id: gate.cliente.id, draw_id: String(latestDraw.id), fecha, tema, role: "user", contenido: pregunta, question_source: consumed.source, message_order: orderBase, created_at: nowIso });
    if (insertUser.error) throw insertUser.error;
    const insertAssistant = await gate.admin.from("cliente_oraculo_mensajes").insert({ cliente_id: gate.cliente.id, draw_id: String(latestDraw.id), fecha, tema, role: "assistant", contenido: respuesta, question_source: consumed.source, message_order: orderBase + 1, created_at: new Date(Date.now() + 1).toISOString() });
    if (insertAssistant.error) throw insertAssistant.error;
    const freshDraw = await getLatestDraw(gate.admin, gate.cliente.id);
    return NextResponse.json({ ok: true, respuesta, mensajes: await loadMessages(gate.admin, gate.cliente.id, freshDraw), questionState: await getQuestionState(gate.admin, gate.cliente.id, freshDraw) });
  } catch (error: any) {
    console.error("[cliente/oraculo][POST]", { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint });
    return NextResponse.json({ ok: false, error: "No hemos podido completar la consulta. Inténtalo de nuevo." }, { status: 500 });
  }
}
