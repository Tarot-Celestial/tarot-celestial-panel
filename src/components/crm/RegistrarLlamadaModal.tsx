"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RegistrarLlamadaModal.module.css";

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

type GameSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
  special?: "mario" | "manual";
};

function GameSelect({
  value,
  options,
  placeholder,
  ariaLabel,
  onChange,
}: {
  value: string;
  options: GameSelectOption[];
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuLayout, setMenuLayout] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    placement: "top" | "bottom";
  } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) || null;

  const updateMenuPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportMargin = 10;
    const gap = 7;
    const desiredHeight = 300;
    const minimumHeight = 96;
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - viewportMargin - gap);
    const spaceAbove = Math.max(0, rect.top - viewportMargin - gap);
    const placement = spaceBelow < 190 && spaceAbove > spaceBelow ? "top" : "bottom";
    const availableHeight = placement === "top" ? spaceAbove : spaceBelow;
    const viewportLimit = Math.max(minimumHeight, viewportHeight - viewportMargin * 2);
    const maxHeight = Math.max(
      Math.min(minimumHeight, viewportLimit),
      Math.min(desiredHeight, availableHeight, viewportLimit),
    );
    const width = Math.min(rect.width, viewportWidth - viewportMargin * 2);
    const left = Math.min(
      Math.max(viewportMargin, rect.left),
      Math.max(viewportMargin, viewportWidth - viewportMargin - width),
    );
    const preferredTop = placement === "top"
      ? rect.top - gap - maxHeight
      : rect.bottom + gap;
    const top = Math.min(
      Math.max(viewportMargin, preferredTop),
      Math.max(viewportMargin, viewportHeight - viewportMargin - maxHeight),
    );

    setMenuLayout({ top, left, width, maxHeight, placement });
  }, []);

  useLayoutEffect(() => {
    if (!expanded) {
      setMenuLayout(null);
      return;
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [expanded, updateMenuPosition]);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setExpanded(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  useEffect(() => {
    if (!expanded || activeIndex < 0) return;
    const activeOption = menuRef.current?.querySelector<HTMLElement>(
      `[data-option-index="${activeIndex}"]`,
    );
    activeOption?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, expanded]);

  function openList() {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    const firstEnabled = options.findIndex((option) => !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabled);
    setExpanded(true);
  }

  function moveActive(direction: 1 | -1) {
    if (!options.length) return;
    let next = activeIndex;
    for (let attempt = 0; attempt < options.length; attempt += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next]?.disabled) {
        setActiveIndex(next);
        return;
      }
    }
  }

  function handleTriggerKeyDown(event: any) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!expanded) openList();
      else moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!expanded) openList();
      else if (activeIndex >= 0 && !options[activeIndex]?.disabled) {
        onChange(options[activeIndex].value);
        setExpanded(false);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setExpanded(false);
    }
  }

  return (
    <div className={styles.dropdown} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.dropdownTrigger} ${expanded ? styles.dropdownTriggerOpen : ""}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={expanded}
        onClick={() => (expanded ? setExpanded(false) : openList())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={selected ? styles.dropdownValue : styles.dropdownPlaceholder}>
          {selected?.label || placeholder}
        </span>
        <span className={styles.dropdownChevron} aria-hidden="true">⌄</span>
      </button>

      {expanded && menuLayout && createPortal(
        <div
          ref={menuRef}
          className={`${styles.dropdownMenu} ${menuLayout.placement === "top" ? styles.dropdownMenuTop : ""}`}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            top: menuLayout.top,
            left: menuLayout.left,
            width: menuLayout.width,
            maxHeight: menuLayout.maxHeight,
          }}
          onWheel={(event) => event.stopPropagation()}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              data-option-index={index}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              className={[
                styles.dropdownOption,
                option.value === value ? styles.dropdownOptionSelected : "",
                activeIndex === index ? styles.dropdownOptionActive : "",
                option.special === "mario" ? styles.dropdownOptionMario : "",
              ].filter(Boolean).join(" ")}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => {
                onChange(option.value);
                setExpanded(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value && <b aria-hidden="true">✓</b>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown) {
  return UUID_PATTERN.test(String(value ?? "").trim());
}

function friendlySubmitError(error: unknown) {
  const message = String(error || "").trim();
  if (["CLIENTE_REQUIRED", "CLIENTE_UUID_INVALID", "CLIENTE_NO_ENCONTRADO"].includes(message)) {
    return "No se pudo identificar correctamente al cliente. Recarga la ficha e inténtalo de nuevo.";
  }
  if (message === "MARIO_COLLABORATOR_NOT_CONFIGURED" || message === "CALL_MARIO_TAG_NOT_CONFIGURED") {
    return "CALL MARIO no está configurado correctamente. Revisa la migración de Supabase antes de registrar la llamada.";
  }
  if (message === "CALL_REGISTER_FAILED") {
    return "No se pudo registrar la llamada. No se aplicaron cambios; inténtalo de nuevo.";
  }
  return message || "Error registrando llamada";
}

function fmtMinutes(v: any) {
  return String(toNum(v)).replace(".00", "");
}

const CODIGO_OPTIONS = [
  { value: "FREE", label: "Free" },
  { value: "RUEDA", label: "Rueda" },
  { value: "CLIENTE", label: "Cliente" },
  { value: "REPITE", label: "Repite" },
  { value: "CALL", label: "CALL · 0,06 €/min" },
] as const;

const PAGO_OPTIONS = ["TPV", "PAYPAL", "BIZUM", "OTROS"] as const;
const CALL_MANUAL_VALUE = "CALL";
const CALL_MARIO_VALUE = "CALL_MARIO";
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
  const submitInFlightRef = useRef(false);
  const operationIdRef = useRef("");

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
  const [marioTarotistaId, setMarioTarotistaId] = useState("");
  const [tarotistaCallManual, setTarotistaCallManual] = useState("");
  const [formaPago, setFormaPago] = useState<(typeof PAGO_OPTIONS)[number] | "">("");
  const [importe, setImporte] = useState("");
  const [clasificacion, setClasificacion] = useState<(typeof CLASIF_OPTIONS)[number]["value"]>("nada");

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setLoading(false);
    submitInFlightRef.current = false;
    operationIdRef.current = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
    setMarioTarotistaId("");
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
        if (tarotistaId === CALL_MANUAL_VALUE) {
          list.push({ key: "call_manual", title: "Nombre tarotista CALL", subtitle: "Escribe el nombre manual que quieres guardar en rendimiento." });
        }
        if (tarotistaId === CALL_MARIO_VALUE) {
          list.push({ key: "mario_tarotista", title: "Tarotista real que atiende", subtitle: "CALL MARIO indica el origen. Selecciona ahora quién prestó realmente el servicio." });
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
        if (tarotistaId === CALL_MANUAL_VALUE) {
          list.push({ key: "call_manual", title: "Nombre tarotista CALL", subtitle: "Escribe el nombre manual de la tarotista CALL." });
        }
        if (tarotistaId === CALL_MARIO_VALUE) {
          list.push({ key: "mario_tarotista", title: "Tarotista real que atiende", subtitle: "CALL MARIO indica el colaborador de origen; selecciona la tarotista que realizó la consulta." });
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
    if (tarotistaId === CALL_MANUAL_VALUE) return tarotistaCallManual.trim() || "CALL";
    const realTarotistaId = tarotistaId === CALL_MARIO_VALUE ? marioTarotistaId : tarotistaId;
    return tarotistas.find((t) => String(t.id) === String(realTarotistaId))?.display_name || "—";
  }, [tarotistaId, marioTarotistaId, tarotistaCallManual, tarotistas]);

  const isMarioCall = tarotistaId === CALL_MARIO_VALUE;

  const tarotistaSelectOptions = useMemo<GameSelectOption[]>(() => [
    { value: CALL_MARIO_VALUE, label: "✦ CALL MARIO · colaborador", special: "mario" },
    { value: CALL_MANUAL_VALUE, label: "CALL · tarotista manual", special: "manual" },
    ...tarotistas.map((tarotista) => ({
      value: String(tarotista.id),
      label: `${tarotista.display_name || tarotista.id}${tarotista.state ? ` · ${tarotista.state}` : ""}`,
    })),
  ], [tarotistas]);

  const realTarotistaOptions = useMemo<GameSelectOption[]>(() => tarotistas.map((tarotista) => ({
    value: String(tarotista.id),
    label: `${tarotista.display_name || tarotista.id}${tarotista.state ? ` · ${tarotista.state}` : ""}`,
  })), [tarotistas]);

  function changeTarotistaChoice(value: string) {
    setTarotistaId(value);
    if (value !== CALL_MARIO_VALUE) setMarioTarotistaId("");
    if (value !== CALL_MANUAL_VALUE) setTarotistaCallManual("");
  }

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
      case "mario_tarotista":
        return Boolean(marioTarotistaId);
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
    if (submitInFlightRef.current) return;

    const clienteId = String(cliente?.id || "").trim();
    if (!isUuid(clienteId)) {
      console.error("[RegistrarLlamadaModal] cliente.id no es un UUID válido", { cliente_id: clienteId });
      setMsg("❌ No se pudo identificar correctamente al cliente. Recarga la ficha e inténtalo de nuevo.");
      return;
    }
    try {
      submitInFlightRef.current = true;
      setLoading(true);
      setMsg("");
      const token = await getToken();
      if (!token) return;

      const actualTarotistaWorkerId = isMarioCall ? marioTarotistaId : (tarotistaId && tarotistaId !== CALL_MANUAL_VALUE ? tarotistaId : null);

      const payload = {
        operation_id: operationIdRef.current,
        cliente_id: clienteId,
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
        tarotista_worker_id: actualTarotistaWorkerId,
        tarotista_manual_call: tarotistaId === CALL_MANUAL_VALUE ? tarotistaCallManual.trim() : null,
        collaborator_source: isMarioCall ? CALL_MARIO_VALUE : null,
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
      console.error("[RegistrarLlamadaModal] error registrando llamada", e);
      setMsg(`❌ ${friendlySubmitError(e?.message)}`);
    } finally {
      submitInFlightRef.current = false;
      setLoading(false);
    }
  }

  if (!open || !cliente || typeof document === "undefined") return null;

  const clienteNombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(" ") || "Cliente";
  const freePend = toNum(cliente.minutos_free_pendientes);
  const normalesPend = toNum(cliente.minutos_normales_pendientes);

  const content = (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalGlow} aria-hidden="true" />
        <div className={styles.header}>
          <div className={styles.headerRow}>
            <div>
              <div className={styles.title}><span className={styles.titleIcon}>📞</span><span>Registrar llamada</span></div>
              <div className={styles.subtitle}>{clienteNombre} · {cliente.telefono || "Sin teléfono"}</div>
            </div>
            <button className={`${styles.gameButton} ${styles.secondaryButton}`} type="button" onClick={onClose}>Cerrar</button>
          </div>
        </div>

        <div className={styles.progressSection}>
          <div className={styles.progressRow}>
            <div>
              <div className={styles.stepLabel}>Paso {step + 1} de {steps.length}</div>
              <div className={styles.progressTrack}>
                <div className={styles.progressFill} style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
              </div>
            </div>
            <div className={styles.balanceBadge}>
              Pendiente CRM: {fmtMinutes(freePend)} free · {fmtMinutes(normalesPend)} normales
            </div>
          </div>
        </div>

        <div className={styles.body}>
          <div key={current?.key} className={styles.step}>
            <div className={styles.stepTitle}>{current?.title}</div>
            <div className={styles.stepSubtitle}>{current?.subtitle}</div>

            {current?.key === "compra" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <button type="button" className={`${styles.choiceButton} ${clienteCompra === "si" ? styles.choiceSelected : ""}`} onClick={() => setClienteCompra("si")} style={{ padding: 16, border: clienteCompra === "si" ? "1px solid rgba(215,181,109,.55)" : undefined, background: clienteCompra === "si" ? "rgba(215,181,109,.14)" : undefined }}>Sí, compra minutos</button>
                <button type="button" className={`${styles.choiceButton} ${clienteCompra === "no" ? styles.choiceSelected : ""}`} onClick={() => setClienteCompra("no")} style={{ padding: 16, border: clienteCompra === "no" ? "1px solid rgba(215,181,109,.55)" : undefined, background: clienteCompra === "no" ? "rgba(215,181,109,.14)" : undefined }}>No compra minutos</button>
              </div>
            )}

            {current?.key === "uso" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <button type="button" className={`${styles.choiceButton} ${usoSinCompra === "minutos" ? styles.choiceSelected : ""}`} onClick={() => setUsoSinCompra("minutos")} style={{ padding: 16, border: usoSinCompra === "minutos" ? "1px solid rgba(215,181,109,.55)" : undefined, background: usoSinCompra === "minutos" ? "rgba(215,181,109,.14)" : undefined }}>Usa minutos</button>
                <button type="button" className={`${styles.choiceButton} ${usoSinCompra === "7free" ? styles.choiceSelected : ""}`} onClick={() => setUsoSinCompra("7free")} style={{ padding: 16, border: usoSinCompra === "7free" ? "1px solid rgba(215,181,109,.55)" : undefined, background: usoSinCompra === "7free" ? "rgba(215,181,109,.14)" : undefined }}>Usa 7 free</button>
              </div>
            )}

            {current?.key === "compra_destino" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <button type="button" className={`${styles.choiceButton} ${compraDestino === "usar_todo" ? styles.choiceSelected : ""}`} onClick={() => setCompraDestino("usar_todo")} style={{ padding: 16, border: compraDestino === "usar_todo" ? "1px solid rgba(215,181,109,.55)" : undefined, background: compraDestino === "usar_todo" ? "rgba(215,181,109,.14)" : undefined }}>Usa todos los minutos</button>
                <button type="button" className={`${styles.choiceButton} ${compraDestino === "guardar" ? styles.choiceSelected : ""}`} onClick={() => setCompraDestino("guardar")} style={{ padding: 16, border: compraDestino === "guardar" ? "1px solid rgba(215,181,109,.55)" : undefined, background: compraDestino === "guardar" ? "rgba(215,181,109,.14)" : undefined }}>Guarda minutos</button>
              </div>
            )}

            {current?.key === "guardar" && (
              <div className="tc-grid-2" style={{ marginTop: 18 }}>
                <div>
                  <div className="tc-sub">Minutos free que guarda</div>
                  <input className={`${styles.gameInput} tc-input`} value={guardarFree} onChange={(e) => setGuardarFree(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                </div>
                <div>
                  <div className="tc-sub">Minutos normales que guarda</div>
                  <input className={`${styles.gameInput} tc-input`} value={guardarNormales} onChange={(e) => setGuardarNormales(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                </div>
              </div>
            )}

            {current?.key === "codigos" && (
              <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
                <div className="tc-grid-2">
                  <div>
                    <div className="tc-sub">Minutos bloque 1</div>
                    <input className={`${styles.gameInput} tc-input`} value={minutos1} onChange={(e) => setMinutos1(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                  </div>
                  <div>
                    <div className="tc-sub">Código bloque 1</div>
                    <select className={`${styles.gameInput} ${styles.gameSelect} tc-input`} value={codigo1} onChange={(e) => setCodigo1(e.target.value as any)} style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}>
                      {CODIGO_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="tc-grid-2">
                  <div>
                    <div className="tc-sub">Minutos bloque 2</div>
                    <input className={`${styles.gameInput} tc-input`} value={minutos2} onChange={(e) => setMinutos2(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                  </div>
                  <div>
                    <div className="tc-sub">Código bloque 2</div>
                    <select className={`${styles.gameInput} ${styles.gameSelect} tc-input`} value={codigo2} onChange={(e) => setCodigo2(e.target.value as any)} style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}>
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
                <div className={styles.fieldLabel}>Tarotista u origen</div>
                <GameSelect
                  value={tarotistaId}
                  options={tarotistaSelectOptions}
                  placeholder="Selecciona una opción"
                  ariaLabel="Tarotista que atiende u origen de la llamada"
                  onChange={changeTarotistaChoice}
                />
                <div className={styles.selectorHint}>
                  CALL MARIO identifica el origen del cliente; la tarotista real se selecciona en el siguiente paso.
                </div>
              </div>
            )}

            {current?.key === "mario_tarotista" && (
              <div className={styles.fieldGroup}>
                <div className={styles.marioOriginCard}>
                  <span className={styles.marioIcon}>✦</span>
                  <div>
                    <strong>Origen vinculado: CALL MARIO</strong>
                    <span>Se guardará el ID real del colaborador y de su etiqueta sin sustituir a la tarotista.</span>
                  </div>
                </div>
                <div className={styles.fieldLabel}>Tarotista que realizó la consulta</div>
                <GameSelect
                  value={marioTarotistaId}
                  options={realTarotistaOptions}
                  placeholder="Selecciona la tarotista real"
                  ariaLabel="Tarotista real que atendió la llamada de CALL MARIO"
                  onChange={setMarioTarotistaId}
                />
              </div>
            )}

            {current?.key === "call_manual" && (
              <div style={{ marginTop: 18 }}>
                <div className="tc-sub">Nombre tarotista CALL</div>
                <input className={`${styles.gameInput} tc-input`} value={tarotistaCallManual} onChange={(e) => setTarotistaCallManual(e.target.value)} placeholder="Ej: Call400" style={{ width: "100%", marginTop: 6 }} />
              </div>
            )}

            {current?.key === "pago" && (
              <div style={{ marginTop: 18 }}>
                <div className="tc-sub">Forma de pago</div>
                <select className={`${styles.gameInput} ${styles.gameSelect} tc-input`} value={formaPago} onChange={(e) => setFormaPago(e.target.value as any)} style={{ width: "100%", marginTop: 6, colorScheme: "dark" }}>
                  <option value="">Selecciona método</option>
                  {PAGO_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </div>
            )}

            {current?.key === "importe" && (
              <div style={{ marginTop: 18 }}>
                <div className="tc-sub">Importe (€)</div>
                <input className={`${styles.gameInput} tc-input`} value={importe} onChange={(e) => setImporte(e.target.value)} placeholder="22" style={{ width: "100%", marginTop: 6 }} />
              </div>
            )}

            {current?.key === "clasificacion" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                {CLASIF_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button" className={`${styles.choiceButton} ${clasificacion === opt.value ? styles.choiceSelected : ""}`} onClick={() => setClasificacion(opt.value)} style={{ padding: 16, border: clasificacion === opt.value ? "1px solid rgba(215,181,109,.55)" : undefined, background: clasificacion === opt.value ? "rgba(215,181,109,.14)" : undefined }}>{opt.label}</button>
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
                    Tiempo: {fmtMinutes(minutosConsumidos)} min · Tarotista real: {tarotistaLabel}
                    {clienteCompra === "si" ? ` · Pago: ${formaPago || "—"} · Importe: ${toNum(importe).toFixed(2)} €` : ""}
                  </div>
                  {isMarioCall && (
                    <div className={styles.marioSummary}>
                      <span>✦</span>
                      <strong>Origen: CALL MARIO</strong>
                    </div>
                  )}
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

            {!!msg && <div className={styles.message}>{msg}</div>}
          </div>
        </div>

        <div className={styles.footer}>
          <div>
            {step > 0 && <button type="button" className={`${styles.gameButton} ${styles.secondaryButton}`} onClick={back}>Atrás</button>}
          </div>
          <div className={styles.footerActions}>
            {current?.key !== "resumen" ? (
              <button type="button" className={`${styles.gameButton} ${styles.primaryButton}`} onClick={next}>Siguiente</button>
            ) : (
              <button type="button" className={`${styles.gameButton} ${styles.primaryButton}`} onClick={submit} disabled={loading}>{loading ? "Guardando..." : "Registrar llamada"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
