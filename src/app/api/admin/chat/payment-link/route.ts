import { NextResponse } from "next/server";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { gateCentralOrAdmin } from "@/lib/gate";
import { getChatPack } from "@/lib/server/chat-platform";

export const runtime = "nodejs";

type LocalizedPack = {
  id: string;
  nombre: string;
  descripcion: string;
  credits: number;
  amount: number;
  currency: string;
  priceLabel: string;
  highlight?: boolean;
};

function getLocalizedChatPacks(country?: string | null): LocalizedPack[] {
  const key = String(country || "").trim();

  if (key === "Puerto Rico" || key === "Estados Unidos" || key === "Argentina" || key === "Venezuela") {
    return [
      { id: "chat_pack_3", nombre: "3 preguntas", descripcion: "Pack rápido para una consulta breve.", credits: 3, amount: 500, currency: "usd", priceLabel: "$5" },
      { id: "chat_pack_5", nombre: "5 preguntas", descripcion: "Ideal para una lectura más completa.", credits: 5, amount: 600, currency: "usd", priceLabel: "$6", highlight: true },
      { id: "chat_pack_10", nombre: "10 preguntas", descripcion: "Pensado para una sesión profunda.", credits: 10, amount: 800, currency: "usd", priceLabel: "$8" },
    ];
  }

  if (key === "México") {
    return [
      { id: "chat_pack_3", nombre: "3 preguntas", descripcion: "Pack rápido para una consulta breve.", credits: 3, amount: 9900, currency: "mxn", priceLabel: "$99 MXN" },
      { id: "chat_pack_5", nombre: "5 preguntas", descripcion: "Ideal para una lectura más completa.", credits: 5, amount: 11900, currency: "mxn", priceLabel: "$119 MXN", highlight: true },
      { id: "chat_pack_10", nombre: "10 preguntas", descripcion: "Pensado para una sesión profunda.", credits: 10, amount: 15900, currency: "mxn", priceLabel: "$159 MXN" },
    ];
  }

  if (key === "Colombia") {
    return [
      { id: "chat_pack_3", nombre: "3 preguntas", descripcion: "Pack rápido para una consulta breve.", credits: 3, amount: 2000000, currency: "cop", priceLabel: "$20.000 COP" },
      { id: "chat_pack_5", nombre: "5 preguntas", descripcion: "Ideal para una lectura más completa.", credits: 5, amount: 2400000, currency: "cop", priceLabel: "$24.000 COP", highlight: true },
      { id: "chat_pack_10", nombre: "10 preguntas", descripcion: "Pensado para una sesión profunda.", credits: 10, amount: 3200000, currency: "cop", priceLabel: "$32.000 COP" },
    ];
  }

  if (key === "Chile") {
    return [
      { id: "chat_pack_3", nombre: "3 preguntas", descripcion: "Pack rápido para una consulta breve.", credits: 3, amount: 490000, currency: "clp", priceLabel: "$4.900 CLP" },
      { id: "chat_pack_5", nombre: "5 preguntas", descripcion: "Ideal para una lectura más completa.", credits: 5, amount: 590000, currency: "clp", priceLabel: "$5.900 CLP", highlight: true },
      { id: "chat_pack_10", nombre: "10 preguntas", descripcion: "Pensado para una sesión profunda.", credits: 10, amount: 790000, currency: "clp", priceLabel: "$7.900 CLP" },
    ];
  }

  if (key === "Perú") {
    return [
      { id: "chat_pack_3", nombre: "3 preguntas", descripcion: "Pack rápido para una consulta breve.", credits: 3, amount: 1900, currency: "pen", priceLabel: "S/ 19" },
      { id: "chat_pack_5", nombre: "5 preguntas", descripcion: "Ideal para una lectura más completa.", credits: 5, amount: 2300, currency: "pen", priceLabel: "S/ 23", highlight: true },
      { id: "chat_pack_10", nombre: "10 preguntas", descripcion: "Pensado para una sesión profunda.", credits: 10, amount: 3100, currency: "pen", priceLabel: "S/ 31" },
    ];
  }

  if (key === "República Dominicana") {
    return [
      { id: "chat_pack_3", nombre: "3 preguntas", descripcion: "Pack rápido para una consulta breve.", credits: 3, amount: 30000, currency: "dop", priceLabel: "$300 DOP" },
      { id: "chat_pack_5", nombre: "5 preguntas", descripcion: "Ideal para una lectura más completa.", credits: 5, amount: 36000, currency: "dop", priceLabel: "$360 DOP", highlight: true },
      { id: "chat_pack_10", nombre: "10 preguntas", descripcion: "Pensado para una sesión profunda.", credits: 10, amount: 48000, currency: "dop", priceLabel: "$480 DOP" },
    ];
  }

  return [
    { id: "chat_pack_3", nombre: "3 preguntas", descripcion: "Pack rápido para una consulta breve.", credits: 3, amount: 500, currency: "eur", priceLabel: "5€" },
    { id: "chat_pack_5", nombre: "5 preguntas", descripcion: "Ideal para una lectura más completa.", credits: 5, amount: 600, currency: "eur", priceLabel: "6€", highlight: true },
    { id: "chat_pack_10", nombre: "10 preguntas", descripcion: "Pensado para una sesión profunda.", credits: 10, amount: 800, currency: "eur", priceLabel: "8€" },
  ];
}


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

    if (!clienteId || !threadId) return NextResponse.json({ ok: false, error: "MISSING_TARGET" }, { status: 400 });

    const admin = supabaseAdmin();
    const { data: thread, error: threadErr } = await admin.from("cliente_chat_threads").select("id, cliente_id, tarotista_worker_id").eq("id", threadId).maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) return NextResponse.json({ ok: false, error: "THREAD_NOT_FOUND" }, { status: 404 });

    const { data: cliente, error: clienteErr } = await admin.from("crm_clientes").select("id, nombre, apellido, email, telefono, telefono_normalizado, pais").eq("id", clienteId).maybeSingle();
    if (clienteErr) throw clienteErr;
    if (!cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NOT_FOUND" }, { status: 404 });

    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const baseUrl = getBaseUrl(req);
    const customerName = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || "Cliente Tarot Celestial";
    const localizedPacks = getLocalizedChatPacks(cliente?.pais);
    const fallbackPack = packId ? getChatPack(packId) : null;
    const packsToSend = localizedPacks.length
      ? localizedPacks
      : fallbackPack
        ? [{
            id: fallbackPack.id,
            nombre: fallbackPack.nombre,
            descripcion: fallbackPack.descripcion,
            credits: fallbackPack.credits,
            amount: Math.round(fallbackPack.priceUsd * 100),
            currency: "usd",
            priceLabel: `$${fallbackPack.priceUsd}`,
            highlight: true,
          }]
        : [];

    if (!packsToSend.length) {
      return NextResponse.json({ ok: false, error: "PACK_NO_ENCONTRADO" }, { status: 400 });
    }

    const createdLinks: any[] = [];
    const optionsForMessage: any[] = [];
    const nowIso = new Date().toISOString();

    for (const pack of packsToSend) {
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
              currency: pack.currency,
              product_data: {
                name: pack.nombre,
                description: pack.descripcion,
                metadata: { pack_id: pack.id, source: "cliente_chat" },
              },
              unit_amount: pack.amount,
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
          currency: pack.currency,
          price_label: pack.priceLabel,
        },
      });

      const { data: linkRow, error: linkErr } = await admin
        .from("cliente_chat_payment_links")
        .insert({
          cliente_id: cliente.id,
          thread_id: threadId,
          tarotista_worker_id: thread.tarotista_worker_id,
          stripe_url: session.url,
          stripe_session_id: session.id,
          pack_code: pack.id,
          amount: pack.amount / 100,
          credits: pack.credits,
          status: "pending",
          created_at: nowIso,
        })
        .select("*")
        .single();
      if (linkErr) throw linkErr;

      createdLinks.push(linkRow);
      optionsForMessage.push({
        id: pack.id,
        title: pack.nombre,
        credits: pack.credits,
        price_label: pack.priceLabel,
        url: session.url,
        highlight: Boolean(pack.highlight),
        payment_link_id: linkRow.id,
      });
    }

    if (sendToThread) {
      await admin.from("cliente_chat_messages").insert({
        thread_id: threadId,
        sender_type: "admin",
        sender_display_name: String(gate.me?.display_name || gate.me?.user?.email || "Admin"),
        body: "Te he enviado las opciones de pago para continuar la consulta.",
        kind: "payment_link",
        meta: {
          country: cliente?.pais || null,
          options: optionsForMessage,
        },
      });

      await admin.from("cliente_chat_threads").update({ last_message_at: nowIso, last_message_preview: "Pago enviado · packs disponibles" }).eq("id", threadId);
    }

    return NextResponse.json({ ok: true, options: optionsForMessage, payment_links: createdLinks });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ADMIN_CHAT_PAYMENT_LINK" }, { status: 500 });
  }
}
