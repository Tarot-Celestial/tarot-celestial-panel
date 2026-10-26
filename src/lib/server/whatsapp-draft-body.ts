/** Bound untrusted bodies even when the client omits or understates Content-Length. */
export async function readWhatsAppDraftBody(req: Request, max: number): Promise<Uint8Array> {
  if (Number(req.headers.get("content-length")) > max) throw new Error("BODY_TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("INVALID_BODY");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error("BODY_TOO_LARGE"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
