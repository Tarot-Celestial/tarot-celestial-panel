import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import type { SupabaseClient } from "@supabase/supabase-js";

export class InstagramDraftError extends Error {}
const execMedia = promisify(execFile);
export const mediaDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Prepared = { bytes: Buffer; type: "image/jpeg" | "video/mp4"; sha: string };
const maxFile = 2 * 1024 * 1024;

export function publicInstagramText(body: string) {
  const normalized = body.normalize("NFC").replace(/\r\n/g, "\n").trim();
  const [captionPart, visual = ""] = normalized.split(/\n\n(?:Texto de la imagen|Texto del vídeo)\n\n/u);
  const caption = captionPart.split(/\n\nTexto alternativo\n\n/u)[0].trim();
  const alt = (visual || normalized).split(/\n\nTexto alternativo\n\n/u)[1]?.trim() || "";
  if (!caption || [...caption].length > 2200 || [...alt].length > 1000 || /^borrador interno\b/iu.test(caption)) {
    throw new InstagramDraftError("Revisa el texto público y la descripción accesible de esta versión antes de aprobarla.");
  }
  return { caption, alt_text: alt };
}

// Only bytes from the immutable Office version enter the encoder; it never accepts a remote URL.
export async function prepareInstagramMedia(source: Buffer, mime: string): Promise<Prepared> {
  if (!source.length || source.length > maxFile || !["image/jpeg","image/png","image/webp","video/mp4"].includes(mime)) {
    throw new InstagramDraftError("Selecciona una versión con una imagen o un vídeo MP4 de hasta 2 MiB.");
  }
  const bin = process.env.FFMPEG_PATH || ffmpeg;
  if (!bin) throw new Error("No está disponible el procesador de medios.");
  const dir = await mkdtemp(path.join(os.tmpdir(), "office-ig-"));
  try {
    const input = path.join(dir, "source");
    await writeFile(input, source);
    const isVideo = mime === "video/mp4";
    const common = ["-hide_banner","-nostdin","-threads","1","-protocol_whitelist","file",
      "-max_pixels","16384000","-f",isVideo ? "mov" : "image2pipe","-i",input];
    if (isVideo) {
      const { stderr } = await execMedia(bin, [...common,"-map","0:v:0","-frames:v","1","-f","null","-"],
        { timeout: 15000, maxBuffer: 120000, windowsHide: true });
      const inputInfo = stderr.split('Stream mapping:')[0];
      const duration = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(inputInfo);
      const seconds = duration ? Number(duration[1])*3600 + Number(duration[2])*60 + Number(duration[3]) : 0;
      // FFmpeg also prints "audio:0kB" in the output summary of a silent video.
      const streamLines = inputInfo.split(/\r?\n/).filter(line => /^\s*Stream #\d+:\d+/.test(line));
      const video = streamLines.find(line => /:\s*Video:/.test(line));
      const incompatibleAudio = streamLines.some(line => /:\s*Audio:(?!\s*aac\b)/i.test(line));
      if (seconds < 3 || seconds > 900 || !video || !/Video:\s*(h264|hevc)\b/i.test(video) || incompatibleAudio) {
        throw new InstagramDraftError("El reel debe ser un MP4 de 3 segundos a 15 minutos, con vídeo H.264 o HEVC y audio AAC si incluye sonido.");
      }
      return { bytes: source, type: "video/mp4", sha: mediaDigest(source) };
    }
    const output = path.join(dir, "feed.jpg");
    const { stderr } = await execMedia(bin, [...common,"-map","0:v:0","-frames:v","1","-threads","1",
      "-vf","scale='min(1080,iw)':-2,setsar=1,format=yuvj420p","-map_metadata","-1","-c:v","mjpeg","-q:v","2","-flags","+bitexact",output],
      { timeout: 15000, maxBuffer: 120000, windowsHide: true });
    const size = /Video:\s*mjpeg[^\n]*?\b(\d{2,5})x(\d{2,5})\b/i.exec(stderr.split("Output #")[1] || "");
    if (!size) throw new InstagramDraftError("No se pudieron verificar las dimensiones de la foto.");
    const width = Number(size[1]), height = Number(size[2]);
    if (width < 320 || width / height < 0.8 || width / height > 1.91) {
      throw new InstagramDraftError("Elige una foto de al menos 320 px de ancho y proporción entre 4:5 y 1,91:1.");
    }
    const bytes = await readFile(output);
    if (bytes.length > 8 * 1024 * 1024) throw new InstagramDraftError("El JPEG supera los 8 MB permitidos por Instagram.");
    return { bytes, type: "image/jpeg", sha: mediaDigest(bytes) };
  } catch (error) {
    if (error instanceof InstagramDraftError) throw error;
    throw new InstagramDraftError("No se pudo preparar este archivo para Instagram. Comprueba su formato.");
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function loadInstagramVersion(db: SupabaseClient, id: string) {
  const row = await db.from("office_versions").select("id,task_id,deliverable_id,version,title,body,status,file_type,file_bytes").eq("id",id).maybeSingle();
  if (row.error) throw new Error("No se pudo consultar el entregable.");
  if (!row.data) throw new InstagramDraftError("No se encontró esta versión.");
  const v = row.data;
  const bytes = typeof v.file_bytes === "string" && v.file_bytes.startsWith("\\x") ? Buffer.from(v.file_bytes.slice(2), "hex") : null;
  if (!bytes) throw new InstagramDraftError("Esta versión requiere un archivo adjunto compatible.");
  const media = await prepareInstagramMedia(bytes, v.file_type);
  return { version: { id:v.id, task_id:v.task_id, deliverable_id:v.deliverable_id, version:v.version, status:v.status, title:v.title },
    ...publicInstagramText(v.body), media };
}
