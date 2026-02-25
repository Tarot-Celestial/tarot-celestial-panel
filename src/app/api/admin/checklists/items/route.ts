import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

async function requireAdmin(admin: any, uid: string) {
  const { data: me, error } = await admin
    .from("workers")
    .select("id, role, display_name")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!me) return { ok: false, error: "NO_WORKER" } as const;
  if (me.role !== "admin") return { ok: false, error: "FORBIDDEN" } as const;
  return { ok: true, me } as const;
}

function normTemplateKey(v: any) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  // permitimos solo central/tarotista por seguridad UI
  if (s !== "central" && s !== "tarotista") return "";
  return s;
}

export async function GET(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const check = await requireAdmin(admin, uid);
    if (!check.ok) return NextResponse.json(check, { status: check.error === "FORBIDDEN" ? 403 : 403 });

    const u = new URL(req.url);
    const template_key = normTemplateKey(u.searchParams.get("template_key"));
    if (!template_key) return NextResponse.json({ ok: false, error: "BAD_TEMPLATE_KEY" }, { status: 400 });

    // aseguramos plantilla (si no existe, la creamos)
    const title = template_key === "central" ? "Checklist Central" : "Checklist Tarotista";
    const { data: tplUp, error: eUp } = await admin
      .from("checklist_templates")
      .upsert({ template_key, title }, { onConflict: "template_key" })
      .select("id, template_key, title")
      .maybeSingle();
    if (eUp) throw eUp;

    const tpl = tplUp;
    if (!tpl) return NextResponse.json({ ok: false, error: "NO_TEMPLATE" }, { status: 500 });

    const { data: items, error: ei } = await admin
      .from("checklist_template_items")
      .select("id, sort, label")
      .eq("template_id", tpl.id)
      .order("sort", { ascending: true });
    if (ei) throw ei;

    return NextResponse.json({
      ok: true,
      template: tpl,
      items: items || [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });

    const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const check = await requireAdmin(admin, uid);
    if (!check.ok) return NextResponse.json(check, { status: check.error === "FORBIDDEN" ? 403 : 403 });

    const body = await req.json().catch(() => ({}));
    const template_key = normTemplateKey(body.template_key);
    const id = body.id ? String(body.id) : "";
    const label = String(body.label || "").trim();
    const sort = Number(body.sort ?? 0);

    if (!template_key) return NextResponse.json({ ok: false, error: "BAD_TEMPLATE_KEY" }, { status: 400 });
    if (!label) return NextResponse.json({ ok: false, error: "MISSING_LABEL" }, { status: 400 });
    if (!isFinite(sort)) return NextResponse.json({ ok: false, error: "BAD_SORT" }, { status: 400 });

    // asegurar plantilla
    const title = template_key === "central" ? "Checklist Central" : "Checklist Tarotista";
    const { data: tplUp, error: eUp } = await admin
      .from("checklist_templates")
      .upsert({ template_key, title }, { onConflict: "template_key" })
      .select("id, template_key, title")
      .maybeSingle();
    if (eUp) throw eUp;

    const tpl = tplUp;
    if (!tpl) return NextResponse.json({ ok: false, error: "NO_TEMPLATE" }, { status: 500 });

    // create/update item
    if (id) {
      const { data: upd, error: eu } = await admin
        .from("checklist_template_items")
        .update({ label, sort })
        .eq("id", id)
        .select("id, sort, label")
        .maybeSingle();
      if (eu) throw eu;

      return NextResponse.json({ ok: true, action: "updated", item: upd });
    } else {
      const { data: ins, error: ei } = await admin
        .from("checklist_template_items")
        .insert({ template_id: tpl.id, label, sort })
        .select("id, sort, label")
        .maybeSingle();
      if (ei) throw ei;

      return NextResponse.json({ ok: true, action: "created", item: ins });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
