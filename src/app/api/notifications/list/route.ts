import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );

  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data.user?.id || null;
}

function pendingEstado(v: any) {
  const s = String(v || "").trim().toLowerCase();
  return ["pendiente", "pending", "confirmada", "confirmado", "programada", "activa"].includes(s);
}

export async function GET(req: Request) {
  try {
    const admin = adminClient();
    const { searchParams } = new URL(req.url);
    const user_id = searchParams.get("user_id");
    const uid = await uidFromBearer(req);

    let worker: any = null;
    if (uid) {
      const { data } = await admin.from("workers").select("id, role, display_name").eq("user_id", uid).maybeSingle();
      worker = data || null;
    }

    const notifications: any[] = [];

    if (user_id) {
      const { data, error } = await admin
        .from("notifications")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      notifications.push(...(data || []));
    }

    if (worker?.role === "admin" || worker?.role === "central") {
      const now = new Date();
      const soon = new Date(now.getTime() + 15 * 60000).toISOString();
      const { data: reservas } = await admin
        .from("reservas")
        .select("id, cliente_nombre, fecha_reserva, estado")
        .gte("fecha_reserva", now.toISOString())
        .lte("fecha_reserva", soon)
        .order("fecha_reserva", { ascending: true })
        .limit(3);
      for (const r of reservas || []) {
        if (!pendingEstado(r?.estado)) continue;
        notifications.push({
          id: `virtual:reserva:${r.id}`,
          title: "Reserva próxima",
          message: `${r?.cliente_nombre || "Cliente"} tiene reserva a las ${new Date(r.fecha_reserva).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}.`,
          created_at: new Date().toISOString(),
          read: false,
          synthetic: true,
        });
      }
    }

    if (worker?.role === "admin") {
      const d = new Date();
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const nextMonthIso = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 1)).toISOString();
      const monthStartIso = `${monthKey}-01T00:00:00.000Z`;

      const { data: invoices } = await admin
        .from("invoices")
        .select("id")
        .eq("month_key", monthKey)
        .or("worker_ack.is.null,worker_ack.eq.pending,worker_ack.eq.review");
      const pendingInvoices = Array.isArray(invoices) ? invoices.length : 0;
      if (pendingInvoices > 0) {
        notifications.push({
          id: `virtual:invoice:${monthKey}`,
          title: "Facturas pendientes",
          message: `Hay ${pendingInvoices} factura(s) pendientes o en revisión este mes.`,
          created_at: new Date().toISOString(),
          read: false,
          synthetic: true,
        });
      }

      const { data: rr } = await admin
        .from("rendimiento_llamadas")
        .select("importe")
        .gte("fecha_hora", monthStartIso)
        .lt("fecha_hora", nextMonthIso);
      const amount = (rr || []).reduce((a: number, x: any) => a + (Number(x?.importe) || 0), 0);
      notifications.push({
        id: `virtual:billing:${monthKey}`,
        title: "Facturación del mes",
        message: `Cobros acumulados del mes: ${amount.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}.`,
        created_at: new Date().toISOString(),
        read: false,
        synthetic: true,
      });
    }

    notifications.sort((a, b) => new Date(String(b.created_at || 0)).getTime() - new Date(String(a.created_at || 0)).getTime());
    return NextResponse.json({ ok: true, data: notifications.slice(0, 20) });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
