"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gift, LoaderCircle, Plus, RefreshCw, Search, Ticket, UserRound, X } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./CentralRafflePanel.module.css";
import CentralRaffleWheel from "./CentralRaffleWheel";
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
};

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
  const [wheel, setWheel] = useState<{ id: string; title: string; entries: WheelEntry[] } | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<ClientMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRequest = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/central/raffle", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo cargar el sorteo.");
      setRaffle(json.raffle || null);
      setEntries(Array.isArray(json.entries) ? json.entries : []);
      return { id: String(json.raffle?.id || ""), title: String(json.raffle?.title || "Sorteo actual"), entries: eligibleEntries(Array.isArray(json.entries) ? json.entries : []) };
    } catch (error: any) {
      setMessage(error?.message || "No se pudo cargar el sorteo.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => searchRequest.current?.abort(), []);

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
        setMatches(Array.isArray(json.clients) ? json.clients : []);
      } catch (error: any) {
        if (error?.name !== "AbortError") setMessage(error?.message || "No se pudo buscar el cliente.");
      } finally {
        if (searchRequest.current === controller) setSearching(false);
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
    if (entryByNumber.has(number)) return;
    setSelectedNumber(number);
    setPhone("");
    setMatches([]);
    setMessage("");
  }

  function closeSelector() {
    searchRequest.current?.abort();
    setSelectedNumber(null);
    setPhone("");
    setMatches([]);
    setSearching(false);
  }

  async function assign(client: ClientMatch) {
    if (!selectedNumber || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/central/raffle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign", raffle_number: selectedNumber, client_id: client.id }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo asignar el número.");
      setEntries((current) => [...current, json.entry].sort((a, b) => a.raffle_number - b.raffle_number));
      closeSelector();
    } catch (error: any) {
      setMessage(error?.message || "No se pudo asignar el número.");
    } finally {
      setBusy(false);
    }
  }

  async function extend() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const token = await accessToken();
      const response = await fetch("/api/central/raffle", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "extend" }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo añadir la siguiente fila.");
      setRaffle((current) => current ? { ...current, max_number: Number(json.max_number) } : current);
    } catch (error: any) {
      setMessage(error?.message || "No se pudo añadir la siguiente fila.");
    } finally {
      setBusy(false);
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

      {wheel ? <CentralRaffleWheel key={wheel.id} raffleId={wheel.id} title={wheel.title} entries={wheel.entries} onClose={() => setWheel(null)} /> : null}
      {selectedNumber ? (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby="raffle-selector-title">
          <div className={styles.modal}>
            <button type="button" className={styles.close} onClick={closeSelector} aria-label="Cerrar"><X /></button>
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
