import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret, type SocialProvider } from "@/lib/server/social-connections";

type SocialConnectionSecret = {
  provider: SocialProvider;
  account_id: string | null;
  username: string | null;
  access_token_ciphertext: string;
};

type SnapshotInput = {
  followers_count?: number | null;
  following_count?: number | null;
  media_count?: number | null;
  likes_count?: number | null;
  metrics?: Record<string, any>;
};

const n = (value: any) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

function graphBase() {
  return (process.env.INSTAGRAM_GRAPH_BASE || "https://graph.instagram.com").replace(/\/$/, "");
}
function graphVersion() {
  return (process.env.META_GRAPH_API_VERSION || "v24.0").trim();
}

async function getConnection(provider: SocialProvider) {
  const { data, error } = await supabaseAdmin()
    .from("tc_social_connections")
    .select("provider,account_id,username,access_token_ciphertext")
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw error;
  if (!data?.access_token_ciphertext) return null;
  const token = decryptSecret(data.access_token_ciphertext);
  if (!token) return null;
  return { ...(data as SocialConnectionSecret), accessToken: token };
}

async function igGet(path: string, token: string) {
  const url = `${graphBase()}/${graphVersion()}/${path.replace(/^\//, "")}`;
  const response = await fetch(url, { cache: "no-store" });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok || json?.error) {
    const error = new Error(json?.error?.message || `Instagram API ${response.status}`) as Error & { code?: string };
    error.code = String(json?.error?.code || response.status);
    throw error;
  }
  return json;
}

async function ttGet(path: string, token: string) {
  const response = await fetch(`https://open.tiktokapis.com${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok || (json?.error?.code && json.error.code !== "ok")) {
    throw new Error(json?.error?.message || json?.error_description || `TikTok API ${response.status}`);
  }
  return json;
}

async function ttPost(path: string, token: string, body: any) {
  const response = await fetch(`https://open.tiktokapis.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  if (!response.ok || (json?.error?.code && json.error.code !== "ok")) {
    throw new Error(json?.error?.message || json?.error_description || `TikTok API ${response.status}`);
  }
  return json;
}

function dateRange(days: number) {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - Math.max(1, Math.min(90, days)));
  return {
    since: since.toISOString().slice(0, 10),
    until: until.toISOString().slice(0, 10),
  };
}

function parseInsightRows(rows: any[]) {
  const out: Record<string, number> = {};
  for (const row of rows || []) {
    const name = String(row?.name || "");
    if (!name) continue;
    if (typeof row?.total_value?.value === "number") out[name] = n(row.total_value.value);
    else if (Array.isArray(row?.values)) out[name] = row.values.reduce((sum: number, item: any) => sum + n(item?.value), 0);
  }
  return out;
}

async function instagramAccountInsights(accountId: string, token: string, days: number, warnings: string[]) {
  const { since, until } = dateRange(days);
  const wanted = [
    "views",
    "reach",
    "accounts_engaged",
    "total_interactions",
    "likes",
    "comments",
    "shares",
    "saves",
    "replies",
    "profile_links_taps",
  ];
  const params = new URLSearchParams({
    metric: wanted.join(","),
    period: "day",
    metric_type: "total_value",
    since,
    until,
    access_token: token,
  });
  try {
    const json = await igGet(`${accountId}/insights?${params.toString()}`, token);
    return parseInsightRows(json?.data || []);
  } catch (groupError: any) {
    warnings.push(`Meta no aceptó el grupo completo de insights: ${String(groupError?.message || groupError).slice(0, 160)}`);
    const result: Record<string, number> = {};
    for (const metric of wanted) {
      try {
        const one = new URLSearchParams({ metric, period: "day", metric_type: "total_value", since, until, access_token: token });
        const json = await igGet(`${accountId}/insights?${one.toString()}`, token);
        Object.assign(result, parseInsightRows(json?.data || []));
      } catch {
        // Meta no expone todas las métricas para todas las cuentas/periodos.
      }
    }
    return result;
  }
}

async function instagramMedia(accountId: string, token: string, warnings: string[]) {
  const params = new URLSearchParams({
    fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
    limit: "12",
    access_token: token,
  });
  let rows: any[] = [];
  try {
    const json = await igGet(`${accountId}/media?${params.toString()}`, token);
    rows = Array.isArray(json?.data) ? json.data : [];
  } catch (error: any) {
    warnings.push(`No se pudo leer el contenido reciente de Instagram: ${String(error?.message || error).slice(0, 160)}`);
    return [];
  }

  const enriched: any[] = [];
  for (const row of rows.slice(0, 8)) {
    let insights: Record<string, number> = {};
    try {
      const q = new URLSearchParams({ metric: "views,reach,total_interactions,saved,shares", access_token: token });
      const json = await igGet(`${row.id}/insights?${q.toString()}`, token);
      insights = parseInsightRows(json?.data || []);
    } catch {
      try {
        const q = new URLSearchParams({ metric: "views,reach", access_token: token });
        const json = await igGet(`${row.id}/insights?${q.toString()}`, token);
        insights = parseInsightRows(json?.data || []);
      } catch {
        // Likes y comentarios del objeto media siguen siendo útiles aunque insights no esté disponible.
      }
    }
    const likes = n(row.like_count);
    const comments = n(row.comments_count);
    const saved = n(insights.saved);
    const shares = n(insights.shares);
    const reach = n(insights.reach);
    const interactions = n(insights.total_interactions) || likes + comments + saved + shares;
    enriched.push({
      id: row.id,
      caption: row.caption || "",
      media_type: row.media_product_type || row.media_type || "MEDIA",
      permalink: row.permalink || null,
      thumbnail_url: row.thumbnail_url || row.media_url || null,
      timestamp: row.timestamp || null,
      likes,
      comments,
      saved,
      shares,
      views: n(insights.views),
      reach,
      interactions,
      engagement_rate: reach > 0 ? (interactions / reach) * 100 : null,
    });
  }
  return enriched.sort((a, b) => b.interactions - a.interactions);
}

async function saveSnapshot(provider: SocialProvider, input: SnapshotInput) {
  try {
    const db = supabaseAdmin();
    const snapshotDate = new Date().toISOString().slice(0, 10);
    await db.from("tc_social_metric_snapshots").upsert({
      provider,
      snapshot_date: snapshotDate,
      captured_at: new Date().toISOString(),
      followers_count: input.followers_count ?? null,
      following_count: input.following_count ?? null,
      media_count: input.media_count ?? null,
      likes_count: input.likes_count ?? null,
      metrics: input.metrics || {},
    }, { onConflict: "provider,snapshot_date" });
  } catch {
    // El panel sigue funcionando aunque todavía no se haya ejecutado el SQL de snapshots.
  }
}

async function snapshotHistory(provider: SocialProvider, days = 90) {
  try {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    const { data, error } = await supabaseAdmin()
      .from("tc_social_metric_snapshots")
      .select("snapshot_date,captured_at,followers_count,following_count,media_count,likes_count,metrics")
      .eq("provider", provider)
      .gte("snapshot_date", since.toISOString().slice(0, 10))
      .order("snapshot_date", { ascending: true });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

function growthFromHistory(history: any[], currentFollowers: number, days: number) {
  if (!history.length || !currentFollowers) return { delta: null, pct: null };
  const target = new Date();
  target.setUTCDate(target.getUTCDate() - days);
  const targetMs = target.getTime();
  const candidates = history
    .filter((row) => row.followers_count != null)
    .map((row) => ({ ...row, ms: new Date(`${row.snapshot_date}T00:00:00Z`).getTime() }))
    .sort((a, b) => Math.abs(a.ms - targetMs) - Math.abs(b.ms - targetMs));
  const base = n(candidates[0]?.followers_count);
  if (!base) return { delta: null, pct: null };
  const delta = currentFollowers - base;
  return { delta, pct: (delta / base) * 100 };
}

async function instagramAnalytics(days: number) {
  const warnings: string[] = [];
  const conn = await getConnection("instagram");
  if (!conn) return { connected: false, warnings: ["Instagram no está conectado."] };
  const token = conn.accessToken;
  let profile: any = {};
  for (const fields of [
    "id,username,name,profile_picture_url,followers_count,follows_count,media_count",
    "id,username,name,followers_count,follows_count,media_count",
    "id,username,name,followers_count,media_count",
  ]) {
    try {
      const q = new URLSearchParams({ fields, access_token: token });
      profile = await igGet(`me?${q.toString()}`, token);
      if (profile?.id) break;
    } catch (error: any) {
      warnings.push(String(error?.message || error).slice(0, 160));
    }
  }
  const accountId = String(profile?.id || conn.account_id || "");
  if (!accountId) throw new Error("Instagram conectado, pero no hay account_id para consultar analítica.");
  const metrics = await instagramAccountInsights(accountId, token, days, warnings);
  const media = await instagramMedia(accountId, token, warnings);
  const followers = n(profile.followers_count);
  await saveSnapshot("instagram", {
    followers_count: followers || null,
    following_count: n(profile.follows_count) || null,
    media_count: n(profile.media_count) || null,
    metrics,
  });
  const history = await snapshotHistory("instagram", 90);
  const g7 = growthFromHistory(history, followers, 7);
  const g30 = growthFromHistory(history, followers, 30);
  const mediaInteractions = media.reduce((sum, item) => sum + n(item.interactions), 0);
  const mediaViews = media.reduce((sum, item) => sum + n(item.views), 0);
  const accountInteractions = n(metrics.total_interactions) || n(metrics.likes) + n(metrics.comments) + n(metrics.shares) + n(metrics.saves) + n(metrics.replies);
  const interactions = accountInteractions || mediaInteractions;
  const reach = n(metrics.reach);
  const views = n(metrics.views) || mediaViews;
  return {
    connected: true,
    source: "instagram_api",
    profile: {
      id: accountId,
      username: profile.username || conn.username || null,
      name: profile.name || null,
      avatar_url: profile.profile_picture_url || null,
      followers_count: followers,
      following_count: n(profile.follows_count),
      media_count: n(profile.media_count),
    },
    metrics: { ...metrics, views, interactions, recent_media_interactions: mediaInteractions, engagement_rate: reach > 0 ? (interactions / reach) * 100 : (views > 0 ? (interactions / views) * 100 : null) },
    growth: { days7: g7, days30: g30 },
    history,
    media,
    warnings: Array.from(new Set(warnings)).slice(0, 5),
  };
}

async function tiktokAnalytics(days: number) {
  const warnings: string[] = [];
  const conn = await getConnection("tiktok");
  if (!conn) return { connected: false, warnings: ["TikTok no está conectado."] };
  const token = conn.accessToken;
  let profile: any = {};
  try {
    const fields = "open_id,display_name,avatar_url,username,follower_count,following_count,likes_count,video_count";
    const json = await ttGet(`/v2/user/info/?fields=${encodeURIComponent(fields)}`, token);
    profile = json?.data?.user || {};
  } catch (error: any) {
    warnings.push(`TikTok perfil: ${String(error?.message || error).slice(0, 160)}`);
  }
  let videos: any[] = [];
  try {
    const fields = "id,title,video_description,duration,cover_image_url,share_url,create_time,like_count,comment_count,share_count,view_count";
    const json = await ttPost(`/v2/video/list/?fields=${encodeURIComponent(fields)}`, token, { max_count: 20 });
    videos = (json?.data?.videos || []).map((v: any) => ({
      id: v.id,
      caption: v.video_description || v.title || "",
      media_type: "VIDEO",
      permalink: v.share_url || null,
      thumbnail_url: v.cover_image_url || null,
      timestamp: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
      likes: n(v.like_count),
      comments: n(v.comment_count),
      shares: n(v.share_count),
      views: n(v.view_count),
      reach: null,
      saved: null,
      interactions: n(v.like_count) + n(v.comment_count) + n(v.share_count),
      engagement_rate: n(v.view_count) > 0 ? ((n(v.like_count) + n(v.comment_count) + n(v.share_count)) / n(v.view_count)) * 100 : null,
    })).sort((a: any, b: any) => b.interactions - a.interactions);
  } catch (error: any) {
    warnings.push(`TikTok vídeos: ${String(error?.message || error).slice(0, 160)}`);
  }
  const followers = n(profile.follower_count);
  await saveSnapshot("tiktok", {
    followers_count: followers || null,
    following_count: n(profile.following_count) || null,
    media_count: n(profile.video_count) || null,
    likes_count: n(profile.likes_count) || null,
    metrics: {
      views: videos.reduce((sum, v) => sum + n(v.views), 0),
      interactions: videos.reduce((sum, v) => sum + n(v.interactions), 0),
    },
  });
  const history = await snapshotHistory("tiktok", 90);
  const g7 = growthFromHistory(history, followers, 7);
  const g30 = growthFromHistory(history, followers, 30);
  const recentCutoff = Date.now() - days * 86400000;
  const recent = videos.filter((v) => !v.timestamp || new Date(v.timestamp).getTime() >= recentCutoff);
  const views = recent.reduce((sum, v) => sum + n(v.views), 0);
  const interactions = recent.reduce((sum, v) => sum + n(v.interactions), 0);
  return {
    connected: true,
    source: "tiktok_display_api",
    profile: {
      id: profile.open_id || conn.account_id || null,
      username: profile.username || conn.username || null,
      name: profile.display_name || null,
      avatar_url: profile.avatar_url || null,
      followers_count: followers,
      following_count: n(profile.following_count),
      media_count: n(profile.video_count),
      likes_count: n(profile.likes_count),
    },
    metrics: { views, interactions, engagement_rate: views > 0 ? (interactions / views) * 100 : null },
    growth: { days7: g7, days30: g30 },
    history,
    media: videos.slice(0, 8),
    warnings,
  };
}

export async function getSocialNativeAnalytics(provider: SocialProvider, days = 30) {
  return provider === "instagram" ? instagramAnalytics(days) : tiktokAnalytics(days);
}

export async function maybeCaptureSocialSnapshots() {
  const db = supabaseAdmin();
  const results: Record<string, string> = {};
  for (const provider of ["instagram", "tiktok"] as const) {
    try {
      const { data: last } = await db
        .from("tc_social_metric_snapshots")
        .select("captured_at")
        .eq("provider", provider)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const age = last?.captured_at ? Date.now() - new Date(last.captured_at).getTime() : Infinity;
      if (age < 6 * 60 * 60 * 1000) {
        results[provider] = "fresh";
        continue;
      }
      const native: any = await getSocialNativeAnalytics(provider, 30);
      results[provider] = native?.connected ? "captured" : "not_connected";
    } catch (error: any) {
      results[provider] = `error:${String(error?.message || error).slice(0, 80)}`;
    }
  }
  return results;
}
