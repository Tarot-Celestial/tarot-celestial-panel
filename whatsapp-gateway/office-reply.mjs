import { createHash, randomBytes } from "node:crypto";
import { OPERATION_ID_RE, gatewayError } from "./captacion-journal.mjs";

const direct = /^(?:[1-9]\d{7,14}@s\.whatsapp\.net|\d{1,30}@lid)$/;
export async function sendOfficeReply(session, command, journal) {
  const { operationId, senderId, jid, inboundId, inboundAt, sourceHash, text } = command || {};
  if (!OPERATION_ID_RE.test(operationId || "") || !direct.test(jid || "") || typeof senderId !== "string" ||
      typeof inboundId !== "string" || !inboundId || typeof text !== "string" || !text.trim() || text.length > 1000 ||
      !/^[a-f0-9]{64}$/.test(sourceHash || "")) throw gatewayError("INVALID_OFFICE_REPLY",400);
  const fingerprint = createHash("sha256").update(JSON.stringify([session.id,senderId,jid,inboundId,inboundAt,sourceHash,text])).digest("hex");
  const prior = journal.lookup(session.id,operationId,fingerprint);
  if (prior) return prior;
  session.requireConnected();
  if (session.me?.id !== senderId || !/^[1-9]\d{7,14}$/.test(session.me?.phone || "")) throw gatewayError("SENDER_CHANGED",409);
  const target = session.store.canonical(jid);
  if (target !== jid || target === session.store.canonical(senderId)) throw gatewayError("INVALID_RECIPIENT",409);
  const latest = session.store.getMessages(target,1)[0];
  const occurred = Date.parse(inboundAt), since = Date.now() - occurred;
  if (!latest || latest.chatJid !== target || latest.fromMe !== false || latest.kind !== "text" || latest.id !== inboundId ||
      !Number.isFinite(occurred) || Number(latest.ts)*1000 !== occurred || since < 0 || since >= 24*3600000 ||
      createHash("sha256").update(String(latest.text)).digest("hex") !== sourceHash) throw gatewayError("INBOUND_CHANGED",409);
  const messageId = "3EB0" + randomBytes(9).toString("hex").toUpperCase();
  const claim = journal.claim({sessionId:session.id,operationId,fingerprint,sender:session.me.phone,chatId:target,messageId});
  if (!claim.claimed) return claim.receipt;
  try {
    const sent = await session.sock.sendMessage(target,{text},{messageId});
    if (sent?.key?.id !== messageId) return journal.setStatus(operationId,"unknown");
    const receipt = journal.setStatus(operationId,"accepted");
    try { session.onCaptacionSent?.(sent); } catch { /* Receipt is durable. */ }
    return receipt;
  } catch {
    return journal.setStatus(operationId,"unknown");
  }
}
