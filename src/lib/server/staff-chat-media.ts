import { staffChatError, requireStaffChatThread, type StaffChatActor } from "@/lib/server/staff-chat";

export const STAFF_MEDIA_BUCKET = "staff-chat-private";
export const STAFF_MEDIA_COLUMNS = "id,thread_id,sender_worker_id,message_id,object_path,kind,mime_type,file_name,size_bytes,validated_at";
// Optional for older clients. This binds a pending send to its original actor;
// it never supplies or overrides the identity verified by getUser.
export function requireExpectedChatActor(body: any, me: StaffChatActor) {
  if (body?.expected_worker_id !== undefined && String(body.expected_worker_id).toLowerCase() !== me.id.toLowerCase()) throw new Error("IDENTITY_CHANGED");
}
const TYPES: Record<string, { kind: "image" | "audio"; extension: string; max: number }> = {
  "image/jpeg": { kind: "image", extension: "jpg", max: 10 * 1024 * 1024 },
  "image/png": { kind: "image", extension: "png", max: 10 * 1024 * 1024 },
  "image/webp": { kind: "image", extension: "webp", max: 10 * 1024 * 1024 },
  "audio/webm": { kind: "audio", extension: "webm", max: 15 * 1024 * 1024 },
  "audio/ogg": { kind: "audio", extension: "ogg", max: 15 * 1024 * 1024 },
  "audio/mp4": { kind: "audio", extension: "m4a", max: 15 * 1024 * 1024 },
  "audio/mpeg": { kind: "audio", extension: "mp3", max: 15 * 1024 * 1024 },
};
export function requireMediaId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error("INVALID_ATTACHMENT_ID");
  return value.toLowerCase();
}
export function mediaInput(body: any) {
  const id = requireMediaId(body?.client_upload_id);
  const mime = String(body?.mime_type || "").split(";")[0].trim().toLowerCase();
  const type = TYPES[mime];
  const size = body?.size_bytes;
  if (!type || body?.kind !== type.kind) throw new Error("INVALID_MEDIA_TYPE");
  if (!Number.isSafeInteger(size) || size <= 0 || size > type.max) throw new Error("INVALID_MEDIA_SIZE");
  const fileName = String(body?.file_name || (type.kind === "image" ? "imagen" : "nota-de-voz"))
    .replace(/[\\/\u0000-\u001f\u007f]/g, "_").trim().slice(0, 120);
  if (!fileName) throw new Error("INVALID_MEDIA_NAME");
  return { id, mime, type, size, fileName };
}
export function publicAttachment(row: any) {
  return { id: String(row.id), kind: row.kind, mime_type: row.mime_type, file_name: row.file_name, size_bytes: Number(row.size_bytes) };
}
export async function messageAttachments(db: any, messageIds: string[]) {
  if (!messageIds.length) return new Map<string, any>();
  const { data, error } = await db.from("staff_chat_attachments").select(STAFF_MEDIA_COLUMNS).in("message_id", messageIds);
  if (error) throw error;
  return new Map<string, any>((data || []).map((row: any) => [String(row.message_id), publicAttachment(row)]));
}
async function attachmentRow(db: any, attachmentId: string) {
  const { data, error } = await db.from("staff_chat_attachments").select(STAFF_MEDIA_COLUMNS).eq("id", requireMediaId(attachmentId)).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("ATTACHMENT_NOT_FOUND");
  return data;
}
export async function reserveStaffMedia(db: any, me: StaffChatActor, body: any) {
  const threadId = String(body?.thread_id || "");
  await requireStaffChatThread(db, me, threadId);
  const input = mediaInput(body);
  const objectPath = me.id + "/" + threadId + "/" + input.id + "." + input.type.extension;
  const row = { id: input.id, thread_id: threadId, sender_worker_id: me.id, object_path: objectPath,
    kind: input.type.kind, mime_type: input.mime, file_name: input.fileName, size_bytes: input.size };
  const { error } = await db.from("staff_chat_attachments").insert(row);
  if (error && error.code !== "23505") throw error;
  if (error) {
    const previous = await attachmentRow(db, input.id);
    if (previous.sender_worker_id !== me.id || previous.thread_id !== threadId) throw new Error("FORBIDDEN");
    if (previous.object_path !== objectPath || previous.mime_type !== input.mime || Number(previous.size_bytes) !== input.size || previous.file_name !== input.fileName) throw new Error("UPLOAD_ID_CONFLICT");
  }
  const storage = db.storage.from(STAFF_MEDIA_BUCKET);
  const { data: exists, error: existsError } = await storage.exists(objectPath);
  if (existsError) throw new Error("MEDIA_STORAGE_UNAVAILABLE");
  if (exists) return { ok: true, attachment_id: input.id, bucket: STAFF_MEDIA_BUCKET, path: objectPath, already_uploaded: true };
  const { data, error: signingError } = await storage.createSignedUploadUrl(objectPath, { upsert: false });
  if (signingError || !data?.token) throw new Error("MEDIA_STORAGE_UNAVAILABLE");
  return { ok: true, attachment_id: input.id, bucket: STAFF_MEDIA_BUCKET, path: objectPath,
    token: data.token, signed_url: data.signedUrl, already_uploaded: false };
}
// File names and browser MIME are untrusted. Restrict containers and reject obvious
// video tracks in audio uploads. This is format validation, not a malware scanner.
export function validMediaBytes(bytes: Uint8Array, mime: string) {
  const b = Buffer.from(bytes);
  const head = b.subarray(0, 65536);
  if (mime === "image/jpeg") return b.length > 4 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (mime === "image/png") return b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.toString("ascii",12,16) === "IHDR";
  if (mime === "image/webp") return b.length >= 16 && b.toString("ascii",0,4) === "RIFF" && b.toString("ascii",8,12) === "WEBP";
  if (mime === "audio/ogg") return head.toString("ascii",0,4) === "OggS" && (head.includes(Buffer.from("OpusHead")) || head.includes(Buffer.from("vorbis"))) && !head.includes(Buffer.from("theora"));
  if (mime === "audio/webm") return b[0] === 26 && b[1] === 69 && b[2] === 223 && b[3] === 163
    && head.includes(Buffer.from("webm")) && (head.includes(Buffer.from("A_OPUS")) || head.includes(Buffer.from("A_VORBIS")))
    && !head.includes(Buffer.from("V_VP")) && !head.includes(Buffer.from("V_AV1"));
  if (mime === "audio/mp4") return b.length >= 16 && b.toString("ascii",4,8) === "ftyp" && b.includes(Buffer.from("soun")) && !b.includes(Buffer.from("vide"));
  if (mime === "audio/mpeg") {
    let offset = 0;
    if (head.toString("ascii",0,3) === "ID3" && b.length >= 10) offset = 10 + ((b[6]&127)<<21) + ((b[7]&127)<<14) + ((b[8]&127)<<7) + (b[9]&127);
    for (let i = offset; i < Math.min(b.length-3, offset+4096); i++) {
      if (b[i] === 255 && (b[i+1]&224) === 224 && (b[i+1]&6) !== 0 && (b[i+2]&240) !== 0 && (b[i+2]&240) !== 240 && (b[i+2]&12) !== 12) return true;
    }
  }
  return false;
}
export async function validateStaffMedia(db: any, me: StaffChatActor, threadId: string, attachmentId: string) {
  const row = await attachmentRow(db, attachmentId);
  if (row.sender_worker_id !== me.id || row.thread_id !== threadId) throw new Error("FORBIDDEN");
  if (row.validated_at) return row;
  const storage = db.storage.from(STAFF_MEDIA_BUCKET);
  const { data: info, error: infoError } = await storage.info(row.object_path);
  if (infoError || !info) throw new Error("ATTACHMENT_NOT_UPLOADED");
  const size = Number(info.size ?? info.metadata?.size);
  const mime = String(info.contentType ?? info.mimetype ?? info.metadata?.mimetype ?? "").split(";")[0].toLowerCase();
  if (size !== Number(row.size_bytes) || mime !== row.mime_type) throw new Error("INVALID_MEDIA_CONTENT");
  // At most 15 MiB, fetched server-to-storage; it never traverses a Vercel request body.
  const { data: blob, error: downloadError } = await storage.download(row.object_path);
  if (downloadError || !blob) throw new Error("MEDIA_STORAGE_UNAVAILABLE");
  if (blob.size !== size || !validMediaBytes(new Uint8Array(await blob.arrayBuffer()), mime)) throw new Error("INVALID_MEDIA_CONTENT");
  const { error } = await db.from("staff_chat_attachments").update({ validated_at: new Date().toISOString() }).eq("id", row.id);
  if (error) throw error;
  return row;
}
export async function sendStaffMediaMessage(db: any, me: StaffChatActor, threadId: string, clientMessageId: string, text: string, attachmentId: string) {
  await requireStaffChatThread(db, me, threadId);
  const row = await validateStaffMedia(db, me, threadId, attachmentId);
  const messageText = text || (row.kind === "image" ? "📷 Imagen" : "🎤 Nota de voz");
  const { data, error } = await db.rpc("staff_chat_send_media_message", {
    p_worker_id: me.id, p_thread_id: threadId, p_client_message_id: clientMessageId, p_body: messageText, p_attachment_id: row.id,
  });
  if (error) throw error;
  if (!data?.message?.id) throw new Error("MEDIA_STORAGE_UNAVAILABLE");
  return { ...data, attachment: publicAttachment(row) };
}
export async function readStaffMedia(db: any, me: StaffChatActor, attachmentId: string) {
  const row = await attachmentRow(db, attachmentId);
  await requireStaffChatThread(db, me, row.thread_id);
  if (!row.message_id || !row.validated_at) throw new Error("ATTACHMENT_NOT_FOUND");
  const { data, error } = await db.storage.from(STAFF_MEDIA_BUCKET).createSignedUrl(row.object_path, 60);
  if (error || !data?.signedUrl) throw new Error("MEDIA_STORAGE_UNAVAILABLE");
  return { ok: true, url: data.signedUrl, expires_in: 60 };
}
export function staffMediaError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as any)?.message || "");
  if (message === "IDENTITY_CHANGED") return { code: message, status: 409 };
  if (["ATTACHMENT_NOT_FOUND"].includes(message)) return { code: message, status: 404 };
  if (["ATTACHMENT_ALREADY_USED", "UPLOAD_ID_CONFLICT", "ATTACHMENT_NOT_UPLOADED"].includes(message)) return { code: message, status: 409 };
  if (message === "MEDIA_STORAGE_UNAVAILABLE") return { code: message, status: 503 };
  return staffChatError(error);
}
