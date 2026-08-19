"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { BadgePlus, Coins, Contact, Save, ShieldCheck, Sparkles, Tag, UserRoundCheck, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { COUNTRY_OPTIONS, DEFAULT_COUNTRY_CODE, buildInternationalPhone, formatCountryOptionLabel, getCountryByCode } from "@/lib/countries";
import { getActiveBrand } from "@/components/global/BrandSwitcher";
import { tcToast } from "@/lib/tc-toast";
import styles from "./CentralNewClientModal.module.css";

type TagOption = { id: string; nombre: string; color?: string | null };
type ResponsibleWorker = { id: string; display_name?: string | null; team?: string | null; role?: string | null; is_active?: boolean | null };
type Props = { open: boolean; onClose: () => void; onCreated: (clientId: string) => void };
type FormState = {
  nombre: string; apellido: string; telefono: string; countryCode: string; email: string;
  deuda: string; free: string; normal: string; notas: string;
};
const EMPTY_FORM: FormState = { nombre: "", apellido: "", telefono: "", countryCode: DEFAULT_COUNTRY_CODE, email: "", deuda: "0", free: "0", normal: "0", notas: "" };

async function token() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || "";
}
async function json(response: Response) {
  return response.json().catch(() => null);
}
function friendlyError(code: string) {
  if (code === "CLIENTE_YA_EXISTE_EN_ESTA_MARCA") return "Esta clienta ya existe en la marca seleccionada.";
  if (code === "FALTA_NOMBRE") return "El nombre es obligatorio.";
  if (code === "FALTA_TELEFONO") return "El teléfono es obligatorio.";
  if (code === "FALTA_RESPONSABLE") return "Selecciona una telefonista responsable.";
  if (code === "RESPONSABLE_NO_VALIDO") return "La telefonista seleccionada ya no está disponible.";
  if (code === "NO_PUEDE_ASIGNAR_OTRA_TELEFONISTA") return "No tienes permiso para asignar la clienta a otra telefonista.";
  if (code === "WORKER_INACTIVO") return "Tu perfil de telefonista no está activo.";
  if (code === "NO_AUTH") return "La sesión ha caducado. Vuelve a iniciar sesión.";
  return code || "No se pudo crear la clienta.";
}

export default function CentralNewClientModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [brand, setBrand] = useState<"celestial" | "orion">("celestial");
  const [tags, setTags] = useState<TagOption[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [loadingTags, setLoadingTags] = useState(false);
  const [workers, setWorkers] = useState<ResponsibleWorker[]>([]);
  const [responsibleId, setResponsibleId] = useState("");
  const [canAssign, setCanAssign] = useState(false);
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [creatingTag, setCreatingTag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const country = useMemo(() => getCountryByCode(form.countryCode), [form.countryCode]);
  const selectedWorker = useMemo(() => workers.find((item) => item.id === responsibleId) || null, [responsibleId, workers]);
  const origin = brand === "orion" ? "tarot_orion" : "tarot_celestial";

  useEffect(() => {
    if (!open) return;
    setBrand(getActiveBrand());
    setForm(EMPTY_FORM);
    setTags([]);
    setSelectedTags([]);
    setNewTag("");
    setWorkers([]);
    setResponsibleId("");
    setCanAssign(false);
    setError("");
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    void (async () => {
      setLoadingTags(true); setLoadingWorkers(true);
      try {
        const accessToken = await token();
        const headers = { Authorization: `Bearer ${accessToken}` };
        const [tagsResponse, workersResponse] = await Promise.all([
          fetch("/api/crm/etiquetas/listar", { headers, cache: "no-store" }),
          fetch("/api/crm/clientes/crear", { headers, cache: "no-store" }),
        ]);
        const [tagsPayload, workersPayload] = await Promise.all([json(tagsResponse), json(workersResponse)]);
        if (tagsResponse.ok && tagsPayload?.ok) setTags(Array.isArray(tagsPayload.etiquetas) ? tagsPayload.etiquetas : []);
        if (!workersResponse.ok || !workersPayload?.ok) throw new Error(friendlyError(String(workersPayload?.error || "")));
        const available = Array.isArray(workersPayload.workers) ? workersPayload.workers : [];
        setWorkers(available);
        setCanAssign(Boolean(workersPayload.can_assign));
        // La telefonista autenticada queda preseleccionada cuando la asignación está
        // protegida. Un administrador debe escoger expresamente a la responsable.
        setResponsibleId(String(workersPayload.current_worker_id || ""));
      } catch (cause: any) {
        setError(friendlyError(String(cause?.message || "")));
      } finally { setLoadingTags(false); setLoadingWorkers(false); }
    })();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function createTag() {
    const name = newTag.trim();
    if (!name || creatingTag) return;
    setCreatingTag(true); setError("");
    try {
      const accessToken = await token();
      const response = await fetch("/api/crm/etiquetas/crear", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ nombre: name }) });
      const payload = await json(response);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "No se pudo crear la etiqueta.");
      const created = payload.etiqueta as TagOption;
      setTags((current) => current.some((item) => item.id === created.id) ? current : [...current, created].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
      setSelectedTags((current) => current.includes(created.id) ? current : [...current, created.id]);
      setNewTag("");
    } catch (cause: any) { setError(cause?.message || "No se pudo crear la etiqueta."); }
    finally { setCreatingTag(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!form.nombre.trim()) return setError("El nombre es obligatorio.");
    const phone = buildInternationalPhone(country, form.telefono);
    if (!phone) return setError("Introduce un teléfono válido.");
    if (!responsibleId) return setError("Selecciona una telefonista responsable.");
    setSaving(true); setError("");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("NO_AUTH");
      const response = await fetch("/api/crm/clientes/crear", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre.trim(), apellido: form.apellido.trim(), telefono: phone, pais: country.label,
          email: form.email.trim(), origen: origin, brand,
          deuda_pendiente: Number(String(form.deuda).replace(",", ".")) || 0,
          minutos_free_pendientes: Math.max(0, Number(String(form.free).replace(",", ".")) || 0),
          minutos_normales_pendientes: Math.max(0, Number(String(form.normal).replace(",", ".")) || 0),
          notas: form.notas.trim(), etiquetas: selectedTags,
          responsible_worker_id: responsibleId, source: "mis_clientas",
        }),
      });
      const payload = await json(response);
      if (!response.ok || !payload?.ok) throw new Error(friendlyError(String(payload?.error || "")));
      const clientId = String(payload?.cliente?.id || "");
      setForm(EMPTY_FORM); setSelectedTags([]); setNewTag("");
      onCreated(clientId);
      onClose();
      const responsibleName = String(payload?.responsable?.display_name || workers.find((item) => item.id === responsibleId)?.display_name || "la telefonista seleccionada");
      tcToast({ title: "✓ Clienta creada", description: `${form.nombre.trim()} ha sido asignada a ${responsibleName}.`, tone: "success", duration: 4200 });
      window.dispatchEvent(new Event("tc-my-clients-refresh"));
    } catch (cause: any) { setError(friendlyError(String(cause?.message || ""))); }
    finally { setSaving(false); }
  }

  if (!open) return null;
  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="new-client-title">
        <header className={styles.header}><div className={styles.mark}><Sparkles /></div><div><span>NUEVA CLIENTA · {brand.toUpperCase()}</span><h2 id="new-client-title">Alta sincronizada con CRM</h2><p>Datos, cartera, saldos y XP conectados al sistema real.</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar formulario"><X /></button></header>
        <form onSubmit={submit} className={styles.form}>
          <div className={styles.scroll}>
            <fieldset><legend><Contact /> Datos personales</legend><div className={styles.grid}>
              <label><span>Nombre *</span><input autoFocus value={form.nombre} onChange={(e)=>update("nombre",e.target.value)} autoComplete="given-name" /></label>
              <label><span>Apellidos</span><input value={form.apellido} onChange={(e)=>update("apellido",e.target.value)} autoComplete="family-name" /></label>
              <label><span>País</span><select value={form.countryCode} onChange={(e)=>update("countryCode",e.target.value)}>{COUNTRY_OPTIONS.map((item)=><option key={item.code} value={item.code}>{formatCountryOptionLabel(item)}</option>)}</select></label>
              <label><span>Teléfono *</span><div className={styles.phone}><b>{country.dialCode}</b><input value={form.telefono} onChange={(e)=>update("telefono",e.target.value)} inputMode="tel" autoComplete="tel-national" placeholder={country.hint}/></div></label>
              <label className={styles.full}><span>Email</span><input type="email" value={form.email} onChange={(e)=>update("email",e.target.value)} autoComplete="email" placeholder="clienta@email.com" /></label>
            </div></fieldset>
            <fieldset className={styles.assignmentSection}><legend><UserRoundCheck /> Asignación y procedencia</legend><div className={styles.assignmentGrid}>
              <div className={styles.responsibleField}><span className={styles.label}>Telefonista responsable *</span>
                {loadingWorkers ? <div className={styles.responsibleLoading}>Consultando telefonistas activas…</div> : canAssign ? (
                  <div className={styles.workerOptions} role="radiogroup" aria-label="Telefonista responsable">
                    {workers.map((item) => <label key={item.id} className={responsibleId===item.id?styles.workerSelected:styles.workerOption}>
                      <input type="radio" name="responsible-worker" value={item.id} checked={responsibleId===item.id} onChange={()=>setResponsibleId(item.id)} />
                      <span className={styles.avatar}>{String(item.display_name||"T").trim().charAt(0).toUpperCase()}</span>
                      <span><strong>{item.display_name||"Telefonista"}</strong><small>{item.team?`Equipo ${item.team}`:"Equipo sin asignar"} · Telefonista activa</small></span>
                      {responsibleId===item.id?<ShieldCheck aria-hidden="true"/>:null}
                    </label>)}
                  </div>
                ) : selectedWorker ? (
                  <div className={styles.workerLocked}><span className={styles.avatar}>{String(selectedWorker.display_name||"T").trim().charAt(0).toUpperCase()}</span><span><strong>{selectedWorker.display_name||"Telefonista"}</strong><small>{selectedWorker.team?`Equipo ${selectedWorker.team}`:"Equipo sin asignar"} · Asignación protegida</small></span><ShieldCheck aria-hidden="true"/></div>
                ) : <div className={styles.responsibleLoading}>No hay una telefonista válida disponible.</div>}
              </div>
              <label className={styles.originField}><span>Origen</span><div className={styles.originValue}><BadgePlus/><strong>{brand==="orion"?"Tarot Orion":"Tarot Celestial"}</strong></div><input type="hidden" value={origin}/><small>Valor interno: {origin}</small></label>
            </div></fieldset>
            <fieldset><legend><Coins /> Saldos iniciales</legend><div className={styles.balanceGrid}>
              <label><span>Deuda</span><input type="number" step="0.01" value={form.deuda} onChange={(e)=>update("deuda",e.target.value)} /></label>
              <label><span>Minutos FREE</span><input type="number" min="0" step="1" value={form.free} onChange={(e)=>update("free",e.target.value)} /></label>
              <label><span>Minutos normales</span><input type="number" min="0" step="1" value={form.normal} onChange={(e)=>update("normal",e.target.value)} /></label>
            </div></fieldset>
            <fieldset><legend><Tag /> Información interna</legend><div className={styles.grid}>
              <label className={styles.full}><span>Notas</span><textarea rows={3} value={form.notas} onChange={(e)=>update("notas",e.target.value)} /></label>
              <div className={styles.full}><span className={styles.label}>Etiquetas</span><div className={styles.tags}>{loadingTags?<small>Cargando etiquetas…</small>:tags.map((item)=><label key={item.id} className={selectedTags.includes(item.id)?styles.tagSelected:styles.tag}><input type="checkbox" checked={selectedTags.includes(item.id)} onChange={()=>setSelectedTags((current)=>current.includes(item.id)?current.filter((id)=>id!==item.id):[...current,item.id])}/><span>{item.nombre}</span></label>)}</div><div className={styles.newTag}><input value={newTag} onChange={(e)=>setNewTag(e.target.value)} placeholder="Nueva etiqueta"/><button type="button" onClick={()=>void createTag()} disabled={!newTag.trim()||creatingTag}>{creatingTag?"Creando…":"Crear etiqueta"}</button></div></div>
            </div></fieldset>
            {error?<div className={styles.error} role="alert">{error}</div>:null}
          </div>
          <footer><span className={styles.syncNote}><ShieldCheck/> CRM y cartera sincronizados</span><button type="button" className={styles.cancel} onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className={styles.submit} disabled={saving||loadingWorkers||!responsibleId}>{saving?<span className={styles.spinner}/>:<Save size={17}/>}<span>{saving?"Creando clienta…":"Crear clienta"}</span></button></footer>
        </form>
      </section>
    </div>
  );
}
