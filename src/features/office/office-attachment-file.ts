import { OFFICE_FILE_LIMIT } from "./model";

export async function fileData(file: File) {
  if (file.size > OFFICE_FILE_LIMIT || file.size === 0) throw new Error("El archivo debe contener datos y ocupar como máximo 2 MiB.");
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", pdf: "application/pdf", txt: "text/plain",
  };
  const mime = types[file.name.split(".").pop()?.toLowerCase() || ""];
  if (!mime || (file.type && file.type !== mime)) throw new Error("Adjunta un PDF, PNG, JPEG, WebP, MP4 o TXT válido.");
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo seleccionado."));
    reader.readAsDataURL(file);
  });
  return { file_name: file.name, file_type: mime, file_base64: url.slice(url.indexOf(",") + 1) };
}
