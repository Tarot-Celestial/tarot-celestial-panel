import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  try {
    const me = await workerFromRequest(req);
    if (!me) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (String(me.role || "").toLowerCase() !== "admin") {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const paymentId = String(body?.payment_id || "").trim();
    if (!UUID_RE.test(paymentId)) {
      return NextResponse.json({ ok: false, error: "INVALID_PAYMENT_ID" }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: payment, error: paymentError } = await admin
      .from("crm_cliente_pagos")
      .select("id,estado,source_rendimiento_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment) return NextResponse.json({ ok: false, error: "PAYMENT_NOT_FOUND" }, { status: 404 });

    const currentStatus = String(payment.estado || "").trim().toLowerCase();
    if (["cancelled", "canceled", "cancelado", "anulado", "void", "voided"].includes(currentStatus)) {
      return NextResponse.json({ ok: true, payment, already_cancelled: true });
    }

    // La operación económica oficial se conserva para auditoría, pero deja de
    // afectar inmediatamente a todos los totales al pasar a estado cancelled.
    // No se elimina Rendimiento ni la nota automática para no romper relaciones.
    const { data: cancelledPayment, error: cancelError } = await admin
      .from("crm_cliente_pagos")
      .update({ estado: "cancelled" })
      .eq("id", paymentId)
      .select("id,estado,source_rendimiento_id")
      .single();

    if (cancelError) {
      console.error("[Diario cancel movement] Supabase error", {
        code: cancelError.code,
        message: cancelError.message,
        details: cancelError.details,
        hint: cancelError.hint,
        payment_id: paymentId,
        admin_user_id: me.user_id || me.resolved_uid || null,
      });
      throw cancelError;
    }

    const response = NextResponse.json({ ok: true, payment: cancelledPayment });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return response;
  } catch (error: any) {
    console.error("[Diario cancel movement] Error", {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    });
    const response = NextResponse.json(
      { ok: false, error: "MOVEMENT_CANCEL_FAILED" },
      { status: 500 },
    );
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    return response;
  }
}
