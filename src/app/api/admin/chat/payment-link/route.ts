import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";
import { CLIENTE_CHAT_PACKS, getChatPack } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function getBaseUrl(req: Request) {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(req: Request) {
  try {
    const gate = await gateCentralOrAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error || "UNAUTH" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const clienteId = String(body?.cliente_id || "").trim();
    const threadId = String(body?.thread_id || "").trim();
    const packId = String(body?.pack_id || "").trim();
    const sendToThread = body?.send_to_thread !== false;

    const pack = getChatPack(packId);
    if (!clienteId || !threadId) return NextResponse.json({ ok: false, error: "MISSING_TARGET" }, { status: 400 });
    if (!pack) return NextResponse.json({ ok: false, error: "PACK_NO_ENCONTRADO", packs: CLIENTE_CHAT_PACKS }, { status: 400 });

    const admin = supabaseAdmin();
    const { data: thread, error: threadErr } = await admin.from("cliente_chat_threads").select("id, cliente_id, tarotista_worker_id").eq("id", threadId).maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });

    const { data: cliente, error: clienteErr } = await admin.from("crm_clientes").select("id, nombre, apellido, email, telefono, telefono_normalizado").eq("id", clienteId).maybeSingle();
    if (clienteErr) throw clienteErr;
    if (!cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NOT_FOUND" }, { status: 404 });

    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const baseUrl = getBaseUrl(req);
    const customerName = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente Tarot Celestial";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      success_url: `${baseUrl}/cliente/chat?checkout=ok&thread=${encodeURIComponent(threadId)}`,
      cancel_url: `${baseUrl}/cliente/chat?checkout=cancelled&thread=${encodeURIComponent(threadId)}`,
      customer_email: cliente?.email || undefined,
      phone_number_collection: { enabled: true },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            product_data: {
              name: pack.nombre,
              description: pack.descripcion,
              metadata: { pack_id: pack.id, source: "cliente_chat" },
            },
            unit_amount: Math.round(pack.priceUsd * 100),
          },
        },
      ],
      metadata: {
        source: "cliente_chat",
        cliente_id: cliente.id,
        thread_id: threadId,
        tarotista_worker_id: String(thread.tarotista_worker_id || ""),
        pack_id: pack.id,
        credits: String(pack.credits),
        cliente_nombre: customerName,
        phone: cliente?.telefono_normalizado || cliente?.telefono || "",
      },
    });

    const nowIso = new Date().toISOString();
    const { data: linkRow, error: linkErr } = await admin
      .from("cliente_chat_payment_links")
      .insert({
        cliente_id: cliente.id,
        thread_id: threadId,
        tarotista_worker_id: thread.tarotista_worker_id,
        stripe_url: session.url,
        stripe_session_id: session.id,
        pack_code: pack.id,
        amount: pack.priceUsd,
        credits: pack.credits,
        status: "pending",
        created_at: nowIso,
      })
      .select("*")
      .single();
    if (linkErr) throw linkErr;

    if (sendToThread) {
      await admin.from("cliente_chat_messages").insert({
        thread_id: threadId,
        sender_type: "admin",
        sender_display_name: String(gate.me?.display_name || gate.me?.user?.email || "Admin"),
        body: `Aquí tienes tu enlace de pago para ${pack.nombre}: ${session.url}`,
        kind: "payment_link",
        meta: {
          pack_id: pack.id,
          credits: pack.credits,
          amount: pack.priceUsd,
          url: session.url,
          payment_link_id: linkRow.id,
        },
      });

      await admin.from("cliente_chat_threads").update({ last_message_at: nowIso, last_message_preview: `Pago enviado · ${pack.nombre}` }).eq("id", threadId);
    }

    return NextResponse.json({ ok: true, url: session.url, pack, payment_link: linkRow });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_PAYMENT_LINK" }, { status: 500 });
  }
}
