import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  decodeSocialRecovery,
  getSocialConnections,
  saveSocialConnection,
} from "@/lib/server/social-connections";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function projectRef() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    return url ? new URL(url).hostname.split(".")[0] || null : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.error === "FORBIDDEN" ? 403 : 401 },
      );
    }

    let rows = await getSocialConnections();
    let byProvider = Object.fromEntries(rows.map((row: any) => [row.provider, row]));
    let recovered = false;
    let recoveryError: string | null = null;

    // Recuperación automática: el callback deja durante 15 minutos una copia cifrada
    // y HttpOnly del OAuth. Si por cualquier motivo la lectura inmediata no encuentra
    // la fila, este endpoint vuelve a persistirla en la MISMA instancia de Supabase que
    // usa el panel y verifica el resultado antes de responder.
    if (!byProvider.instagram) {
      const recoveryRaw = req.cookies.get("tc_social_oauth_recovery")?.value;
      const recovery = decodeSocialRecovery(recoveryRaw);
      if (recovery?.provider === "instagram") {
        try {
          await saveSocialConnection({
            provider: recovery.provider,
            accountId: recovery.accountId,
            username: recovery.username || null,
            displayName: recovery.displayName || null,
            avatarUrl: recovery.avatarUrl || null,
            accessToken: recovery.accessToken,
            refreshToken: recovery.refreshToken || null,
            expiresIn: recovery.expiresIn || null,
            refreshExpiresIn: recovery.refreshExpiresIn || null,
            scopes: recovery.scopes || [],
            metadata: {
              ...(recovery.metadata || {}),
              recovered_from_oauth_cookie: true,
            },
            connectedBy: recovery.connectedBy || null,
          });
          rows = await getSocialConnections();
          byProvider = Object.fromEntries(rows.map((row: any) => [row.provider, row]));
          recovered = Boolean(byProvider.instagram);
        } catch (error: any) {
          recoveryError = error?.message || "No se pudo recuperar la conexión OAuth";
        }
      }
    }

    const db = supabaseAdmin();
    const { count, error: countError } = await db
      .from("tc_social_connections")
      .select("provider", { count: "exact", head: true });

    const response = NextResponse.json({
      ok: true,
      connections: {
        instagram: byProvider.instagram || null,
        tiktok: byProvider.tiktok || null,
      },
      configured: {
        instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
        tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
      },
      storage: {
        table: "tc_social_connections",
        readable: !countError,
        rows: countError ? null : (count ?? 0),
        error: countError ? countError.message : null,
        project_ref: projectRef(),
      },
      recovery: {
        attempted: Boolean(req.cookies.get("tc_social_oauth_recovery")?.value),
        recovered,
        error: recoveryError,
      },
      build: "social-oauth-v4",
    });

    if (byProvider.instagram || recoveryError) {
      response.cookies.delete("tc_social_oauth_recovery");
    }
    return response;
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "SOCIAL_STATUS_ERROR" }, { status: 500 });
  }
}
