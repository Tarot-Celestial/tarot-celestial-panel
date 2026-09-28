import { NextResponse } from "next/server";
import { campaignIdentity, campaignResponseError } from "@/lib/server/campaign-auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { db: admin, clientId } = await campaignIdentity(req, "client");

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();

    if (id) {
      const { error } = await admin
        .from("cliente_notificaciones")
        .update({ leida: true })
        .eq("id", id)
        .eq("cliente_id", clientId);
      if (error) throw error;
    } else {
      const { error } = await admin
        .from("cliente_notificaciones")
        .update({ leida: true })
        .eq("cliente_id", clientId)
        .eq("leida", false);
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return campaignResponseError(e);
  }
}
