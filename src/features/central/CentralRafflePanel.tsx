"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gift, LoaderCircle, Plus, RefreshCw, RotateCcw, Search, Ticket, UserRound, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./CentralRafflePanel.module.css";
import CentralRaffleWheel from "./CentralRaffleWheel";
import CentralRaffleHistory from "./CentralRaffleHistory";
import { eligibleEntries, type WheelEntry } from "./raffle-wheel";

const sb = supabaseBrowser();

type ClientMatch = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  auth_user_id: string | null;
};

type RaffleEntry = {
  id: string;
  raffle_number: number;
  client_id: string;
  assigned_at: string;
  client: any;
};

type RaffleState = {
  id: string;
  title: string;
  max_number: number;
  status?: string;
};

type ResetConfirmation = { raffleId: string; title: string; requestId: string };

async function accessToken() {
  return (await sb.auth.getSession()).data.session?.access_token || "";
}

function clientName(client: any) {
  return [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim() || "Cliente sin nombre";
}

export default function CentralRafflePanel() {
  const [raffle, setRaffle] = useState<RaffleState | null>(null);
  const [entries, setEntries] = useState<RaffleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [reset, setReset] = useState<ResetConfirmation | null>(null);
  const [resetError, setResetError] = useState("");
  const [historyVersion, setHistoryVersion] = useState(0);
  const [wheel, setWheel] = useState<{ id: string; title: string; entries: WheelEntry[] } | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRequest = useRef<AbortController | null>(null);
  const raffleRef = useRef<RaffleState | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const loadSequence = useRef(0);
  const refreshPending = useRef(false);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const cancelResetButton = useRef<HTMLButtonElement>(null);

  const applyState = useCallback((next: RaffleState | null, nextEntries: RaffleEntry[]) => {
    const changed = Boolean(raffleRef.current && raffleRef.current.id !== next?.id);
    raffleRef.current = next;
    setRaffle(next);
    setEntries(nextEntries);
    if (changed) {
      searchRequest.current?.abort();
      setWheel(null);
      setSelectedNumber(null);
      setPhone("");
      setMatches([]);
      setSearching(false);
      setReset(null);
      setResetError("");
      setNotice("El sorteo activo ha cambiado. Ya estás viendo el actual.");
      setHistoryVersion((value) => value + 1);
    }
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (busyRef.current) { refreshPending.current = true; return null; }
    const sequence = ++loadSequence.current;
    if (!quiet) { setLoading(true); setMessage(""); }
    try {
      const token = await accessToken();
      const response = await fetch("/api/central/raffle", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar el sorteo.");
      if (!mounted.current || sequence !== loadSequence.current || busyRef.current) return null;
      applyState(json.raffle || null, Array.isArray(json.entries) ? json.entries : []);
      if (!quiet) setMessage("");
      return { id: String(json.raffle?.id || ""), title: String(json.raffle?.title || "Sorteo actual"), entries: eligibleEntries(Array.isArray(json.entries) ? json.entries : []) };
    } catch (error: any) {
      if (mounted.current && sequence === loadSequence.current) setMessage(error?.message || "No se pudo cargar el sorteo.");
      return null;
    } finally {
      if (mounted.current && sequence === loadSequence.current) setLoading(false);
    }
  }, [applyState]);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (document.visibilityState !== "visible") { refreshPending.current = true; return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { refreshPending.current = false; void load(true); }, 300);
    };
    void load();
    const channel = sb.channel("central:raffle:active")
      .on("postgres_changes", { event: "*", schema: "public", table: "raffles" }, schedule)
      .subscribe((status) => { if (status === "SUBSCRIBED") schedule(); });
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      mounted.current = false;
      loadSequence.current++;
      if (timer) clearTimeout(timer);
      searchRequest.current?.abort();
      void sb.removeChannel(channel);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [load]);

  useEffect(() => {
    if (!reset) return;
    const dialog = resetDialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    cancelResetButton.current?.focus();
    return () => { dialog?.close(); previousFocus?.focus(); };
  }, [reset]);

  function beginMutation() {
    if (busyRef.current || loading) return false;
    busyRef.current = true;
    loadSequence.current++;
    setBusy(true);
    setMessage("");
    setNotice("");
    return true;
  }

  function finishMutation() {
    busyRef.current = false;
    if (!mounted.current) return;
    setBusy(false);
    if (refreshPending.current && document.visibilityState === "visible") {
      refreshPending.current = false;
      void load(true);
    }
  }

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    setMatches([]);
    if (!selectedNumber || digits.length < 4) {
      setSearching(false);
      return;
    }
    const timer = window.setTimeout(async () => {
      searchRequest.current?.abort();
      const controller = new AbortController();
      searchRequest.current = controller;
      setSearching(true);
      try {
        const token = await accessToken();
        const response = await fetch(`/api/central/raffle?search=${encodeURIComponent(digits)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await response.json().catch(() => null);
        if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo buscar el cliente.");
        if (!mounted.current || controller.signal.aborted || searchRequest.current !== controller) return;
        setMatches(Array.isArray(json.clients) ? json.clients : []);
      } catch (error: any) {
        if (mounted.current && searchRequest.current === controller && error?.name !== "AbortError") setMessage(error?.message || "No se pudo buscar el cliente.");
      } finally {
        if (mounted.current && searchRequest.current === controller) setSearching(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [phone, selectedNumber]);

  const entryByNumber = useMemo(() => new Map(entries.map((entry) => [Number(entry.raffle_number), entry])), [entries]);
  const batches = useMemo(() => {
    const max = Math.max(40, Number(raffle?.max_number || 40));
    return Array.from({ length: Math.ceil(max / 40) }, (_, index) => {
      const start = index * 40 + 1;
      const end = Math.min(max, start + 39);
      return { start, end, numbers: Array.from({ length: end - start + 1 }, (__, offset) => start + offset) };
    });
  }, [raffle?.max_number]);

  function openNumber(number: number) {
    if (busyRef.current || loading || entryByNumber.has(number)) return;
    setSelectedNumber(number);
    setPhone("");
    setMatches([]);
    setMessage("");
  }

  function closeSelector() {
    searchRequest.current?.abort();
    searchRequest.current = null;
    setSelectedNumber(null);
    setPhone("");
    setMatches([]);
    setSearching(false);
  }

  async function assign(client: ClientMatch) {
    const raffleId = raffleRef.current?.id;
    if (!selectedNumber || !raffleId || !beginMutation()) return;
    try {
      const token = await accessToken();
      const response = await fetch("/api/central/raffle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", raffle_id: raffleId, raffle_number: selectedNumber, client_id: client.id }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo asignar el número.");
      if (!mounted.current) return;
      setEntries((current) => [...current.filter((entry) => entry.id !== json.entry.id), json.entry].sort((a, b) => a.raffle_number - b.raffle_number));
      closeSelector();
    } catch (error: any) {
      if (mounted.current) setMessage(error?.message || "No se pudo asignar el número.");
      refreshPending.current = true;
    } finally {
      finishMutation();
    }
  }

  async function extend() {
    const raffleId = raffleRef.current?.id;
    if (!raffleId || !beginMutation()) return;
    try {
      const token = await accessToken();
      const response = await fetch("/api/central/raffle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extend", raffle_id: raffleId }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo añadir la siguiente fila.");
      if (!mounted.current) return;
      const next = raffleRef.current ? { ...raffleRef.current, max_number: Number(json.max_number) } : null;
      raffleRef.current = next;
      setRaffle(next);
    } catch (error: any) {
      if (mounted.current) setMessage(error?.message || "No se pudo añadir la siguiente fila.");
      refreshPending.current = true;
    } finally {
      finishMutation();
    }
  }

  function openReset() {
    const current = raffleRef.current;
    if (!current || busyRef.current || loading) return;
    closeSelector();
    setResetError("");
    setReset({ raffleId: current.id, title: current.title, requestId: crypto.randomUUID() });
  }

  async function confirmReset() {
    if (!reset || !beginMutation()) return;
    setResetError("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch("/api/central/raffle", {
        method: "POST",
        headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ action: "reset", raffle_id: reset.raffleId, request_id: reset.requestId, confirmed: true }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo reiniciar el sorteo.");
      if (!mounted.current) return;
      applyState(json.raffle, Array.isArray(json.entries) ? json.entries : []);
      closeSelector();
      setWheel(null);
      setReset(null);
      setNotice(json.already_reset ? "Este reinicio ya estaba completado. Estás viendo el sorteo actual." : "Nuevo sorteo preparado: 40 números libres y sin premios configurados. El anterior se conserva en el historial.");
    } catch (error: any) {
      if (mounted.current) setResetError(error?.name === "AbortError"
        ? "No hemos recibido la confirmación. Puedes reintentar esta misma operación sin crear otro sorteo."
        : error?.message || "No se pudo reiniciar el sorteo. Puedes reintentar esta confirmación.");
    } finally {
      clearTimeout(timeout);
      finishMutation();
    }
  }

  return (
    <section className={styles.root} aria-labelledby="central-raffle-title">
      <header className={styles.header}>
        <div className={styles.headerIcon}><Gift /></div>
        <div>
          <span>SORTEO CONECTADO</span>
          <div className={styles.titleRow}>
            <h2 id="central-raffle-title">{raffle?.title || "Sorteo actual"}</h2>
            <button type="button" className={styles.winnersButton} disabled={loading || busy}
              onClick={async () => { const fresh = await load(); if (fresh) setWheel(fresh); }}>✦ Elegir ganadores</button>
            <button type="button" className={styles.resetButton} disabled={loading || busy || !raffle} onClick={openReset}>
              <RotateCcw size={15} /> Reiniciar sorteo
            </button>
          </div>
          <p>Selecciona un número libre y busca al cliente por teléfono. Un mismo cliente puede participar con varios números.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading || busy}><RefreshCw className={loading ? styles.spin : undefined} /> Actualizar</button>
      </header>

      <div className={styles.legend}>
        <span><i className={styles.freeDot} /> Disponible</span>
        <span><i className={styles.usedDot} /> Utilizado</span>
        <strong>{entries.length} asignados de {raffle?.max_number || 40}</strong>
      </div>

      {message ? <div className={styles.message} role="alert">{message}</div> : null}
      {notice ? <div className={styles.success} role="status">{notice}</div> : null}
      {loading ? <div className={styles.loading}><LoaderCircle className={styles.spin} /> Preparando los números…</div> : (
        <div className={styles.batches}>
          {batches.map((batch) => (
            <section key={batch.start} className={styles.batch} aria-label={`Números ${batch.start} a ${batch.end}`}>
              <div className={styles.batchTitle}><Ticket /> Números {batch.start}–{batch.end}</div>
              <div className={styles.grid}>
                {batch.numbers.map((number) => {
                  const entry = entryByNumber.get(number);
                  const name = entry ? clientName(entry.client) : "";
                  return (
                    <button
                      type="button"
                      key={number}
                      className={entry ? styles.usedSlot : styles.freeSlot}
                      disabled={busy}
                      onClick={() => openNumber(number)}
                      aria-label={entry ? `Número ${number}, utilizado por ${name}` : `Asignar número ${number}`}
                      title={entry ? `${name} · ${entry.client?.telefono || entry.client?.telefono_normalizado || "Sin teléfono"}` : `Asignar el número ${number}`}
                    >
                      <b>{number}</b>
                      <span>{entry ? name : "Disponible"}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {!loading ? <button type="button" className={styles.extendButton} onClick={() => void extend()} disabled={busy}>
        {busy ? <LoaderCircle className={styles.spin} /> : <Plus />} Añadir siguiente fila · {Number(raffle?.max_number || 40) + 1}–{Number(raffle?.max_number || 40) + 40}
      </button> : null}

      <CentralRaffleHistory refreshKey={historyVersion} />

      {reset ? (
        <dialog ref={resetDialog} className={styles.resetDialog} aria-labelledby="raffle-reset-title" aria-describedby="raffle-reset-description"
          onCancel={(event) => { event.preventDefault(); if (!busyRef.current) setReset(null); }}
          onClick={(event) => { if (event.target === event.currentTarget && !busyRef.current) setReset(null); }}>
          <div className={styles.resetContent}>
            <span className={styles.resetIcon}><RotateCcw aria-hidden="true" /></span>
            <h3 id="raffle-reset-title">¿Estás seguro de reiniciar el sorteo?</h3>
            <p id="raffle-reset-description">Se cerrará «{reset.title}» y se abrirá un sorteo nuevo con <strong>40 números libres, sin participantes ni premios</strong>.</p>
            <p>El sorteo anterior, sus números y sus ganadores se conservarán en el historial. El nuevo sorteo comenzará sin permitir ganadores repetidos.</p>
            {resetError ? <div className={styles.message} role="alert">{resetError}</div> : null}
            <div className={styles.resetActions}>
              <button ref={cancelResetButton} type="button" className={styles.cancelReset} disabled={busy} onClick={() => setReset(null)}>Cancelar</button>
              <button type="button" className={styles.confirmReset} disabled={busy} onClick={() => void confirmReset()}>
                {busy ? <LoaderCircle size={16} className={styles.spin} aria-hidden="true" /> : <RotateCcw size={16} aria-hidden="true" />}
                {busy ? "Preparando nuevo sorteo…" : "Sí, reiniciar sorteo"}
              </button>
            </div>
          </div>
        </dialog>
      ) : null}

      {wheel ? <CentralRaffleWheel key={wheel.id} raffleId={wheel.id} title={wheel.title} entries={wheel.entries} onClose={() => setWheel(null)} /> : null}
      {selectedNumber ? (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="raffle-selector-title">
          <div className={styles.modal}>
            <button type="button" className={styles.close} disabled={busy} onClick={closeSelector} aria-label="Cerrar"><X /></button>
            <div className={styles.modalNumber}>{selectedNumber}</div>
            <span>ASIGNAR NÚMERO</span>
            <h3 id="raffle-selector-title">Busca al cliente por teléfono</h3>
            <p>Escribe al menos 4 cifras. Selecciona la ficha correcta cuando aparezca.</p>
            <label className={styles.search}>
              <Search />
              <input autoFocus inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Ej. 603391576" />
              {searching ? <LoaderCircle className={styles.spin} /> : null}
            </label>
            <div className={styles.results}>
              {matches.map((client) => (
                <button type="button" key={client.id} onClick={() => void assign(client)} disabled={busy}>
                  <UserRound />
                  <span><strong>{client.name}</strong><small>{client.phone || "Sin teléfono"}{client.email ? ` · ${client.email}` : ""}</small></span>
                  <b>Seleccionar</b>
                </button>
              ))}
              {!searching && phone.replace(/\D/g, "").length >= 4 && matches.length === 0 ? <div className={styles.empty}>No encontramos coincidencias con ese teléfono.</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
