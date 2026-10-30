import { supabaseBrowser } from "@/lib/supabase-browser";
import { chatRequest } from "@/lib/staff-chat-client";

export type StaffChatMediaDraft = {
  file: File; kind: "image" | "audio"; mimeType: string; clientUploadId: string;
  previewUrl: string; attachmentId?: string;
};
const TYPES = { image: ["image/jpeg", "image/png", "image/webp"], audio: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"] };
export const CHAT_MEDIA_MAX_BYTES = { image: 10 * 1024 * 1024, audio: 15 * 1024 * 1024 };
export function chatMediaType(file: Pick<File, "type" | "size">, kind: "image" | "audio") {
  const mime = file.type.split(";", 1)[0].trim().toLowerCase();
  if (!TYPES[kind].includes(mime)) throw new Error(kind === "image" ? "Selecciona una imagen JPG, PNG o WebP." : "Selecciona audio WebM, Ogg, MP4 o MP3.");
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > CHAT_MEDIA_MAX_BYTES[kind]) throw new Error(kind === "image" ? "La imagen debe ocupar entre 1 byte y 10 MB." : "El audio debe ocupar entre 1 byte y 15 MB.");
  return mime;
}
export function createChatMediaDraft(file: File, kind: "image" | "audio"): StaffChatMediaDraft {
  const mimeType = chatMediaType(file, kind);
  return { file, kind, mimeType, clientUploadId: crypto.randomUUID(), previewUrl: URL.createObjectURL(file) };
}
export function releaseChatMediaDraft(draft?: StaffChatMediaDraft | null) {
  if (draft?.previewUrl) URL.revokeObjectURL(draft.previewUrl);
}
export async function uploadStaffChatMedia(draft: StaffChatMediaDraft, threadId: string, isCurrent: () => boolean, expectedWorkerId: string) {
  chatMediaType(draft.file, draft.kind);
  const result = await chatRequest("/api/chat/media/upload", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: threadId, client_upload_id: draft.clientUploadId, expected_worker_id: expectedWorkerId, kind: draft.kind, mime_type: draft.mimeType, file_name: draft.file.name, size_bytes: draft.file.size }),
  });
  if (!isCurrent()) throw new Error("El chat cambió de cuenta; no se enviará este adjunto.");
  if (!result.attachment_id || (draft.attachmentId && draft.attachmentId !== result.attachment_id)) throw new Error("No se pudo confirmar el adjunto. Reintenta el mismo envío.");
  draft.attachmentId = result.attachment_id;
  if (!result.already_uploaded) {
    if (!result.bucket || !result.path || !result.token) throw new Error("No se pudo preparar la subida del archivo.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const uploaded = await Promise.race([
        supabaseBrowser().storage.from(result.bucket).uploadToSignedUrl(result.path, result.token, draft.file, { contentType: draft.mimeType, upsert: false }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("La subida está tardando demasiado. Reintenta el mismo envío para comprobarla.")), 60000); }),
      ]);
      if (uploaded.error) throw new Error("No se pudo confirmar la subida. Reintenta este mismo envío.");
    } finally { if (timer) clearTimeout(timer); }
  }
  if (!isCurrent()) throw new Error("El chat cambió de cuenta; no se enviará este adjunto.");
  return String(result.attachment_id);
}
