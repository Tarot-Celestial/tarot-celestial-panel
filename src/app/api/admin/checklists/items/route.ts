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

async function assertAdmin(req: Request) {
  const { uid } = await uidFromBearer(req);
  if (!uid) return { ok: false as const, error: "NO_AUTH", status: 401 };

  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: me, error: em } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (em) throw em;
  if (!me || me.role !== "admin") return { ok: false as const, error: "FORBIDDEN", status: 403 };

  return { ok: true as const, admin };
}

/**
 * GET:
 *  - /api/admin/checklists/items                  -> lista plantillas (tarotista/central)
 *  - /api/admin/checklists/items?template_key=...  -> devuelve template + items
 */
export async function GET(req: Request) {
  try {
    const a = await assertAdmin(req);
    if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });
    const admin = a.admin;

    const u = new URL(req.url);
    const template_key = String(u.searchParams.get("template_key") || "").trim();

    // 1) Si NO viene template_key -> LISTA plantillas (esto sería “3.1”)
    if (!template_key) {
      const { data: templates, error: et } = await admin
        .from("checklist_templates")
        .select("id, template_key, title")
        .order("template_key", { ascending: true });

      if (et) throw et;

      // contadores (total/activos)
      const out: any[] = [];
      for (const t of templates || []) {
        const { count: total } = await admin
          .from("checklist_template_items")
          .select("id", { count: "exact", head: true })
          .eq("template_id", t.id);

        const { count: active } = await admin
          .from("checklist_template_items")
          .select("id", { count: "exact", head: true })
          .eq("template_id", t.id)
          .eq("is_active", true);

        out.push({
          ...t,
          items_total: total || 0,
          items_active: active || 0,
        });
      }

      return NextResponse.json({ ok: true, templates: out });
    }

    // 2) Si viene template_key -> TEMPLATE + ITEMS (esto sería “3.2 GET”)
    const { data: tpl, error: et2 } = await admin
      .from("checklist_templates")
      .select("id, template_key, title")
      .eq("template_key", template_key)
      .maybeSingle();

    if (et2) throw et2;
    if (!tpl) return NextResponse.json({ ok: false, error: "NO_TEMPLATE" }, { status: 404 });

    const { data: items, error: ei } = await admin
      .from("checklist_template_items")
      .select("id, sort, label, description, is_active")
      .eq("template_id", tpl.id)
      .order("sort", { ascending: true });

    if (ei) throw ei;

    return NextResponse.json({ ok: true, template: tpl, items: items || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

/**
 * POST:
 *  - action: "add_item" | "update_item" | "delete_item" | "update_template"
 *
 *  add_item:
 *    { action:"add_item", template_key, label, sort, description?, is_active? }
 *
 *  update_item:
 *    { action:"update_item", id, label?, sort?, description?, is_active? }
 *
 *  delete_item:
 *    { action:"delete_item", id }
 *
 *  update_template:
 *    { action:"update_template", template_key, title }
 */
export async function POST(req: Request) {
  try {
    const a = await assertAdmin(req);
    if (!a.ok) return NextResponse.json({ ok: false, error: a.error }, { status: a.status });
    const admin = a.admin;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "").trim();

    // --- update template title (opcional)
    if (action === "update_template") {
      const template_key = String(body.template_key || "").trim();
      const title = body.title == null ? null : String(body.title);

      if (!template_key) return NextResponse.json({ ok: false, error: "MISSING_TEMPLATE_KEY" }, { status: 400 });

      const { data: tpl, error: et } = await admin
        .from("checklist_templates")
        .update({ title })
        .eq("template_key", template_key)
        .select("id, template_key, title")
        .maybeSingle();

      if (et) throw et;
      return NextResponse.json({ ok: true, template: tpl });
    }

    // --- add item
    if (action === "add_item") {
      const template_key = String(body.template_key || "").trim();
      const label = String(body.label || "").trim();
      const sort = Number(body.sort ?? 10);
      const description = body.description == null ? null : String(body.description);
      const is_active = body.is_active == null ? true : Boolean(body.is_active);

      if (!template_key || !label) return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
      if (!isFinite(sort)) return NextResponse.json({ ok: false, error: "BAD_SORT" }, { status: 400 });

      const { data: tpl, error: et } = await admin
        .from("checklist_templates")
        .select("id, template_key, title")
        .eq("template_key", template_key)
        .maybeSingle();

      if (et) throw et;
      if (!tpl) return NextResponse.json({ ok: false, error: "NO_TEMPLATE" }, { status: 404 });

      const { data: it, error: ei } = await admin
        .from("checklist_template_items")
        .insert({
          template_id: tpl.id,
          label,
          sort,
          description,
          is_active,
        })
        .select("id, sort, label, description, is_active")
        .maybeSingle();

      if (ei) throw ei;
      return NextResponse.json({ ok: true, item: it });
    }

    // --- update item
    if (action === "update_item") {
      const id = String(body.id || "").trim();
      if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

      const patch: any = {};
      if (body.label != null) patch.label = String(body.label).trim();
      if (body.sort != null) {
        const s = Number(body.sort);
        if (!isFinite(s)) return NextResponse.json({ ok: false, error: "BAD_SORT" }, { status: 400 });
        patch.sort = s;
      }
      if (body.description !== undefined) patch.description = body.description == null ? null : String(body.description);
      if (body.is_active != null) patch.is_active = Boolean(body.is_active);

      const { data: it, error: ei } = await admin
        .from("checklist_template_items")
        .update(patch)
        .eq("id", id)
        .select("id, sort, label, description, is_active")
        .maybeSingle();

      if (ei) throw ei;
      return NextResponse.json({ ok: true, item: it });
    }

    // --- delete item
    if (action === "delete_item") {
      const id = String(body.id || "").trim();
      if (!id) return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });

      // borrar primero marks para evitar FK si aplica
      await admin.from("checklist_response_items").delete().eq("item_id", id);

      const { error } = await admin.from("checklist_template_items").delete().eq("id", id);
      if (error) throw error;

      return NextResponse.json({ ok: true });
    }

    // --- compatibilidad con tu UI actual (sin action):
    // Tu Admin actual hace POST con {template_key,id,label,sort} sin action.
    // Lo soportamos aquí tal cual:
    {
      const template_key = String(body.template_key || "").trim();
      const id = String(body.id || "").trim();
      const label = String(body.label || "").trim();
      const sort = Number(body.sort ?? 10);

      if (!template_key) return NextResponse.json({ ok: false, error: "MISSING_TEMPLATE_KEY" }, { status: 400 });
      if (!label) return NextResponse.json({ ok: false, error: "MISSING_LABEL" }, { status: 400 });
      if (!isFinite(sort)) return NextResponse.json({ ok: false, error: "BAD_SORT" }, { status: 400 });

      const { data: tpl, error: et } = await admin
        .from("checklist_templates")
        .select("id")
        .eq("template_key", template_key)
        .maybeSingle();

      if (et) throw et;
      if (!tpl) return NextResponse.json({ ok: false, error: "NO_TEMPLATE" }, { status: 404 });

      if (!id) {
        const { data: it, error: ei } = await admin
          .from("checklist_template_items")
          .insert({ template_id: tpl.id, label, sort, is_active: true })
          .select("id, sort, label, description, is_active")
          .maybeSingle();

        if (ei) throw ei;
        return NextResponse.json({ ok: true, item: it });
      } else {
        const { data: it, error: ei } = await admin
          .from("checklist_template_items")
          .update({ label, sort })
          .eq("id", id)
          .select("id, sort, label, description, is_active")
          .maybeSingle();

        if (ei) throw ei;
        return NextResponse.json({ ok: true, item: it });
      }
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
