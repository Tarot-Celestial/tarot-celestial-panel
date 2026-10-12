import * as THREE from "three";

export type PlanetTexture = { texture: THREE.Texture; width: number; dispose: () => void };
export type PlanetDetailTextures = { textures: THREE.Texture[]; width: number; dispose: () => void };

/** A split surface is installed atomically; failure or cancellation frees both halves. */
export async function loadPlanetDetail(paths: string[], signal: AbortSignal, anisotropy: number): Promise<PlanetDetailTextures> {
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) request.abort();
  const loaded: PlanetTexture[] = [];
  try {
    const maps = await Promise.all(paths.map(async path => {
      const map = await loadPlanetTexture(path, request.signal, anisotropy);
      if (request.signal.aborted) { map.dispose(); throw new DOMException("Detail request canceled", "AbortError"); }
      loaded.push(map);
      return map;
    }));
    if (request.signal.aborted) throw new DOMException("Detail request canceled", "AbortError");
    if (maps.length === 2) maps.forEach(map => { map.texture.wrapS = THREE.ClampToEdgeWrapping; });
    return { textures: maps.map(map => map.texture), width: maps.reduce((sum, map) => sum + map.width, 0), dispose: () => maps.forEach(map => map.dispose()) };
  } catch (error) {
    request.abort(); loaded.forEach(map => map.dispose());
    throw error;
  } finally { signal.removeEventListener("abort", abort); }
}

/** Only the visible worlds own textures. Canceled navigation releases late decodes. */
export async function loadPlanetTexture(path: string, signal: AbortSignal, anisotropy: number): Promise<PlanetTexture> {
  const response = await fetch(path, { signal, cache: "force-cache" });
  if (!response.ok) throw new Error(`Planet texture unavailable (${response.status})`);
  const blob = await response.blob();
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  let texture: THREE.Texture;
  const canceled = () => { if (signal.aborted) throw new DOMException("Texture request canceled", "AbortError"); };
  try {
    canceled();
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" });
      canceled();
      texture = new THREE.Texture(bitmap);
      texture.flipY = false;
    } else {
      const url = URL.createObjectURL(blob);
      image = new Image(); image.decoding = "async";
      try { image.src = url; await image.decode(); canceled(); }
      finally { URL.revokeObjectURL(url); }
      texture = new THREE.Texture(image);
    }
  } catch (error) { bitmap?.close(); if (image) image.src = ""; throw error; }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(4, Math.max(1, anisotropy));
  texture.needsUpdate = true;
  let disposed = false;
  return {
    texture,
    width: bitmap?.width || image?.naturalWidth || 0,
    dispose() {
      if (disposed) return;
      disposed = true; texture.dispose(); bitmap?.close();
      if (image) image.src = "";
      texture.image = null;
    },
  };
}
