"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Instagram, Link2, RefreshCw, ShieldCheck, Unlink, Video } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./SocialNetworksAdminPanel.module.css";

type Provider = "instagram" | "tiktok";
type Connection = {
  provider: Provider;
  account_id?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  token_expires_at?: string | null;
  scopes?: string[] | null;
  connected_at?: string | null;
};

const META: Record<Provider, { title: string; subtitle: string; note: string; icon: any }> = {
  instagram: {
    title: "Instagram",
    subtitle: "Instagram Professional",
    note: "Base preparada para Posts, Reels, Stories, estadísticas, comentarios y mensajes según los permisos aprobados por Meta.",
    icon: Instagram,
  },
  tiktok: {
    title: "TikTok",
    subtitle: "TikTok for Developers",
    note: "Base preparada para perfil, vídeos y Content Posting API. La publicación pública depende de los scopes aprobados en TikTok.",
    icon: Video,
  },
};

function expiryLabel(value?: string | null) {
  if (!value) return "Sin caducidad informada";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Caducidad no disponible";
  return `Token hasta ${date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
}

export default function SocialNetworksAdminPanel() {
  const search = useSearchParams();
  const [connections, setConnections] = useState<Record<Provider, Connection | null>>({ instagram: null, tiktok: null });
  const [configured, setConfigured] = useState<Record<Provider, boolean>>({ instagram: false, tiktok: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const token = useCallback(async () => {
    const { data } = await supabaseBrowser().auth.getSession();
    const access = data.session?.access_token;
    if (!access) throw new Error("Sesión de administrador no disponible");
    return access;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const access = await token();
      const res = await fetch(`/api/admin/social-connections/status?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${access}` },
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "No se pudieron cargar las conexiones");
      setConnections(json.connections || { instagram: null, tiktok: null });
      setConfigured(json.configured || { instagram: false, tiktok: false });
    } catch (e: any) {
      setError(e?.message || "No se pudieron cargar las conexiones");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const connected = search.get("social_connected");
    const oauthError = search.get("social_error");
    if (connected === "instagram") setMessage("Instagram conectado correctamente.");
    if (connected === "tiktok") setMessage("TikTok conectado correctamente.");
    if (oauthError) setError(oauthError);
  }, [search]);

  const connectedCount = useMemo(() => Object.values(connections).filter(Boolean).length, [connections]);

  async function connect(provider: Provider) {
    setBusy(provider);
    setError("");
    setMessage("");
    try {
      const access = await token();
      const res = await fetch("/api/admin/social-connections/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok || !json.auth_url) throw new Error(json.error || "No se pudo iniciar la conexión");
      window.location.assign(json.auth_url);
    } catch (e: any) {
      setError(e?.message || "No se pudo iniciar la conexión");
      setBusy(null);
    }
  }

  async function disconnect(provider: Provider) {
    if (!window.confirm(`¿Desconectar ${META[provider].title} de Tarot Celestial?`)) return;
    setBusy(provider);
    setError("");
    setMessage("");
    try {
      const access = await token();
      const res = await fetch("/api/admin/social-connections/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "No se pudo desconectar");
      setMessage(`${META[provider].title} desconectado.`);
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo desconectar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div>
          <div className={styles.eyebrow}><span>✦</span> CENTRO SOCIAL · TAROT CELESTIAL</div>
          <h2>Redes sociales</h2>
          <p>Conecta las cuentas oficiales de Instagram y TikTok desde un único lugar. Los tokens quedan gestionados en servidor y nunca se exponen al navegador.</p>
        </div>
        <div className={styles.heroStatus}>
          <span>{connectedCount}/2</span>
          <small>redes conectadas</small>
        </div>
      </section>

      {(message || error) && (
        <div className={`${styles.notice} ${error ? styles.noticeError : styles.noticeOk}`}>
          {error || message}
        </div>
      )}

      <div className={styles.grid}>
        {(["instagram", "tiktok"] as Provider[]).map((provider) => {
          const item = META[provider];
          const connection = connections[provider];
          const Icon = item.icon;
          const isConnected = Boolean(connection);
          const isConfigured = configured[provider];
          return (
            <article key={provider} className={`${styles.card} ${styles[provider]}`}>
              <div className={styles.cardGlow} />
              <div className={styles.cardHeader}>
                <div className={styles.brandIcon}><Icon size={27} /></div>
                <div className={styles.brandCopy}>
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </div>
                <div className={`${styles.state} ${isConnected ? styles.stateOn : styles.stateOff}`}>
                  <span className={styles.stateDot} />
                  {isConnected ? "CONECTADO" : "SIN CONECTAR"}
                </div>
              </div>

              {isConnected ? (
                <div className={styles.profile}>
                  <div className={styles.avatar}>
                    {connection?.avatar_url ? <img src={connection.avatar_url} alt="" /> : <Icon size={30} />}
                  </div>
                  <div>
                    <strong>{connection?.display_name || connection?.username || item.title}</strong>
                    <span>{connection?.username ? `@${connection.username}` : "Cuenta autorizada"}</span>
                  </div>
                  <CheckCircle2 className={styles.check} size={22} />
                </div>
              ) : (
                <div className={styles.emptyProfile}>
                  <Link2 size={21} />
                  <div><strong>Cuenta no vinculada</strong><span>Conecta la cuenta oficial para empezar.</span></div>
                </div>
              )}

              <p className={styles.note}>{item.note}</p>

              <div className={styles.infoRows}>
                <div><span>Credenciales app</span><b className={isConfigured ? styles.good : styles.warn}>{isConfigured ? "Configuradas" : "Faltan en Vercel"}</b></div>
                <div><span>OAuth</span><b>{isConnected ? "Autorizado" : "Pendiente"}</b></div>
                <div><span>Seguridad</span><b>Server-side</b></div>
                {isConnected && <div><span>Token</span><b>{expiryLabel(connection?.token_expires_at)}</b></div>}
              </div>

              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={busy === provider || !isConfigured}
                  onClick={() => connect(provider)}
                >
                  {busy === provider ? <RefreshCw size={16} className={styles.spin} /> : <Link2 size={16} />}
                  {isConnected ? "Reconectar cuenta" : `Conectar ${item.title}`}
                </button>
                {isConnected && (
                  <button className={styles.secondary} disabled={busy === provider} onClick={() => disconnect(provider)}>
                    <Unlink size={16} /> Desconectar
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <section className={styles.securityCard}>
        <ShieldCheck size={24} />
        <div>
          <strong>Conexión segura de Tarot Celestial</strong>
          <p>OAuth real, secretos y refresh tokens solo en backend. OAuth real, secretos y refresh tokens solo en backend. Las conexiones son propias de Tarot Celestial y sirven al centro de contenido, programación, biblioteca y publicaciones.</p>
        </div>
        <button onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? styles.spin : ""} /> Actualizar estado</button>
      </section>
    </div>
  );
}
