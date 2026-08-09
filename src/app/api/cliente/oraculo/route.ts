import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";
import {
  TAROT_CARDS,
  answerTarotFollowup,
  buildTarotReading,
  normalizeOracleTopic,
  resolveTarotCard,
} from "@/lib/server/oracle-tarot";

export const runtime = "nodejs";

function madridDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function serializeDraw(row: Record<string, unknown> | null) {
  if (!row?.card_id) return null;
  return {
    id: String(row.id || ""),
    tema: String(row.tema || "general"),
    fecha: String(row.fecha || ""),
    cardId: String(row.card_id || ""),
    cardName: String(row.card_name || row.titulo || ""),
    cardImage: String(row.card_image || ""),
    keyword: String(row.keyword || row.energia || ""),
    advice: String(row.advice || row.cierre || ""),
    message: String(row.reading_short || row.prediccion || ""),
    isFree: Boolean(row.is_free),
    revealedAt: String(row.revealed_at || row.created_at || ""),
    selectedPosition: Number(row.selected_position || 0),
  };
}

async function getLatestDraw(admin: any, clientId: string) {
  const { data, error } = await admin
    .from("cliente_oraculo_diario")
    .select("id,fecha,tema,titulo,prediccion,energia,cierre,created_at,card_id,card_name,card_image,keyword,advice,reading_short,is_free,revealed_at,selected_position")
    .eq("cliente_id", clientId)
    .not("card_id", "is", null)
    .order("revealed_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function hasUsedFreeDraw(admin: any, clientId: string) {
  const { data, error } = await admin
    .from("cliente_oraculo_diario")
    .select("id")
    .eq("cliente_id", clientId)
    .eq("is_free", true)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function loadMessages(admin: any, clientId: string, draw: Record<string, unknown> | null) {
  if (!draw) return [];
  const fecha = String(draw.fecha || "");
  const tema = String(draw.tema || "general");
  const { data, error } = await admin
    .from("cliente_oraculo_mensajes")
    .select("id, role, contenido, created_at")
    .eq("cliente_id", clientId)
    .eq("fecha", fecha)
    .eq("tema", tema)
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) throw error;
  return data || [];
}

export async function GET(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const latestDraw = await getLatestDraw(gate.admin, gate.cliente.id);
    const freeUsed = await hasUsedFreeDraw(gate.admin, gate.cliente.id);
    const messages = await loadMessages(gate.admin, gate.cliente.id, latestDraw);

    return NextResponse.json({
      ok: true,
      freeAvailable: !freeUsed,
      creditsConfigured: false,
      latestDraw: serializeDraw(latestDraw),
      mensajes: messages,
      deckSize: TAROT_CARDS.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ERR_CLIENTE_ORACULO";
    console.error("[cliente/oraculo][GET]", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid || !gate.cliente) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action || "question").trim().toLowerCase();

    if (action === "shuffle") {
      const freeUsed = await hasUsedFreeDraw(gate.admin, gate.cliente.id);
      return NextResponse.json({
        ok: true,
        shuffleId: randomUUID(),
        canReveal: !freeUsed,
        freeAvailable: !freeUsed,
        creditsConfigured: false,
        deckSize: TAROT_CARDS.length,
      });
    }

    if (action === "reveal") {
      const tema = normalizeOracleTopic(body.tema);
      const position = Number(body.position);
      const shuffleId = String(body.shuffleId || "").trim();
      if (!shuffleId || !Number.isInteger(position) || position < 0 || position > 20) {
        return NextResponse.json({ ok: false, error: "INVALID_CARD_SELECTION" }, { status: 400 });
      }

      const freeUsed = await hasUsedFreeDraw(gate.admin, gate.cliente.id);
      if (freeUsed) {
        return NextResponse.json(
          { ok: false, error: "ORACLE_CREDITS_NOT_CONFIGURED", message: "Tu primera tirada gratuita ya fue utilizada. Las nuevas tiradas de pago estarán disponibles próximamente." },
          { status: 409 },
        );
      }

      const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "oracle";
      const card = resolveTarotCard({ clientId: gate.cliente.id, shuffleId, position, topic: tema, secret });
      const reading = buildTarotReading(card, tema);
      const nowIso = new Date().toISOString();
      const fecha = madridDateKey();

      const payload = {
        cliente_id: gate.cliente.id,
        fecha,
        tema,
        titulo: card.name,
        prediccion: reading.message,
        energia: card.keyword,
        cierre: card.advice,
        created_at: nowIso,
        card_id: card.id,
        card_name: card.name,
        card_image: card.image,
        keyword: card.keyword,
        advice: card.advice,
        reading_short: reading.message,
        is_free: true,
        revealed_at: nowIso,
        selected_position: position,
      };

      // Compatibilidad con el Oráculo anterior: si ya existe la lectura genérica del
      // mismo día/tema, la convertimos en la tirada real en lugar de crear otra fila.
      const legacy = await gate.admin
        .from("cliente_oraculo_diario")
        .select("id")
        .eq("cliente_id", gate.cliente.id)
        .eq("fecha", fecha)
        .eq("tema", tema)
        .is("card_id", null)
        .limit(1)
        .maybeSingle();
      if (legacy.error) throw legacy.error;

      const writeQuery = legacy.data?.id
        ? gate.admin.from("cliente_oraculo_diario").update(payload).eq("id", legacy.data.id)
        : gate.admin.from("cliente_oraculo_diario").insert(payload);

      const inserted = await writeQuery
        .select("id,fecha,tema,titulo,prediccion,energia,cierre,created_at,card_id,card_name,card_image,keyword,advice,reading_short,is_free,revealed_at,selected_position")
        .single();

      if (inserted.error) {
        if (inserted.error.code === "23505") {
          const latestDraw = await getLatestDraw(gate.admin, gate.cliente.id);
          return NextResponse.json({ ok: false, error: "FREE_DRAW_ALREADY_USED", latestDraw: serializeDraw(latestDraw) }, { status: 409 });
        }
        throw inserted.error;
      }

      return NextResponse.json({ ok: true, draw: serializeDraw(inserted.data), freeAvailable: false });
    }

    const pregunta = String(body.pregunta || "").trim();
    if (!pregunta) {
      return NextResponse.json({ ok: false, error: "PREGUNTA_REQUIRED" }, { status: 400 });
    }

    const latestDraw = await getLatestDraw(gate.admin, gate.cliente.id);
    if (!latestDraw?.card_id) {
      return NextResponse.json({ ok: false, error: "DRAW_REQUIRED" }, { status: 409 });
    }

    const card = TAROT_CARDS.find((item) => item.id === String(latestDraw.card_id));
    if (!card) {
      return NextResponse.json({ ok: false, error: "CARD_NOT_FOUND" }, { status: 500 });
    }

    const tema = normalizeOracleTopic(latestDraw.tema);
    const respuesta = answerTarotFollowup({
      question: pregunta,
      topic: tema,
      card,
      reading: String(latestDraw.reading_short || latestDraw.prediccion || ""),
    });
    const fecha = String(latestDraw.fecha || madridDateKey());
    const nowIso = new Date().toISOString();

    const insertUser = await gate.admin.from("cliente_oraculo_mensajes").insert({
      cliente_id: gate.cliente.id,
      fecha,
      tema,
      role: "user",
      contenido: pregunta,
      created_at: nowIso,
    });
    if (insertUser.error) throw insertUser.error;

    const insertAssistant = await gate.admin.from("cliente_oraculo_mensajes").insert({
      cliente_id: gate.cliente.id,
      fecha,
      tema,
      role: "assistant",
      contenido: respuesta,
      created_at: new Date(Date.now() + 1).toISOString(),
    });
    if (insertAssistant.error) throw insertAssistant.error;

    const mensajes = await loadMessages(gate.admin, gate.cliente.id, latestDraw);
    return NextResponse.json({ ok: true, respuesta, mensajes });
  } catch (error: unknown) {
    const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
    console.error("[cliente/oraculo][POST]", {
      code: details.code,
      message: details.message,
      details: details.details,
      hint: details.hint,
    });
    const message = error instanceof Error ? error.message : String(details.message || "ERR_CLIENTE_ORACULO_SEND");
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
