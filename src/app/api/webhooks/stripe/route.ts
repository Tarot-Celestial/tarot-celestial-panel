import { NextResponse } from "next/server";
import Stripe from "stripe";
import { adminClient } from "@/lib/server/auth-cliente";
import { applyClientPurchase, getClientePack } from "@/lib/server/cliente-platform";
import { getConfiguredMinutePack } from "@/lib/server/cliente-minute-packs";
import { addClientChatCredits, getChatPack } from "@/lib/server/chat-platform";
import { getOraclePack, grantOracleCredits } from "@/lib/server/oracle-premium";
import { getOracleQuestionPack, grantOracleQuestions } from "@/lib/server/oracle-questions";

export const runtime = "nodejs";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  try {
    const stripe = new Stripe(getEnv("STRIPE_SECRET_KEY"), { apiVersion: "2023-10-16" });
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json({ ok: false, error: "MISSING_STRIPE_SIGNATURE" }, { status: 400 });
    }

    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      getEnv("STRIPE_WEBHOOK_SECRET")
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      const source = String(session.metadata?.source || "cliente_panel").trim();
      const clienteId = String(session.metadata?.cliente_id || "").trim();
      const admin = adminClient();

      const paymentRef = String(session.id || session.payment_intent || "").trim();
      const amountTotal = Number(session.amount_total || 0) / 100;

      // =========================
      // 💬 CHAT (NO TOCAR)
      // =========================
      if (source === "cliente_chat") {
        const packId = String(session.metadata?.pack_id || "").trim();
        const threadId = String(session.metadata?.thread_id || "").trim() || null;
        const pack = getChatPack(packId);

        if (!clienteId || !pack) {
          return NextResponse.json(
            { ok: false, error: "INVALID_STRIPE_CHAT_METADATA" },
            { status: 400 }
          );
        }

        const creditResult = await addClientChatCredits(admin, {
          clienteId,
          threadId,
          amount: Number(session.metadata?.credits || pack.credits),
          type: "purchase",
          notes: `Stripe checkout completado · ${pack.nombre}`,
          meta: {
            stripe_session_id: session.id,
            payment_intent:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id || null,
            amount_usd: amountTotal || pack.priceUsd,
          },
        });

        await admin
          .from("cliente_chat_payment_links")
          .update({
            status: "paid",
            stripe_session_id: session.id,
            paid_at: new Date().toISOString(),
          })
          .eq("stripe_session_id", session.id);

        if (threadId) {
          await admin
            .from("cliente_chat_threads")
            .update({
              creditos_restantes: creditResult.balance,
              estado: "open",
              last_message_at: new Date().toISOString(),
              last_message_preview: `Pago confirmado · ${pack.nombre}`,
            })
            .eq("id", threadId);

          await admin.from("cliente_chat_messages").insert({
            thread_id: threadId,
            sender_type: "system",
            sender_display_name: "Sistema",
            body: `Pago confirmado. Ya tienes ${creditResult.balance} créditos disponibles para seguir con tu consulta.`,
            kind: "system",
            meta: {
              pack_id: pack.id,
              credits: pack.credits,
              stripe_session_id: session.id,
            },
          });
        }
      }

      // =========================
      // 🔮 ORÁCULO PREMIUM
      // =========================
      else if (source === "cliente_oracle_questions") {
        const packId = String(session.metadata?.pack_id || "").trim();
        const pack = getOracleQuestionPack(packId);
        if (!clienteId || !pack) return NextResponse.json({ ok: false, error: "INVALID_STRIPE_ORACLE_QUESTION_METADATA" }, { status: 400 });
        await grantOracleQuestions(admin, {
          clienteId, questions: Number(session.metadata?.oracle_questions || pack.questions),
          reference: `stripe:${session.id}`, notes: `Stripe checkout completado · ${pack.nombre}`,
          meta: { stripe_session_id: session.id, payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null, amount_eur: amountTotal || pack.priceEur },
        });
      }

      // =========================
      // 🔮 ORÁCULO PREMIUM
      // =========================
      else if (source === "cliente_oracle") {
        const packId = String(session.metadata?.pack_id || "").trim();
        const pack = getOraclePack(packId);
        if (!clienteId || !pack) {
          return NextResponse.json({ ok: false, error: "INVALID_STRIPE_ORACLE_METADATA" }, { status: 400 });
        }

        await grantOracleCredits(admin, {
          clienteId,
          credits: Number(session.metadata?.oracle_credits || pack.credits),
          reference: `stripe:${session.id}`,
          packId: pack.id,
          notes: `Stripe checkout completado · ${pack.nombre}`,
          meta: {
            stripe_session_id: session.id,
            payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null,
            amount_eur: amountTotal || pack.priceEur,
          },
        });
      }

      // =========================
      // 💰 PANEL CLIENTE (AQUÍ METEMOS LA NOTA)
      // =========================
      else {
        const packId = String(session.metadata?.pack_id || "").trim();
        const pack = getConfiguredMinutePack(packId) || getClientePack(packId);

        if (!clienteId || !pack) {
          return NextResponse.json(
            { ok: false, error: "INVALID_STRIPE_METADATA" },
            { status: 400 }
          );
        }

        // ✅ 1. APLICAR COMPRA (YA EXISTENTE)
        await applyClientPurchase(admin, {
          clienteId,
          packId,
          paymentRef,
          paymentIntent:
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : session.payment_intent?.id || null,
          stripeSessionId: session.id,
          amountUsd: amountTotal || pack.priceUsd,
          totalMinutes: Number(session.metadata?.total_minutes || pack.totalMinutes),
          metodo: "stripe_checkout",
          notas: `Stripe checkout completado · ${pack.nombre}`,
        });

        // ✅ 2. NUEVO → CREAR NOTA EN CRM
        await admin.from("crm_client_notes").insert({
          cliente_id: clienteId,
          texto: `🟣 Compra web: ha comprado ${pack.nombre} (${Number(amountTotal || pack.priceUsd).toFixed(2)} USD) a través del panel cliente`,
          author_user_id: null,
          author_name: "Sistema",
          author_email: null,
          is_pinned: false,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR_STRIPE_WEBHOOK" },
      { status: 400 }
    );
  }
}
