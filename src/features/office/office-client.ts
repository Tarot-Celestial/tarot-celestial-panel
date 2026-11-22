"use client";

import { supabaseBrowser } from "@/lib/supabase-browser";

export class OfficeRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function authorizedRequest(path: string, init: RequestInit = {}) {
  const { data, error } = await supabaseBrowser().auth.getSession();
  if (error) throw new OfficeRequestError("No se pudo comprobar tu sesión. Vuelve a intentarlo.", 503);
  if (!data.session) throw new OfficeRequestError("Inicia sesión para entrar en la Oficina.", 401);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  if (typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const fallback = response.status === 403 ? "Acceso reservado a administración." : "No se pudo completar la operación en la Oficina.";
    const message = detail?.message || detail?.error;
    if (response.status === 401 || response.status === 403) window.dispatchEvent(new Event("tc-office-access-changed"));
    throw new OfficeRequestError(typeof message === "string" ? message : fallback, response.status);
  }
  return response;
}

export async function officeRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authorizedRequest(path, init);
  return response.json();
}

export async function officeFile(versionId: string, signal?: AbortSignal) {
  const response = await authorizedRequest(`/api/admin/oficina/archivo?id=${encodeURIComponent(versionId)}`, { signal });
  return response.blob();
}

export async function officeDownload(versionId: string, filename: string) {
  const url = URL.createObjectURL(await officeFile(versionId));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
