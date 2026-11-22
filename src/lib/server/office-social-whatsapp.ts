import "server-only";
import { createHash } from "node:crypto";
import { whatsappGatewayFetch } from "./whatsapp-gateway";
import { hasAdminAccess } from "./admin-access";
import { captacionWhatsAppLead, captacionWhatsAppName, captacionWhatsAppRecipient, captacionWhatsAppTemplate,
  CAPTACION_WHATSAPP_BODY, sendCaptacionWhatsAppOfficial } from "./captacion-whatsapp";
import { DispatchDecision, openWindow, type CaptureJob, type SocialProof } from "./office-social-policy";

const direct = /^(?:[1-9]\d{7,14}@s\.whatsapp\.net|\d{1,30}@lid)$/;
function sessionPath(job: CaptureJob) {
  if (!/^(?:central|w-[a-zA-Z0-9_-]{1,60})$/.test(job.session_id || "") || !direct.test(job.recipient_id || "")) throw new DispatchDecision("INVALID_WHATSAPP_SOURCE");
  return "/sessions/" + job.session_id;
}
export async function readWhatsAppProof(job: CaptureJob): Promise<SocialProof> {
  const base = sessionPath(job);
  const [status,chat] = await Promise.all([whatsappGatewayFetch(base+"/status"),
    whatsappGatewayFetch(base+"/chats/"+encodeURIComponent(job.recipient_id!)+"/messages?limit=3")]);
  if (status.status !== 200 || !status.json?.ok || status.json.state !== "connected" || status.json.session !== job.session_id ||
      status.json.me?.id !== job.account_id || !status.json.me?.phone) throw new DispatchDecision("WHATSAPP_SESSION_CHANGED","blocked");
  if (chat.status !== 200 || !chat.json?.ok || chat.json.chat?.id !== job.recipient_id || chat.json.chat?.isGroup ||
      !Array.isArray(chat.json.messages)) throw new DispatchDecision("WHATSAPP_RECIPIENT_UNVERIFIED");
  const msg = chat.json.messages.at(-1), when = Number(msg?.ts) * 1000;
  if (!msg || msg.fromMe !== false || msg.chatJid !== job.recipient_id || msg.kind !== "text" || typeof msg.text !== "string" ||
      msg.id !== job.source_id || !Number.isFinite(when) || when !== Date.parse(job.latest_inbound_at)) throw new DispatchDecision("INBOUND_CHANGED");
  if (!openWindow(job.latest_inbound_at,24)) throw new DispatchDecision("WINDOW_CLOSED");
  return { accountId:job.account_id,peerId:job.recipient_id,sourceId:job.source_id,sourceAt:job.latest_inbound_at,text:msg.text,
    privateAllowed:status.json.capabilities?.officeReply === true,publicAllowed:false,lastReplyAt:null,senderPhone:status.json.me.phone };
}
export async function sendWhatsAppReply(job: CaptureJob, proof: SocialProof, body: string) {
  if (!proof.privateAllowed) throw new DispatchDecision("WHATSAPP_GATEWAY_UPDATE_REQUIRED","blocked");
  const result = await whatsappGatewayFetch(sessionPath(job)+"/office-reply",{ method:"POST",body:{
    operationId:job.request_id, senderId:job.account_id, jid:job.recipient_id, inboundId:proof.sourceId, inboundAt:proof.sourceAt,
    sourceHash:createHash("sha256").update(proof.text).digest("hex"),text:body,
  } });
  const receipt = result.json;
  if (result.status === 404 || ["INBOUND_CHANGED","INVALID_RECIPIENT","SENDER_CHANGED","NOT_CONNECTED","INVALID_OFFICE_REPLY"].includes(receipt?.error)) {
    throw new DispatchDecision(result.status === 404 ? "WHATSAPP_GATEWAY_UPDATE_REQUIRED" : receipt.error,"blocked");
  }
  if (result.status !== 200 || !receipt?.ok || receipt.operationId !== job.request_id || receipt.chatId !== job.recipient_id || receipt.sender !== proof.senderPhone ||
      !["accepted","delivered","read"].includes(receipt.status) || typeof receipt.messageId !== "string" || !receipt.messageId) {
    throw new DispatchDecision("WHATSAPP_RECEIPT_UNCERTAIN","uncertain");
  }
  return receipt.messageId as string;
}
export async function prepareFormReply(db: any, job: CaptureJob) {
  if (job.whatsapp_consent !== true) throw new DispatchDecision("WHATSAPP_CONSENT_REQUIRED");
  if (!job.lead_id || !job.client_id || !job.actor_worker_id || !job.actor_user_id) throw new DispatchDecision("FORM_IDENTITY_UNVERIFIED");
  if (!await hasAdminAccess(db,job.actor_user_id)) throw new DispatchDecision("DELEGATION_REQUIRED","blocked");
  const actor = {id:job.actor_worker_id,user_id:job.actor_user_id,can_admin:true};
  const context = await captacionWhatsAppLead(db,actor,job.lead_id,"celestial");
  if (context.client.id !== job.client_id || context.submission_key !== "meta:"+job.source_id || context.lead.closed_at ||
      !captacionWhatsAppRecipient(context.client)) throw new DispatchDecision("FORM_CHANGED");
  const settings = await captacionWhatsAppTemplate();
  if (!settings.ready || !settings.template) throw new DispatchDecision(settings.reason || "TEMPLATE_UNAVAILABLE","blocked");
  return { body:CAPTACION_WHATSAPP_BODY.replace("{{1}}",()=>captacionWhatsAppName(context.client)), send:async () => {
    const result = await sendCaptacionWhatsAppOfficial(db,actor,context,job.request_id);
    if (!result.message_id || !["accepted","sent","delivered","read"].includes(result.status)) {
      throw new DispatchDecision(["failed","undelivered"].includes(result.status) ? "WHATSAPP_REJECTED" : "WHATSAPP_RECEIPT_UNCERTAIN",
        ["failed","undelivered"].includes(result.status) ? "failed" : "uncertain");
    }
    return String(result.message_id);
  } };
}
