import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { gatewayError, OPERATION_ID_RE } from "./captacion-journal.mjs";

const IMAGE_PATH = fileURLToPath(new URL("../public/images/captacion/tarot-celestial-beneficios-v1.png", import.meta.url));
const IMAGE_VERSION = "tarot-celestial-beneficios-v1";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function captacionCaption(name) {
  return `Hola${name ? `, ${name}` : ""} 💜
Somos el equipo de Tarot Celestial. ¡Gracias por tu interés!

Aquí tus consultas vienen con más beneficios:
🎡 3 niveles de compra: cada nivel te da acceso a una ruleta con mejores premios.
🪙 Recibe Coins según el nivel de tu compra.
👑 Sube de rango y descubre más beneficios.
🔮 Prueba el Oráculo: tu primera tirada de cartas es gratis.

Regístrate y descubre tu espacio aquí:
https://clientestarotcelestial.es/cliente/oraculo

Te comparto una imagen para que veas cómo funciona. ¿Te ayudo a empezar? ✨`;
}

export function readCaptacionImage() {
  try {
    const bytes = fs.readFileSync(IMAGE_PATH);
    if (bytes.length < 8 || bytes.length > 5 * 1024 * 1024 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error();
    return bytes;
  } catch { throw gatewayError("IMAGE_UNAVAILABLE"); }
}

export function validateCaptacionCommand(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !["operationId", "phone", "name", "expectedSender"].includes(key))) {
    throw gatewayError("INVALID_CAPTACION_COMMAND", 400);
  }
  if (typeof value.operationId !== "string" || !OPERATION_ID_RE.test(value.operationId)) throw gatewayError("INVALID_OPERATION_ID", 400);
  if (typeof value.phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(value.phone)) throw gatewayError("INVALID_PHONE", 400);
  if (typeof value.expectedSender !== "string" || !/^\+?[1-9]\d{7,14}$/.test(value.expectedSender)) throw gatewayError("INVALID_SENDER", 400);
  if (typeof value.name !== "string" || value.name.length > 160 || /[\u0000-\u001f\u007f-\u009f]/.test(value.name)) throw gatewayError("INVALID_NAME", 400);
  return {
    operationId: value.operationId.toLowerCase(), phone: value.phone,
    name: value.name.replace(/\s+/g, " ").trim(), expectedSender: value.expectedSender.replace(/^\+/, ""),
  };
}

/** Dependencies are injectable only in Node tests; HTTP accepts no text or URL. */
export function createCaptacionSender({ journal, imageLoader = readCaptacionImage, timeoutMs = 25_000, onWarning = () => {} }) {
  return async function sendCaptacion(session, input) {
    const command = validateCaptacionCommand(input);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify({
      sessionId: session.id, phone: command.phone, name: command.name, sender: command.expectedSender, image: IMAGE_VERSION,
    })).digest("hex");
    const existing = journal.lookup(session.id, command.operationId, fingerprint);
    if (existing) return existing;

    const sock = session.sock;
    const checkSender = () => {
      if (session.state !== "connected" || !session.sock) throw gatewayError("NOT_CONNECTED", 409);
      if (session.sock !== sock || session.me?.phone !== command.expectedSender) throw gatewayError("SENDER_CHANGED", 409);
    };
    checkSender();
    const image = imageLoader();
    let found;
    try { [found] = (await sock.onWhatsApp(command.phone.slice(1))) || []; }
    catch { throw gatewayError("RECIPIENT_LOOKUP_FAILED", 503); }
    if (!found?.exists) throw gatewayError("NOT_ON_WHATSAPP", 404);
    const chatId = String(found.jid || "").replace(/:\d+@/, "@");
    // Use the provider's resolved direct recipient, never arbitrary caller JIDs.
    if (!/^(?:[1-9]\d{7,14}@s\.whatsapp\.net|\d{1,30}@lid)$/.test(chatId)) throw gatewayError("INVALID_RECIPIENT", 503);
    checkSender();
    const messageId = `3EB0${crypto.randomBytes(9).toString("hex").toUpperCase()}`;
    const claim = journal.claim({
      sessionId: session.id, operationId: command.operationId, fingerprint,
      sender: command.expectedSender, chatId, messageId,
    });
    if (!claim.claimed) return claim.receipt;

    const receipt = (status) => {
      try { return journal.setStatus(command.operationId, status); }
      catch {
        onWarning("CAPTACION_RECEIPT_WRITE_FAILED");
        return { ...claim.receipt, status: "unknown" };
      }
    };
    // Any failure after calling sendMessage is ambiguous. Keep the durable claim;
    // do not expose a retryable HTTP error, and never invoke send a second time.
    const sending = Promise.resolve().then(() => {
      checkSender();
      return sock.sendMessage(chatId, {
      image, caption: captacionCaption(command.name), mimetype: "image/png",
      }, { messageId, mediaUploadTimeoutMs: 15_000 });
    }).then((sent) => {
      if (sent?.key?.id !== messageId) return receipt("unknown");
      const accepted = receipt("accepted");
      try { session.onCaptacionSent?.(sent); } catch { onWarning("CAPTACION_CHAT_UPDATE_FAILED"); }
      return accepted;
    }, () => receipt("unknown"));
    let timer;
    try {
      return await Promise.race([sending, new Promise((resolve) => {
        timer = setTimeout(() => resolve(receipt("unknown")), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
}
