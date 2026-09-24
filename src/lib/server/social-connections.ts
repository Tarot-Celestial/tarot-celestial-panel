import "server-only";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";

export type SocialProvider = "instagram" | "tiktok";

export type StoredSocialConnection = {
  provider: SocialProvider;
  account_id: string | null;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  token_expires_at: string | null;
  refresh_expires_at: string | null;
  scopes: string[] | null;
  metadata: Record<string, any> | null;
  connected_at: string;
  updated_at: string;
  connected_by: string | null;
};

function encryptionKey() {
  const secret = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing SOCIAL_TOKEN_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("INVALID_SOCIAL_SECRET");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64url")), decipher.final()]).toString("utf8");
}

export function socialRedirectUri(provider: SocialProvider, requestUrl: string) {
  const envName = provider === "instagram" ? "INSTAGRAM_REDIRECT_URI" : "TIKTOK_REDIRECT_URI";
  const configured = process.env[envName]?.trim();
  if (configured) return configured;
  const origin = new URL(requestUrl).origin;
  return `${origin}/api/social/oauth/${provider}/callback`;
}

const INSTAGRAM_LOGIN_SUPPORTED_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
  "instagram_business_manage_comments",
  "instagram_business_manage_messages",
] as const;

export function instagramScopes() {
  const requested = (process.env.INSTAGRAM_SCOPES || INSTAGRAM_LOGIN_SUPPORTED_SCOPES.join(","))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  // Instagram Login solo admite estos scopes. Filtramos cualquier permiso del flujo
  // Facebook Login (por ejemplo insights) para que no rompa el OAuth.
  return requested.filter((scope) =>
    (INSTAGRAM_LOGIN_SUPPORTED_SCOPES as readonly string[]).includes(scope),
  );
}

type OAuthStatePayload = {
  provider: SocialProvider;
  adminId: string | null;
  nonce: string;
  issuedAt: number;
};

function oauthStateKey() {
  const secret = process.env.SOCIAL_TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Missing SOCIAL_TOKEN_ENCRYPTION_KEY or SUPABASE_SERVICE_ROLE_KEY");
  return crypto.createHash("sha256").update(`tc-social-oauth:${secret}`).digest();
}

export function createSocialOAuthState(provider: SocialProvider, adminId?: string | null) {
  const payload: OAuthStatePayload = {
    provider,
    adminId: adminId || null,
    nonce: crypto.randomBytes(20).toString("hex"),
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", oauthStateKey()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySocialOAuthState(value: string | null | undefined, provider: SocialProvider) {
  if (!value) return null;
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  const expected = crypto.createHmac("sha256", oauthStateKey()).update(encoded).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OAuthStatePayload;
    if (payload.provider !== provider) return null;
    if (!payload.issuedAt || Date.now() - payload.issuedAt > 15 * 60 * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function tiktokScopes() {
  return (process.env.TIKTOK_SCOPES || "user.info.basic,user.info.stats,video.list,video.upload,video.publish")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export async function saveSocialConnection(input: {
  provider: SocialProvider;
  accountId?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  refreshExpiresIn?: number | null;
  scopes?: string[] | null;
  metadata?: Record<string, any> | null;
  connectedBy?: string | null;
}) {
  const db = supabaseAdmin();
  const now = new Date();
  const expiresAt = input.expiresIn && Number(input.expiresIn) > 0
    ? new Date(now.getTime() + Number(input.expiresIn) * 1000).toISOString()
    : null;
  const refreshExpiresAt = input.refreshExpiresIn && Number(input.refreshExpiresIn) > 0
    ? new Date(now.getTime() + Number(input.refreshExpiresIn) * 1000).toISOString()
    : null;

  const row = {
    provider: input.provider,
    account_id: input.accountId || null,
    username: input.username || null,
    display_name: input.displayName || null,
    avatar_url: input.avatarUrl || null,
    access_token_ciphertext: encryptSecret(input.accessToken),
    refresh_token_ciphertext: encryptSecret(input.refreshToken || null),
    token_expires_at: expiresAt,
    refresh_expires_at: refreshExpiresAt,
    scopes: input.scopes || [],
    metadata: input.metadata || {},
    connected_by: input.connectedBy || null,
    connected_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  const { error } = await db.from("tc_social_connections").upsert(row, { onConflict: "provider" });
  if (error) {
    const detail = [error.message, error.details, error.hint].filter(Boolean).join(" · ");
    throw new Error(`No se pudo guardar la conexión social en Supabase: ${detail || error.code || "error desconocido"}`);
  }
}

export async function getSocialConnections() {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("tc_social_connections")
    .select("provider,account_id,username,display_name,avatar_url,token_expires_at,refresh_expires_at,scopes,metadata,connected_at,updated_at")
    .order("provider");
  if (error) throw error;
  return data || [];
}

export async function deleteSocialConnection(provider: SocialProvider) {
  const db = supabaseAdmin();
  const { error } = await db.from("tc_social_connections").delete().eq("provider", provider);
  if (error) throw error;
}

export function isSocialProvider(value: any): value is SocialProvider {
  return value === "instagram" || value === "tiktok";
}
