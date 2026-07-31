"use client";

import {
  ArrowLeft,
  CalendarDays,
  Mail,
  MessageCircle,
  MoreHorizontal,
  Phone,
  ShoppingBag,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import MyClientSummary from "./MyClientSummary";
import MyClientNotes from "./MyClientNotes";
import MyClientPurchases from "./MyClientPurchases";
import { getClientLifecycleStatus } from "./clientLifecycle";
import styles from "./MyClientProfile.module.css";

type ClientData = Record<string, any> & {
  id: string;
  nombre?: string | null;
  apellido?: string | null;
  telefono?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  photo_url?: string | null;
  foto_url?: string | null;
};

type PurchaseData = {
  id: string;
  created_at?: string | null;
  notas?: string | null;
  referencia_externa?: string | null;
} | null;

type SummaryData = {
  captured_at?: string | null;
  captured_by?: { id?: string | null; display_name?: string | null } | null;
  fidelity_index?: number | null;
  favorite_tarotists?: Array<{ id: string; tarotist_id: string; name: string; created_at?: string | null }>;
  available_tarotists?: Array<{ id: string; name: string }>;
  notes?: any[];
  interactions?: any[];
  calls?: any[];
  payments?: any[];
  totals?: {
    purchases?: number;
    spent?: number;
    calls?: number;
    consultations?: number;
    followUps?: number;
    messages?: number;
    minutes?: number | null;
  };
};

type TabKey = "resumen" | "seguimientos" | "compras" | "notas" | "preferencias" | "actividad";

type Props = {
  clientId: string;
  onBack: () => void;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "resumen", label: "Resumen" },
  { key: "seguimientos", label: "Seguimientos" },
  { key: "compras", label: "Compras" },
  { key: "notas", label: "Notas" },
  { key: "preferencias", label: "Preferencias" },
  { key: "actividad", label: "Actividad" },
];

function getName(client: ClientData | null) {
  if (!client) return "";
  return [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || "Clienta sin nombre";
}

function getInitials(client: ClientData | null) {
  const words = getName(client).split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "C";
}

function getPhoto(client: ClientData | null) {
  return client?.avatar_url || client?.photo_url || client?.foto_url || null;
}

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

async function token() {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.access_token || null;
}

export default function MyClientProfile({ clientId, onBack }: Props) {
  const [client, setClient] = useState<ClientData | null>(null);
  const [purchase, setPurchase] = useState<PurchaseData>(null);
  const [summary, setSummary] = useState<SummaryData>({});
  const [activeTab, setActiveTab] = useState<TabKey>("resumen");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (showLoader = true) => {
    if (showLoader) setLoading(true);
    setError("");
    try {
      const accessToken = await token();
      if (!accessToken) throw new Error("No se pudo validar la sesión.");
      const response = await fetch(`/api/central/my-clients/detail?id=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error === "CLIENT_NOT_FOUND" ? "La clienta no existe o ya no está disponible." : payload?.error || "No se pudo cargar la ficha.");
      }
      setClient(payload.cliente || null);
      setPurchase(payload.ultima_compra || null);
      setSummary(payload.resumen || {});
    } catch (loadError: any) {
      setError(loadError?.message || "No se pudo cargar la ficha.");
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load(true);
  }, [load]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(false), 250);
    };
    const channel = supabase
      .channel(`my-client-summary-${clientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "crm_client_notes", filter: `cliente_id=eq.${clientId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "client_favorite_tarotists", filter: `client_id=eq.${clientId}` }, refresh)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [clientId, load]);

  const status = useMemo(() => getClientLifecycleStatus(purchase?.created_at), [purchase?.created_at]);
  const name = getName(client);
  const photo = getPhoto(client);
  const purchaseDate = formatDate(purchase?.created_at);

  if (loading) {
    return <section className={styles.stateCard}>Cargando ficha de la clienta…</section>;
  }

  if (error || !client) {
    return (
      <section className={styles.stateCard}>
        <strong>No se pudo abrir la ficha</strong>
        <span>{error || "La clienta solicitada no está disponible."}</span>
        <button type="button" onClick={onBack}><ArrowLeft size={17} /> Volver a Mis clientas</button>
      </section>
    );
  }

  return (
    <section className={styles.profile} aria-labelledby="my-client-profile-title">
      <button type="button" className={styles.backButton} onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />
        Volver a Mis clientas
      </button>

      <div className={styles.hero}>
        <div className={styles.identity}>
          <div className={styles.avatar}>
            {photo ? <img src={photo} alt="" /> : <span>{getInitials(client)}</span>}
          </div>
          <div className={styles.identityCopy}>
            <div className={styles.nameRow}>
              <h2 id="my-client-profile-title">{name}</h2>
              <span className={`${styles.status} ${styles[status.tone]}`}>{status.label}</span>
            </div>
            <div className={styles.contactLine}>
              <Phone size={16} aria-hidden="true" />
              <span>{client.telefono || "Sin teléfono"}</span>
              {client.telefono && <MessageCircle size={17} className={styles.whatsapp} aria-label="WhatsApp" />}
            </div>
            {client.email && (
              <div className={styles.contactLine}>
                <Mail size={16} aria-hidden="true" />
                <span>{client.email}</span>
              </div>
            )}
          </div>
          <button type="button" className={styles.moreButton} aria-label="Opciones de la clienta">
            <MoreHorizontal size={21} aria-hidden="true" />
          </button>
        </div>

        <article className={styles.purchaseCard}>
          <div className={styles.purchaseIcon}><ShoppingBag size={22} aria-hidden="true" /></div>
          <div>
            <span className={styles.purchaseLabel}>ÚLTIMA COMPRA</span>
            {purchase ? (
              <>
                <strong>Minutos no disponibles</strong>
                <small><CalendarDays size={14} aria-hidden="true" /> {purchaseDate || "Fecha no disponible"}</small>
              </>
            ) : (
              <strong>Sin compras</strong>
            )}
          </div>
        </article>
      </div>

      <nav className={styles.tabs} aria-label="Secciones de la ficha">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? styles.activeTab : ""}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "resumen" ? (
        <div className={styles.summaryPanel}>
          <MyClientSummary
            clientId={clientId}
            lastPurchaseAt={purchase?.created_at}
            summary={summary}
            onRefresh={() => load(false)}
          />
        </div>
      ) : activeTab === "compras" ? (
        <div className={styles.summaryPanel}>
          <MyClientPurchases
            clientId={clientId}
            client={client}
            tarotists={(summary.available_tarotists || []).map((item: any) => ({ id: item.id, display_name: item.name }))}
            onRefresh={() => load(false)}
          />
        </div>
      ) : activeTab === "notas" ? (
        <div className={styles.summaryPanel}>
          <MyClientNotes
            clientId={clientId}
            notes={summary.notes || []}
            onRefresh={() => load(false)}
          />
        </div>
      ) : (
        <div className={styles.tabPanel}>
          <span>{TABS.find((tab) => tab.key === activeTab)?.label}</span>
          <p>Este apartado se desarrollará en una próxima fase.</p>
        </div>
      )}
    </section>
  );
}
