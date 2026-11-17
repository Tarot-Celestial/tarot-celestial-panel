"use client";

import nextDynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Landmark, LoaderCircle, LockKeyhole, ShieldCheck, Vault } from "lucide-react";
import AppHeader from "@/components/AppHeader";
import { loadPanelIdentity, panelPathForRole, panelSessionRejected, redirectToLogin } from "@/lib/panel-access";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { AccountingSnapshot, Entry, EntryInput, OptionInput } from "@/lib/accounting";
import { AccountingRequestError, accountingAccessExpired, accountingRequest, accountingSessionIdentity } from "@/features/accounting/accounting-client";
import styles from "@/features/accounting/accounting.module.css";

export const dynamic = "force-dynamic";
const Workspace = nextDynamic(() => import("@/features/accounting/AccountingWorkspace"), { ssr: false, loading: () => <div className={styles.loading}><LoaderCircle className={styles.spin} size={25} />Preparando tu contabilidad…</div> });
type SnapshotResponse = AccountingSnapshot & { ok: true; updatedAt: string };
type AccessResponse = { ok: true; configured: boolean; unlocked: boolean; expiresAt?: string };

export default function AccountingPage() {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [accessAttempt, setAccessAttempt] = useState(0);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [locking, setLocking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const epoch = useRef(0);
  const accessEpoch = useRef(0);
  const authIdentity = useRef<string | null>(null);

  const clearFinancialAccess = useCallback(() => {
    epoch.current += 1;
    accessEpoch.current += 1;
    setSnapshot(null); setUnlocked(false); setExpiresAt(null); setPassword(""); setMessage(null); setRefreshing(false);
  }, []);

  const handleError = useCallback((cause: unknown) => {
    const text = cause instanceof Error ? cause.message : "No se pudo completar la operación. Vuelve a intentarlo.";
    if (accountingAccessExpired(cause)) {
      clearFinancialAccess();
      if (cause instanceof AccountingRequestError && cause.status === 401) redirectToLogin("accounting_session");
      if (cause instanceof AccountingRequestError && cause.status === 403) setAuthorized(false);
    }
    if (cause instanceof AccountingRequestError && cause.code === "ACCOUNTING_NOT_CONFIGURED") setConfigured(false);
    setError(text);
  }, [clearFinancialAccess]);

  const refresh = useCallback(async (): Promise<SnapshotResponse> => {
    const requestEpoch = ++epoch.current;
    setRefreshing(true);
    try {
      const value = await accountingRequest<SnapshotResponse>();
      if (!Array.isArray(value.entries) || !Array.isArray(value.categories) || !Array.isArray(value.methods)) throw new Error("La respuesta de contabilidad no es válida. No se han sustituido tus datos.");
      if (epoch.current === requestEpoch) { setSnapshot(value); setError(null); }
      return value;
    } catch (cause) {
      if (epoch.current === requestEpoch) handleError(cause);
      throw cause;
    } finally { if (epoch.current === requestEpoch) setRefreshing(false); }
  }, [handleError]);

  useEffect(() => {
    let active = true;
    const principalEpoch = accessEpoch.current;
    const sb = supabaseBrowser();
    setChecking(true); setError(null);
    void (async () => {
      try {
        const identity = await loadPanelIdentity(sb);
        if (!active || principalEpoch !== accessEpoch.current) return;
        if (identity.can_admin !== true) { window.location.replace(panelPathForRole(String(identity.role || ""))); return; }
        setAuthorized(true);
        const session = await accountingRequest<AccessResponse>("/session");
        if (!active || principalEpoch !== accessEpoch.current) return;
        setConfigured(session.configured); setUnlocked(session.unlocked); setExpiresAt(session.expiresAt || null);
      } catch (cause) {
        if (!active || principalEpoch !== accessEpoch.current) return;
        if (panelSessionRejected(cause)) { redirectToLogin("accounting_access"); return; }
        handleError(cause);
      } finally { if (active && principalEpoch === accessEpoch.current) setChecking(false); }
    })();
    return () => { active = false; };
  }, [accessAttempt, handleError]);

  useEffect(() => {
    if (!unlocked) return;
    void refresh().catch(() => null);
    const onFocus = () => { if (document.visibilityState === "visible") void refresh().catch(() => null); };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, 60000);
    return () => { window.removeEventListener("focus", onFocus); window.clearInterval(timer); epoch.current += 1; };
  }, [unlocked, refresh]);

  useEffect(() => {
    if (!unlocked || !expiresAt) return;
    const delay = new Date(expiresAt).getTime() - Date.now();
    const timer = window.setTimeout(() => { clearFinancialAccess(); setError("El acceso privado ha caducado. Introduce la contraseña para continuar."); }, Math.max(0, delay));
    return () => window.clearTimeout(timer);
  }, [unlocked, expiresAt, clearFinancialAccess]);

  useEffect(() => {
    const { data } = supabaseBrowser().auth.onAuthStateChange((event, session) => {
      const identity = accountingSessionIdentity(session);
      const previousIdentity = authIdentity.current;
      authIdentity.current = identity;
      if (event === "SIGNED_OUT") { clearFinancialAccess(); setAuthorized(false); redirectToLogin("accounting_signout"); }
      else if (identity && previousIdentity !== identity && (previousIdentity || event !== "INITIAL_SESSION")) {
        clearFinancialAccess(); setAuthorized(false); setChecking(true);
        setAccessAttempt(value => value + 1);
      }
    });
    return () => { data.subscription.unsubscribe(); accessEpoch.current += 1; epoch.current += 1; };
  }, [clearFinancialAccess]);

  async function unlock(event: FormEvent) {
    event.preventDefault(); if (unlocking) return;
    const principalEpoch = accessEpoch.current;
    setUnlocking(true); setError(null);
    try {
      const session = await accountingRequest<AccessResponse>("/session", { method: "POST", body: JSON.stringify({ password }) });
      if (principalEpoch !== accessEpoch.current) return;
      setConfigured(session.configured); setUnlocked(session.unlocked); setExpiresAt(session.expiresAt || null);
    } catch (cause) { if (principalEpoch === accessEpoch.current) handleError(cause); }
    finally { setUnlocking(false); setPassword(""); }
  }

  async function lock() {
    if (locking) return;
    const principalEpoch = accessEpoch.current;
    setLocking(true); setError(null);
    try { await accountingRequest("/session", { method: "DELETE", body: "{}" }); if (principalEpoch === accessEpoch.current) clearFinancialAccess(); }
    catch (cause) { if (principalEpoch === accessEpoch.current) handleError(cause); }
    finally { setLocking(false); }
  }

  async function saveEntry(entry: EntryInput) {
    setMessage(null);
    try {
      await accountingRequest<{ ok: true; entry: Entry }>("/movimientos", { method: "POST", body: JSON.stringify(entry) });
      let fresh: SnapshotResponse;
      try { fresh = await refresh(); }
      catch { throw new Error("El servidor ha guardado el movimiento, pero no pudimos verificar la nueva lectura. Reintenta sin modificar los campos: no se duplicará."); }
      const stored = fresh.entries.find(item => item.id === entry.id);
      if (!stored || stored.voided_at || stored.amount_cents !== entry.amount_cents || stored.kind !== entry.kind) throw new Error("No se pudo verificar el movimiento guardado. Actualiza antes de registrar otra operación.");
      setMessage("Movimiento guardado y comprobado en el servidor.");
    } catch (cause) { handleError(cause); throw cause; }
  }

  async function voidEntry(id: string, reason: string) {
    setMessage(null);
    try {
      await accountingRequest("/movimientos/anular", { method: "POST", body: JSON.stringify({ id, reason }) });
      const fresh = await refresh();
      if (!fresh.entries.find(entry => entry.id === id)?.voided_at) throw new Error("No se pudo verificar la anulación. Actualiza antes de continuar.");
      setMessage("Movimiento anulado. El motivo queda guardado en el historial.");
    } catch (cause) { handleError(cause); throw cause; }
  }

  async function saveOption(option: OptionInput) {
    setMessage(null);
    try {
      const result = await accountingRequest<{ ok: true; option: { id: string } }>("/opciones", { method: "POST", body: JSON.stringify(option) });
      const fresh = await refresh();
      const saved = (option.kind === "method" ? fresh.methods : fresh.categories).find(item => item.id === result.option.id);
      if (!saved || saved.name.trim().toLocaleLowerCase("es") !== option.name.trim().toLocaleLowerCase("es") || saved.active !== option.active) throw new Error("No se pudo verificar esta opción. Actualiza antes de continuar.");
      setMessage("Opción guardada y comprobada.");
    } catch (cause) { handleError(cause); throw cause; }
  }

  if (!authorized || checking) return <div className={styles.page}><div className={styles.loading}>{error ? <><p role="alert">{error}</p><button type="button" className={styles.primary} onClick={() => setAccessAttempt(value => value + 1)}>Reintentar acceso</button><a className={styles.textButton} href="/admin"><ArrowLeft size={16} />Volver al panel</a></> : <><LoaderCircle size={27} className={styles.spin} /><p>Verificando el acceso privado…</p></>}</div></div>;

  return <div className={styles.page}><AppHeader />
    {!unlocked ? <main className={styles.gateShell}><a className={styles.backLink} href="/admin"><ArrowLeft size={16} />Volver al panel</a><section className={styles.gate}>
      <div className={styles.gateMark}><Vault size={45} strokeWidth={1.2} /><span><LockKeyhole size={15} /></span></div>
      <p className={styles.eyebrow}>CONTABILIDAD · ACCESO PRIVADO</p><h1>Bienvenido, Alex<span className={styles.goldPeriod}>.</span></h1><p className={styles.gateSubtitle}>Todo lo que entra. Todo lo que sale.<br />Y lo que guardamos para el futuro.</p>
      <div className={styles.gateBrands}><span><i className={styles.celestialDot} />Tarot Celestial</span><span><i className={styles.leonarisDot} />Tarot Leonaris</span></div>
      <form onSubmit={unlock} className={styles.gateForm}>
        <label htmlFor="accounting-password">Contraseña de contabilidad</label><div className={styles.passwordInput}><LockKeyhole size={18} /><input id="accounting-password" type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder="Introduce tu contraseña" required disabled={unlocking || !configured} maxLength={256} /><button type="button" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
        {!configured ? <p role="alert" className={styles.warning}>El acceso privado todavía no está configurado en el servidor. La contabilidad permanece bloqueada hasta activar su contraseña.</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button type="submit" className={styles.gateSubmit} disabled={unlocking || !configured || !password}>{unlocking ? <LoaderCircle size={18} className={styles.spin} /> : <ArrowRight size={18} />}{unlocking ? "Comprobando acceso…" : "Entrar a mi contabilidad"}</button>
      </form><p className={styles.gateSecurity}><ShieldCheck size={15} />Sesión de administrador + contraseña privada</p>
      <div className={styles.gateFooter}><Landmark size={14} />Dos cuentas independientes<span />Una bóveda compartida</div>
    </section></main> : snapshot ? <Workspace snapshot={snapshot} updatedAt={snapshot.updatedAt} refreshing={refreshing} locking={locking} message={message} error={error} onRefresh={refresh} onLock={lock} onSaveEntry={saveEntry} onVoidEntry={voidEntry} onSaveOption={saveOption} /> : <main className={styles.loading}>{error ? <><p role="alert">{error}</p><button type="button" className={styles.primary} onClick={() => void refresh().catch(() => null)}>Reintentar lectura</button><button type="button" className={styles.secondary} onClick={() => void lock()}>Bloquear contabilidad</button></> : <><LoaderCircle className={styles.spin} size={27} /><p>Leyendo los movimientos guardados…</p></>}</main>}
  </div>;
}
