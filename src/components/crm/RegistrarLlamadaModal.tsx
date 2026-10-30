"use client";
import { CALL_CODE_OPTIONS as CODIGO_OPTIONS } from "@/lib/activity-codes";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./RegistrarLlamadaModal.module.css";
import { type FreePassStatus } from "./FreePassBenefits";
import { tcToast } from "@/lib/tc-toast";
import { rankFreeOfferLabel, rankFreeReason, rankFreeUsage, type RankFreeOffer } from "@/lib/client-rank-free-usage";

type ClienteLite = {
  free_passes?: FreePassStatus | null;
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

type PayPalCollection = {
  id: string;
  amount: number;
  currency: string;
  pack_id: string;
  pack_name: string;
  completed_at: string;
  pricing_mode: string;
  order_id: string;
};

function collectionLabel(collection: PayPalCollection) {
  const date = new Date(collection.completed_at);
  const when = Number.isFinite(date.getTime()) ? date.toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Fecha por confirmar";
  const amount = Number(collection.amount).toLocaleString("es-ES", { style: "currency", currency: collection.currency || "EUR" });
  return `${when} · ${amount} · ${collection.pack_name || "Cobro PayPal"} · ${collection.order_id || collection.id}`;
}

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
  onBenefitsChanged?: () => Promise<void>;
  onSuccess?: (message?: string, confirmed?: { clienteId: string; balances: { free_after: number; normal_after: number } | null }) => Promise<void> | void;
};

type CaptureXpPreview = {
  enabled: boolean;
  xp: number;
  eligible: boolean;
  already_awarded: boolean;
  owner_name?: string | null;
  current_worker_is_owner?: boolean;
  status?: string;
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
  if (["RANK_NOT_ELIGIBLE", "ALREADY_USED", "TAROTISTA_INACTIVE", "SOURCE_REQUIRED", "NO_ELIGIBLE_SOURCE", "POLICY_NOT_CONFIGURED"].includes(message)) return rankFreeReason(message);
  if (message === "GIFT_NOT_AVAILABLE") return "Este regalo ya no está disponible para esta tarotista. Actualiza el registro antes de continuar.";
  if (message === "RANK_CHANGED") return "El rango ha cambiado. Pulsa Atrás y revisa el regalo disponible con el rango actual antes de guardar.";
  if (message === "RANK_FREE_REGISTER_FAILED") return "No se pudo confirmar el resultado. Reintenta este mismo registro para comprobarlo sin duplicar el regalo.";
  if (message === "INVALID_RANK_FREE_REQUEST") return "No se pudo validar este regalo. Cierra y vuelve a abrir el registro para actualizar sus datos.";
  if (message === "PAYPAL_COLLECTION_SELECTION_REQUIRED") return "Hay un cobro PayPal pendiente de registrar. Vuelve a Importe cobrado y selecciona el cobro exacto o confirma que se trata de un pago externo distinto.";
  if (["PAYPAL_COLLECTION_ALREADY_REGISTERED", "PAYPAL_COLLECTION_ALREADY_RECORDED", "PAYPAL_COLLECTION_ALREADY_USED"].includes(message)) return "Este cobro PayPal ya está registrado. No vuelvas a crear la compra; usa su saldo pendiente para registrar la llamada.";
  if (message === "OPERATION_CONFLICT") return "Esta operación ya se guardó con otros datos. Cierra el formulario y actualiza la ficha antes de continuar.";
  if (message === "RECOVERY_REQUIRES_PURCHASE" || message === "PAYMENT_REQUIRED") return "Recuperado requiere una compra confirmada posterior al contacto. Para una compra ya registrada, confírmala desde Recuperar clientes.";
  if (message === "CONTACT_FIRST") return "Marca primero «Fue contactada» en Recuperar clientes. La compra debe ser posterior a ese contacto.";
  if (message === "OTHER_OWNER") return "Este cliente está asignado a otra central. Actualiza la ficha para comprobar su responsable.";
  if (message === "NOT_ELIGIBLE" || message === "RECOVERY_NOT_ELIGIBLE") return "Este cliente no cumple las condiciones de recuperación. Actualiza su ficha antes de registrar la compra.";
  if (message === "INVALID_CALL_MINUTES") return "Revisa los minutos: deben ser positivos, con su código. Si guarda toda la compra para después, los utilizados pueden ser 0.";
  if (message === "PAYPAL_PAYMENT_ALREADY_CONFIRMED") return "Existe una compra histórica de PayPal de este importe pendiente de revisión. Administración debe comprobarla antes de registrar otra compra.";
  if (message === "PAYMENT_ALREADY_LINKED") return "Ese pago ya tiene una llamada vinculada. Vuelve a abrir la ficha; para otra llamada utiliza los minutos pendientes.";
  if (message === "EXISTING_PAYMENT_INVALID") return "El pago ya no está disponible o no pertenece a esta clienta. Vuelve a abrir el formulario.";
  if (message === "PAYMENT_OPERATION_CONFLICT") return "Esta operación ya se utilizó con otro pago. Cierra y vuelve a abrir el formulario.";
  if (message === "EXISTING_PAYMENT_CALL_ONLY") return "Selecciona el pago confirmado y registra únicamente los minutos utilizados.";
  if (["CLIENTE_REQUIRED", "CLIENTE_UUID_INVALID", "CLIENTE_NO_ENCONTRADO"].includes(message)) {
    return "No se pudo identificar correctamente al cliente. Recarga la ficha e inténtalo de nuevo.";
  }
  if (message === "MARIO_COLLABORATOR_NOT_CONFIGURED" || message === "CALL_MARIO_TAG_NOT_CONFIGURED") {
    return "CALL MARIO no está configurado correctamente. Revisa la migración de Supabase antes de registrar la llamada.";
  }
  if (message === "PAYMENT_REGISTER_FAILED") {
    return "No se pudo registrar el pago. La llamada no se ha guardado. Revisa los datos e inténtalo de nuevo.";
  }
  if (message === "CALL_REGISTER_FAILED") {
    return "No se pudo registrar la llamada. No se aplicaron cambios; inténtalo de nuevo.";
  }
  if (message === "BALANCE_CHANGED") {
    return "El saldo ha cambiado mientras registrabas la llamada. Vuelve a abrir el formulario para comprobar los minutos actuales; no se ha guardado esta operación.";
  }
  if (message === "PURCHASE_MINUTES_EXCEEDED") return "El consumo supera los minutos de esta compra. Revisa los minutos comprados y los códigos.";
  if (message === "INSUFFICIENT_FREE_MINUTES") {
    return "La clienta no dispone de minutos free suficientes para registrar esta llamada.";
  }
  if (message === "INSUFFICIENT_NORMAL_MINUTES") {
    return "La clienta no dispone de minutos normales suficientes para registrar esta llamada.";
  }
  if (message === "INSUFFICIENT_MINUTES") {
    return "La clienta no dispone de minutos free ni normales suficientes para registrar esta llamada.";
  }
  if (message === "CAPTURE_REQUIRES_COMPLETED_PURCHASE") {
    return "No se puede confirmar la captación sin una primera compra real completada.";
  }
  return message || "Error registrando llamada";
}

function fmtMinutes(v: any) {
  return String(toNum(v)).replace(".00", "");
}

// Shared with the performance editor; stored codes and registration behavior are unchanged.


const PAGO_OPTIONS = ["TPV", "PAYPAL", "BIZUM", "OTROS"] as const;
const CALL_MANUAL_VALUE = "CALL";
const CALL_MARIO_VALUE = "CALL_MARIO";
const CLASIF_OPTIONS = [
  { value: "nada", label: "Nada" },
  { value: "promo", label: "Promo" },
  { value: "captado", label: "Captado" },
  { value: "recuperado", label: "Recuperado" },
  { value: "super_promo_ruleta", label: "Super Promo Ruleta" },
] as const;

export default function RegistrarLlamadaModal({
  open,
  cliente,
  tarotistas,
  onClose,
  getToken,
  onSuccess,
  onBenefitsChanged,
}: Props) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const submitInFlightRef = useRef(false);
  const modalGenerationRef = useRef(0);
  const operationIdRef = useRef("");
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [liveBalance, setLiveBalance] = useState<{ minutos_free_pendientes: number; minutos_normales_pendientes: number } | null>(null);
  const [rankFreeSnapshot, setRankFreeSnapshot] = useState<{ clienteId: string; preview: unknown } | null>(null);
  const [rankFreeWorkerId, setRankFreeWorkerId] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [clienteCompra, setClienteCompra] = useState<"si" | "no" | "">("");
  const [usoSinCompra, setUsoSinCompra] = useState<"minutos" | "7free" | "rank_free" | "">("");
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
  const [captureXp, setCaptureXp] = useState<CaptureXpPreview | null>(null);
  const [collections, setCollections] = useState<PayPalCollection[]>([]);
  const [collectionsStatus, setCollectionsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [collectionChoice, setCollectionChoice] = useState("");
  const [collectionsRetry, setCollectionsRetry] = useState(0);
  const needsPayPalSource = clienteCompra === "si" && formaPago === "PAYPAL";
  const selectedCollection = needsPayPalSource ? collections.find(collection => collection.id === collectionChoice) || null : null;
  const isManualCollection = selectedCollection?.pricing_mode === "manual_amount" || selectedCollection?.pack_id === "crm_manual_amount";
  const paypalSourceValid = !needsPayPalSource || (collectionsStatus === "ready" && (collectionChoice === "external" || Boolean(selectedCollection)));
  const rankFree = useMemo(() => rankFreeUsage(rankFreeSnapshot && rankFreeSnapshot.clienteId === cliente?.id ? rankFreeSnapshot.preview : null), [rankFreeSnapshot, cliente?.id]);
  const selectedRankFree = rankFree.offers.find(offer => offer.workerId === rankFreeWorkerId) || null;
  const isRankFree = clienteCompra === "no" && usoSinCompra === "rank_free";

  useEffect(() => {
    modalGenerationRef.current += 1;
    if (!open) return;
    setStep(0);
    setLoading(false);
    submitInFlightRef.current = false;
    operationIdRef.current = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMsg("");
    setClienteCompra("");
    setLiveBalance(null);
    setRankFreeSnapshot(null);
    setRankFreeWorkerId("");
    setBalanceError("");
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
    setCaptureXp(null);
    setCollectionChoice("");
    setCollections([]);
    setCollectionsStatus("idle");
    let cancelled = false;
    void (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error("Sin sesión");
        const response = await fetch(`/api/crm/rendimiento/registrar?mode=balance&cliente_id=${encodeURIComponent(String(cliente?.id))}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        const json = await response.json();
        if (!response.ok || !json.ok || !json.balance) throw new Error("Sin saldo");
        if (!cancelled) {
          setLiveBalance(json.balance);
          setRankFreeSnapshot({ clienteId: String(cliente?.id), preview: json.rank_free });
        }
      } catch {
        if (!cancelled) setBalanceError("No se pudo consultar el saldo actual. Cierra y vuelve a abrir el registro.");
      }
    })();
    void (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token || cancelled || !isUuid(cliente?.id)) return;
        const response = await fetch(`/api/crm/rendimiento/registrar?cliente_id=${encodeURIComponent(String(cliente?.id))}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const json = await response.json();
        if (!cancelled && response.ok && json.ok) setCaptureXp(json.capture_xp);
      } catch {
        // La previsualización es informativa; el servidor decide y persiste el premio real.
      }
    })();
    return () => { cancelled = true; modalGenerationRef.current += 1; };
  }, [open, cliente?.id]);

  useEffect(() => {
    setCollectionChoice("");
    setCollections([]);
    if (!open || !needsPayPalSource || !isUuid(cliente?.id)) {
      setCollectionsStatus("idle");
      return;
    }
    let cancelled = false;
    setCollectionsStatus("loading");
    void (async () => {
      try {
        const token = await getTokenRef.current();
        if (!token) throw new Error("Sin sesión");
        const response = await fetch(`/api/crm/rendimiento/registrar?mode=collections&cliente_id=${encodeURIComponent(String(cliente?.id))}`, {
          headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
        });
        const json = await response.json();
        if (!response.ok || !json.ok || !Array.isArray(json.collections)) throw new Error("Sin cobros");
        if (!cancelled) { setCollections(json.collections); setCollectionsStatus("ready"); }
      } catch {
        if (!cancelled) setCollectionsStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [open, cliente?.id, needsPayPalSource, collectionsRetry]);

  const steps = useMemo(() => {
    const list: { key: string; title: string; subtitle: string }[] = [
      { key: "compra", title: "¿Qué vas a registrar?", subtitle: "Registra una compra nueva o una consulta con saldo o regalo disponible." },
    ];

    if (clienteCompra === "no") {
      list.push({ key: "uso", title: "¿Qué minutos utiliza en esta consulta?", subtitle: rankFree.rank ? "Elige el regalo de su rango para conocer a una tarotista nueva o utiliza saldo pendiente." : "Elige los minutos disponibles para esta consulta." });
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
        list.push({ key: "guardar", title: "¿Cuántos minutos quedan pendientes?", subtitle: "Introduce solo lo que queda de esta compra después de la llamada. Se sumará al saldo anterior; no vuelvas a incluirlo." });
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
        list.push({ key: "clasificacion", title: "Clasificación", subtitle: "Selecciona la tarifa de esta compra. Promo no entrega Coins ni giros; Nada corresponde a tarifa normal." });
      }
    }

    list.push({ key: "resumen", title: "Resumen final", subtitle: "Revisa los datos antes de registrar la llamada." });
    return list;
  }, [clienteCompra, usoSinCompra, compraDestino, tarotistaId, rankFree.rank]);

  const current = steps[step];
  const minutosConsumidos = useMemo(() => {
    if (isRankFree) return selectedRankFree?.consumeMinutes || 0;
    if (clienteCompra === "no" && usoSinCompra === "7free") return 7;
    return toNum(minutos1) + toNum(minutos2);
  }, [clienteCompra, usoSinCompra, minutos1, minutos2, isRankFree, selectedRankFree]);

  const tarotistaLabel = useMemo(() => {
    if (isRankFree) return selectedRankFree?.workerName || "—";
    if (tarotistaId === CALL_MANUAL_VALUE) return tarotistaCallManual.trim() || "CALL";
    const realTarotistaId = tarotistaId === CALL_MARIO_VALUE ? marioTarotistaId : tarotistaId;
    return tarotistas.find((t) => String(t.id) === String(realTarotistaId))?.display_name || "—";
  }, [tarotistaId, marioTarotistaId, tarotistaCallManual, tarotistas, isRankFree, selectedRankFree]);

  const isMarioCall = !isRankFree && tarotistaId === CALL_MARIO_VALUE;

  const balanceValidationError = useMemo(() => {
    if (clienteCompra === "si") return "";
    if (balanceError) return balanceError;
    if (!liveBalance) return "Comprobando saldo actual…";
    if (clienteCompra !== "no") return "";
    if (isRankFree) return selectedRankFree?.eligible ? "" : selectedRankFree ? rankFreeReason(selectedRankFree.reason) : "Pulsa Atrás y selecciona un regalo disponible antes de guardar.";
    const availableFree = toNum(liveBalance.minutos_free_pendientes);
    const availableNormal = toNum(liveBalance.minutos_normales_pendientes);

    if (usoSinCompra === "7free") {
      if (!rankFree.allowInitialFree) return "La consulta inicial de 7 minutos no está disponible en este paso para su rango actual.";
      return availableFree >= 7 ? "" : "La clienta no dispone de 7 minutos free suficientes para registrar esta consulta.";
    }

    if (usoSinCompra !== "minutos") return "";
    const requestedFree = (codigo1 === "FREE" ? toNum(minutos1) : 0)
      + (codigo2 === "FREE" ? toNum(minutos2) : 0);
    const requestedNormal = (codigo1 !== "FREE" ? toNum(minutos1) : 0)
      + (codigo2 && codigo2 !== "FREE" ? toNum(minutos2) : 0);

    if (requestedFree > availableFree) {
      return `Saldo free insuficiente: disponibles ${fmtMinutes(availableFree)}, solicitados ${fmtMinutes(requestedFree)}.`;
    }
    if (requestedNormal > availableNormal) {
      return `Saldo normal insuficiente: disponibles ${fmtMinutes(availableNormal)}, solicitados ${fmtMinutes(requestedNormal)}.`;
    }
    return "";
  }, [clienteCompra, compraDestino, guardarFree, guardarNormales, usoSinCompra, liveBalance, balanceError, codigo1, codigo2, minutos1, minutos2, isRankFree, selectedRankFree, rankFree.allowInitialFree]);

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

  function chooseRankFree(offer: RankFreeOffer) {
    if (!offer.eligible) return;
    setUsoSinCompra("rank_free");
    setRankFreeWorkerId(offer.workerId);
    setTarotistaId(offer.workerId);
    setMarioTarotistaId("");
    setTarotistaCallManual("");
    setCodigo1("FREE");
    setMinutos1("0");
    setCodigo2("");
    setMinutos2("0");
    setClasificacion("nada");
    setMsg("");
  }

  function currentStepIsValid() {
    switch (current?.key) {
      case "compra":
        return clienteCompra === "si" || clienteCompra === "no";
      case "uso":
        return usoSinCompra === "minutos" || (usoSinCompra === "7free" && rankFree.allowInitialFree) || (usoSinCompra === "rank_free" && Boolean(selectedRankFree?.eligible));
      case "compra_destino":
        return compraDestino === "usar_todo" || compraDestino === "guardar";
      case "guardar":
        return toNum(guardarFree) >= 0 && toNum(guardarNormales) >= 0;
      case "codigos":
        return toNum(minutos1) >= 0 && toNum(minutos2) >= 0
          && (minutosConsumidos > 0 || (clienteCompra === "si" && compraDestino === "guardar" && toNum(guardarFree) + toNum(guardarNormales) > 0))
          && (toNum(minutos2) <= 0 || Boolean(codigo2));
      case "tarotista":
        return Boolean(tarotistaId);
      case "call_manual":
        return Boolean(tarotistaCallManual.trim());
      case "mario_tarotista":
        return Boolean(marioTarotistaId);
      case "pago":
        return Boolean(formaPago);
      case "importe":
        return toNum(importe) > 0 && paypalSourceValid;
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
    if ((current?.key === "uso" || current?.key === "codigos") && balanceValidationError) {
      setMsg(`⚠️ ${balanceValidationError}`);
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
    const modalGeneration = modalGenerationRef.current;

    const clienteId = String(cliente?.id || "").trim();
    if (!isUuid(clienteId)) {
      console.error("[RegistrarLlamadaModal] cliente.id no es un UUID válido", { cliente_id: clienteId });
      setMsg("❌ No se pudo identificar correctamente al cliente. Recarga la ficha e inténtalo de nuevo.");
      return;
    }
    if (balanceValidationError) {
      setMsg(`⚠️ ${balanceValidationError}`);
      return;
    }
    if (!paypalSourceValid) {
      setMsg("Selecciona el cobro PayPal confirmado o indica que es un pago externo en el paso Importe cobrado.");
      return;
    }
    try {
      submitInFlightRef.current = true;
      setLoading(true);
      setMsg("");
      const token = await getToken();
      if (modalGeneration !== modalGenerationRef.current) return;
      if (!token) return;

      const actualTarotistaWorkerId = isRankFree ? selectedRankFree?.workerId : isMarioCall ? marioTarotistaId : (tarotistaId && tarotistaId !== CALL_MANUAL_VALUE ? tarotistaId : null);

      const payload = {
        minute_accounting_version: 3,
        operation_id: operationIdRef.current,
        cliente_id: clienteId,
        cliente_compra_minutos: clienteCompra === "si",
        uso_tipo: clienteCompra === "no" ? usoSinCompra : "compra",
        ...(isRankFree ? {
          rank_free_expected_rank: rankFree.rank,
          rank_free_expected_minutes: rankFree.minutes,
          rank_free_eligibility_key: selectedRankFree?.eligibilityKey,
        } : {}),
        guarda_minutos: clienteCompra === "si" && compraDestino === "guardar",
        misma_compra: clienteCompra === "si" && compraDestino === "usar_todo",
        guardados_free: isRankFree ? 0 : toNum(guardarFree),
        guardados_normales: isRankFree ? 0 : toNum(guardarNormales),
        codigo_1: isRankFree ? "FREE" : minutosConsumidos > 0 ? codigo1 : null,
        minutos_1: isRankFree ? minutosConsumidos : toNum(minutos1),
        codigo_2: isRankFree ? null : codigo2 || null,
        minutos_2: isRankFree ? 0 : toNum(minutos2),
        tarotista_worker_id: actualTarotistaWorkerId,
        tarotista_manual_call: !isRankFree && tarotistaId === CALL_MANUAL_VALUE ? tarotistaCallManual.trim() : null,
        collaborator_source: isMarioCall ? CALL_MARIO_VALUE : null,
        forma_pago: clienteCompra === "si" ? formaPago || null : null,
        paypal_collection_order_id: selectedCollection?.id || null,
        paypal_collection_source: needsPayPalSource ? selectedCollection ? "crm_collection" : collectionChoice === "external" ? "external" : null : null,
        importe: clienteCompra === "si" ? toNum(importe) : 0,
        clasificacion: isRankFree ? "nada" : clasificacion,
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
      if (modalGeneration !== modalGenerationRef.current) return;
      if (!j?._ok || !j?.ok) {
        if (isRankFree) {
          if (j?.balance) setLiveBalance(j.balance);
          if (j?.rank_free) setRankFreeSnapshot({ clienteId, preview: j.rank_free });
          else if (["RANK_CHANGED", "ALREADY_USED", "GIFT_NOT_AVAILABLE", "TAROTISTA_INACTIVE", "RANK_NOT_ELIGIBLE", "PAYMENT_OPERATION_CONFLICT"].includes(j?.error)) setRankFreeSnapshot(null);
          if (j?.error === "RANK_CHANGED") setRankFreeWorkerId("");
          throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
        }
        if (j?.balance) {
          setLiveBalance(j.balance);
          const free = toNum(j.balance.minutos_free_pendientes);
          const normal = toNum(j.balance.minutos_normales_pendientes);
          throw new Error(`Saldo actualizado: ${fmtMinutes(free)} FREE + ${fmtMinutes(normal)} normales. No se ha registrado esta llamada. Pulsa Atrás y revisa los bloques de minutos.`);
        }
        console.error("[RegistrarLlamadaModal] fallo API registrar llamada", {
          error: j?.error || null,
          diagnostic_code: j?.diagnostic_code || null,
          diagnostic_message: j?.diagnostic_message || null,
          diagnostic_details: j?.diagnostic_details || null,
          diagnostic_hint: j?.diagnostic_hint || null,
          request_id: j?.request_id || operationIdRef.current || null,
          payload_sanitizado: {
            operation_id: operationIdRef.current || null,
            cliente_id: clienteId,
            cliente_compra_minutos: clienteCompra === "si",
            uso_tipo: clienteCompra === "no" ? usoSinCompra : "compra",
            tarotista_worker_id: actualTarotistaWorkerId,
            forma_pago: clienteCompra === "si" ? formaPago || null : null,
            importe: clienteCompra === "si" ? toNum(importe) : 0,
            minutos_1: toNum(minutos1),
            codigo_1: minutosConsumidos > 0 ? codigo1 : null,
            minutos_2: toNum(minutos2),
            codigo_2: codigo2 || null,
          },
        });
        throw new Error(j?.error || `HTTP ${j?._status || r.status}`);
      }

      if (clienteCompra === "si" && toNum(importe) > 0) {
        const paymentEventDetail = {
          operationId: String(j?.operation_id || operationIdRef.current || ""),
          rendimientoId: String(j?.rendimiento_id || ""),
          paymentId: String(j?.payment_id || ""),
          clientName: String(j?.client_name || [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ") || "Clienta"),
          amount: Number(j?.amount ?? toNum(importe)),
          currency: String(j?.currency || "EUR"),
          countToday: Number(j?.payment_count_today || 0) || undefined,
          xpEvent: j?.xp_event || null,
          clienteId,
          business: String(j?.business || ""),
          occurredAt: String(j?.created_at || new Date().toISOString()),
        };

        // Invalida de inmediato las vistas económicas abiertas en esta pestaña
        // y en otras pestañas del mismo navegador. Los módulos vuelven a consultar
        // la fuente real, por lo que este aviso nunca suma importes localmente.
        window.dispatchEvent(new CustomEvent("tc-payment-recorded", { detail: paymentEventDetail }));
        try {
          const paymentChannel = new BroadcastChannel("tc-payments");
          paymentChannel.postMessage({ type: "payment-recorded", ...paymentEventDetail });
          paymentChannel.close();
        } catch {
          // BroadcastChannel es solo una optimización; Realtime sigue siendo la fuente principal.
        }
      }

      if (j?.xp_event) {
        window.dispatchEvent(new CustomEvent("tc-xp-recorded", { detail: { event: j.xp_event, clienteId } }));
      }
      if (j?.recovery) {
        window.dispatchEvent(new Event("tc-recovery-mission-refresh"));
      }

      if (onSuccess) await onSuccess(j?.message || "✅ Llamada registrada correctamente", {
        clienteId,
        // Replays can contain an older receipt; refresh rather than restore it.
        balances: j?.duplicate_prevented ? null : j?.balances || null,
      });
      if (modalGeneration !== modalGenerationRef.current) return;
      onClose();
    } catch (e: any) {
      if (modalGeneration !== modalGenerationRef.current) return;
      console.error("[RegistrarLlamadaModal] error registrando llamada", e);
      setMsg(`❌ ${friendlySubmitError(e?.message)}`);
      if (clienteCompra === "si") tcToast({ title: "Cobro no registrado", description: "No hemos podido completar la operación.", tone: "error", duration: 4200 });
    } finally {
      if (modalGeneration === modalGenerationRef.current) {
        submitInFlightRef.current = false;
        setLoading(false);
      }
    }
  }

  if (!open || !cliente || typeof document === "undefined") return null;

  const clienteNombre = [cliente.nombre, cliente.apellido].filter(Boolean).join(" ") || "Cliente";
  const freePend = toNum(liveBalance?.minutos_free_pendientes);
  const normalesPend = toNum(liveBalance?.minutos_normales_pendientes);
  const usedFree = isRankFree ? minutosConsumidos : (codigo1 === "FREE" ? toNum(minutos1) : 0) + (codigo2 === "FREE" ? toNum(minutos2) : 0);
  const usedNormal = minutosConsumidos - usedFree;
  const remainingFree = compraDestino === "guardar" ? toNum(guardarFree) : 0;
  const remainingNormal = compraDestino === "guardar" ? toNum(guardarNormales) : 0;

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
              {liveBalance ? <>Pendiente CRM: {fmtMinutes(freePend)} free · {fmtMinutes(normalesPend)} normales</> : balanceError ? "Saldo pendiente de comprobar" : "Consultando saldo…"}
            </div>
          </div>
        </div>

        <div className={styles.body}>
          <div key={current?.key} className={styles.step}>
            <div className={styles.stepTitle}>{current?.title}</div>
            <div className={styles.stepSubtitle}>{current?.subtitle}</div>

            {current?.key === "compra" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <button type="button" className={`${styles.choiceButton} ${clienteCompra === "si" ? styles.choiceSelected : ""}`} onClick={() => { setClienteCompra("si"); }} style={{ padding: 16, border: clienteCompra === "si" ? "1px solid rgba(215,181,109,.55)" : undefined, background: clienteCompra === "si" ? "rgba(215,181,109,.14)" : undefined }}>Registrar una compra nueva</button>
                <button type="button" className={`${styles.choiceButton} ${clienteCompra === "no" ? styles.choiceSelected : ""}`} onClick={() => { setClienteCompra("no"); }} style={{ padding: 16, border: clienteCompra === "no" ? "1px solid rgba(215,181,109,.55)" : undefined, background: clienteCompra === "no" ? "rgba(215,181,109,.14)" : undefined }}>Usar saldo o regalo · sin nueva compra</button>
              </div>
            )}

            {current?.key === "uso" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <section className={styles.confirmedPayments} aria-label="Regalo para conocer a una tarotista nueva">
                  <strong>{rankFree.rankLabel ? `Regalo del rango ${rankFree.rankLabel}` : "Regalo para conocer a una tarotista nueva"}</strong>
                  {!rankFreeSnapshot || rankFreeSnapshot.clienteId !== cliente.id ? <p role="status">{balanceError || "Comprobando regalos disponibles…"}</p> : <>
                    {rankFree.available.map(offer => <button key={offer.workerId} type="button" aria-pressed={isRankFree && rankFreeWorkerId === offer.workerId} className={`${styles.choiceButton} ${styles.rankGiftChoice} ${isRankFree && rankFreeWorkerId === offer.workerId ? styles.choiceSelected : ""}`} onClick={() => chooseRankFree(offer)}>
                      <strong>{rankFreeOfferLabel(rankFree)}</strong>
                      <small>Para conocer a {offer.workerName} · una vez por cliente</small>
                    </button>)}
                    {!rankFree.available.length && <p>{rankFree.explanation}</p>}
                    {rankFree.offers.filter(offer => !offer.eligible).map(offer => <small key={offer.workerId}>{offer.workerName}: {rankFreeReason(offer.reason)}</small>)}
                  </>}
                  <p>Este regalo tiene sus propios minutos, aunque el saldo pendiente sea 0. No consume los pases periódicos de 7 minutos ni la consulta inicial.</p>
                  <small>Elegir una opción no añade minutos. El regalo y la llamada solo se confirman al pulsar Registrar llamada.</small>
                </section>
                <button type="button" aria-pressed={usoSinCompra === "minutos"} className={`${styles.choiceButton} ${usoSinCompra === "minutos" ? styles.choiceSelected : ""}`} onClick={() => { setUsoSinCompra("minutos"); setMsg(""); }} style={{ padding: 16, border: usoSinCompra === "minutos" ? "1px solid rgba(215,181,109,.55)" : undefined, background: usoSinCompra === "minutos" ? "rgba(215,181,109,.14)" : undefined }}>Usar saldo pendiente</button>
                {rankFree.allowInitialFree ? <button type="button" aria-pressed={usoSinCompra === "7free"} className={`${styles.choiceButton} ${usoSinCompra === "7free" ? styles.choiceSelected : ""}`} onClick={() => { setUsoSinCompra("7free"); setMsg(""); }} style={{ padding: 16, border: usoSinCompra === "7free" ? "1px solid rgba(215,181,109,.55)" : undefined, background: usoSinCompra === "7free" ? "rgba(215,181,109,.14)" : undefined }}>Usar 7 min FREE iniciales</button> : null}
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
                  <div className="tc-sub">Minutos FREE que quedan pendientes</div>
                  <input className={`${styles.gameInput} tc-input`} value={guardarFree} onChange={(e) => setGuardarFree(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                </div>
                <div>
                  <div className="tc-sub">Minutos normales que quedan pendientes</div>
                  <input className={`${styles.gameInput} tc-input`} value={guardarNormales} onChange={(e) => setGuardarNormales(e.target.value)} style={{ width: "100%", marginTop: 6 }} />
                </div>
              </div>
            )}

            {current?.key === "codigos" && (
              <div style={{ display: "grid", gap: 14, marginTop: 18 }}>
                {clienteCompra === "si" && compraDestino === "guardar" && <p>Si todavía no ha hablado, deja 0 minutos utilizados. No hace falta registrar un minuto para guardar la compra.</p>}
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
                {needsPayPalSource ? <div className={styles.confirmedPayments}>
                  <label htmlFor="registered-paypal-collection"><strong>¿Qué cobro PayPal vas a registrar?</strong></label>
                  <p>Elige el enlace que ya se ha pagado. Así se conserva su tarifa y se evita registrar el mismo cobro dos veces.</p>
                  {collectionsStatus === "loading" ? <p role="status">Consultando cobros confirmados…</p> : collectionsStatus === "error" ? <>
                    <p role="alert">No se pudieron consultar los cobros. Reintenta antes de continuar.</p>
                    <button type="button" onClick={() => setCollectionsRetry(value => value + 1)}>Reintentar cobros</button>
                  </> : collectionsStatus === "ready" ? <>
                    <select id="registered-paypal-collection" className={`${styles.gameInput} ${styles.gameSelect} tc-input`} value={collectionChoice} onChange={(event) => {
                      const choice = event.target.value;
                      const collection = collections.find(item => item.id === choice);
                      setCollectionChoice(choice);
                      setImporte(collection ? String(collection.amount) : "");
                    }}>
                      <option value="">Selecciona el origen del pago</option>
                      {collections.map(collection => <option key={collection.id} value={collection.id}>{collectionLabel(collection)}</option>)}
                      <option value="external">Pago PayPal externo · no creado desde Realizar pago</option>
                    </select>
                    {!collections.length ? <small>No hay cobros de Realizar pago confirmados y pendientes de registrar para esta clienta.</small> : null}
                    {selectedCollection ? <small>{isManualCollection ? "Importe manual: sin Coins ni giros, sea cual sea la clasificación." : "Paquete de tarifa normal. La clasificación Promo no concede Coins ni giros."}</small> : collectionChoice === "external" ? <small>Registra únicamente un pago recibido fuera del cobrador del panel.</small> : null}
                  </> : null}
                </div> : null}
                <label className="tc-sub" htmlFor="registered-call-amount">Importe (€)</label>
                <input id="registered-call-amount" inputMode="decimal" readOnly={Boolean(selectedCollection)} className={`${styles.gameInput} tc-input`} value={importe} onChange={(e) => { setImporte(e.target.value); }} placeholder="22" style={{ width: "100%", marginTop: 6 }} />
              </div>
            )}

            {current?.key === "clasificacion" && (
              <div className={styles.classificationGrid}>
                {isManualCollection ? <p className={styles.message}>Este cobro se creó con importe manual: no entrega Coins ni giros de ruleta con ninguna clasificación.</p> : null}
                {CLASIF_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button" aria-pressed={clasificacion === opt.value} className={`${styles.choiceButton} ${styles[`classification_${opt.value}`]} ${clasificacion === opt.value ? styles.choiceSelected : ""}`} onClick={() => setClasificacion(opt.value)}>
                    <span className={styles.classificationIcon} aria-hidden="true">{opt.value === "captado" ? "★" : opt.value === "promo" ? "✦" : opt.value === "recuperado" ? "↗" : opt.value === "super_promo_ruleta" ? "🎡" : "•"}</span>
                    <span><b>{opt.label}</b>{opt.value === "nada" ? <small>{isManualCollection ? "Cobro manual · Sin Coins ni giros" : "Tarifa normal · Coins y ruleta según el importe y el rango"}</small> : opt.value === "promo" ? <small>Precio promocional · Sin Coins ni giros de ruleta</small> : opt.value === "captado" ? <small>{captureXp?.eligible ? `${captureXp.owner_name || "La captadora histórica"} recibirá +${captureXp.xp.toLocaleString("es-ES")} XP` : captureXp?.already_awarded ? "XP de captación ya concedido" : "Se validará la primera gestora"} · {isManualCollection ? "Sin Coins ni giros" : "Beneficios de tarifa normal"}</small> : opt.value === "recuperado" ? <small>Compra confirmada tras el contacto · +75 XP una sola vez · Cuenta para las 5 recuperaciones de tu turno · {isManualCollection ? "Sin Coins ni giros" : "Beneficios de tarifa normal"}</small> : opt.value === "super_promo_ruleta" ? <small>{isManualCollection ? "Este cobro manual no permite conceder giros" : "+1 giro exclusivo · Super Ruleta Nivel Especial"}</small> : null}</span>
                    {opt.value === "captado" && captureXp?.eligible ? <strong>+{captureXp.xp.toLocaleString("es-ES")} XP</strong> : null}
                  </button>
                ))}
              </div>
            )}

            {current?.key === "resumen" && (
              <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
                <div className={styles.confirmedPayments}>
                  <strong>Así quedarán sus minutos</strong>
                  <span>Saldo anterior: {freePend} free + {normalesPend} normales = {freePend + normalesPend} min</span>
                  {clienteCompra === "si" ? <>
                    <span>Minutos de la compra: {compraDestino === "guardar" ? toNum(guardarFree) + usedFree : usedFree} FREE + {compraDestino === "guardar" ? toNum(guardarNormales) + usedNormal : usedNormal} normales.</span>
                    <span>Consumo ahora: {usedFree} FREE + {usedNormal} normales.</span>
                    {balanceValidationError ? <strong role="alert">{balanceValidationError}</strong> : <>
                      <span>Quedan de esta compra: {remainingFree} FREE + {remainingNormal} normales.</span>
                      {liveBalance && <strong>Saldo previsto al guardar: {freePend + remainingFree} FREE + {normalesPend + remainingNormal} normales.</strong>}
                    </>}
                    <small>{isManualCollection ? "Cobro manual: no se añaden Coins ni giros de ruleta." : clasificacion === "promo" ? "Compra promocional: no se añaden Coins ni giros de ruleta." : "Los bonos de rango se suman aparte y quedan detallados en la nota final."}</small>
                  </> : isRankFree && selectedRankFree ? <>
                    <span>Regalo para conocer a {selectedRankFree.workerName} · rango {rankFree.rankLabel} · una vez por cliente y tarotista.</span>
                    <span>Se utilizan {selectedRankFree.consumeMinutes} minutos FREE del regalo de bienvenida. Su saldo pendiente se mantiene.</span>
                    <span>Consumo ahora: {selectedRankFree.consumeMinutes} FREE con {selectedRankFree.workerName}.</span>
                    {balanceValidationError ? <strong role="alert">{balanceValidationError}</strong> : <strong>Saldo previsto al guardar: {freePend} FREE + {normalesPend} normales.</strong>}
                    <small>La llamada contará con sus {selectedRankFree.consumeMinutes} minutos FREE en el rendimiento de {selectedRankFree.workerName}. No es una compra ni utiliza un pase de 7 minutos.</small>
                  </> : isRankFree ? <strong role="alert">{balanceValidationError}</strong> : <>
                    {balanceValidationError ? <strong role="alert">{balanceValidationError} No se descontarán minutos hasta corregir los bloques.</strong> : <>
                      <span>Se descuentan {minutosConsumidos} min de esta llamada.</span>
                      <strong>Saldo previsto: {freePend + normalesPend - minutosConsumidos} min</strong>
                    </>}
                  </>}
                  <small>{isRankFree ? "Al guardar se vuelve a comprobar el rango, la tarotista y que el regalo no se haya usado. El regalo, el consumo y la llamada se confirman juntos." : "La base de datos comprueba el saldo real al guardar. Los premios nuevos se registran aparte."}</small>
                </div>
                <div className="tc-card" style={{ borderRadius: 18, padding: 14, background: "rgba(255,255,255,.03)" }}>
                  <div className="tc-sub">Cliente</div>
                  <div style={{ marginTop: 4 }}>{clienteNombre}</div>
                </div>
                <div className="tc-card" style={{ borderRadius: 18, padding: 14, background: "rgba(255,255,255,.03)" }}>
                  <div className="tc-sub">Tipo</div>
                  <div style={{ marginTop: 4 }}>
                    {clienteCompra === "si" ? "Compra minutos" : isRankFree ? "Regalo por rango · nueva tarotista" : usoSinCompra === "7free" ? "Usa 7 free iniciales" : "Usa minutos pendientes"}
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
                      Quedan pendientes: {fmtMinutes(guardarFree)} FREE · {fmtMinutes(guardarNormales)} normales
                    </div>
                  )}
                  {isRankFree ? <div className="tc-sub" style={{ marginTop: 8 }}>Código: {minutosConsumidos} FREE</div> : (toNum(minutos1) > 0 || toNum(minutos2) > 0) && (
                    <div className="tc-sub" style={{ marginTop: 8 }}>
                      Códigos: {toNum(minutos1) > 0 ? `${fmtMinutes(minutos1)} ${codigo1}` : ""}{toNum(minutos2) > 0 ? ` · ${fmtMinutes(minutos2)} ${codigo2}` : ""}
                    </div>
                  )}
                  <div className="tc-sub" style={{ marginTop: 8 }}>
                    Clasificación: {CLASIF_OPTIONS.find((x) => x.value === clasificacion)?.label || "Nada"}
                  </div>
                  {selectedCollection ? <div className="tc-sub" style={{ marginTop: 8 }}>Cobro PayPal: {collectionLabel(selectedCollection)}</div> : needsPayPalSource && collectionChoice === "external" ? <div className="tc-sub" style={{ marginTop: 8 }}>Origen: pago PayPal externo</div> : null}
                </div>
                {clasificacion === "super_promo_ruleta" && !isManualCollection ? (
                  <div className={styles.superPromoAchievement}>
                    <span className={styles.superPromoAchievementIcon} aria-hidden="true">🎡</span>
                    <div>
                      <small>SUPER PROMO RULETA</small>
                      <strong>+1 giro · Nivel Especial</strong>
                      <p>Se acreditará al guardar correctamente la llamada. No suma giros de Nivel 1, 2 ni 3.</p>
                    </div>
                  </div>
                ) : null}
                {clasificacion === "captado" ? (
                  <div className={`${styles.captureAchievement} ${captureXp?.already_awarded ? styles.captureAlreadyAwarded : ""}`}>
                    <span className={styles.captureAchievementIcon} aria-hidden="true">★</span>
                    <div>
                      <small>LOGRO DE CAPTACIÓN</small>
                      <strong>{captureXp?.eligible ? "Nueva clienta captada" : captureXp?.already_awarded ? "Captación ya premiada" : "Captación pendiente de validar"}</strong>
                      <p>{captureXp?.eligible
                        ? `+${captureXp.xp.toLocaleString("es-ES")} XP para ${captureXp.owner_name || "la primera gestora"}. La compra en tu cargo se premia por separado.`
                        : captureXp?.already_awarded
                          ? "La llamada se guardará, pero esta clienta no volverá a dar XP de captación."
                          : "Supabase comprobará la primera gestión y la primera compra real antes de conceder XP."}</p>
                    </div>
                  </div>
                ) : null}
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
              <button type="button" className={`${styles.gameButton} ${styles.primaryButton}`} onClick={submit} disabled={loading || (isRankFree && Boolean(balanceValidationError))}>{loading ? "Guardando..." : "Registrar llamada"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
