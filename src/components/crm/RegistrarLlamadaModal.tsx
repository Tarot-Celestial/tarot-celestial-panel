"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type ClienteLite = {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  minutos_free_pendientes?: number | string | null;
  minutos_normales_pendientes?: number | string | null;
};

type TarotistaOpt = {
  id: string;
  display_name?: string | null;
  state?: string | null;
};

type Props = {
  open: boolean;
  cliente: ClienteLite | null;
  tarotistas: TarotistaOpt[];
  onClose: () => void;
  getToken: () => Promise<string>;
  onSuccess?: (message?: string) => Promise<void> | void;
};

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

function toNum(v: any) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function fmtMinutes(v: any) {
  return String(toNum(v)).replace(".00", "");
}

const CODIGO_OPTIONS = [
  { value: "FREE", label: "Free" },
  { value: "RUEDA", label: "Rueda" },
  { value: "CLIENTE", label: "Cliente" },
  { value: "REPITE", label: "Repite" },
] as const;

const PAGO_OPTIONS = ["TPV", "PAYPAL", "BIZUM", "OTROS"] as const;
const CLASIF_OPTIONS = [
  { value: "nada", label: "Nada" },
  { value: "promo", label: "Promo" },
  { value: "captado", label: "Captado" },
  { value: "recuperado", label: "Recuperado" },
] as const;

export default function RegistrarLlamadaModal({
  open,
  cliente,
  tarotistas,
  onClose,
  getToken,
  onSuccess,
}: Props) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [clienteCompra, setClienteCompra] = useState<"si" | "no" | "">("");
  const [usoSinCompra, setUsoSinCompra] = useState<"minutos" | "7free" | "">("");
  const [compraDestino, setCompraDestino] = useState<"usar_todo" | "guardar" | "">("");
  const [guardarFree, setGuardarFree] = useState("0");
  const [guardarNormales, setGuardarNormales] = useState("0");

  const [minutos1, setMinutos1] = useState("0");
  const [codigo1, setCodigo1] = useState<(typeof CODIGO_OPTIONS)[number]["value"]>("FREE");
  const [minutos2, setMinutos2] = useState("0");
  const [codigo2, setCodigo2] = useState<(typeof CODIGO_OPTIONS)[number]["value"] | "">("");

  const [tarotistaId, setTarotistaId] = useState("");
  const [tarotistaCallManual, setTarotistaCallManual] = useState("");
  const [formaPago, setFormaPago] = useState<(typeof PAGO_OPTIONS)[number] | "">("");
  const [importe, setImporte] = useState("");
  const [clasificacion, setClasificacion] = useState<(typeof CLASIF_OPTIONS)[number]["value"]>("nada");

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setLoading(false);
    setMsg("");
    setClienteCompra("");
    setUsoSinCompra("");
    setCompraDestino("");
    setGuardarFree("0");
    setGuardarNormales("0");
    setMinutos1("0");
    setCodigo1("FREE");
    setMinutos2("0");
    setCodigo2("");
    setTarotistaId("");
    setTarotistaCallManual("");
    setFormaPago("");
    setImporte("");
    setClasificacion("nada");
  }, [open, cliente?.id]);

  const steps = useMemo(() => {
    const list: { key: string; title: string; subtitle: string }[] = [
      { key: "compra", title: "¿Cliente compra minutos?", subtitle: "Este dato decide todo el flujo de la llamada." },
    ];

    if (clienteCompra === "no") {
      list.push({ key: "uso", title: "¿Cliente usa minutos o 7free?", subtitle: "Indica qué ha usado realmente en esta llamada." });
      if (usoSinCompra === "minutos") {
        list.push({ key: "codigos", title: "¿Qué código de minutos usa?", subtitle: "Puedes registrar hasta dos bloques de minutos." });
      }
      if (usoSinCompra === "7free" || usoSinCompra === "minutos") {
        list.push({ key: "tarotista", title: "Tarotista que atiende", subtitle: "Selecciona la tarotista que ha recibido la llamada." });
        if (tarotistaId === "CALL") {
          list.push({ key: "call_manual", title: "Nombre tarotista CALL", subtitle: "Escribe el nombre manual que quieres guardar en rendimiento." });
        }
      }
    }

    if (clienteCompra === "si") {
      list.push({ key: "compra_destino", title: "¿Usa todos los minutos o guarda?", subtitle: "Si guarda, esos minutos quedarán pendientes en su CRM." });
      if (compraDestino === "guardar") {
        list.push({ key: "guardar", title: "¿Cuántos minutos guarda?", subtitle: "Se guardarán como free y normales dentro del CRM." });
      }
      if (compraDestino) {
        list.push({ key: "codigos", title: "¿Qué código de minutos usa?", subtitle: "Registra aquí los minutos utilizados en esta llamada." });
        list.push({ key: "tarotista", title: "Tarotista que atiende", subtitle: "Selecciona la tarotista que ha atendido la llamada." });
        if (tarotistaId === "CALL") {
          list.push({ key: "call_manual", title: "Nombre tarotista CALL", subtitle: "Escribe el nombre manual de la tarotista CALL." });
        }
        list.push({ key: "pago", title: "Forma de pago", subtitle: "Elige cómo se ha cobrado esta compra." });
        list.push({ key: "importe", title: "Importe cobrado", subtitle: "Indica el importe final de la operación." });
        list.push({ key: "clasificacion", title: "Clasificación", subtitle: "Marca si fue promo, captado, recuperado o nada." });
      }
    }

    list.push({ key: "resumen", title: "Resumen final", subtitle: "Revisa los datos antes de registrar la llamada." });
    return list;
  }, [clienteCompra, usoSinCompra, compraDestino, tarotistaId]);

  const current = steps[step];
  const minutosConsumidos = useMemo(() => {
    if (clienteCompra === "no" && usoSinCompra === "7free") return 7;
    return toNum(minutos1) + toNum(minutos2);
  }, [clienteCompra, usoSinCompra, minutos1, minutos2]);

  const tarotistaLabel = useMemo(() => {
    if (tarotistaId === "CALL") return tarotistaCallManual.trim() || "CALL";
    return tarotistas.find((t) => String(t.id) === String(tarotistaId))?.display_name || "—";
  }, [tarotistaId, tarotistaCallManual, tarotistas]);

  function currentStepIsValid() {
    switch (current?.key) {
      case "compra":
        return clienteCompra === "si" || clienteCompra === "no";
      case "uso":
        return usoSinCompra === "minutos" || usoSinCompra === "7free";
      case "compra_destino":
        return compraDestino === "usar_todo" || compraDestino === "guardar";
      case "guardar":
        return toNum(guardarFree) >= 0 && toNum(guardarNormales) >= 0;
      case "codigos":
        return minutosConsumidos > 0 && (toNum(minutos2) <= 0 || Boolean(codigo2));
      case "tarotista":
        return Boolean(tarotistaId);
      case "call_manual":
        return Boolean(tarotistaCallManual.trim());
      case "pago":
        return Boolean(formaPago);
      case "importe":
        return toNum(importe) > 0;
      case "clasificacion":
        return Boolean(clasificacion);
      default:
        return true;
    }
  }

  function next() {
    if (!currentStepIsValid()) {
      setMsg("⚠️ Completa esta pregunta antes de continuar.");
      return;
    }
    setMsg("");
    setStep((s) => Math.min(s + 1, steps.length - 1));
  }

  function back() {
    setMsg("");
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    if (!cliente?.id) return;
    try {
      setLoading(true);
      setMsg("");
      const token = await getToken();
      if (!token) return;

      const payload = {
        cliente_id: cliente.id,
        cliente_compra_minutos: clienteCompra === "si",
        uso_tipo: clienteCompra === "no" ? usoSinCompra : "compra",
        guarda_minutos: clienteCompra === "si" && compraDestino === "guardar",
        misma_compra: clienteCompra === "si" && compraDestino === "usar_todo",
        guardados_free: toNum(guardarFree),
        guardados_normales: toNum(guardarNormales),
        codigo_1: minutosConsumidos > 0 ? codigo1 : null,
        minutos_1: toNum(minutos1),
        codigo_2: codigo2 || null,
        minutos_2: toNum(minutos2),
        tarotista_worker_id: tarotistaId && tarotistaId !== "CALL" ? tarotistaId : null,
        tarotista_manual_call: tarotistaId === "CALL" ? tarotistaCallManual.trim() : null,
        forma_pago: clienteCompra === "si" ? formaPago || null : null,
        importe: clienteCompra === "si" ? toNum(importe) : 0,
        clasificacion,
      };

      const r = await fetch("/api/crm/rendimiento/registrar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const j = await safeJson(r);
      if (!j?._ok || !j?.ok) throw new Error(j?.error || `HTTP ${j?._status || r.status}`);

      if (onSuccess) await onSuccess(j?.message || "✅ Llamada registrada correctamente");
      onClose();
    } catch (e: any) {
      setMsg(`❌ ${e?.message || "Error registrando llamada"}`);
    } finally {
      setLoading(false);
    }
  }

  if (!open || !cliente || typeof document === "undefined") return null;

  const clienteNombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(" ") || "Cliente";
  const freePend = toNum(cliente.minutos_free_pendientes);
  const normalesPend = toNum(cliente.minutos_normales_pendientes);

  const content = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(5,5,10,.78)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, 96vw)",
          maxHeight: "90vh",
          overflow: "hidden",
          borderRadius: 24,
          border: "1px solid rgba(255,255,255,.10)",
          background: "linear-gradient(180deg, rgba(15,15,25,.98), rgba(10,10,18,.98))",
          boxShadow: "0 30px 80px rgba(0,0,0,.55)",
          display: "grid",
          gridTemplateRows: "auto auto 1fr auto",
          transform: open ? "translateY(0px) scale(1)" : "translateY(14px) scale(.98)",
          transition: "all .18s ease",
        }}
      >
        <div style={{ padding: 18, borderBottom: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <div className="tc-title" style={{ fontSize: 20 }}>📞 Registrar llamada</div>
              <div className="tc-sub" style={{ marginTop: 6 }}>{clienteNombre} · {cliente.telefono || "Sin teléfono"}</div>
            </div>
            <button className="tc-btn" type="button" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,.06)", display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
            <div>
              <div className="tc-sub">Paso {step + 1} de {steps.length}</div>
              <div style={{ height: 8, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.08)", marginTop: 8 }}>
                <div style={{ width: `${((step + 1) / steps.length) * 100}%`, height: "100%", background: "linear-gradient(90deg, rgba(215,181,109,.9), rgba(255,226,156,.9))", transition: "width .22s ease" }} />
              </div>
            </div>
            <div className="tc-sub" style={{ whiteSpace: "nowrap" }}>
              Pendiente CRM: {fmtMinutes(freePend)} free · {fmtMinutes(normalesPend)} normales
            </div>
          </div>
        </div>

        <div style={{ padding: 18, overflowY: "auto" }}>
          <div key={current?.key} style={{ animation: "tcFadeStep .18s ease" }}>
            <div className="tc-title" style={{ fontSize: 22 }}>{current?.title}</div>
            <div className="tc-sub" style={{ marginTop: 8, maxWidth: 620 }}>{current?.subtitle}</div>

            {current?.key === "compra" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <button type="button" className="tc-btn" onClick={() => setClienteCompra("si")} style={{ padding: 16, border: clienteCompra === "si" ? "1px solid rgba(215,181,109,.55)" : undefined, background: clienteCompra === "si" ? "rgba(215,181,109,.14)" : undefined }}>Sí, compra minutos</button>
                <button type="button" className="tc-btn" onClick={() => setClienteCompra("no")} style={{ padding: 16, border: clienteCompra === "no" ? "1px solid rgba(215,181,109,.55)" : undefined, background: clienteCompra === "no" ? "rgba(215,181,109,.14)" : undefined }}>No compra minutos</button>
              </div>
            )}

            {current?.key === "uso" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <button type="button" className="tc-btn" onClick={() => setUsoSinCompra("minutos")} style={{ padding: 16, border: usoSinCompra === "minutos" ? "1px solid rgba(215,181,109,.55)" : undefined, background: usoSinCompra === "minutos" ? "rgba(215,181,109,.14)" : undefined }}>Usa minutos</button>
                <button type="button" className="tc-btn" onClick={() => setUsoSinCompra("7free")} style={{ padding: 16, border: usoSinCompra === "7free" ? "1px solid rgba(215,181,109,.55)" : undefined, background: usoSinCompra === "7free" ? "rgba(215,181,109,.14)" : undefined }}>Usa 7 free</button>
              </div>
            )}

            {current?.key === "compra_destino" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <button type="button" className="tc-btn" onClick={() => setCompraDestino("usar_todo")} style={{ padding: 16, border: compraDestino === "usar_todo" ? "1px solid rgba(215,181,109,.55)" : undefined, background: compraDestino === "usar_todo" ? "rgba(215,181,109,.14)" : undefined }}>Usa todos los minutos</button>
                <button type="button" className="tc-btn" onClick={() => setCompraDestino("guardar")} style={{ padding: 16, border: compraDestino === "guardar" ? "1px solid rgba(215,181,109,.55)" : undefined, background: compraDestino === "guardar" ? "rgba(215,181,109,.14)" : undefined }}>Guarda minutos</button>
              </div>
            )}

            {current?.key === "guardar" && (
              <div className="tc-grid-2" style={{ marginTop: 18 }}>
                <div>
                  <div className="tc-sub">Minutos free que guarda</div>
                  <input className="tc-input" value={guardarFree} onChange={(e) => setGuardarFree(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                </div>
                <div>
                  <div className="tc-sub">Minutos normales que guarda</div>
                  <input className="tc-input" value={guardarNormales} onChange={(e) => setGuardarNormales(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                </div>
              </div>
            )}

            {current?.key === "codigos" && (
              <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
                <div className="tc-grid-2">
                  <div>
                    <div className="tc-sub">Minutos bloque 1</div>
                    <input className="tc-input" value={minutos1} onChange={(e) => setMinutos1(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                  </div>
                  <div>
                    <div className="tc-sub">Código bloque 1</div>
                    <select className="tc-input" value={codigo1} onChange={(e) => setCodigo1(e.target.value as any)} style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}>
                      {CODIGO_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="tc-grid-2">
                  <div>
                    <div className="tc-sub">Minutos bloque 2</div>
                    <input className="tc-input" value={minutos2} onChange={(e) => setMinutos2(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                  </div>
                  <div>
                    <div className="tc-sub">Código bloque 2</div>
                    <select className="tc-input" value={codigo2} onChange={(e) => setCodigo2(e.target.value as any)} style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}>
                      <option value="">Sin segundo bloque</option>
                      {CODIGO_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="tc-sub">Tiempo total registrado: {fmtMinutes(minutosConsumidos)} minutos</div>
              </div>
            )}

            {current?.key === "tarotista" && (
              <div style={{ marginTop: 18 }}>
                <div className="tc-sub">Tarotista</div>
                <select className="tc-input" value={tarotistaId} onChange={(e) => setTarotistaId(e.target.value)} style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}>
                  <option value="">Selecciona tarotista</option>
                  <option value="CALL">CALL</option>
                  {tarotistas.map((t) => (
                    <option key={t.id} value={t.id}>{t.display_name || t.id}{t.state ? ` · ${t.state}` : ""}</option>
                  ))}
                </select>
              </div>
            )}

            {current?.key === "call_manual" && (
              <div style={{ marginTop: 18 }}>
                <div className="tc-sub">Nombre tarotista CALL</div>
                <input className="tc-input" value={tarotistaCallManual} onChange={(e) => setTarotistaCallManual(e.target.value)} placeholder="Ej: Call400" style={{ width: "100%", marginTop: 6 }} />
              </div>
            )}

            {current?.key === "pago" && (
              <div style={{ marginTop: 18 }}>
                <div className="tc-sub">Forma de pago</div>
                <select className="tc-input" value={formaPago} onChange={(e) => setFormaPago(e.target.value as any)} style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}>
                  <option value="">Selecciona método</option>
                  {PAGO_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            )}

            {current?.key === "importe" && (
              <div style={{ marginTop: 18 }}>
                <div className="tc-sub">Importe (€)</div>
                <input className="tc-input" value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="22" style={{ width: "100%", marginTop: 6 }} />
              </div>
            )}

            {current?.key === "clasificacion" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                {CLASIF_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button" className="tc-btn" onClick={() => setClasificacion(opt.value)} style={{ padding: 16, border: clasificacion === opt.value ? "1px solid rgba(215,181,109,.55)" : undefined, background: clasificacion === opt.value ? "rgba(215,181,109,.14)" : undefined }}>{opt.label}</button>
                ))}
              </div>
            )}

            {current?.key === "resumen" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <div className="tc-card" style={{ borderRadius: 18, padding: 14, background: "rgba(255,255,255,.03)" }}>
                  <div className="tc-sub">Cliente</div>
                  <div style={{ marginTop: 4 }}>{clienteNombre}</div>
                </div>
                <div className="tc-card" style={{ borderRadius: 18, padding: 14, background: "rgba(255,255,255,.03)" }}>
                  <div className="tc-sub">Tipo</div>
                  <div style={{ marginTop: 4 }}>
                    {clienteCompra === "si" ? "Compra minutos" : usoSinCompra === "7free" ? "Usa 7 free" : "Usa minutos pendientes"}
                  </div>
                </div>
                <div className="tc-card" style={{ borderRadius: 18, padding: 14, background: "rgba(255,255,255,.03)" }}>
                  <div className="tc-sub">Resumen operativo</div>
                  <div style={{ marginTop: 4 }}>
                    Tiempo: {fmtMinutes(minutosConsumidos)} min · Tarotista: {tarotistaLabel}
                    {clienteCompra === "si" ? ` · Pago: ${formaPago || "—"} · Importe: ${toNum(importe).toFixed(2)} €` : ""}
                  </div>
                  {clienteCompra === "si" && compraDestino === "guardar" && (
                    <div className="tc-sub" style={{ marginTop: 8 }}>
                      Guarda: {fmtMinutes(guardarFree)} free · {fmtMinutes(guardarNormales)} normales
                    </div>
                  )}
                  {(toNum(minutos1) > 0 || toNum(minutos2) > 0) && (
                    <div className="tc-sub" style={{ marginTop: 8 }}>
                      Códigos: {toNum(minutos1) > 0 ? `${fmtMinutes(minutos1)} ${codigo1}` : ""}{toNum(minutos2) > 0 ? ` · ${fmtMinutes(minutos2)} ${codigo2}` : ""}
                    </div>
                  )}
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    Clasificación: {CLASIF_OPTIONS.find((x) => x.value === clasificacion)?.label || "Nada"}
                  </div>
                </div>
              </div>
            )}

            {!!msg && <div className="tc-sub" style={{ marginTop: 16 }}>{msg}</div>}
          </div>
        </div>

        <div style={{ padding: 18, borderTop: "1px solid rgba(255,255,255,.08)", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div>
            {step > 0 && <button type="button" className="tc-btn" onClick={back}>Atrás</button>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {current?.key !== "resumen" ? (
              <button type="button" className="tc-btn tc-btn-gold" onClick={next}>Siguiente</button>
            ) : (
              <button type="button" className="tc-btn tc-btn-gold" onClick={submit} disabled={loading}>{loading ? "Guardando..." : "Registrar llamada"}</button>
            )}
          </div>
        </div>
      </div>
      <style jsx global>{`
        @keyframes tcFadeStep {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );

  return createPortal(content, document.body);
}
