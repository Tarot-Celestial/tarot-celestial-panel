import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { decryptSecret, encryptSecret, type SocialProvider } from "@/lib/server/social-connections";

export type SocialContentRow = {
  id: string;
  provider: SocialProvider;
  content_type: string;
  title: string | null;
  caption: string | null;
  media_urls: string[] | null;
  status: string;
  privacy_level: string | null;
  publish_mode: string | null;
  settings: Record<string, any> | null;
};

async function connection(provider: SocialProvider) {
  const db = supabaseAdmin();
  const { data, error } = await db.from("tc_social_connections").select("*").eq("provider", provider).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`${provider.toUpperCase()}_NOT_CONNECTED`);
  let accessToken = decryptSecret(data.access_token_ciphertext);
  if (!accessToken) throw new Error(`${provider.toUpperCase()}_TOKEN_MISSING`);

  const expiresAt = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  const shouldRefresh = expiresAt > 0 && expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000;
  if (shouldRefresh) {
    try {
      if (provider === "instagram") {
        const refreshUrl = new URL("https://graph.instagram.com/refresh_access_token");
        refreshUrl.searchParams.set("grant_type", "ig_refresh_token");
        refreshUrl.searchParams.set("access_token", accessToken);
        const refreshResponse = await fetch(refreshUrl, { cache: "no-store" });
        const refreshed: any = await refreshResponse.json().catch(() => ({}));
        if (refreshResponse.ok && refreshed?.access_token) {
          accessToken = String(refreshed.access_token);
          await db.from("tc_social_connections").update({
            access_token_ciphertext: encryptSecret(accessToken),
            token_expires_at: refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : data.token_expires_at,
            updated_at: new Date().toISOString(),
          }).eq("provider", provider);
        }
      } else {
        const refreshToken = decryptSecret(data.refresh_token_ciphertext);
        if (refreshToken && process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET) {
          const form = new URLSearchParams({
            client_key: process.env.TIKTOK_CLIENT_KEY,
            client_secret: process.env.TIKTOK_CLIENT_SECRET,
            grant_type: "refresh_token",
            refresh_token: refreshToken,
          });
          const refreshResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, cache: "no-store" });
          const refreshed: any = await refreshResponse.json().catch(() => ({}));
          if (refreshResponse.ok && refreshed?.access_token) {
            accessToken = String(refreshed.access_token);
            await db.from("tc_social_connections").update({
              access_token_ciphertext: encryptSecret(accessToken),
              refresh_token_ciphertext: encryptSecret(refreshed.refresh_token || refreshToken),
              token_expires_at: refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : data.token_expires_at,
              refresh_expires_at: refreshed.refresh_expires_in ? new Date(Date.now() + Number(refreshed.refresh_expires_in) * 1000).toISOString() : data.refresh_expires_at,
              updated_at: new Date().toISOString(),
            }).eq("provider", provider);
          }
        }
      }
    } catch {
      // Si el refresh temporal falla, se intenta con el token actual; la API devolverá el error real si ya no es válido.
    }
  }
  return { ...data, accessToken } as any;
}

function apiVersion() {
  return (process.env.META_GRAPH_API_VERSION || "v24.0").trim();
}

async function igFetch(path: string, token: string, init?: RequestInit) {
  const host = (process.env.INSTAGRAM_GRAPH_BASE || "https://graph.instagram.com").replace(/\/$/, "");
  const url = `${host}/${apiVersion()}/${path.replace(/^\//, "")}`;
  const res = await fetch(url, { ...init, cache: "no-store" });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error_message || `Instagram API ${res.status}`);
  return json;
}

async function createInstagramContainer(accountId: string, token: string, params: Record<string, string>) {
  const body = new URLSearchParams({ ...params, access_token: token });
  return igFetch(`${accountId}/media`, token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
}

async function waitInstagramContainer(containerId: string, token: string) {
  let lastStatus = "UNKNOWN";
  for (let i = 0; i < 20; i += 1) {
    const q = new URLSearchParams({ fields: "status_code,status", access_token: token });
    const result = await igFetch(`${containerId}?${q.toString()}`, token);
    lastStatus = String(result?.status_code || result?.status || "UNKNOWN").toUpperCase();
    if (lastStatus === "FINISHED" || lastStatus === "PUBLISHED") return;
    if (lastStatus === "ERROR" || lastStatus === "EXPIRED") {
      throw new Error(result?.status || `Instagram no pudo procesar el contenido (${lastStatus})`);
    }
    await new Promise((resolve) => setTimeout(resolve, i < 4 ? 1200 : 2000));
  }
  throw new Error(`Instagram todavía está procesando el contenido (${lastStatus}). Inténtalo de nuevo en unos segundos.`);
}

function isInstagramMediaNotReadyError(error: any) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("media id is not available") || message.includes("media is not ready") || message.includes("2207027");
}

async function publishInstagramContainer(accountId: string, token: string, creationId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const body = new URLSearchParams({ creation_id: creationId, access_token: token });
      return await igFetch(`${accountId}/media_publish`, token, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch (error: any) {
      if (!isInstagramMediaNotReadyError(error) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2500 + attempt * 1000));
      await waitInstagramContainer(creationId, token);
    }
  }
  throw new Error("Instagram no pudo publicar el contenedor.");
}

async function publishInstagram(row: SocialContentRow) {
  const conn = await connection("instagram");
  const accountId = String(conn.account_id || "");
  if (!accountId) throw new Error("INSTAGRAM_ACCOUNT_ID_MISSING");
  const token = conn.accessToken;
  const media = (row.media_urls || []).filter(Boolean);
  if (!media.length) throw new Error("Añade al menos una URL pública de imagen o vídeo");
  const caption = row.caption || "";
  let creationId = "";

  if (row.content_type === "carousel") {
    if (media.length < 2) throw new Error("Un carrusel necesita al menos 2 recursos");
    const children: string[] = [];
    for (const url of media.slice(0, 10)) {
      const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(url);
      const child = await createInstagramContainer(accountId, token, isVideo
        ? { media_type: "VIDEO", video_url: url, is_carousel_item: "true" }
        : { image_url: url, is_carousel_item: "true" });
      const childId = String(child.id);
      await waitInstagramContainer(childId, token);
      children.push(childId);
    }
    const parent = await createInstagramContainer(accountId, token, {
      media_type: "CAROUSEL",
      children: children.join(","),
      caption,
    });
    creationId = String(parent.id);
    await waitInstagramContainer(creationId, token);
  } else if (row.content_type === "reel") {
    const created = await createInstagramContainer(accountId, token, {
      media_type: "REELS",
      video_url: media[0],
      caption,
      share_to_feed: String(row.settings?.share_to_feed !== false),
    });
    creationId = String(created.id);
    await waitInstagramContainer(creationId, token);
  } else if (row.content_type === "story") {
    const isVideo = /\.(mp4|mov|webm)(\?|$)/i.test(media[0]);
    const created = await createInstagramContainer(accountId, token, isVideo
      ? { media_type: "STORIES", video_url: media[0] }
      : { media_type: "STORIES", image_url: media[0] });
    creationId = String(created.id);
    await waitInstagramContainer(creationId, token);
  } else {
    const created = await createInstagramContainer(accountId, token, { image_url: media[0], caption });
    creationId = String(created.id);
    await waitInstagramContainer(creationId, token);
  }

  const published = await publishInstagramContainer(accountId, token, creationId);
  return { externalPostId: String(published.id || ""), externalPublishId: creationId, raw: published };
}

async function tiktokRequest(path: string, token: string, body?: any) {
  const res = await fetch(`https://open.tiktokapis.com${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || (json?.error?.code && json.error.code !== "ok")) throw new Error(json?.error?.message || json?.error_description || `TikTok API ${res.status}`);
  return json;
}

async function publishTikTok(row: SocialContentRow) {
  const conn = await connection("tiktok");
  const token = conn.accessToken;
  const media = (row.media_urls || []).filter(Boolean);
  if (!media.length) throw new Error("Añade una URL pública del vídeo o de las fotos");
  const publishMode = row.publish_mode === "inbox" ? "inbox" : "direct";

  if (publishMode === "direct") {
    const creator = await tiktokRequest("/v2/post/publish/creator_info/query/", token);
    const allowed = Array.isArray(creator?.data?.privacy_level_options) ? creator.data.privacy_level_options : [];
    const requested = row.privacy_level || "SELF_ONLY";
    if (allowed.length && !allowed.includes(requested)) {
      throw new Error(`La privacidad ${requested} no está permitida por la cuenta de TikTok. Opciones: ${allowed.join(", ")}`);
    }
  }

  if (row.content_type === "photo") {
    const result = await tiktokRequest("/v2/post/publish/content/init/", token, {
      post_info: {
        title: row.title || row.caption || "Tarot Celestial",
        description: row.caption || "",
        privacy_level: row.privacy_level || "SELF_ONLY",
        disable_comment: Boolean(row.settings?.disable_comment),
        auto_add_music: Boolean(row.settings?.auto_add_music),
      },
      source_info: { source: "PULL_FROM_URL", photo_images: media.slice(0, 35), photo_cover_index: 0 },
      post_mode: publishMode === "direct" ? "DIRECT_POST" : "MEDIA_UPLOAD",
      media_type: "PHOTO",
    });
    return { externalPostId: "", externalPublishId: String(result?.data?.publish_id || ""), raw: result };
  }

  const endpoint = publishMode === "direct" ? "/v2/post/publish/video/init/" : "/v2/post/publish/inbox/video/init/";
  const body: any = {
    source_info: { source: "PULL_FROM_URL", video_url: media[0] },
  };
  if (publishMode === "direct") {
    body.post_info = {
      title: row.caption || row.title || "",
      privacy_level: row.privacy_level || "SELF_ONLY",
      disable_duet: Boolean(row.settings?.disable_duet),
      disable_comment: Boolean(row.settings?.disable_comment),
      disable_stitch: Boolean(row.settings?.disable_stitch),
      brand_organic_toggle: Boolean(row.settings?.brand_organic_toggle ?? true),
      is_aigc: Boolean(row.settings?.is_aigc),
    };
  }
  const result = await tiktokRequest(endpoint, token, body);
  return { externalPostId: "", externalPublishId: String(result?.data?.publish_id || ""), raw: result };
}

export async function publishSocialContentById(id: string) {
  const db = supabaseAdmin();
  const { data: row, error } = await db.from("tc_social_content").select("*").eq("id", id).single();
  if (error) throw error;
  if (!row) throw new Error("CONTENT_NOT_FOUND");
  if (row.status === "published") return row;

  await db.from("tc_social_content").update({ status: "publishing", error_message: null, updated_at: new Date().toISOString() }).eq("id", id);
  try {
    const result = row.provider === "instagram" ? await publishInstagram(row as SocialContentRow) : await publishTikTok(row as SocialContentRow);
    const now = new Date().toISOString();
    await db.from("tc_social_content").update({
      status: row.provider === "tiktok" && result.externalPublishId ? "processing" : "published",
      external_post_id: result.externalPostId || null,
      external_publish_id: result.externalPublishId || null,
      published_at: row.provider === "instagram" ? now : null,
      updated_at: now,
      error_message: null,
    }).eq("id", id);
    await db.from("tc_social_publish_log").insert({ content_id: id, provider: row.provider, status: "sent", external_publish_id: result.externalPublishId || null, external_post_id: result.externalPostId || null, response: result.raw || {} });
    return { ...row, ...result };
  } catch (e: any) {
    const message = String(e?.message || "Error publicando").slice(0, 1000);
    await db.from("tc_social_content").update({ status: "failed", error_message: message, updated_at: new Date().toISOString() }).eq("id", id);
    await db.from("tc_social_publish_log").insert({ content_id: id, provider: row.provider, status: "failed", error_message: message });
    throw e;
  }
}

export async function refreshTikTokStatusForContent(id: string) {
  const db = supabaseAdmin();
  const { data: row, error } = await db.from("tc_social_content").select("*").eq("id", id).single();
  if (error) throw error;
  if (!row || row.provider !== "tiktok" || !row.external_publish_id) return row;
  const conn = await connection("tiktok");
  const result = await tiktokRequest("/v2/post/publish/status/fetch/", conn.accessToken, { publish_id: row.external_publish_id });
  const status = result?.data?.status;
  let local = "processing";
  if (status === "PUBLISH_COMPLETE" || status === "SEND_TO_USER_INBOX") local = status === "PUBLISH_COMPLETE" ? "published" : "sent_to_inbox";
  if (status === "FAILED") local = "failed";
  const postId = Array.isArray(result?.data?.publicaly_available_post_id) ? String(result.data.publicaly_available_post_id[0] || "") : "";
  await db.from("tc_social_content").update({ status: local, external_post_id: postId || row.external_post_id, published_at: local === "published" ? new Date().toISOString() : row.published_at, error_message: status === "FAILED" ? result?.data?.fail_reason || "TikTok rechazó la publicación" : null, updated_at: new Date().toISOString() }).eq("id", id);
  return result;
}
