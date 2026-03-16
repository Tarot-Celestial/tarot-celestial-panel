"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser();

async function safeJson(res: Response) {
  const txt = await res.text();
  if (!txt) return { _raw: "", _status: res.status, _ok: res.ok };
  try {
    const j = JSON.parse(txt);
    return { ...j, _raw: txt, _status: res.status, _ok: res.ok };
  } catch {
    return { _raw: txt.slice(0, 800), _status: res.status, _ok: res.ok };
  }
}

function eur(n: any) {
  const x = Number(n) || 0;
  return x.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

type CRMClientesPanelProps = {
  mode?: "admin" | "central";
  showImportButton?: boolean;
};

export default function CRMClientesPanel({
  mode = "admin",
  showImportButton = mode === "admin",
}: CRMClientesPanelProps) {
  const [crmQuery, setCrmQuery] = useState("");
  const [crmTagFilter, setCrmTagFilter] = useState("");
  const [crmPhoneFilter, setCrmPhoneFilter] = useState("");
  const [crmCountryFilter, setCrmCountryFilter] = useState("");
  const [crmLoading, setCrmLoading] = useState(false);
  const [crmRows, setCrmRows] = useState<any[]>([]);
  const [crmMsg, setCrmMsg] = useState("");
  const [crmImportLoading, setCrmImportLoading] = useState(false);
  const [crmCreateLoading, setCrmCreateLoading] = useState(false);
  const [crmCreateMsg, setCrmCreateMsg] = useState("");

  const [crmClienteSelId, setCrmClienteSelId] = useState("");
  const [crmClienteFicha, setCrmClienteFicha] = useState<any>(null);
  const [crmFichaLoading, setCrmFichaLoading] = useState(false);
  const [crmFichaMsg, setCrmFichaMsg] = useState("");

  const [crmEditNombre, setCrmEditNombre] = useState("");
  const [crmEditApellido, setCrmEditApellido] = useState("");
  const [crmEditTelefono, setCrmEditTelefono] = useState("");
  const [crmEditPais, setCrmEditPais] = useState("");
  const [crmEditEmail, setCrmEditEmail] = useState("");
  const [crmEditNotas, setCrmEditNotas] = useState("");
  const [crmEditOrigen, setCrmEditOrigen] = useState("");
  const [crmEditDeuda, setCrmEditDeuda] = useState("0");
  const [crmEditMinFree, setCrmEditMinFree] = useState("0");
  const [crmEditMinNormales, setCrmEditMinNormales] = useState("0");
  const [crmSaveLoading, setCrmSaveLoading] = useState(false);

  const [crmNewNombre, setCrmNewNombre] = useState("");
  const [crmNewApellido, setCrmNewApellido] = useState("");
  const [crmNewTelefono, setCrmNewTelefono] = useState("");
  const [crmNewPais, setCrmNewPais] = useState("España");
  const [crmNewEmail, setCrmNewEmail] = useState("");
  const [crmNewNotas, setCrmNewNotas] = useState("");
  const [crmNewOrigen, setCrmNewOrigen] = useState("manual");
  const [crmNewDeuda, setCrmNewDeuda] = useState("0");
  const [crmNewMinFree, setCrmNewMinFree] = useState("0");
  const [crmNewMinNormales, setCrmNewMinNormales] = useState("0");

  async function getTokenOrLogin() {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.href = "/login";
      return "";
    }
    return token;
  }

  async function searchCRM() {
    const q = crmQuery.trim();
    const telefono = crmPhoneFilter.trim();
    const etiqueta = crmTagFilter.trim();
    const pais = crmCountryFilter.trim();

    if (!q && !telefono && !etiqueta && !pais) {
      setCrmMsg("⚠️ Escribe al menos un filtro");
      setCrmRows([]);
      return;
    }

    try {
      setCrmLoading(true);
      setCrmMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (telefono) params.set("telefono", telefono);
      if (etiqueta) {
        params.set("etiqueta", etiqueta);
        params.set("tag", etiqueta);
      }
      if (pais) params.set("pais", pais);

      const r = await fetch(`/api/crm/clientes/buscar?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmRows(j.clientes || []);
      setCrmMsg(`Resultados: ${(j.clientes || []).length}`);
    } catch (e: any) {
      setCrmRows([]);
      setCrmMsg(`❌ ${e?.message || "Error"}`);
    } finally {
      setCrmLoading(false);
    }
  }

  async function importCRM() {
    try {
      setCrmImportLoading(true);
      setCrmMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/admin/crm/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmMsg(j.message || "✅ Importación CRM lanzada correctamente.");
    } catch (e: any) {
      setCrmMsg(`❌ ${e?.message || "Error al importar CRM"}`);
    } finally {
      setCrmImportLoading(false);
    }
  }

  async function createCRMClient() {
    if (!crmNewNombre.trim()) {
      setCrmCreateMsg("⚠️ El nombre es obligatorio");
      return;
    }

    if (!crmNewTelefono.trim()) {
      setCrmCreateMsg("⚠️ El teléfono es obligatorio");
      return;
    }

    try {
      setCrmCreateLoading(true);
      setCrmCreateMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/clientes/crear", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nombre: crmNewNombre.trim(),
          apellido: crmNewApellido.trim(),
          telefono: crmNewTelefono.trim(),
          pais: crmNewPais.trim() || "España",
          email: crmNewEmail.trim(),
          notas: crmNewNotas.trim(),
          origen: crmNewOrigen.trim() || "manual",
          deuda_pendiente: Number(String(crmNewDeuda).replace(",", ".")) || 0,
          minutos_free_pendientes: Number(String(crmNewMinFree).replace(",", ".")) || 0,
          minutos_normales_pendientes: Number(String(crmNewMinNormales).replace(",", ".")) || 0,
        }),
      });

      const j = await safeJson(r);

      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      setCrmCreateMsg("✅ Cliente creado correctamente");
      setCrmNewNombre("");
      setCrmNewApellido("");
      setCrmNewTelefono("");
      setCrmNewPais("España");
      setCrmNewEmail("");
      setCrmNewNotas("");
      setCrmNewOrigen("manual");
      setCrmNewDeuda("0");
      setCrmNewMinFree("0");
      setCrmNewMinNormales("0");

      await searchCRM();
    } catch (e: any) {
      setCrmCreateMsg(`❌ ${e?.message || "Error al crear cliente"}`);
    } finally {
      setCrmCreateLoading(false);
    }
  }

  function clearCRMFilters() {
    setCrmQuery("");
    setCrmTagFilter("");
    setCrmPhoneFilter("");
    setCrmCountryFilter("");
    setCrmRows([]);
    setCrmMsg("");
  }

  function closeCRMFicha() {
    setCrmClienteSelId("");
    setCrmClienteFicha(null);
    setCrmFichaMsg("");
    setCrmEditNombre("");
    setCrmEditApellido("");
    setCrmEditTelefono("");
    setCrmEditPais("");
    setCrmEditEmail("");
    setCrmEditNotas("");
    setCrmEditOrigen("");
    setCrmEditDeuda("0");
    setCrmEditMinFree("0");
    setCrmEditMinNormales("0");
  }

  async function openCRMFicha(id: string) {
    if (!id) return;

    try {
      setCrmFichaLoading(true);
      setCrmFichaMsg("");
      setCrmClienteSelId(id);

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch(`/api/crm/clientes/ficha?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status}`);

      const c = j.cliente;
      setCrmClienteFicha(c);
      setCrmEditNombre(String(c?.nombre || ""));
      setCrmEditApellido(String(c?.apellido || ""));
      setCrmEditTelefono(String(c?.telefono || ""));
      setCrmEditPais(String(c?.pais || ""));
      setCrmEditEmail(String(c?.email || ""));
      setCrmEditNotas(String(c?.notas || ""));
      setCrmEditOrigen(String(c?.origen || ""));
      setCrmEditDeuda(String(c?.deuda_pendiente ?? 0));
      setCrmEditMinFree(String(c?.minutos_free_pendientes ?? 0));
      setCrmEditMinNormales(String(c?.minutos_normales_pendientes ?? 0));
    } catch (e: any) {
      console.error("ERROR FICHA", e);
      setCrmClienteFicha(null);
      setCrmFichaMsg(`❌ ${e?.message || "Error cargando ficha"}`);
    } finally {
      setCrmFichaLoading(false);
    }
  }

  async function saveCRMFicha() {
    if (!crmClienteSelId) return;

    try {
      setCrmSaveLoading(true);
      setCrmFichaMsg("");

      const token = await getTokenOrLogin();
      if (!token) return;

      const r = await fetch("/api/crm/clientes/actualizar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: crmClienteSelId,
          nombre: crmEditNombre,
          apellido: crmEditApellido,
          telefono: crmEditTelefono,
          pais: crmEditPais,
          email: crmEditEmail,
          notas: crmEditNotas,
          origen: crmEditOrigen,
          deuda_pendiente: Number(String(crmEditDeuda).replace(",", ".")) || 0,
          minutos_free_pendientes: Number(String(crmEditMinFree).replace(",", ".")) || 0,
          minutos_normales_pendientes: Number(String(crmEditMinNormales).replace(",", ".")) || 0,
        }),
      });

      const j = await safeJson(r);
      if (!j?.ok) throw new Error(j?.error || "Error guardando");

      setCrmClienteFicha((prev: any) => ({
        ...(prev || {}),
        nombre: crmEditNombre,
        apellido: crmEditApellido,
        telefono: crmEditTelefono,
        pais: crmEditPais,
        email: crmEditEmail,
        notas: crmEditNotas,
        origen: crmEditOrigen,
        deuda_pendiente: Number(String(crmEditDeuda).replace(",", ".")) || 0,
        minutos_free_pendientes: Number(String(crmEditMinFree).replace(",", ".")) || 0,
        minutos_normales_pendientes: Number(String(crmEditMinNormales).replace(",", ".")) || 0,
      }));

      setCrmFichaMsg("✅ Cliente actualizado");
      await searchCRM();
    } catch (e: any) {
      setCrmFichaMsg(`❌ ${e?.message || "Error guardando ficha"}`);
    } finally {
      setCrmSaveLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="tc-card">
        <div className="tc-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <div>
            <div className="tc-title">👥 CRM</div>
            <div className="tc-sub">
              Busca clientes por nombre, teléfono, país o etiqueta
            </div>
          </div>

          <div className="tc-row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="tc-btn" onClick={clearCRMFilters} disabled={crmLoading || crmImportLoading}>
              Limpiar filtros
            </button>

            {showImportButton ? (
              <button className="tc-btn tc-btn-gold" onClick={importCRM} disabled={crmImportLoading}>
                {crmImportLoading ? "Importando…" : "Importar CRM"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="tc-hr" />

        <div className="tc-grid-4">
          <div>
            <div className="tc-sub">Nombre / búsqueda general</div>
            <input className="tc-input" value={crmQuery} onChange={(e) => setCrmQuery(e.target.value)} placeholder="María, Ana, etc." style={{ width: "100%", marginTop: 6 }} onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }} />
          </div>

          <div>
            <div className="tc-sub">Teléfono</div>
            <input className="tc-input" value={crmPhoneFilter} onChange={(e) => setCrmPhoneFilter(e.target.value)} placeholder="600123123" style={{ width: "100%", marginTop: 6 }} onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }} />
          </div>

          <div>
            <div className="tc-sub">Etiqueta</div>
            <input className="tc-input" value={crmTagFilter} onChange={(e) => setCrmTagFilter(e.target.value)} placeholder="vip, premium, nueva..." style={{ width: "100%", marginTop: 6 }} onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }} />
          </div>

          <div>
            <div className="tc-sub">País</div>
            <input className="tc-input" value={crmCountryFilter} onChange={(e) => setCrmCountryFilter(e.target.value)} placeholder="España, México..." style={{ width: "100%", marginTop: 6 }} onKeyDown={(e) => { if (e.key === "Enter") searchCRM(); }} />
          </div>
        </div>

        <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="tc-btn tc-btn-gold" onClick={searchCRM} disabled={crmLoading}>
            {crmLoading ? "Buscando…" : "Buscar"}
          </button>
        </div>

        <div className="tc-hr" />
        <div className="tc-sub">{crmMsg || " "}</div>
      </div>

      <div className="tc-card">
        <div className="tc-title">➕ Crear cliente nuevo</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>
          Alta manual de cliente desde el panel {mode}
        </div>

        <div className="tc-hr" />

        <div className="tc-grid-4">
          <div><div className="tc-sub">Nombre</div><input className="tc-input" value={crmNewNombre} onChange={(e) => setCrmNewNombre(e.target.value)} placeholder="Nombre" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">Apellido</div><input className="tc-input" value={crmNewApellido} onChange={(e) => setCrmNewApellido(e.target.value)} placeholder="Apellido" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">Teléfono</div><input className="tc-input" value={crmNewTelefono} onChange={(e) => setCrmNewTelefono(e.target.value)} placeholder="600123123" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">País</div><input className="tc-input" value={crmNewPais} onChange={(e) => setCrmNewPais(e.target.value)} placeholder="España" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">Email</div><input className="tc-input" value={crmNewEmail} onChange={(e) => setCrmNewEmail(e.target.value)} placeholder="cliente@email.com" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">Origen</div><input className="tc-input" value={crmNewOrigen} onChange={(e) => setCrmNewOrigen(e.target.value)} placeholder="manual" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">Deuda</div><input className="tc-input" value={crmNewDeuda} onChange={(e) => setCrmNewDeuda(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">Min free</div><input className="tc-input" value={crmNewMinFree} onChange={(e) => setCrmNewMinFree(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
        </div>

        <div className="tc-grid-2" style={{ marginTop: 12 }}>
          <div><div className="tc-sub">Min normales</div><input className="tc-input" value={crmNewMinNormales} onChange={(e) => setCrmNewMinNormales(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
          <div><div className="tc-sub">Notas</div><input className="tc-input" value={crmNewNotas} onChange={(e) => setCrmNewNotas(e.target.value)} placeholder="Notas internas" style={{ width: "100%", marginTop: 6 }} /></div>
        </div>

        <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="tc-btn tc-btn-ok" onClick={createCRMClient} disabled={crmCreateLoading}>
            {crmCreateLoading ? "Creando..." : "Crear cliente"}
          </button>
        </div>

        <div className="tc-sub" style={{ marginTop: 10 }}>{crmCreateMsg || " "}</div>
      </div>

      {(crmFichaLoading || crmClienteFicha) && (
        <div className="tc-card" style={{ marginTop: 12 }}>
          <div className="tc-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div className="tc-title">🧾 Ficha CRM</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>
                {crmFichaLoading ? "Cargando ficha del cliente..." : `Editando cliente #${crmClienteSelId || crmClienteFicha?.id || ""}`}
              </div>
            </div>

            {!crmFichaLoading && <button className="tc-btn" onClick={closeCRMFicha}>Cerrar ficha</button>}
          </div>

          <div className="tc-hr" />

          {crmFichaLoading ? (
            <div className="tc-sub">Cargando ficha...</div>
          ) : (
            <>
              <div className="tc-grid-4">
                <div><div className="tc-sub">Nombre</div><input className="tc-input" value={crmEditNombre} onChange={(e) => setCrmEditNombre(e.target.value)} placeholder="Nombre" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Apellido</div><input className="tc-input" value={crmEditApellido} onChange={(e) => setCrmEditApellido(e.target.value)} placeholder="Apellido" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Teléfono</div><input className="tc-input" value={crmEditTelefono} onChange={(e) => setCrmEditTelefono(e.target.value)} placeholder="600123123" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">País</div><input className="tc-input" value={crmEditPais} onChange={(e) => setCrmEditPais(e.target.value)} placeholder="España" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Email</div><input className="tc-input" value={crmEditEmail} onChange={(e) => setCrmEditEmail(e.target.value)} placeholder="cliente@email.com" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Origen</div><input className="tc-input" value={crmEditOrigen} onChange={(e) => setCrmEditOrigen(e.target.value)} placeholder="manual" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Deuda pendiente</div><input className="tc-input" value={crmEditDeuda} onChange={(e) => setCrmEditDeuda(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Min free pendientes</div><input className="tc-input" value={crmEditMinFree} onChange={(e) => setCrmEditMinFree(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
              </div>

              <div className="tc-grid-2" style={{ marginTop: 12 }}>
                <div><div className="tc-sub">Min normales pendientes</div><input className="tc-input" value={crmEditMinNormales} onChange={(e) => setCrmEditMinNormales(e.target.value)} placeholder="0" style={{ width: "100%", marginTop: 6 }} /></div>
                <div><div className="tc-sub">Notas</div><textarea className="tc-input" value={crmEditNotas} onChange={(e) => setCrmEditNotas(e.target.value)} placeholder="Notas internas" style={{ width: "100%", marginTop: 6, minHeight: 110 }} /></div>
              </div>

              <div className="tc-grid-2" style={{ marginTop: 12 }}>
                <div><div className="tc-sub">ID cliente</div><div className="tc-sub" style={{ marginTop: 8, wordBreak: "break-all" }}>{crmClienteFicha?.id || crmClienteSelId || "—"}</div></div>
                <div><div className="tc-sub">Última ficha cargada</div><div className="tc-sub" style={{ marginTop: 8 }}>{[crmClienteFicha?.nombre, crmClienteFicha?.apellido].filter(Boolean).join(" ") || "—"}</div></div>
              </div>

              <div className="tc-row" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
                <button className="tc-btn" onClick={closeCRMFicha}>Cancelar</button>
                <button className="tc-btn tc-btn-ok" onClick={saveCRMFicha} disabled={crmSaveLoading || !crmClienteSelId}>
                  {crmSaveLoading ? "Guardando..." : "Guardar cambios"}
                </button>
              </div>

              <div className="tc-sub" style={{ marginTop: 10 }}>{crmFichaMsg || " "}</div>
            </>
          )}
        </div>
      )}

      <div className="tc-card">
        <div className="tc-title">📋 Resultados CRM</div>
        <div className="tc-sub" style={{ marginTop: 6 }}>Resultado de búsqueda con filtros</div>

        <div className="tc-hr" />

        <div style={{ overflowX: "auto" }}>
          <table className="tc-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Teléfono</th>
                <th>País</th>
                <th>Etiquetas</th>
                <th>Min free</th>
                <th>Min normales</th>
                <th>Deuda</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(crmRows || []).map((r: any) => {
                const etiquetas = r.etiquetas || r.tags || r.labels || r.crm_tags || r.crm_etiquetas || [];
                const etiquetasTexto = Array.isArray(etiquetas)
                  ? etiquetas.map((x: any) => typeof x === "string" ? x : x?.nombre || x?.label || x?.name || x?.tag || "").filter(Boolean).join(", ")
                  : "";

                return (
                  <tr key={r.id}>
                    <td><b>{[r.nombre, r.apellido].filter(Boolean).join(" ") || "—"}</b></td>
                    <td>{r.telefono || "—"}</td>
                    <td>{r.pais || "—"}</td>
                    <td>{etiquetasTexto || "—"}</td>
                    <td>{r.minutos_free_pendientes ?? 0}</td>
                    <td>{r.minutos_normales_pendientes ?? 0}</td>
                    <td>{eur(r.deuda_pendiente || 0)}</td>
                    <td><button className="tc-btn" onClick={() => openCRMFicha(String(r.id || ""))}>Ver ficha</button></td>
                  </tr>
                );
              })}

              {crmRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="tc-muted">Sin resultados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
