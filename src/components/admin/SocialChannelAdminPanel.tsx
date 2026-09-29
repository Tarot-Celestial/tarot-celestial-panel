"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  Clock3,
  Eye,
  FolderOpen,
  Heart,
  ImageIcon,
  Instagram,
  LayoutDashboard,
  Link2,
  Megaphone,
  PlayCircle,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Video,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import styles from "./SocialChannelAdminPanel.module.css";
import TarotVideoStudio from "./TarotVideoStudio";

type Provider = "instagram" | "tiktok";
type Section = "resumen" | "crear" | "ia" | "programadas" | "calendario" | "publicaciones" | "promociones" | "biblioteca" | "analitica" | "conexion";

type ContentItem = {
  id: string;
  provider: Provider;
  content_type: string;
  title?: string | null;
  caption?: string | null;
  media_urls?: string[] | null;
  scheduled_at?: string | null;
  status: string;
  error_message?: string | null;
  privacy_level?: string | null;
  publish_mode?: string | null;
  external_post_id?: string | null;
  external_publish_id?: string | null;
  created_at: string;
  published_at?: string | null;
  campaign_id?: string | null;
  settings?: Record<string, any> | null;
};

type Campaign = {
  id: string;
  name: string;
  objective?: string | null;
  status: string;
  starts_at?: string | null;
  ends_at?: string | null;
  notes?: string | null;
};

type LibraryItem = {
  id: string;
  label?: string | null;
  media_type: string;
  url: string;
  thumbnail_url?: string | null;
  metadata?: Record<string, any> | null;
  created_at: string;
};

type Connection = {
  provider: Provider;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  token_expires_at?: string | null;
} | null;

type AiIdea = {
  title: string;
  content_type: string;
  hook: string;
  caption: string;
  hashtags: string[];
  cta: string;
  visual_prompt: string;
  reel_script: string;
  media_url?: string;
  media_kind?: "image" | "video";
};

type WeekItem = AiIdea & {
  day_offset: number;
  time: string;
  requires_video: boolean;
  media_url?: string;
};

type WeekPlan = {
  strategy_summary: string;
  items: WeekItem[];
};

type FlexiblePlan = {
  strategy_summary: string;
  items: WeekItem[];
};

type Props = { provider: Provider };

const sections: Array<{ key: Section; label: string; icon: any }> = [
  { key: "resumen", label: "Resumen", icon: LayoutDashboard },
  { key: "crear", label: "Crear", icon: Plus },
  { key: "ia", label: "IA Studio", icon: Sparkles },
  { key: "programadas", label: "Programadas", icon: CalendarClock },
  { key: "calendario", label: "Calendario", icon: CalendarClock },
  { key: "publicaciones", label: "Publicaciones", icon: Send },
  { key: "promociones", label: "Promociones", icon: Megaphone },
  { key: "biblioteca", label: "Biblioteca", icon: FolderOpen },
  { key: "analitica", label: "Analítica", icon: BarChart3 },
  { key: "conexion", label: "Conexión", icon: Settings2 },
];

function toLocalInput(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function localDateInput(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fmt(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function formatNumber(value: any) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? new Intl.NumberFormat("es-ES").format(n) : "0";
}

function formatPct(value: any) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(1)}%` : "—";
}

function statusLabel(s: string) {
  return ({
    draft: "Borrador",
    scheduled: "Programada",
    publishing: "Publicando",
    processing: "Procesando",
    published: "Publicada",
    failed: "Error",
    sent_to_inbox: "Enviada a TikTok",
  } as Record<string, string>)[s] || s;
}

function contentLabel(provider: Provider, type: string) {
  const labels: Record<string, string> = {
    post: "Publicación",
    reel: "Reel",
    story: "Story",
    carousel: "Carrusel",
    video: "Vídeo",
    photo: "Fotos",
  };
  return labels[type] || (provider === "instagram" ? "Publicación" : "Contenido");
}

function isVideoType(type: string) {
  return ["reel", "video"].includes(String(type || "").toLowerCase());
}
function isStoryType(type: string) {
  return String(type || "").toLowerCase() === "story";
}

function publishCaptionForIdea(idea: AiIdea) {
  if (isStoryType(idea.content_type)) return "";
  const tags = (idea.hashtags || [])
    .map((tag) => String(tag || "").trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag.replace(/\s+/g, "")}`));
  return [idea.caption?.trim(), idea.cta?.trim(), tags.join(" ")].filter(Boolean).join("\n\n");
}


function captionWithHashtags(idea: AiIdea) {
  return publishCaptionForIdea(idea);
}

function scheduledIso(startDate: string, dayOffset: number, time: string) {
  const safeTime = /^\d{2}:\d{2}$/.test(time || "") ? time : "19:30";
  const base = new Date(`${startDate}T${safeTime}:00`);
  base.setDate(base.getDate() + Number(dayOffset || 0));
  return base.toISOString();
}

function dayName(startDate: string, dayOffset: number) {
  const d = new Date(`${startDate}T12:00:00`);
  d.setDate(d.getDate() + dayOffset);
  return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "short" });
}

function currentMonthValue(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 7);
}

function shiftMonth(value: string, delta: number) {
  const [year, month] = String(value || currentMonthValue()).split("-").map(Number);
  const d = new Date(year || new Date().getFullYear(), (month || 1) - 1 + delta, 1, 12, 0, 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(value: string) {
  const [year, month] = String(value || currentMonthValue()).split("-").map(Number);
  const d = new Date(year || new Date().getFullYear(), (month || 1) - 1, 1, 12, 0, 0);
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function buildCalendarDays(monthValue: string) {
  const [year, month] = String(monthValue || currentMonthValue()).split("-").map(Number);
  const first = new Date(year || new Date().getFullYear(), (month || 1) - 1, 1, 12, 0, 0);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0, 12, 0, 0);
  const end = new Date(last);
  end.setDate(last.getDate() + (7 - ((last.getDay() + 6) % 7) - 1));
  const days: Array<{ key: string; day: number; inMonth: boolean }> = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    days.push({ key, day: cursor.getDate(), inMonth: cursor.getMonth() === first.getMonth() });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function FollowerChart({ history }: { history: any[] }) {
  const rows = (history || []).filter((x) => Number.isFinite(Number(x.followers_count))).slice(-30);
  if (rows.length < 2) {
    return <div className={styles.chartEmpty}>El histórico de seguidores empieza a guardarse desde ahora. En cuanto tengamos varios días aparecerá aquí la curva de crecimiento.</div>;
  }
  const values = rows.map((x) => Number(x.followers_count));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const points = rows.map((x, index) => {
    const px = rows.length === 1 ? 0 : (index / (rows.length - 1)) * 100;
    const py = 92 - ((Number(x.followers_count) - min) / span) * 76;
    return `${px},${py}`;
  }).join(" ");
  return (
    <div className={styles.chartBox}>
      <div className={styles.chartTop}><span>{formatNumber(min)}</span><b>{formatNumber(max)}</b></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Crecimiento de seguidores">
        <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={styles.chartLabels}><span>{rows[0]?.snapshot_date}</span><span>{rows[rows.length - 1]?.snapshot_date}</span></div>
    </div>
  );
}

export default function SocialChannelAdminPanel({ provider }: Props) {
  const searchParams = useSearchParams();
  const [section, setSection] = useState<Section>("resumen");
  const [items, setItems] = useState<ContentItem[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [connection, setConnection] = useState<Connection>(null);
  const [configured, setConfigured] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [analyticsRange, setAnalyticsRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [aiProgress, setAiProgress] = useState("");
  const [aiProgressCurrent, setAiProgressCurrent] = useState(0);
  const [aiProgressTotal, setAiProgressTotal] = useState(0);

  const [draft, setDraft] = useState<any>({
    id: "",
    content_type: provider === "instagram" ? "post" : "video",
    title: "",
    caption: "",
    media: "",
    scheduled_at: "",
    campaign_id: "",
    privacy_level: "SELF_ONLY",
    publish_mode: provider === "tiktok" ? "inbox" : "direct",
    share_to_feed: true,
    disable_comment: false,
    disable_duet: false,
    disable_stitch: false,
    is_aigc: false,
    ai_meta: null,
  });
  const [campaignDraft, setCampaignDraft] = useState<any>({ name: "", objective: "", status: "active", starts_at: "", ends_at: "", notes: "" });
  const [libraryDraft, setLibraryDraft] = useState<any>({ label: "", media_type: "image", url: "" });
  const [aiSingle, setAiSingle] = useState<any>({
    brief: "",
    objective: "ventas y engagement",
    tone: "premium, cercano y celestial",
    cta: "",
    content_type: provider === "instagram" ? "post" : "photo",
    campaign_id: "",
    quantity: 1,
  });
  const [aiIdea, setAiIdea] = useState<AiIdea | null>(null);
  const [aiSeries, setAiSeries] = useState<AiIdea[]>([]);
  const [aiSeriesSummary, setAiSeriesSummary] = useState("");
  const [weekDraft, setWeekDraft] = useState<any>({
    start_date: localDateInput(),
    brief: "",
    objective: "crecimiento, interacción y conversión",
    preferred_time: "19:30",
    mode: "automatic",
    campaign_id: "",
    generate_images: true,
  });
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null);
  const [flexDraft, setFlexDraft] = useState<any>({
    start_date: localDateInput(),
    brief: "",
    objective: "crecimiento, interacción y conversión",
    preferred_time: "19:30",
    campaign_id: "",
    days: 7,
    posts_per_day: 1,
    reels_per_day: 0,
    stories_per_day: 1,
    generate_media: true,
  });
  const [flexPlan, setFlexPlan] = useState<FlexiblePlan | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(currentMonthValue());

  const brand = provider === "instagram"
    ? { name: "Instagram", Icon: Instagram, tag: "Contenido, Reels, Stories, campañas e insights" }
    : { name: "TikTok", Icon: Video, tag: "Vídeos, fotos, programación y crecimiento" };

  const accessToken = useCallback(async () => {
    const { data } = await supabaseBrowser().auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("Sesión de administrador no disponible");
    return token;
  }, []);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const token = await accessToken();
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
      cache: "no-store",
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json?.ok === false) throw new Error(json?.error || "Error de servidor");
    return json;
  }, [accessToken]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api(`/api/admin/social-connections/status?t=${Date.now()}`);
      setConnection(status.connections?.[provider] ?? status?.[provider] ?? null);
      setConfigured(Boolean(status.configured?.[provider]));

      const results = await Promise.allSettled([
        api(`/api/admin/social-content?provider=${provider}&t=${Date.now()}`),
        api(`/api/admin/social-campaigns?provider=${provider}&t=${Date.now()}`),
        api(`/api/admin/social-library?provider=${provider}&t=${Date.now()}`),
        api(`/api/admin/social-analytics?provider=${provider}&range=${analyticsRange}&t=${Date.now()}`),
      ]);
      const [contentResult, campaignResult, libraryResult, analyticsResult] = results;
      if (contentResult.status === "fulfilled") setItems(contentResult.value.items || []);
      if (campaignResult.status === "fulfilled") setCampaigns(campaignResult.value.items || []);
      if (libraryResult.status === "fulfilled") setLibrary(libraryResult.value.items || []);
      if (analyticsResult.status === "fulfilled") setAnalytics(analyticsResult.value);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) setError(failed.reason?.message || "Algún módulo social no pudo cargar sus datos");
    } catch (e: any) {
      setError(e?.message || "No se pudo cargar el estado de conexión");
    } finally {
      setLoading(false);
    }
  }, [api, provider, analyticsRange]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const connected = searchParams?.get("social_connected");
    const oauthError = searchParams?.get("social_error");
    if (oauthError) {
      setError(oauthError);
      setMessage("");
      setSection("conexion");
    }
    if (connected === provider) {
      setMessage(`${brand.name} autorizado por OAuth. Comprobando conexión guardada…`);
      setError("");
      setSection("conexion");
      const verify = async () => {
        try {
          const status = await api(`/api/admin/social-connections/status?t=${Date.now()}`);
          const current = status.connections?.[provider] ?? status?.[provider] ?? null;
          setConnection(current);
          setConfigured(Boolean(status.configured?.[provider]));
          if (current) {
            setError("");
            setMessage(`${brand.name} conectado correctamente.`);
          } else {
            const storage = status.storage || {};
            const build = status.build ? ` · build ${status.build}` : "";
            const providers = Array.isArray(storage.providers) && storage.providers.length ? ` · proveedores: ${storage.providers.join(", ")}` : "";
            const recovery = status.recovery?.attempted ? ` · recuperación: ${status.recovery?.recovered ? "OK" : (status.recovery?.error || "no aplicada")}` : "";
            const callbackBuild = searchParams?.get("social_callback_build");
            const callbackProvider = searchParams?.get("social_callback_provider");
            const callbackInfo = callbackBuild
              ? ` · callback: ${callbackBuild}${callbackProvider ? `/${callbackProvider}` : ""}`
              : " · callback: NO IDENTIFICADO (posible despliegue antiguo)";
            setError(`${brand.name} autorizó los permisos, pero la conexión no aparece en el panel. Tabla: ${storage.table || "tc_social_connections"} · filas: ${storage.rows ?? "?"} · proyecto: ${storage.project_ref || "?"}${providers}${recovery}${build}${callbackInfo}`);
          }
        } catch (e: any) {
          setError(e?.message || "No se pudo verificar la conexión después del OAuth");
        }
      };
      const timers = [250, 1000, 2500].map((ms) => window.setTimeout(() => void verify(), ms));
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }
  }, [searchParams, provider, api, brand.name]);

  useEffect(() => {
    setDraft((v: any) => ({ ...v, id: "", content_type: provider === "instagram" ? "post" : "video", privacy_level: "SELF_ONLY", publish_mode: provider === "tiktok" ? "inbox" : "direct" }));
    setAiSingle((v: any) => ({ ...v, content_type: provider === "instagram" ? "post" : "photo" }));
    setWeekPlan(null);
    setFlexPlan(null);
    setAiIdea(null);
    setAiSeries([]);
    setAiSeriesSummary("");
  }, [provider]);

  const scheduled = useMemo(() => items.filter((x) => x.status === "scheduled"), [items]);
  const published = useMemo(() => items.filter((x) => ["published", "processing", "sent_to_inbox", "failed"].includes(x.status)), [items]);
  const activeCampaigns = useMemo(() => campaigns.filter((x) => x.status === "active").length, [campaigns]);
  const native = analytics?.native || null;
  const profile = native?.profile || {};
  const nativeMetrics = native?.metrics || {};

  const calendarItemsByDay = useMemo(() => {
    const map = new Map<string, ContentItem[]>();
    for (const item of items) {
      const base = item.scheduled_at || item.published_at || null;
      if (!base) continue;
      const d = new Date(base);
      if (!Number.isFinite(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.scheduled_at || a.published_at || a.created_at).getTime() - new Date(b.scheduled_at || b.published_at || b.created_at).getTime());
    }
    return map;
  }, [items]);

  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);

  function campaignPayload(id: string) {
    const campaign = campaigns.find((c) => c.id === id);
    return campaign ? { id: campaign.id, name: campaign.name, objective: campaign.objective, notes: campaign.notes, starts_at: campaign.starts_at, ends_at: campaign.ends_at } : null;
  }

  function editContent(item: ContentItem) {
    setDraft({
      id: item.id,
      content_type: item.content_type,
      title: item.title || "",
      caption: item.caption || "",
      media: (item.media_urls || []).join("\n"),
      scheduled_at: toLocalInput(item.scheduled_at),
      campaign_id: item.campaign_id || "",
      privacy_level: item.privacy_level || "SELF_ONLY",
      publish_mode: item.publish_mode || (provider === "tiktok" ? "inbox" : "direct"),
      share_to_feed: item.settings?.share_to_feed !== false,
      disable_comment: Boolean(item.settings?.disable_comment),
      disable_duet: Boolean(item.settings?.disable_duet),
      disable_stitch: Boolean(item.settings?.disable_stitch),
      is_aigc: Boolean(item.settings?.is_aigc),
      ai_meta: item.settings?.ai_meta || null,
    });
    setSection("crear");
  }

  async function saveContent(publishNow = false) {
    setBusy("save-content");
    setError("");
    setMessage("");
    try {
      const body = {
        ...draft,
        provider,
        media_urls: String(draft.media || "").split(/\n|,/).map((v: string) => v.trim()).filter(Boolean),
        scheduled_at: draft.scheduled_at ? new Date(draft.scheduled_at).toISOString() : null,
        settings: {
          share_to_feed: Boolean(draft.share_to_feed),
          disable_comment: Boolean(draft.disable_comment),
          disable_duet: Boolean(draft.disable_duet),
          disable_stitch: Boolean(draft.disable_stitch),
          is_aigc: Boolean(draft.is_aigc),
          brand_organic_toggle: true,
          ai_meta: draft.ai_meta || null,
        },
      };
      const saved = await api("/api/admin/social-content", { method: "POST", body: JSON.stringify(body) });
      if (publishNow && saved.item?.id) {
        await api("/api/admin/social-publish", { method: "POST", body: JSON.stringify({ id: saved.item.id }) });
        setMessage("Contenido enviado a publicación.");
      } else {
        setMessage(draft.scheduled_at ? "Publicación programada." : "Borrador guardado.");
      }
      setDraft({ id: "", content_type: provider === "instagram" ? "post" : "video", title: "", caption: "", media: "", scheduled_at: "", campaign_id: "", privacy_level: "SELF_ONLY", publish_mode: provider === "tiktok" ? "inbox" : "direct", share_to_feed: true, disable_comment: false, disable_duet: false, disable_stitch: false, is_aigc: false, ai_meta: null });
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally {
      setBusy("");
    }
  }

  async function removeContent(id: string) {
    if (!confirm("¿Eliminar este contenido?")) return;
    setBusy(id);
    try {
      await api("/api/admin/social-content", { method: "POST", body: JSON.stringify({ action: "delete", id }) });
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar");
    } finally {
      setBusy("");
    }
  }

  async function publish(id: string, action = "publish") {
    setBusy(id);
    setError("");
    try {
      await api("/api/admin/social-publish", { method: "POST", body: JSON.stringify({ id, action }) });
      setMessage(action === "refresh-status" ? "Estado actualizado." : "Publicación enviada.");
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo publicar");
    } finally {
      setBusy("");
    }
  }

  async function saveCampaign() {
    setBusy("campaign");
    try {
      await api("/api/admin/social-campaigns", { method: "POST", body: JSON.stringify({ ...campaignDraft, provider }) });
      setCampaignDraft({ name: "", objective: "", status: "active", starts_at: "", ends_at: "", notes: "" });
      setMessage("Promoción guardada.");
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar la promoción");
    } finally {
      setBusy("");
    }
  }

  async function removeCampaign(id: string) {
    if (!confirm("¿Eliminar esta promoción?")) return;
    setBusy(id);
    try {
      await api("/api/admin/social-campaigns", { method: "POST", body: JSON.stringify({ action: "delete", id }) });
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo eliminar");
    } finally {
      setBusy("");
    }
  }

  async function saveLibrary() {
    setBusy("library");
    try {
      await api("/api/admin/social-library", { method: "POST", body: JSON.stringify({ ...libraryDraft, provider }) });
      setLibraryDraft({ label: "", media_type: "image", url: "" });
      setMessage("Recurso añadido a la biblioteca.");
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar");
    } finally {
      setBusy("");
    }
  }

  function useLibraryItemInEditor(item: LibraryItem) {
    const isVideo = String(item.media_type || "").toLowerCase() === "video";
    setDraft({
      id: "",
      content_type: provider === "instagram" ? (isVideo ? "reel" : "post") : (isVideo ? "video" : "photo"),
      title: item.label || (isVideo ? "Vídeo de biblioteca" : "Imagen de biblioteca"),
      caption: "",
      media: item.url,
      scheduled_at: "",
      campaign_id: "",
      privacy_level: "SELF_ONLY",
      publish_mode: provider === "tiktok" ? "inbox" : "direct",
      share_to_feed: true,
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
      is_aigc: Boolean(item.metadata?.ai_generated),
      ai_meta: item.metadata?.ai_generated ? { ...item.metadata, source: "social_library" } : null,
    });
    setMessage(isVideo ? "Vídeo cargado en el editor. Puedes añadir texto, programarlo o publicarlo." : "Imagen cargada en el editor.");
    setSection("crear");
  }

  async function publishLibraryVideo(item: LibraryItem) {
    if (String(item.media_type || "").toLowerCase() !== "video") {
      useLibraryItemInEditor(item);
      return;
    }
    const busyKey = `library-publish-${item.id}`;
    setBusy(busyKey);
    setError("");
    setMessage("");
    try {
      const saved = await api("/api/admin/social-content", {
        method: "POST",
        body: JSON.stringify({
          provider,
          content_type: provider === "instagram" ? "reel" : "video",
          title: item.label || "Vídeo de biblioteca",
          caption: "",
          media_urls: [item.url],
          campaign_id: null,
          privacy_level: "SELF_ONLY",
          publish_mode: provider === "tiktok" ? "inbox" : "direct",
          settings: {
            is_aigc: Boolean(item.metadata?.ai_generated),
            share_to_feed: true,
            brand_organic_toggle: true,
            ai_meta: item.metadata?.ai_generated ? { ...item.metadata, source: "social_library" } : null,
          },
        }),
      });
      if (!saved.item?.id) throw new Error("No se pudo crear la publicación desde la Biblioteca.");
      await api("/api/admin/social-publish", { method: "POST", body: JSON.stringify({ id: saved.item.id }) });
      setMessage(provider === "tiktok"
        ? "Vídeo enviado a la bandeja de TikTok. Ábrelo en TikTok para revisarlo y publicarlo."
        : "Vídeo enviado a publicación en Instagram.");
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo publicar el vídeo desde la Biblioteca");
    } finally {
      setBusy("");
    }
  }

  async function connect() {
    setBusy("connect");
    try {
      const result = await api("/api/admin/social-connections/connect", { method: "POST", body: JSON.stringify({ provider }) });
      if (result.auth_url) window.location.assign(result.auth_url);
    } catch (e: any) {
      setError(e?.message || "No se pudo iniciar OAuth");
      setBusy("");
    }
  }

  async function disconnect() {
    if (!confirm(`¿Desconectar ${brand.name}?`)) return;
    setBusy("disconnect");
    try {
      await api("/api/admin/social-connections/disconnect", { method: "POST", body: JSON.stringify({ provider }) });
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo desconectar");
    } finally {
      setBusy("");
    }
  }

  function startAiProgress(total: number, initialText: string) {
    setAiProgressTotal(total);
    setAiProgressCurrent(total > 0 ? 1 : 0);
    setAiProgress(initialText);
  }

  function updateAiProgress(current: number, total: number, textLabel: string) {
    setAiProgressTotal(total);
    setAiProgressCurrent(current);
    setAiProgress(textLabel);
  }

  function clearAiProgress() {
    setAiProgress("");
    setAiProgressCurrent(0);
    setAiProgressTotal(0);
  }

  async function materializeIdeaMedia(idea: AiIdea) {
    const wantsVideo = isVideoType(idea.content_type);
    if (wantsVideo) {
      const videoResponse = await api("/api/admin/social-ai", {
        method: "POST",
        body: JSON.stringify({
          action: "video",
          provider,
          prompt: idea.reel_script || idea.visual_prompt || idea.caption || idea.title,
          label: idea.title || "Reel IA",
          format: "vertical",
          duration: 5,
          content_type: idea.content_type,
        }),
      });
      return { ...idea, media_url: videoResponse.asset.url, media_kind: "video" as const };
    }
    const format = ["story", "photo"].includes(String(idea.content_type || "")) ? "vertical" : "square";
    const imageResponse = await api("/api/admin/social-ai", {
      method: "POST",
      body: JSON.stringify({
        action: "image",
        provider,
        prompt: idea.visual_prompt || idea.caption || idea.title,
        label: idea.title || "Creatividad IA",
        format,
        quality: "medium",
        content_type: idea.content_type,
      }),
    });
    return { ...idea, media_url: imageResponse.asset.url, media_kind: imageResponse.asset.media_type === "video" ? "video" as const : "image" as const };
  }

  function pushIdeaToEditor(idea: AiIdea) {
    setDraft({
      id: "",
      content_type: idea.content_type || (provider === "instagram" ? "post" : "photo"),
      title: idea.title,
      caption: captionWithHashtags(idea),
      media: idea.media_url || "",
      scheduled_at: "",
      campaign_id: aiSingle.campaign_id || "",
      privacy_level: "SELF_ONLY",
      publish_mode: provider === "tiktok" ? "inbox" : "direct",
      share_to_feed: true,
      disable_comment: false,
      disable_duet: false,
      disable_stitch: false,
      is_aigc: true,
      ai_meta: { hook: idea.hook, visual_prompt: idea.visual_prompt, reel_script: idea.reel_script, source: "ai_studio" },
    });
    setSection("crear");
  }

  async function createIdeaAsContent(idea: AiIdea, publishNow = false, options?: { silent?: boolean; skipReload?: boolean; skipBusy?: boolean; skipSectionChange?: boolean }) {
    const silent = Boolean(options?.silent);
    if (!options?.skipBusy) setBusy(publishNow ? "ai-publish" : "ai-save");
    if (!silent) {
      setError("");
      setMessage("");
    }
    try {
      const saved = await api("/api/admin/social-content", {
        method: "POST",
        body: JSON.stringify({
          provider,
          content_type: idea.content_type,
          title: idea.title,
          caption: publishCaptionForIdea(idea),
          media_urls: idea.media_url ? [idea.media_url] : [],
          campaign_id: aiSingle.campaign_id || null,
          privacy_level: "SELF_ONLY",
          publish_mode: provider === "tiktok" ? "inbox" : "direct",
          settings: {
            is_aigc: true,
            share_to_feed: true,
            brand_organic_toggle: true,
            ai_meta: { source: "ai_studio", hook: idea.hook, visual_prompt: idea.visual_prompt, reel_script: idea.reel_script, story_caption_embedded: isStoryType(idea.content_type) },
          },
        }),
      });
      if (publishNow && saved.item?.id) {
        await api("/api/admin/social-publish", { method: "POST", body: JSON.stringify({ id: saved.item.id }) });
        if (!silent) setMessage(isStoryType(idea.content_type) ? "Story enviada a publicación." : "Contenido enviado a publicación.");
        if (!options?.skipSectionChange) setSection("publicaciones");
      } else if (!silent) {
        setMessage(isStoryType(idea.content_type) ? "Story guardada como borrador." : "Contenido guardado como borrador.");
      }
      if (!options?.skipReload) await load();
      return saved.item;
    } catch (e: any) {
      if (!silent) setError(e?.message || (publishNow ? "No se pudo publicar el contenido" : "No se pudo guardar el contenido"));
      throw e;
    } finally {
      if (!options?.skipBusy) setBusy("");
    }
  }

  async function publishSeries() {
    if (!aiSeries.length) return;
    setBusy("ai-series-publish");
    setError("");
    setMessage("");
    try {
      startAiProgress(aiSeries.length, `Publicando serie 1/${aiSeries.length}…`);
      for (let index = 0; index < aiSeries.length; index += 1) {
        const idea = aiSeries[index];
        updateAiProgress(index + 1, aiSeries.length, `Publicando ${index + 1}/${aiSeries.length}: ${idea.title || "sin título"}`);
        await createIdeaAsContent(idea, true, { silent: true, skipReload: true, skipBusy: true, skipSectionChange: true });
      }
      setMessage(`Serie publicada correctamente. ${aiSeries.length} piezas enviadas a Instagram.`);
      setSection("publicaciones");
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo publicar la serie completa");
    } finally {
      clearAiProgress();
      setBusy("");
    }
  }

  async function saveSeriesToDrafts() {
    if (!aiSeries.length) return;
    setBusy("ai-series-save");
    setError("");
    setMessage("");
    try {
      startAiProgress(aiSeries.length, `Guardando borrador 1/${aiSeries.length}…`);
      for (let index = 0; index < aiSeries.length; index += 1) {
        const idea = aiSeries[index];
        updateAiProgress(index + 1, aiSeries.length, `Guardando borrador ${index + 1}/${aiSeries.length}: ${idea.title || "sin título"}`);
        await api("/api/admin/social-content", {
          method: "POST",
          body: JSON.stringify({
            provider,
            content_type: idea.content_type,
            title: idea.title,
            caption: captionWithHashtags(idea),
            media_urls: idea.media_url ? [idea.media_url] : [],
            campaign_id: aiSingle.campaign_id || null,
            privacy_level: "SELF_ONLY",
            publish_mode: provider === "tiktok" ? "inbox" : "direct",
            settings: { is_aigc: true, share_to_feed: true, brand_organic_toggle: true, ai_meta: { source: "ai_series", hook: idea.hook, visual_prompt: idea.visual_prompt, reel_script: idea.reel_script } },
          }),
        });
      }
      setMessage(`Serie guardada. ${aiSeries.length} piezas añadidas como borradores.`);
      await load();
      setSection("crear");
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar la serie");
    } finally {
      clearAiProgress();
      setBusy("");
    }
  }

  async function generateSingleIdea() {
    if (!aiSingle.brief.trim()) {
      setError("Describe qué quieres promocionar o comunicar.");
      return;
    }
    setBusy("ai-single");
    setError("");
    setMessage("");
    setAiIdea(null);
    setAiSeries([]);
    setAiSeriesSummary("");
    try {
      const quantity = Math.max(1, Math.min(20, Number(aiSingle.quantity || 1)));
      if (quantity > 1) {
        startAiProgress(quantity, `Preparando serie 1/${quantity}…`);
        const response = await api("/api/admin/social-ai", {
          method: "POST",
          body: JSON.stringify({
            action: "series",
            provider,
            brief: aiSingle.brief,
            objective: aiSingle.objective,
            tone: aiSingle.tone,
            cta: aiSingle.cta,
            content_type: aiSingle.content_type,
            pieces_count: quantity,
            campaign: campaignPayload(aiSingle.campaign_id),
          }),
        });
        const items = Array.isArray(response.series?.items) ? response.series.items : [];
        setAiSeriesSummary(String(response.series?.strategy_summary || ""));
        const built: AiIdea[] = [];
        for (let index = 0; index < items.length; index += 1) {
          const rawIdea = items[index] as AiIdea;
          updateAiProgress(index + 1, items.length, `Generando pieza ${index + 1}/${items.length}: ${rawIdea.title || "sin título"}`);
          const ready = await materializeIdeaMedia(rawIdea);
          built.push(ready);
          setAiSeries([...built]);
        }
        setMessage(`La IA ha creado una serie completa de ${built.length} piezas listas.`);
      } else {
        startAiProgress(1, "Creando idea…");
        const response = await api("/api/admin/social-ai", {
          method: "POST",
          body: JSON.stringify({
            action: "single",
            provider,
            brief: aiSingle.brief,
            objective: aiSingle.objective,
            tone: aiSingle.tone,
            cta: aiSingle.cta,
            content_type: aiSingle.content_type,
            campaign: campaignPayload(aiSingle.campaign_id),
          }),
        });
        updateAiProgress(1, 1, "Generando creatividad final…");
        const result = response.result || {};
        const built = await materializeIdeaMedia(result);
        setAiIdea(built);
        setMessage("La IA ha creado la pieza completa: copy + creatividad final lista.");
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo generar la pieza completa");
    } finally {
      clearAiProgress();
      setBusy("");
    }
  }

  async function generateMediaForIdea() {
    if (!aiIdea?.visual_prompt && !aiIdea?.reel_script) return;
    setBusy("ai-image");
    setError("");
    try {
      startAiProgress(1, isVideoType(aiIdea.content_type) ? "Regenerando vídeo…" : "Regenerando imagen…");
      const rebuilt = await materializeIdeaMedia(aiIdea);
      setAiIdea(rebuilt);
      setMessage(isVideoType(aiIdea.content_type) ? "Vídeo regenerado y guardado en la Biblioteca multimedia." : "Imagen regenerada y guardada en la Biblioteca multimedia.");
      await load();
    } catch (e: any) {
      setError(e?.message || (isVideoType(aiIdea?.content_type || "") ? "No se pudo generar el vídeo" : "No se pudo generar la imagen"));
    } finally {
      clearAiProgress();
      setBusy("");
    }
  }

  function sendIdeaToEditor() {
    if (!aiIdea) return;
    pushIdeaToEditor(aiIdea);
  }

  async function generateWeekPlan() {
    if (!weekDraft.brief.trim()) {
      setError("Escribe el briefing de la semana: promoción, objetivo o temas que quieres trabajar.");
      return;
    }
    setBusy("ai-week");
    setWeekPlan(null);
    setError("");
    setMessage("");
    try {
      const response = await api("/api/admin/social-ai", {
        method: "POST",
        body: JSON.stringify({
          action: "week",
          provider,
          brief: weekDraft.brief,
          objective: weekDraft.objective,
          preferred_time: weekDraft.preferred_time,
          mode: weekDraft.mode,
          campaign: campaignPayload(weekDraft.campaign_id),
        }),
      });
      setWeekPlan(response.plan);
      setMessage("Semana creada. Revísala y, cuando quieras, programa las 7 piezas.");
    } catch (e: any) {
      setError(e?.message || "No se pudo crear el plan semanal");
    } finally {
      setBusy("");
    }
  }

  async function scheduleWeek() {
    if (!weekPlan?.items?.length) return;
    setBusy("ai-week-schedule");
    setError("");
    setMessage("");
    const results: string[] = [];
    try {
      const ordered = [...weekPlan.items].sort((a, b) => a.day_offset - b.day_offset);
      for (let index = 0; index < ordered.length; index += 1) {
        const item = ordered[index];
        setAiProgress(`Preparando ${index + 1} de ${ordered.length}: ${dayName(weekDraft.start_date, item.day_offset)}…`);
        let mediaUrl = item.media_url || "";
        if (!item.requires_video && weekDraft.generate_images && !mediaUrl) {
          const format = item.content_type === "story" || provider === "tiktok" ? "vertical" : "square";
          try {
            const imageResult = await api("/api/admin/social-ai", {
              method: "POST",
              body: JSON.stringify({ action: "image", provider, prompt: item.visual_prompt, label: item.title, format, quality: "medium" }),
            });
            mediaUrl = imageResult.asset.url;
          } catch (e: any) {
            results.push(`${dayName(weekDraft.start_date, item.day_offset)}: imagen pendiente (${e?.message || "error"})`);
          }
        }

        const canSchedule = Boolean(mediaUrl) && !item.requires_video;
        const contentBody = {
          provider,
          content_type: item.content_type,
          title: item.title,
          caption: captionWithHashtags(item),
          media_urls: mediaUrl ? [mediaUrl] : [],
          scheduled_at: canSchedule ? scheduledIso(weekDraft.start_date, item.day_offset, item.time || weekDraft.preferred_time) : null,
          campaign_id: weekDraft.campaign_id || null,
          privacy_level: "SELF_ONLY",
          publish_mode: provider === "tiktok" ? "inbox" : "direct",
          status: "draft",
          settings: {
            is_aigc: true,
            share_to_feed: true,
            brand_organic_toggle: true,
            ai_meta: {
              source: "ai_week",
              hook: item.hook,
              visual_prompt: item.visual_prompt,
              reel_script: item.reel_script,
              requires_video: item.requires_video,
              strategy_summary: weekPlan.strategy_summary,
            },
          },
        };
        await api("/api/admin/social-content", { method: "POST", body: JSON.stringify(contentBody) });
        results.push(`${dayName(weekDraft.start_date, item.day_offset)}: ${canSchedule ? "programada" : "guardada como borrador"}`);
      }
      setMessage(`Semana preparada. ${results.filter((x) => x.includes("programada")).length} programadas; ${results.filter((x) => x.includes("borrador") || x.includes("pendiente")).length} requieren revisión.`);
      setSection("programadas");
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo completar la programación semanal");
    } finally {
      setAiProgress("");
      setBusy("");
    }
  }

  async function generateFlexiblePlan() {
    if (provider !== "instagram") {
      setError("Este planificador avanzado está preparado para Instagram.");
      return;
    }
    if (!flexDraft.brief.trim()) {
      setError("Escribe el briefing del calendario antes de generarlo.");
      return;
    }
    setBusy("ai-flex-plan");
    setFlexPlan(null);
    setError("");
    setMessage("");
    try {
      const response = await api("/api/admin/social-ai", {
        method: "POST",
        body: JSON.stringify({
          action: "plan",
          provider,
          brief: flexDraft.brief,
          objective: flexDraft.objective,
          preferred_time: flexDraft.preferred_time,
          days: Number(flexDraft.days || 7),
          posts_per_day: Number(flexDraft.posts_per_day || 0),
          reels_per_day: Number(flexDraft.reels_per_day || 0),
          stories_per_day: Number(flexDraft.stories_per_day || 0),
          campaign: campaignPayload(flexDraft.campaign_id),
        }),
      });
      setFlexPlan(response.plan);
      setMessage("Plan generado. Si quieres, ahora puedo crear automáticamente las imágenes, los Reels y dejar todo programado.");
    } catch (e: any) {
      setError(e?.message || "No se pudo crear el calendario automático");
    } finally {
      setBusy("");
    }
  }

  async function scheduleFlexiblePlan() {
    if (!flexPlan?.items?.length) return;
    setBusy("ai-flex-schedule");
    setError("");
    setMessage("");
    const results: string[] = [];
    try {
      const ordered = [...flexPlan.items].sort((a, b) => a.day_offset - b.day_offset || String(a.time).localeCompare(String(b.time)));
      for (let index = 0; index < ordered.length; index += 1) {
        const item = ordered[index];
        setAiProgress(`Preparando ${index + 1} de ${ordered.length}: ${dayName(flexDraft.start_date, item.day_offset)} · ${item.time}`);
        let mediaUrl = item.media_url || "";
        if (flexDraft.generate_media && !mediaUrl) {
          if (item.requires_video) {
            const videoResult = await api("/api/admin/social-ai", {
              method: "POST",
              body: JSON.stringify({
                action: "video",
                provider,
                prompt: item.reel_script || item.visual_prompt,
                label: item.title,
                format: "vertical",
                duration: 5,
              }),
            });
            mediaUrl = videoResult.asset.url;
          } else {
            const format = item.content_type === "story" ? "vertical" : "square";
            const imageResult = await api("/api/admin/social-ai", {
              method: "POST",
              body: JSON.stringify({
                action: "image",
                provider,
                prompt: item.visual_prompt,
                label: item.title,
                format,
                quality: "medium",
              }),
            });
            mediaUrl = imageResult.asset.url;
          }
        }

        const canSchedule = Boolean(mediaUrl);
        await api("/api/admin/social-content", {
          method: "POST",
          body: JSON.stringify({
            provider,
            content_type: item.content_type,
            title: item.title,
            caption: captionWithHashtags(item),
            media_urls: mediaUrl ? [mediaUrl] : [],
            scheduled_at: canSchedule ? scheduledIso(flexDraft.start_date, item.day_offset, item.time || flexDraft.preferred_time) : null,
            campaign_id: flexDraft.campaign_id || null,
            privacy_level: "SELF_ONLY",
            publish_mode: provider === "tiktok" ? "inbox" : "direct",
            settings: {
              is_aigc: true,
              share_to_feed: true,
              brand_organic_toggle: true,
              ai_meta: {
                source: "ai_flexible_plan",
                hook: item.hook,
                visual_prompt: item.visual_prompt,
                reel_script: item.reel_script,
                requires_video: item.requires_video,
                strategy_summary: flexPlan.strategy_summary,
              },
            },
          }),
        });
        results.push(`${dayName(flexDraft.start_date, item.day_offset)} · ${item.time}: ${canSchedule ? "programada" : "borrador sin media"}`);
      }
      setMessage(`Calendario listo. ${results.filter((x) => x.includes("programada")).length} programadas; ${results.filter((x) => x.includes("borrador")).length} quedaron en borrador.`);
      setSection("calendario");
      setCalendarMonth(String(flexDraft.start_date || localDateInput()).slice(0, 7));
      await load();
    } catch (e: any) {
      setError(e?.message || "No se pudo generar y programar el calendario");
    } finally {
      setAiProgress("");
      setBusy("");
    }
  }


  const ContentTable = ({ rows }: { rows: ContentItem[] }) => (
    <div className={styles.tableWrap}>
      <table>
        <thead><tr><th>Contenido</th><th>Tipo</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead>
        <tbody>
          {rows.length ? rows.map((item) => (
            <tr key={item.id}>
              <td><b>{item.title || item.caption?.slice(0, 54) || "Sin título"}</b>{item.error_message && <small className={styles.errorText}>{item.error_message}</small>}</td>
              <td>{contentLabel(provider, item.content_type)}</td>
              <td><span className={`${styles.status} ${styles[`status_${item.status}`] || ""}`}>{statusLabel(item.status)}</span></td>
              <td>{fmt(item.scheduled_at || item.published_at || item.created_at)}</td>
              <td>
                <div className={styles.rowActions}>
                  <button onClick={() => editContent(item)}>Editar</button>
                  {!['published', 'processing', 'sent_to_inbox'].includes(item.status) && <button className={styles.primaryTiny} disabled={busy === item.id} onClick={() => void publish(item.id)}><PlayCircle size={13} />Publicar</button>}
                  {provider === "tiktok" && item.external_publish_id && <button disabled={busy === item.id} onClick={() => void publish(item.id, "refresh-status")}>Estado</button>}
                  <button className={styles.dangerTiny} disabled={busy === item.id} onClick={() => void removeContent(item.id)}><Trash2 size={13} /></button>
                </div>
              </td>
            </tr>
          )) : <tr><td colSpan={5} className={styles.empty}>Todavía no hay contenido en esta sección.</td></tr>}
        </tbody>
      </table>
    </div>
  );

  const Icon = brand.Icon;
  const followers = Number(profile.followers_count || 0);
  const g7 = native?.growth?.days7;
  const g30 = native?.growth?.days30;

  return (
    <div className={styles.page}>
      <section className={`${styles.hero} ${styles[provider]}`}>
        <div className={styles.heroIcon}><Icon size={28} /></div>
        <div>
          <div className={styles.eyebrow}>REDES SOCIALES · TAROT CELESTIAL</div>
          <h2>{brand.name}</h2>
          <p>{brand.tag}. Gestión propia y adaptada a Tarot Celestial.</p>
        </div>
        <div className={`${styles.connectionBadge} ${connection ? styles.connected : ""}`}><span />{connection ? `@${connection.username || connection.display_name || "conectada"}` : "Sin conectar"}</div>
      </section>

      <div className={styles.sectionNav}>
        {sections.map(({ key, label, icon: NavIcon }) => <button key={key} className={section === key ? styles.sectionActive : ""} onClick={() => setSection(key)}><NavIcon size={15} />{label}</button>)}
      </div>

      {(message || error) && <div className={`${styles.notice} ${error ? styles.noticeError : styles.noticeOk}`}>{error || message}</div>}

      {section === "resumen" && (
        <div className={styles.stack}>
          <div className={styles.metrics}>
            <article><span>Cuenta</span><strong>{connection ? "Conectada" : "Pendiente"}</strong><small>{configured ? "Credenciales listas" : "Faltan variables"}</small></article>
            <article><span>Seguidores</span><strong>{native?.connected ? formatNumber(followers) : "—"}</strong><small>{g7?.delta == null ? "histórico iniciándose" : `${g7.delta >= 0 ? "+" : ""}${formatNumber(g7.delta)} en 7 días`}</small></article>
            <article><span>Programadas</span><strong>{scheduled.length}</strong><small>pendientes de publicar</small></article>
            <article><span>Promociones</span><strong>{activeCampaigns}</strong><small>activas</small></article>
          </div>
          <div className={styles.twoCols}>
            <section className={styles.card}><h3><Clock3 size={18} /> Próximas publicaciones</h3><ContentTable rows={scheduled.slice(0, 5)} /></section>
            <section className={styles.card}>
              <h3><Sparkles size={18} /> Centro inteligente</h3>
              <div className={styles.flow}>
                <div><b>1</b><span>IA dirige el concepto del vídeo de tarot</span></div>
                <div><b>2</b><span>Runway genera el clip con tus referencias</span></div>
                <div><b>3</b><span>Puedes crear hasta 60 s en dos escenas</span></div>
                <div><b>4</b><span>El resultado queda listo para editar o enviar</span></div>
              </div>
              <button className={styles.aiCta} onClick={() => setSection("ia")}><Sparkles size={16} /> Abrir IA Studio</button>
            </section>
          </div>
        </div>
      )}

      {section === "crear" && (
        <section className={styles.card}>
          <div className={styles.cardTitle}><div><h3>Centro de contenido</h3><p>Crea o edita una publicación y decide si sale ahora o queda programada.</p></div><span className={styles.pill}>{provider.toUpperCase()}</span></div>
          <div className={styles.formGrid}>
            <label>Tipo<select value={draft.content_type} onChange={(e) => setDraft({ ...draft, content_type: e.target.value })}>{provider === "instagram" ? <><option value="post">Publicación</option><option value="reel">Reel</option><option value="story">Story</option><option value="carousel">Carrusel</option></> : <><option value="video">Vídeo</option><option value="photo">Fotos</option></>}</select></label>
            <label>Promoción<select value={draft.campaign_id} onChange={(e) => setDraft({ ...draft, campaign_id: e.target.value })}><option value="">Sin promoción</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label className={styles.full}>Título interno<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Ej. Promo último día" /></label>
            {draft.content_type === "story" ? <div className={`${styles.full} ${styles.storyNotice}`}>En las stories de Instagram el texto principal va dentro de la propia pieza. Este contenido se guardará y publicará sin caption externo. Si configuras música de fondo, la story se generará como vídeo.</div> : <label className={styles.full}>Texto / caption<textarea rows={6} value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value })} placeholder="Texto que acompañará la publicación…" /></label>}
            <label className={styles.full}>URLs públicas de imagen/vídeo<textarea rows={3} value={draft.media} onChange={(e) => setDraft({ ...draft, media: e.target.value })} placeholder="Una URL por línea. Para carrusel/fotos puedes añadir varias." /><small>Meta y TikTok deben poder descargar el recurso desde Internet.</small></label>
            <label>Programar para<input type="datetime-local" value={draft.scheduled_at} onChange={(e) => setDraft({ ...draft, scheduled_at: e.target.value })} /></label>
            {provider === "tiktok" && <><label>Modo<select value={draft.publish_mode} onChange={(e) => setDraft({ ...draft, publish_mode: e.target.value })}><option value="inbox">Enviar a bandeja TikTok (recomendado)</option><option value="direct">Publicación directa</option></select></label><label>Privacidad<select value={draft.privacy_level} onChange={(e) => setDraft({ ...draft, privacy_level: e.target.value })}><option value="SELF_ONLY">Solo yo / pruebas</option><option value="PUBLIC_TO_EVERYONE">Público</option><option value="MUTUAL_FOLLOW_FRIENDS">Amigos mutuos</option><option value="FOLLOWER_OF_CREATOR">Seguidores</option></select></label></>}
            {provider === "instagram" && <label className={styles.checkLabel}><input type="checkbox" checked={draft.share_to_feed} onChange={(e) => setDraft({ ...draft, share_to_feed: e.target.checked })} /> Mostrar Reel también en el feed</label>}
            {provider === "tiktok" && <div className={styles.checkGroup}><label><input type="checkbox" checked={draft.disable_comment} onChange={(e) => setDraft({ ...draft, disable_comment: e.target.checked })} /> Desactivar comentarios</label><label><input type="checkbox" checked={draft.disable_duet} onChange={(e) => setDraft({ ...draft, disable_duet: e.target.checked })} /> Desactivar duetos</label><label><input type="checkbox" checked={draft.disable_stitch} onChange={(e) => setDraft({ ...draft, disable_stitch: e.target.checked })} /> Desactivar stitch</label><label><input type="checkbox" checked={draft.is_aigc} onChange={(e) => setDraft({ ...draft, is_aigc: e.target.checked })} /> Contenido generado con IA</label></div>}
          </div>
          <div className={styles.actions}><button className={styles.secondary} disabled={busy === "save-content"} onClick={() => void saveContent(false)}>{draft.scheduled_at ? <CalendarClock size={16} /> : <FolderOpen size={16} />} {draft.scheduled_at ? "Guardar y programar" : "Guardar borrador"}</button><button className={styles.primary} disabled={busy === "save-content" || !connection} onClick={() => void saveContent(true)}><Send size={16} /> Publicar ahora</button></div>
        </section>
      )}

      {section === "ia" && (
        <TarotVideoStudio
          provider={provider}
          connected={Boolean(connection)}
          onRefresh={load}
          onUseInEditor={(studioResult) => {
            setDraft({
              id: "",
              content_type: provider === "instagram" ? "reel" : "video",
              title: studioResult.title || "Vídeo IA Studio",
              caption: "",
              media: studioResult.url,
              scheduled_at: "",
              campaign_id: "",
              privacy_level: "SELF_ONLY",
              publish_mode: provider === "tiktok" ? "inbox" : "direct",
              share_to_feed: true,
              disable_comment: false,
              disable_duet: false,
              disable_stitch: false,
              is_aigc: true,
              ai_meta: {
                source: "tarot_video_studio",
                model: studioResult.model,
                duration: studioResult.duration,
                prompt: studioResult.prompt,
                long_mode: studioResult.long_mode,
              },
            });
            setSection("crear");
          }}
        />
      )}

      {section === "programadas" && <section className={styles.card}><div className={styles.cardTitle}><div><h3>Calendario y programadas</h3><p>Todo lo que saldrá automáticamente mediante el worker.</p></div><button className={styles.secondary} onClick={() => setSection("crear")}><Plus size={15} />Nueva</button></div><ContentTable rows={scheduled} /></section>}
      {section === "calendario" && <section className={styles.card}><div className={styles.cardTitle}><div><h3>Vista calendario</h3><p>Aquí ves de un vistazo todo lo programado y publicado por día.</p></div><div className={styles.calendarToolbar}><button className={styles.secondary} onClick={() => setCalendarMonth((v) => shiftMonth(v, -1))}>←</button><b>{monthLabel(calendarMonth)}</b><button className={styles.secondary} onClick={() => setCalendarMonth((v) => shiftMonth(v, 1))}>→</button></div></div><div className={styles.calendarGrid}><div className={styles.calendarWeekday}>Lun</div><div className={styles.calendarWeekday}>Mar</div><div className={styles.calendarWeekday}>Mié</div><div className={styles.calendarWeekday}>Jue</div><div className={styles.calendarWeekday}>Vie</div><div className={styles.calendarWeekday}>Sáb</div><div className={styles.calendarWeekday}>Dom</div>{calendarDays.map((day) => { const dayItems = calendarItemsByDay.get(day.key) || []; return <div key={day.key} className={`${styles.calendarCell} ${day.inMonth ? "" : styles.calendarMuted}`}><div className={styles.calendarDate}><span>{day.day}</span><small>{dayItems.length ? `${dayItems.length} pieza${dayItems.length === 1 ? "" : "s"}` : ""}</small></div><div className={styles.calendarEvents}>{dayItems.slice(0, 4).map((item) => <button key={item.id} className={`${styles.calendarEvent} ${styles[`status_${item.status}`] || ""}`} onClick={() => editContent(item)}><b>{new Date(item.scheduled_at || item.published_at || item.created_at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</b><span>{item.title || contentLabel(provider, item.content_type)}</span></button>)}{dayItems.length > 4 && <div className={styles.moreEvents}>+{dayItems.length - 4} más</div>}</div></div>; })}</div></section>}
      {section === "publicaciones" && <section className={styles.card}><div className={styles.cardTitle}><div><h3>Historial de publicaciones</h3><p>Publicadas, procesando, enviadas a bandeja y errores reales de API.</p></div><button className={styles.secondary} onClick={() => void load()}><RefreshCw size={15} />Actualizar</button></div><ContentTable rows={published} /></section>}

      {section === "promociones" && <div className={styles.twoCols}>
        <section className={styles.card}><h3><Megaphone size={18} /> Crear promoción</h3><div className={styles.formStack}><label>Nombre<input value={campaignDraft.name} onChange={(e) => setCampaignDraft({ ...campaignDraft, name: e.target.value })} placeholder="Ej. Super Ruleta - Último día" /></label><label>Objetivo<input value={campaignDraft.objective} onChange={(e) => setCampaignDraft({ ...campaignDraft, objective: e.target.value })} placeholder="Ventas, alcance, captación…" /></label><div className={styles.formGrid}><label>Inicio<input type="datetime-local" value={campaignDraft.starts_at} onChange={(e) => setCampaignDraft({ ...campaignDraft, starts_at: e.target.value })} /></label><label>Fin<input type="datetime-local" value={campaignDraft.ends_at} onChange={(e) => setCampaignDraft({ ...campaignDraft, ends_at: e.target.value })} /></label></div><label>Notas<textarea rows={4} value={campaignDraft.notes} onChange={(e) => setCampaignDraft({ ...campaignDraft, notes: e.target.value })} /></label><button className={styles.primary} disabled={busy === "campaign" || !campaignDraft.name.trim()} onClick={() => void saveCampaign()}><Plus size={16} />Guardar promoción</button></div></section>
        <section className={styles.card}><h3>Promociones creadas</h3><div className={styles.campaignList}>{campaigns.length ? campaigns.map((c) => <article key={c.id}><div><strong>{c.name}</strong><span>{c.objective || "Sin objetivo"}</span><small>{fmt(c.starts_at)} → {fmt(c.ends_at)}</small></div><button onClick={() => void removeCampaign(c.id)}><Trash2 size={14} /></button></article>) : <div className={styles.empty}>Todavía no hay promociones.</div>}</div></section>
      </div>}

      {section === "biblioteca" && <div className={styles.stack}>
        <section className={styles.card}>
          <div className={styles.cardTitle}><div><h3>Biblioteca multimedia</h3><p>Reproduce tus vídeos, revisa las creatividades y publícalas directamente desde aquí.</p></div></div>
          <div className={styles.libraryForm}>
            <input value={libraryDraft.label} onChange={(e) => setLibraryDraft({ ...libraryDraft, label: e.target.value })} placeholder="Nombre del recurso" />
            <select value={libraryDraft.media_type} onChange={(e) => setLibraryDraft({ ...libraryDraft, media_type: e.target.value })}><option value="image">Imagen</option><option value="video">Vídeo</option></select>
            <input value={libraryDraft.url} onChange={(e) => setLibraryDraft({ ...libraryDraft, url: e.target.value })} placeholder="https://…" />
            <button className={styles.primary} disabled={busy === "library" || !libraryDraft.url.trim()} onClick={() => void saveLibrary()}><Plus size={15} />Añadir</button>
          </div>
        </section>
        <div className={styles.libraryGrid}>
          {library.length ? library.map((x) => {
            const video = String(x.media_type || "").toLowerCase() === "video";
            const publishBusy = busy === `library-publish-${x.id}`;
            return <article key={x.id} className={`${styles.mediaCard} ${video ? styles.mediaCardVideo : ""}`}>
              <div className={styles.libraryPreview}>
                {video
                  ? <video className={styles.libraryVideo} src={x.url} poster={x.thumbnail_url || undefined} controls playsInline preload="metadata" />
                  : <img src={x.thumbnail_url || x.url} alt={x.label || "Recurso de biblioteca"} loading="lazy" />}
                <div className={styles.libraryBadges}>
                  <span>{video ? "VÍDEO" : "IMAGEN"}</span>
                  {x.metadata?.ai_generated ? <span>IA</span> : null}
                </div>
              </div>
              <div className={styles.libraryMeta}>
                <strong>{x.label || (video ? "Vídeo" : "Imagen")}</strong>
                <span>{new Date(x.created_at).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}</span>
                <div className={styles.libraryActions}>
                  <button className={styles.libraryEditButton} onClick={() => useLibraryItemInEditor(x)}>Editar / programar</button>
                  {video && <button className={styles.libraryPublishButton} disabled={!connection || publishBusy} onClick={() => void publishLibraryVideo(x)}>
                    {publishBusy ? <><RefreshCw size={14} className={styles.spin} /> Enviando…</> : <><Send size={14} /> {provider === "tiktok" ? "Enviar a TikTok" : "Publicar ahora"}</>}
                  </button>}
                </div>
              </div>
            </article>;
          }) : <div className={styles.libraryEmpty}><FolderOpen size={28} /><p>Tu biblioteca todavía está vacía.</p></div>}
        </div>
      </div>}

      {section === "analitica" && <div className={styles.stack}>
        <section className={styles.analyticsHeader}><div><span>ANALÍTICA NATIVA</span><h3>Crecimiento y rendimiento real</h3><p>{provider === "instagram" ? "Datos de Instagram API más histórico propio de Tarot Celestial." : "Datos de TikTok Display API más histórico propio de Tarot Celestial."}</p></div><div className={styles.rangeButtons}>{[7, 30, 90].map((r) => <button key={r} className={analyticsRange === r ? styles.rangeActive : ""} onClick={() => setAnalyticsRange(r)}>{r} días</button>)}<button onClick={() => void load()}><RefreshCw size={14} /></button></div></section>

        {analytics?.native_error && <div className={`${styles.notice} ${styles.noticeError}`}>{analytics.native_error}</div>}
        {native?.warnings?.length > 0 && <div className={styles.analyticsWarning}>{native.warnings.join(" · ")}</div>}

        <div className={styles.analyticsMetrics}>
          <article><Users size={18} /><span>Seguidores</span><strong>{native?.connected ? formatNumber(profile.followers_count) : "—"}</strong><small>7d {g7?.delta == null ? "—" : `${g7.delta >= 0 ? "+" : ""}${formatNumber(g7.delta)} (${formatPct(g7.pct)})`}</small></article>
          <article><TrendingUp size={18} /><span>Crecimiento 30d</span><strong>{g30?.delta == null ? "—" : `${g30.delta >= 0 ? "+" : ""}${formatNumber(g30.delta)}`}</strong><small>{formatPct(g30?.pct)}</small></article>
          <article><Eye size={18} /><span>{provider === "instagram" ? "Visualizaciones" : "Views recientes"}</span><strong>{formatNumber(nativeMetrics.views)}</strong><small>{analyticsRange} días</small></article>
          <article><BarChart3 size={18} /><span>Alcance</span><strong>{provider === "instagram" ? formatNumber(nativeMetrics.reach) : "—"}</strong><small>{provider === "instagram" ? `${analyticsRange} días` : "TikTok no expone reach en Display API"}</small></article>
          <article><Heart size={18} /><span>Interacciones</span><strong>{formatNumber(nativeMetrics.interactions || nativeMetrics.total_interactions)}</strong><small>Engagement {nativeMetrics.engagement_rate == null ? "—" : `${Number(nativeMetrics.engagement_rate).toFixed(1)}%`}</small></article>
          <article><Send size={18} /><span>Publicaciones</span><strong>{formatNumber(profile.media_count)}</strong><small>Total en la cuenta</small></article>
        </div>

        <div className={styles.twoCols}>
          <section className={styles.card}><div className={styles.cardTitle}><div><h3><TrendingUp size={18} /> Histórico de seguidores</h3><p>Guardamos una instantánea diaria para medir crecimiento real.</p></div></div><FollowerChart history={native?.history || []} /></section>
          <section className={styles.card}><div className={styles.cardTitle}><div><h3>Detalle del periodo</h3><p>Métricas disponibles para la cuenta conectada.</p></div></div><div className={styles.metricRows}>{provider === "instagram" ? <><div><span>Cuentas alcanzadas</span><b>{formatNumber(nativeMetrics.reach)}</b></div><div><span>Cuentas que interactuaron</span><b>{formatNumber(nativeMetrics.accounts_engaged)}</b></div><div><span>Likes</span><b>{formatNumber(nativeMetrics.likes)}</b></div><div><span>Comentarios</span><b>{formatNumber(nativeMetrics.comments)}</b></div><div><span>Compartidos</span><b>{formatNumber(nativeMetrics.shares)}</b></div><div><span>Guardados</span><b>{formatNumber(nativeMetrics.saves)}</b></div><div><span>Interacciones con botones del perfil</span><b>{formatNumber(nativeMetrics.profile_links_taps)}</b></div></> : <><div><span>Likes totales de cuenta</span><b>{formatNumber(profile.likes_count)}</b></div><div><span>Siguiendo</span><b>{formatNumber(profile.following_count)}</b></div><div><span>Vídeos</span><b>{formatNumber(profile.media_count)}</b></div><div><span>Views de vídeos recientes</span><b>{formatNumber(nativeMetrics.views)}</b></div></>}</div></section>
        </div>

        <section className={styles.card}><div className={styles.cardTitle}><div><h3>Contenido con mejor rendimiento</h3><p>Últimas piezas ordenadas por interacción.</p></div></div>{native?.media?.length ? <div className={styles.topMediaGrid}>{native.media.slice(0, 8).map((m: any) => <article key={m.id}>{m.thumbnail_url ? <img src={m.thumbnail_url} alt="" /> : <div className={styles.mediaPlaceholder}><ImageIcon size={24} /></div>}<div><strong>{m.caption?.slice(0, 70) || contentLabel(provider, m.media_type)}</strong><span>{m.media_type}</span><div className={styles.mediaStats}><b>👁 {formatNumber(m.views)}</b><b>♥ {formatNumber(m.likes)}</b><b>💬 {formatNumber(m.comments)}</b><b>↗ {formatNumber(m.shares)}</b></div>{m.engagement_rate != null && <small>Engagement {Number(m.engagement_rate).toFixed(1)}%</small>}{m.permalink && <a href={m.permalink} target="_blank" rel="noreferrer">Abrir publicación</a>}</div></article>)}</div> : <div className={styles.empty}>Todavía no hay datos nativos de publicaciones disponibles.</div>}</section>

        <section className={styles.card}><h3>Actividad del gestor</h3><div className={styles.metrics}><article><span>Total contenido</span><strong>{analytics?.totals?.content || 0}</strong><small>registrado</small></article><article><span>Publicadas</span><strong>{analytics?.totals?.published || 0}</strong><small>confirmadas</small></article><article><span>Programadas</span><strong>{analytics?.totals?.scheduled || 0}</strong><small>pendientes</small></article><article><span>Errores</span><strong>{analytics?.totals?.failed || 0}</strong><small>requieren revisión</small></article></div></section>
      </div>}

      {section === "conexion" && <section className={styles.card}><div className={styles.connectionPanel}><div className={styles.connectionIcon}><Icon size={32} /></div><div><h3>Conexión oficial de {brand.name}</h3><p>OAuth propio de Tarot Celestial. Las credenciales y tokens se guardan cifrados en servidor y nunca se exponen al navegador.</p></div><span className={`${styles.bigState} ${connection ? styles.connected : ""}`}>{connection ? "CONECTADO" : "SIN CONECTAR"}</span></div><div className={styles.connectionRows}><div><span>Variables de entorno</span><b>{configured ? "Configuradas" : "Pendientes"}</b></div><div><span>Cuenta</span><b>{connection ? `@${connection.username || connection.display_name || "autorizada"}` : "—"}</b></div><div><span>Token</span><b>{connection?.token_expires_at ? `Caduca ${fmt(connection.token_expires_at)}` : "—"}</b></div></div><div className={styles.actions}>{connection ? <><button className={styles.secondary} onClick={() => void connect()} disabled={busy === "connect"}><RefreshCw size={16} />Reconectar</button><button className={styles.danger} onClick={() => void disconnect()} disabled={busy === "disconnect"}>Desconectar</button></> : <button className={styles.primary} onClick={() => void connect()} disabled={!configured || busy === "connect"}><Link2 size={16} />Conectar {brand.name}</button>}</div></section>}

      {loading && <div className={styles.loading}><RefreshCw className={styles.spin} size={18} />Actualizando datos…</div>}
      {aiProgress && ["ai-week-schedule", "ai-flex-schedule", "ai-single", "ai-image", "ai-series-save", "ai-series-publish"].includes(busy) && <div className={styles.aiProgress}><Sparkles className={styles.spin} size={18} /><div><b>{aiProgressTotal > 0 ? `${aiProgressCurrent}/${aiProgressTotal}` : "Procesando"}</b><span>{aiProgress}</span></div></div>}
    </div>
  );
}
