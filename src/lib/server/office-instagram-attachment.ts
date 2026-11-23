import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OFFICE_FILE_LIMIT } from "../../features/office/model";

export async function loadOfficePublicationAttachment(db: SupabaseClient, runId: string, expectedHash: string, format: unknown) {
  const invalid = () => new Error("El adjunto de Instagram no coincide con el archivo autorizado para este encargo.");
  if (!/^[0-9a-f]{64}$/.test(expectedHash) || (format !== "photo" && format !== "reel")) throw invalid();
  const { data, error } = await db.from("office_instagram_order_files")
    .select("file_name,file_type,file_bytes,file_alt,sha256").eq("run_id",runId).eq("sha256",expectedHash).single();
  if (error || !data) throw invalid();
  const { file_name, file_type, file_alt, file_bytes } = data;
  if (typeof file_bytes !== "string" || !file_bytes.startsWith("\\x") || file_bytes.length > OFFICE_FILE_LIMIT * 2 + 2 ||
    file_bytes.length % 2 !== 0 || !/^[0-9a-f]+$/.test(file_bytes.slice(2)) || data.sha256 !== expectedHash) throw invalid();
  const bytes = Buffer.from(file_bytes.slice(2), "hex");
  const image = ["image/png","image/jpeg","image/webp"].includes(file_type);
  if (typeof file_name !== "string" || typeof file_alt !== "string" ||
    (format === "reel" ? file_type !== "video/mp4" || file_alt !== "" : !image || !file_alt.trim()) ||
    createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw invalid();
  return { file_name: String(file_name), file_type: String(file_type), file_base64: bytes.toString("base64"), alt_text: file_alt };
}
