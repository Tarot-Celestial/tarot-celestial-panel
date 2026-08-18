"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, CheckCircle2, Coins, ExternalLink, Eye, Gift, Globe2, History, KeyRound, LoaderCircle, LockKeyhole, Search, ShieldCheck, Sparkles, LockKeyholeOpen, UserRoundCheck, WandSparkles } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./ClientWebAdminPanel.module.css";

const sb = supabaseBrowser();

type ClientWebRow = {
  id: string;
  name: string;
  email: string | null;
  auth_email: string | null;
  phone: string | null;
  business: string;
  web_access: boolean;
  auth_user_id: string | null;
  account_status: "active" | "blocked" | "no_access";
  blocked_until: string | null;
  created_at: string | null;
  crm_created_at: string | null;
  last_sign_in_at: string | null;
  last_activity_at: string | null;
  total_accesses: number;
  automatic_rank: string | null;
  effective_rank: string | null;
  rank_override: null | { intervention_type?: string; ends_at?: string | null; reason?: string | null };
  coins: number;
  coin_movements: Array<{ id: string; tipo?: string | null; puntos?: number | null; descripcion?: string | null; saldo_despues?: number | null; created_at?: string | null }>;
  minutes_free: number;
  minutes_normal: number;
  minutes_total: number;
  oracle_credits: number;
  oracle_premium_credits: number;
  oracle_free_today: number;
};

type Props = {
  onOpenCrm: (clientId: string) => void;
  onManageRank: (clientId: string) => void;
};

function rankLabel(rank: string | null) {
  const value = String(rank || "").toLowerCase();
  return value === "oro" ? "Oro" : value === "plata" ? "Plata" : value === "bronce" ? "Bronce" : "Sin rango";
}

function formatDate(value: string | null, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return withTime ? date.toLocaleString("es-ES") : date.toLocaleDateString("es-ES");
}

function statusLabel(row: ClientWebRow) {
  if (!row.web_access) return "Sin acceso web";
  return row.account_status === "blocked" ? "Bloqueada" : "Activa";
}

export default function ClientWebAdminPanel({ onOpenCrm, onManageRank }: Props) {
  const [rows, setRows] = useState<ClientWebRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [rank, setRank] = useState("all");
  const [account, setAccount] = useState("all");
  const [access, setAccess] = useState("web");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, total_pages: 1 });
  const [totals, setTotals] = useState({ web: 0, active: 0, blocked: 0, without_access: 0 });
  const [selected, setSelected] = useState<ClientWebRow | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [blockMode, setBlockMode] = useState<"temporary" | "indefinite">("temporary");
  const [blockUntil, setBlockUntil] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [giftAmount, setGiftAmount] = useState("100");
  const [giftReason, setGiftReason] = useState("");
  const [giftBusy, setGiftBusy] = useState(false);
  const [giftOperationId, setGiftOperationId] = useState(() => crypto.randomUUID());

  const token = useCallback(async () => (await sb.auth.getSession()).data.session?.access_token || "", []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const t = await token();
      const params = new URLSearchParams({ page: String(page), page_size: "20", q, rank, account, access });
      const response = await fetch(`/api/admin/client-web?${params}`, { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudieron cargar los clientes web.");
      setRows(Array.isArray(json.rows) ? json.rows : []);
      setPagination(json.pagination || { page: 1, total: 0, total_pages: 1 });
      setTotals(json.totals || { web: 0, active: 0, blocked: 0, without_access: 0 });
      setSelected((current) => current ? (json.rows || []).find((row: ClientWebRow) => row.id === current.id) || current : null);
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar los clientes web.");
    } finally {
      setLoading(false);
    }
  }, [access, account, page, q, rank, token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 350);
    };
    const channel = sb.channel("admin-client-web-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_clientes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_rank_overrides" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cliente_oracle_credit_movements" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "cliente_oraculo_diario" }, refresh)
      .subscribe();
    return () => { if (timer) window.clearTimeout(timer); void sb.removeChannel(channel); };
  }, [load]);

  const runAction = async (body: Record<string, unknown>) => {
    if (!selected) return;
    setBusy(true);
    setMessage("");
    try {
      const t = await token();
      const response = await fetch("/api/admin/client-web", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: selected.id, ...body }),
      });
      const json = await response.json();
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudo completar la acción.");
      setPasswordOpen(false);
      setBlockOpen(false);
      setPassword("");
      setConfirm("");
      setBlockReason("");
      setBlockUntil("");
      setMessage("Cambios aplicados correctamente.");
      await load();
    } catch (e: any) {
      setMessage(e?.message || "No se pudo completar la acción.");
    } finally {
      setBusy(false);
    }
  };

  const giftCoins = async () => {
    if (!selected || giftBusy) return;
    const amount = Number(giftAmount);
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
      setMessage("Introduce una cantidad entera entre 1 y 1.000.000 Coins.");
      return;
    }
    if (!giftReason.trim()) {
      setMessage("Escribe el motivo del regalo para conservar la trazabilidad.");
      return;
    }
    setGiftBusy(true);
    setMessage("");
    try {
      const t = await token();
      const response = await fetch("/api/admin/client-web", {
        method: "POST",
        headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: selected.id, action: "gift_coins", amount, reason: giftReason.trim(), operation_id: giftOperationId }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) throw new Error(json?.error || "No se pudieron entregar las Coins.");
      const balance = Math.max(0, Number(json.balance || 0));
      setRows((current) => current.map((row) => row.id === selected.id ? { ...row, coins: balance } : row));
      setSelected((current) => current ? { ...current, coins: balance } : current);
      setMessage(json.duplicated ? `Operación ya aplicada. Saldo confirmado: ${balance.toLocaleString("es-ES")} Coins.` : `✓ +${amount.toLocaleString("es-ES")} Coins entregadas. Nuevo saldo: ${balance.toLocaleString("es-ES")} Coins.`);
      setGiftAmount("100");
      setGiftReason("");
      setGiftOperationId(crypto.randomUUID());
      await load();
    } catch (cause: any) {
      setMessage(cause?.message || "No se pudieron entregar las Coins.");
    } finally {
      setGiftBusy(false);
    }
  };

  return <section className={styles.root}>
    <div className={styles.hero}>
      <div className={styles.heroIcon}><Globe2 size={26}/></div>
      <div><div className={styles.eyebrow}>CUENTAS DEL PANEL CLIENTE</div><h1>Clientes web</h1><p>Administra accesos web sin duplicar las fichas del CRM ni sus recursos.</p></div>
      <div className={styles.liveBadge}><Sparkles size={14}/> Datos reales</div>
    </div>

    <div className={styles.metrics}>
      <div><UserRoundCheck/><span>Con acceso web</span><strong>{totals.web}</strong></div>
      <div><CheckCircle2/><span>Activas</span><strong>{totals.active}</strong></div>
      <div className={styles.metricDanger}><Ban/><span>Bloqueadas</span><strong>{totals.blocked}</strong></div>
      <div><LockKeyhole/><span>Sin acceso web</span><strong>{totals.without_access}</strong></div>
    </div>

    <div className={styles.toolbar}>
      <label className={styles.search}><Search size={16}/><input value={q} onChange={(e) => { setPage(1); setQ(e.target.value); }} placeholder="Buscar nombre, email o teléfono"/></label>
      <select value={rank} onChange={(e) => { setPage(1); setRank(e.target.value); }}><option value="all">Todos los rangos</option><option value="bronce">Bronce</option><option value="plata">Plata</option><option value="oro">Oro</option></select>
      <select value={account} onChange={(e) => { setPage(1); setAccount(e.target.value); }}><option value="all">Cualquier estado</option><option value="active">Cuenta activa</option><option value="blocked">Cuenta bloqueada</option></select>
      <select value={access} onChange={(e) => { setPage(1); setAccess(e.target.value); }}><option value="web">Con acceso web</option><option value="without">Sin acceso web</option><option value="all">Todos los clientes</option></select>
    </div>

    <div className={styles.panel}>
      {loading ? <div className={styles.state}>Cargando cuentas reales…</div> : error ? <div className={`${styles.state} ${styles.error}`}>{error}</div> : rows.length === 0 ? <div className={styles.state}>No hay clientes para estos filtros.</div> : <>
        <div className={styles.tableWrap}><table><thead><tr><th>Cliente</th><th>Cuenta</th><th>Rango</th><th>Recursos</th><th>Último acceso</th><th></th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
          <td><div className={styles.clientCell}><span className={styles.avatar}>{row.name.slice(0,1).toUpperCase()}</span><div><strong>{row.name}</strong><small>{row.email || row.auth_email || "Sin email"}</small><small>{row.phone || "Sin teléfono"} · {row.business}</small></div></div></td>
          <td><span className={`${styles.status} ${row.account_status === "blocked" ? styles.blocked : row.account_status === "active" ? styles.active : styles.noAccess}`}>{statusLabel(row)}</span>{row.blocked_until ? <small className={styles.blockUntil}>Hasta {formatDate(row.blocked_until)}</small> : null}</td>
          <td><div className={`${styles.rank} ${styles[`rank_${row.effective_rank || "none"}`] || ""}`}>{rankLabel(row.effective_rank)}</div>{row.rank_override ? <small className={styles.override}>{row.rank_override.intervention_type === "permanent" ? "Administrativo" : "Temporal"}</small> : <small>Automático</small>}</td>
          <td><div className={styles.resources}><span><Coins size={14}/>{row.coins.toLocaleString("es-ES")} Coins</span><span><ShieldCheck size={14}/>{row.minutes_total} min</span><span><WandSparkles size={14}/>{row.oracle_credits} tiradas</span></div></td>
          <td><strong>{formatDate(row.last_sign_in_at)}</strong><small>{row.total_accesses} accesos registrados</small></td>
          <td><button className={styles.detailButton} onClick={() => { setSelected(row); setMessage(""); setGiftAmount("100"); setGiftReason(""); setGiftOperationId(crypto.randomUUID()); }}><Eye size={15}/> Ver detalle</button></td>
        </tr>)}</tbody></table></div>
        <div className={styles.footer}><span>{pagination.total} clientes · Página {pagination.page} de {pagination.total_pages}</span><div><button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Anterior</button><button disabled={page >= pagination.total_pages} onClick={() => setPage((p) => p + 1)}>Siguiente</button></div></div>
      </>}
    </div>

    {selected ? <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}><div className={styles.modal}>
      <div className={styles.modalHeader}><div><div className={styles.eyebrow}>CLIENTE WEB</div><h2>{selected.name}</h2><span className={`${styles.status} ${selected.account_status === "blocked" ? styles.blocked : selected.account_status === "active" ? styles.active : styles.noAccess}`}>{statusLabel(selected)}</span></div><button className={styles.close} onClick={() => setSelected(null)}>×</button></div>
      <section className={styles.coinVault} aria-labelledby="client-coins-title">
        <div className={styles.coinBalance}><div className={styles.coinIcon}><Coins/></div><div><span id="client-coins-title">COINS DE CLIENTES</span><strong>{selected.coins.toLocaleString("es-ES")} <small>Coins</small></strong><p>Saldo disponible · Fuente real del Panel Cliente</p></div><div className={styles.coinLive}><Sparkles/> Sincronizado</div></div>
        <div className={styles.coinAdmin}>
          <div className={styles.coinForm}><label><span>Cantidad</span><input type="number" min="1" max="1000000" step="1" inputMode="numeric" value={giftAmount} onChange={(event)=>setGiftAmount(event.target.value)} disabled={giftBusy}/></label><div className={styles.quickCoins}>{[50,100,250,500].map((value)=><button type="button" key={value} onClick={()=>setGiftAmount(String(value))} disabled={giftBusy}>+{value}</button>)}</div><label className={styles.coinReason}><span>Motivo / mensaje</span><input maxLength={500} value={giftReason} onChange={(event)=>setGiftReason(event.target.value)} placeholder="Gracias por tu fidelidad" disabled={giftBusy}/></label><button type="button" className={styles.giftButton} onClick={()=>void giftCoins()} disabled={giftBusy||!giftReason.trim()||!Number(giftAmount)}>{giftBusy?<LoaderCircle className={styles.spin}/>:<Gift/>}<span>{giftBusy?"Entregando…":`Regalar ${Math.max(0,Number(giftAmount)||0).toLocaleString("es-ES")} Coins`}</span></button></div>
          <div className={styles.coinHistory}><h3><History/> Últimos movimientos</h3>{selected.coin_movements?.length?selected.coin_movements.map((item)=><div key={item.id}><span><b className={item.tipo==="canjeado"?styles.negative:styles.positive}>{item.tipo==="canjeado"?"−":"+"}{Number(item.puntos||0).toLocaleString("es-ES")}</b><small>{item.descripcion||item.tipo||"Movimiento de Coins"}</small></span><time>{formatDate(item.created_at||null)}</time></div>):<p>Aún no hay movimientos registrados.</p>}</div>
        </div>
      </section>
      <div className={styles.detailGrid}>
        <div><span>ID cliente</span><strong>{selected.id}</strong></div><div><span>Email</span><strong>{selected.email || selected.auth_email || "—"}</strong></div><div><span>Teléfono</span><strong>{selected.phone || "—"}</strong></div><div><span>Negocio</span><strong>{selected.business}</strong></div>
        <div><span>Rango efectivo</span><strong>{rankLabel(selected.effective_rank)}{selected.rank_override ? selected.rank_override.intervention_type === "permanent" ? " · Administrativo" : " · Temporal" : ""}</strong></div><div><span>Rango automático</span><strong>{rankLabel(selected.automatic_rank)}</strong></div>
        <div><span>Minutos</span><strong>{selected.minutes_total} <small>({selected.minutes_free} free · {selected.minutes_normal} normales)</small></strong></div><div><span>Tiradas disponibles</span><strong>{selected.oracle_credits} <small>({selected.oracle_free_today} gratis hoy · {selected.oracle_premium_credits} compradas)</small></strong></div>
        <div><span>Cuenta creada</span><strong>{formatDate(selected.created_at)}</strong></div><div><span>Último acceso</span><strong>{formatDate(selected.last_sign_in_at)}</strong></div><div><span>Actividad CRM</span><strong>{formatDate(selected.last_activity_at)}</strong></div>
      </div>
      {selected.blocked_until ? <div className={styles.warning}><Ban size={18}/><div><strong>Acceso bloqueado</strong><span>Hasta {formatDate(selected.blocked_until)}</span></div></div> : null}
      {message ? <div className={styles.message}>{message}</div> : null}
      <div className={styles.modalActions}>
        <button onClick={() => onOpenCrm(selected.id)}><ExternalLink size={15}/> Ver ficha CRM</button>
        <button onClick={() => onManageRank(selected.id)}><ShieldCheck size={15}/> Gestionar rango</button>
        <button onClick={() => { setPasswordOpen(true); setMessage(""); }}><KeyRound size={15}/> {selected.web_access ? "Restablecer contraseña" : "Crear acceso web"}</button>
        {selected.web_access && selected.account_status !== "blocked" ? <button className={styles.dangerButton} onClick={() => { setBlockOpen(true); setMessage(""); }}><Ban size={15}/> Bloquear acceso</button> : null}
        {selected.web_access && selected.account_status === "blocked" ? <button className={styles.successButton} disabled={busy} onClick={() => void runAction({ action: "unblock" })}><LockKeyholeOpen size={15}/> Desbloquear cuenta</button> : null}
      </div>
    </div></div> : null}

    {selected && passwordOpen ? <div className={styles.backdropTop}><div className={styles.smallModal}><div className={styles.modalHeader}><div><div className={styles.eyebrow}>ACCESO SEGURO</div><h2>{selected.web_access ? "Restablecer contraseña" : "Crear acceso web"}</h2></div><button className={styles.close} onClick={() => setPasswordOpen(false)}>×</button></div><p>{selected.web_access ? "La contraseña actual nunca se muestra ni se recupera. Solo se establecerá una nueva." : "Se creará o enlazará de forma segura la cuenta web de esta clienta sin duplicar su ficha CRM."}</p><label>Nueva contraseña<input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)}/></label><label>Confirmar contraseña<input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)}/></label>{message ? <div className={styles.message}>{message}</div> : null}<div className={styles.dialogActions}><button onClick={() => setPasswordOpen(false)}>Cancelar</button><button className={styles.primaryButton} disabled={busy || password.length < 8 || password !== confirm} onClick={() => void runAction({ action: selected.web_access ? "password" : "create_access", password, confirm })}>{busy ? (selected.web_access ? "Cambiando…" : "Creando…") : (selected.web_access ? "Cambiar contraseña" : "Crear acceso web")}</button></div></div></div> : null}

    {selected && blockOpen ? <div className={styles.backdropTop}><div className={styles.smallModal}><div className={styles.modalHeader}><div><div className={styles.eyebrow}>CONTROL DE ACCESO</div><h2>Bloquear cuenta</h2></div><button className={styles.close} onClick={() => setBlockOpen(false)}>×</button></div><p>El cliente no podrá iniciar sesión, pero conservará CRM, compras, Coins, minutos, tiradas y rango.</p><label>Tipo de bloqueo<select value={blockMode} onChange={(e) => setBlockMode(e.target.value as "temporary" | "indefinite")}><option value="temporary">Temporal</option><option value="indefinite">Indefinido</option></select></label>{blockMode === "temporary" ? <label>Bloqueado hasta<input type="datetime-local" value={blockUntil} onChange={(e) => setBlockUntil(e.target.value)}/></label> : null}<label>Motivo<textarea rows={3} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Motivo administrativo (opcional)"/></label>{message ? <div className={styles.message}>{message}</div> : null}<div className={styles.dialogActions}><button onClick={() => setBlockOpen(false)}>Cancelar</button><button className={styles.dangerButton} disabled={busy || (blockMode === "temporary" && !blockUntil)} onClick={() => void runAction({ action: "block", mode: blockMode, until: blockMode === "temporary" ? new Date(blockUntil).toISOString() : null, reason: blockReason })}>{busy ? "Bloqueando…" : "Bloquear acceso"}</button></div></div></div> : null}
  </section>;
}
