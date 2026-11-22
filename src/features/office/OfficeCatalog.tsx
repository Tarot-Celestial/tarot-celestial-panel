"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { BookOpen, ChevronDown } from "lucide-react";
import { officeRequest } from "./office-client";
import { displayTime } from "./WorkTime";
import styles from "./OfficeWorkspace.module.css";

type Offer = {
  id: string; title: string; starts_at: string | null; ends_at: string | null;
  packages: { name?: string; description?: string; currency: string; base_minutes: number; bonus_minutes: number; price: number }[];
  scopes: { market: string; currency: string; channel: string; enabled: boolean; valid: boolean }[];
};
const path = "/api/admin/office/catalog";

export default function OfficeCatalog() {
  const [open, setOpen] = useState(false);
  return <details className={styles.detail} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><BookOpen />Catálogo de promociones<ChevronDown /></summary>
    {open && <CatalogContents />}
  </details>;
}

function CatalogContents() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [reading, setReading] = useState(true);
  const [error, setError] = useState("");
  const [generation, refresh] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setReading(true);
    setError("");
    officeRequest<{ offers: Offer[] }>(path, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setOffers(result.offers);
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo consultar el catálogo.");
    }).finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [generation]);
  return <div className={styles.catalog}>
    {notice && <p role="status">{notice}</p>}
    {reading ? <p role="status">Consultando ofertas vigentes…</p> : error ? <>
      <p role="alert">{error}</p><button type="button" onClick={() => refresh(x => x + 1)}>Volver a consultar</button>
    </> : offers.length ? offers.map(offer => <OfferCard key={offer.id} offer={offer} onSaved={message => {
      setNotice(message);
      refresh(x => x + 1);
    }} />) : <p>Sin ofertas vigentes en el catálogo.</p>}
  </div>;
}

function OfferCard({ offer, onSaved }: { offer: Offer; onSaved: (message: string) => void }) {
  const id = useId();
  const [market, setMarket] = useState("");
  const [currency, setCurrency] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const available = Array.from(new Set(offer.packages.map(p => p.currency)));
  const scopes = offer.scopes.filter(s => s.channel === "instagram");
  const currencyChoices = Array.from(new Set([...available, ...scopes.filter(s => s.enabled).map(s => s.currency)]));
  const scope = scopes.find(s => s.market.toUpperCase() === market && s.currency === currency);
  const canChange = /^[A-Z]{2}$/.test(market) && !!currency && !busy;
  async function setEnabled(enabled: boolean) {
    if (!canChange || locked.current || (enabled && !available.includes(currency))) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await officeRequest(path, { method: "POST", body: JSON.stringify({ promotion_id: offer.id, market, currency, channel: "instagram", enabled }) });
      onSaved(`${enabled ? "Autorización guardada" : "Autorización retirada"} para ${offer.title} · ${market} · ${currency}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la autorización.");
    } finally { locked.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void setEnabled(true); }
  return <article className={styles.offer}>
    <h3>{offer.title}</h3>
    {offer.starts_at && <p>Desde {displayTime(offer.starts_at)} (Madrid)</p>}
    {offer.ends_at && <p>Hasta {displayTime(offer.ends_at)} (Madrid)</p>}
    <ul>{offer.packages.map((p,i) => <li key={i}>{p.name ? p.name + " · " : ""}{p.base_minutes} min{p.bonus_minutes ? ` + ${p.bonus_minutes} de regalo` : ""} · {new Intl.NumberFormat("es-ES", { style: "currency", currency: p.currency, currencyDisplay: "code" }).format(p.price)}</li>)}</ul>
    <p>Uso en borradores de Instagram</p>
    {scopes.some(s => s.enabled) ? <ul>{scopes.filter(s => s.enabled).map(s =>
      <li key={s.market + s.currency}>{s.market.toUpperCase()} · {s.currency} · {s.valid ? "Autorizado" : "Requiere nueva autorización"}</li>)}</ul> : <p>Sin mercados autorizados.</p>}
    <form className={styles.scopeForm} onSubmit={submit}>
      <label htmlFor={id + "-market"}>Mercado (código de país)</label>
      <input id={id + "-market"} list={id + "-markets"} maxLength={2} pattern="[A-Z]{2}" required value={market}
        disabled={busy} onChange={e => setMarket(e.target.value.toUpperCase().trim())} />
      <datalist id={id + "-markets"}><option value="ES">España</option><option value="US">Estados Unidos</option><option value="PR">Puerto Rico</option></datalist>
      <label htmlFor={id + "-currency"}>Moneda de la oferta</label>
      <select id={id + "-currency"} value={currency} required disabled={busy} onChange={e => setCurrency(e.target.value)}>
        <option value="">Elegir moneda</option>{currencyChoices.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      {!(scope?.enabled && scope.valid) && <button type="submit" disabled={!canChange || !available.includes(currency)}>{busy ? "Guardando…" : "Autorizar uso en borradores"}</button>}
      {scope?.enabled && <button type="button" disabled={busy} onClick={() => setEnabled(false)}>Retirar autorización</button>}
      {error && <p role="alert">{error}</p>}
    </form>
  </article>;
}
