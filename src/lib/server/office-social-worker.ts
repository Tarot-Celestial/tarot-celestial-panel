import "server-only";
import { confirmMetaPanelCode, getMetaPanelLink } from "./office-meta-attribution";
import { CAPTACION_WHATSAPP_ORIGIN } from "./captacion-whatsapp";
import { readSocialProof, sendSocialReply } from "./office-social-graph";
import { readWhatsAppProof, sendWhatsAppReply, prepareFormReply } from "./office-social-whatsapp";
import { alreadyAnsweredCountry, answersCommentPrompt, asksToStop, consultationIntent, countryAnswer, DispatchDecision, explicitMarket, messageMarket, readMessageMarket, openWindow, socialReplyText,
  type CaptureJob, type ContactRoute, type InstagramCountryPrompt, type SocialProof } from "./office-social-policy";
export { syncOfficeSocialInboxes } from "./office-social-graph";

type Outcome = "sent" | "blocked" | "handoff" | "failed" | "uncertain";
const pendingInstagramHistory = new Set(["CONVERSATION_PENDING","INBOUND_UNVERIFIED","INCOMPLETE_HISTORY",
  "RECIPIENT_UNVERIFIED","META_UNAVAILABLE","META_RATE_LIMIT","META_OBJECT_UNAVAILABLE","META_MESSAGE_UNAVAILABLE"]);
type Plan = { body:string; route:ContactRoute; send:()=>Promise<string> };
async function rpc(db:any,name:string,args:Record<string,unknown> = {}) {
  const {data,error} = await db.rpc(name,args);
  if (error) throw new Error("OFFICE_CAPTURE_STORAGE_UNAVAILABLE");
  return data;
}
async function activeLine(db:any,market:string) {
  const {data,error} = await db.from("office_capture_lines").select("country,phone,enabled").eq("country",market).maybeSingle();
  if (error) throw new DispatchDecision("LINE_DIRECTORY_UNAVAILABLE","blocked");
  if (!data || data.enabled === false) return null;
  if (data.enabled !== true || data.country !== market || typeof data.phone !== "string" || !/^\+?[0-9][0-9 ()-]{6,23}$/.test(data.phone)) {
    throw new DispatchDecision("LINE_DIRECTORY_INVALID","blocked");
  }
  return data.phone;
}
async function markStop(db:any,job:CaptureJob) {
  if (!await rpc(db,"office_capture_optout",{p_id:job.id,p_lease_token:job.lease_token})) throw new DispatchDecision("CLAIM_CHANGED");
}
async function beforeTransport(db:any,job:CaptureJob) {
  const {data,error} = await db.rpc("office_autonomy_dispatch",{p_id:job.id,p_lease:job.lease_token,p_request:job.request_id});
  if (error || data !== true) throw new DispatchDecision("AUTONOMY_OR_SOURCE_CHANGED","handoff");
}
async function currentConversation(db:any, job:CaptureJob) {
  const [past,question] = await Promise.all([
    db.from("office_capture_inbound").select("inbound_text,source_id,source_at").eq("opportunity_id",job.id)
      .eq("verified",true).lt("source_at",job.latest_inbound_at).order("source_at",{ascending:false}).limit(12),
    db.from("office_capture_attempts").select("route,completed_at,source_id,receipt_id").eq("opportunity_id",job.id).eq("outcome","sent")
      .lt("completed_at",job.latest_inbound_at).order("completed_at",{ascending:false}).limit(15),
  ]);
  if (past.error || question.error) throw new DispatchDecision("CONVERSATION_HISTORY_UNAVAILABLE","blocked");
  const markets = new Set<string>();
  for (const row of past.data || []) {
    const body = String(row.inbound_text || "");
    const market = messageMarket(body);
    const previous = (question.data || []).find((attempt:{completed_at:string}) => Date.parse(attempt.completed_at) < Date.parse(row.source_at));
    if (job.kind === "message" && market && (!explicitMarket(body) || previous?.route === "ask_country")) markets.add(market);
  }
  const lastSent = question.data?.[0];
  const previousRoute: ContactRoute | null = lastSent && openWindow(lastSent.completed_at, 24, Date.parse(job.latest_inbound_at)) ? lastSent.route : null;
  return { previousRoute, lastSent, historicalMarket:markets.size === 1 ? [...markets][0] : null };
}
async function commentPrompt(db:any,job:CaptureJob):Promise<InstagramCountryPrompt|null> {
  return rpc(db,"office_capture_instagram_comment_context",{p_id:job.id,p_lease_token:job.lease_token});
}
async function privatePlan(db:any,job:CaptureJob,proof:SocialProof):Promise<Plan> {
  if (!proof.privateAllowed && !proof.publicAllowed) throw new DispatchDecision("CHANNEL_UNAVAILABLE","blocked");
  if (job.kind === "message") {
    const code = await confirmMetaPanelCode(db,job.id,job.source_id,proof.text);
    if (code !== "not_code") throw new DispatchDecision(code === "confirmed" ? "ATTRIBUTION_CONFIRMED" : "ATTRIBUTION_UNMATCHED");
  }
  if (!openWindow(proof.sourceAt, job.kind === "comment" ? 168 : 24)) throw new DispatchDecision("WINDOW_CLOSED");
  const history = await currentConversation(db,job), location = readMessageMarket(proof.text);
  let previousRoute = proof.followsConsultation ? "ask_country" as const : history.previousRoute;
  let prompt:InstagramCountryPrompt|null = null;
  if (job.channel === "instagram" && job.kind === "message" && countryAnswer(proof.text)) {
    prompt = await commentPrompt(db,job);
    if (prompt) {
      if (!answersCommentPrompt(proof,prompt) || (history.lastSent && Date.parse(history.lastSent.completed_at) >= Date.parse(prompt.completed_at))) {
        throw new DispatchDecision("CONVERSATION_CHANGED");
      }
      previousRoute = "ask_country";
    } else if (alreadyAnsweredCountry(proof,history.lastSent)) throw new DispatchDecision("COUNTRY_ALREADY_ANSWERED","blocked");
  }
  const intent = consultationIntent(proof.text,job.channel,job.kind,previousRoute);
  if (!intent) throw new DispatchDecision("NEEDS_PERSONAL_RESPONSE");
  const market = location.needsCountry ? null : location.market || history.historicalMarket || explicitMarket(job.market);
  const mode = proof.privateAllowed ? "private" : "public";
  let route:ContactRoute = "public_invite", value:string|undefined;
  let phone:string|null = null;
  if (mode === "private") {
    route = intent === "greeting" ? "clarify_request" : "ask_country";
    if (intent !== "greeting" && (market || intent === "oracle")) {
      phone = market && intent !== "oracle" ? await activeLine(db,market) : null;
      route = phone ? "phone" : "oracle";
      value = phone || (job.kind === "message" ? await getMetaPanelLink(db,job.id,CAPTACION_WHATSAPP_ORIGIN,"oracle")
        : new URL("/cliente/oraculo",CAPTACION_WHATSAPP_ORIGIN).href);
    }
  }
  const panelLink = route === "phone" && job.kind === "message" ? await getMetaPanelLink(db,job.id,CAPTACION_WHATSAPP_ORIGIN,"panel") : undefined;
  const body = socialReplyText(route,value,panelLink) + (route === "oracle" && job.kind === "comment"
    ? " Si respondes a este mensaje, podemos ayudarte a vincular tu ficha." : "");
  return {body,route,send:async () => {
    if (market && intent === "consultation" && mode === "private" && await activeLine(db,market) !== phone) throw new DispatchDecision("MARKET_LINE_CHANGED");
    if (job.channel === "whatsapp") {
      await beforeTransport(db,job);
      return sendWhatsAppReply(job,proof,body);
    }
    return sendSocialReply(job,proof,body,mode,async fresh => {
      if (prompt) {
        const current = await commentPrompt(db,job);
        if (!current || current.remote_id !== prompt.remote_id || current.completed_at !== prompt.completed_at || !answersCommentPrompt(fresh,current)) {
          throw new DispatchDecision("CONVERSATION_CHANGED");
        }
      }
      await beforeTransport(db,job);
    });
  }};
}
function decision(error:unknown,committed:boolean): { outcome:Outcome; reason:string } {
  if (error instanceof DispatchDecision) return {outcome:error.outcome,reason:error.code};
  const code = String((error as {code?:string} | null)?.code || "");
  if (["SEND_UNCERTAIN","SEND_PENDING"].includes(code)) return {outcome:"uncertain",reason:"PROVIDER_UNCONFIRMED"};
  if (["TOKEN_EXPIRED","META_PERMISSION","WRONG_ACCOUNT","NOT_CONNECTED","META_RATE_LIMIT","NOT_CONFIGURED","TOKEN_MISSING"].includes(code)) {
    return {outcome:"blocked",reason:code};
  }
  if (["META_REJECTED","INVALID_MESSAGE"].includes(code)) return {outcome:"failed",reason:code};
  if (["STALE_REPLY","REPLY_WINDOW_CLOSED","PRIVATE_REPLY_CLOSED","PRIVATE_REPLY_UNAVAILABLE","LEAD_CLOSED","LEAD_CHANGED","INCOMPLETE_HISTORY","RECIPIENT_UNVERIFIED"].includes(code)) {
    return {outcome:"handoff",reason:code};
  }
  return {outcome:committed ? "uncertain" : "blocked",reason:committed ? "PROVIDER_UNCONFIRMED" : "SOURCE_UNAVAILABLE"};
}
async function readWebhookProof(job:CaptureJob) {
  try { return await readSocialProof(job); }
  catch (error) {
    const code = (error as {code?:string})?.code || "";
    if (code === "META_RATE_LIMIT") return null;
    if (!pendingInstagramHistory.has(code)) throw error;
  }
  // A signed notification can arrive before Graph exposes its conversation.
  await new Promise(resolve => setTimeout(resolve, 1200));
  try { return await readSocialProof(job); }
  catch (error) {
    if (!pendingInstagramHistory.has((error as {code?:string})?.code || "")) throw error;
    return null;
  }
}
async function dispatch(db:any,job:CaptureJob,fromInstagramWebhook = false):Promise<Outcome | "deferred"> {
  const lease = {p_id:job.id,p_lease_token:job.lease_token};
  let committed = false, outcome:Outcome = "sent", reason:string|null = null, receipt:string|null = null;
  try {
    if (job.opted_out) throw new DispatchDecision("OPTED_OUT");
    if (!job.actor_user_id || !job.actor_worker_id || !job.request_id) throw new DispatchDecision("DELEGATION_REQUIRED","blocked");
    if (job.kind !== "form" && job.inbound_text && asksToStop(job.inbound_text)) { await markStop(db,job); return "handoff"; }
    let plan:Plan;
    if (job.channel === "meta_form" && job.kind === "form") {
      const template = await prepareFormReply(db,job,() => beforeTransport(db,job));
      plan = {...template,route:"whatsapp_template"};
    } else {
      const proof = fromInstagramWebhook ? await readWebhookProof(job) :
        job.channel === "whatsapp" ? await readWhatsAppProof(job) : await readSocialProof(job);
      // No send attempt exists. The cron returns expired claimed leases to pending.
      if (!proof) return "deferred";
      if (asksToStop(proof.text)) { await markStop(db,job); return "handoff"; }
      plan = await privatePlan(db,job,proof);
    }
    const begin = await rpc(db,"office_capture_begin",{...lease,p_body:plan.body,p_route:plan.route});
    if (!begin) return "handoff";
    committed = true;
    receipt = await plan.send();
    if (!receipt) throw new DispatchDecision("RECEIPT_MISSING","uncertain");
  } catch (error) {
    const result = decision(error,committed);
    outcome = result.outcome; reason = result.reason;
  }
  const saved = await rpc(db,"office_capture_finish",{...lease,p_outcome:outcome,p_receipt:receipt,p_reason:reason});
  if (saved !== true) return committed ? "uncertain" : "handoff";
  return outcome;
}
export async function runOfficeSocialDispatch(db:any,{limit = 1,deadlineAt = Date.now()+150000}:{limit?:number;deadlineAt?:number} = {}) {
  const totals = {claimed:0,sent:0,blocked:0,handoff:0,uncertain:0,failed:0,deferred:0};
  const cap = Number.isSafeInteger(limit) ? Math.max(0,Math.min(5,limit)) : 1;
  for (let count=0;count<cap;count++) {
    if (Date.now()+45000 >= deadlineAt) break;
    const job = await rpc(db,"office_capture_claim") as CaptureJob | null;
    if (!job) break;
    totals.claimed++;
    totals[await dispatch(db,job)]++;
  }
  return totals;
}

export async function dispatchInstagramWebhookReplies(db:any,accountId:string,sources:{kind:"comment"|"message";id:string}[]) {
  const deadline = Date.now() + 180000;
  const seen = new Set<string>();
  for (const {kind,id} of sources) {
    if (Date.now() >= deadline) break;
    const key = kind + ":" + id;
    if (seen.has(key)) continue;
    seen.add(key);
    const claim = kind === "comment" ? "office_capture_claim_instagram_comment" : "office_capture_claim_instagram_dm";
    const job = await rpc(db,claim,{
      p_account:accountId, p_source_id:id,
    }) as CaptureJob | null;
    if (!job) continue;
    if (job.account_id !== accountId || job.source_id !== id || job.channel !== "instagram" || job.kind !== kind) {
      throw new Error("OFFICE_CAPTURE_SOURCE_MISMATCH");
    }
    await dispatch(db,job,true);
  }
}
