const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { create, act } = require("react-test-renderer");

const directory = path.join(__dirname, "../src/features/office");
const task = { id: "task-test", department_id: "marketing" };
const run = { id: "run-test", task_id: task.id, step: 0, status: "queued", revision_id: null,
  created_at: "2026-11-22T12:00:00Z", updated_at: "2026-11-22T12:00:00Z", outputs: {}, usage: {} };

function harness(api) {
  const cache = new Map(), timers = new Map(), calls = [], previews = [];
  let serial = 0, tree;
  const request = async (endpoint, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ endpoint, body });
    return api(endpoint, body);
  };
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const base = path.join(directory, name);
    const file = [base + ".ts", base + ".tsx"].find(fs.existsSync);
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const exports = {};
    vm.runInNewContext(js, { exports, Error, AbortController, URL, console, Date, Intl, crypto: { randomUUID: () => "request-" + ++serial },
      setTimeout: callback => { const id = ++serial; timers.set(id, callback); return id; },
      clearTimeout: id => timers.delete(id),
      require(spec) {
        if (spec === "./office-client") return { officeRequest: request, OfficeRequestError: class extends Error {},
          async officeInstagramPreview(version, sha, signal) {
            previews.push({ version, sha, signal });
            return new Blob(["archivo simulado"]);
          } };
        if (spec.endsWith(".css")) return { default: {} };
        return spec.startsWith("./") ? load(spec.slice(2)) : require(spec);
      },
    });
    cache.set(name, exports);
    return exports;
  }
  return {
    calls, timers, previews,
    async mount(name, props, entry = "default") { await act(async () => { tree = create(React.createElement(load(name)[entry], props)); }); },
    button(label) { return tree.root.findAllByType("button").find(b => b.children.includes(label)); },
    async click(label) { const button = this.button(label); assert(button && !button.props.disabled, label);
      await act(async () => { await button.props.onClick(); }); },
    all(tag) { return tree.root.findAllByType(tag); },
    get text() { return JSON.stringify(tree.toJSON()); },
    async close() { await act(async () => tree.unmount()); },
  };
}

test("el alta de Atlas guarda un encargo de Marketing antes de iniciar la ejecución y conserva su id ante un fallo", async () => {
  let saved;
  const ui = harness((url, body) => {
    if (body?.action === "create_task") return { id: task.id };
    assert.equal(url, "/api/admin/office/runs");
    throw new Error("No se confirmó el inicio.");
  });
  await ui.mount("WorkTaskForm", { atlas: true, data: { departments: [{ id: "marketing", name: "Marketing" }], workers: [] },
    reload: async () => {}, onClose() {}, onSaved: (id, error) => { saved = { id, error }; } });
  await act(async () => ui.all("textarea")[0].props.onChange({ target: { value: "Preparar un post editorial." } }));
  await act(async () => ui.all("form")[0].props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(ui.calls.map(c => c.body.action), ["create_task", "start"]);
  const created = ui.calls[0].body, posted = ui.calls[1].body;
  assert.equal(created.department_id, "marketing");
  assert.equal(created.assignee_role, "atlas");
  assert.equal(posted.task_id, task.id);
  assert.equal(saved.id, task.id);
  assert.equal(saved.error.requestId, posted.request_id);
  await ui.close();
});

test("Atlas reutiliza la solicitud tras un fallo incierto y permite cancelar el trabajo en cola", async () => {
  let rows = [], attempt = 0;
  const ui = harness((_url, body) => {
    if (!body) return { runs: rows };
    if (body.action === "start") {
      if (++attempt === 1) throw new Error("Conexión interrumpida");
      rows = [run];
    } else if (body.action === "cancel") rows = [{ ...run, status: "cancelled" }];
    return { ok: true };
  });
  await ui.mount("OfficeRuns", { task, versions: [], reload: async () => {}, onEdit() {} });
  await ui.click("Encargar a Atlas");
  assert.match(ui.text, /Conexión interrumpida/);
  await ui.click("Encargar a Atlas");
  const starts = ui.calls.map(c => c.body).filter(b => b?.action === "start");
  assert.equal(starts.length, 2);
  assert.equal(starts[0].request_id, starts[1].request_id);
  assert.equal(ui.timers.size, 1);
  await ui.click("Cancelar ejecución");
  assert.equal(ui.calls.find(c => c.body?.action === "cancel").body.run_id, run.id);
  assert.match(ui.text, /Cancelado/);
  assert.equal(ui.timers.size, 0);
  await ui.close();
});

test("la corrección usa la versión vigente y al completarse recarga el entregable una vez", async () => {
  let rows = [], refreshes = 0;
  const ui = harness((_url, body) => {
    if (!body) return { runs: rows };
    rows = [{ ...run, status: "review", step: 3, outputs: { 0: { brief: "Preparar texto" }, 1: { caption: "Texto corregido" } } }];
    return { ok: true };
  });
  const base = { task_id: task.id, deliverable_id: "series", title: "Texto", status: "cambios" };
  await ui.mount("OfficeRuns", { task, reload: async () => { refreshes++; }, onEdit() {},
    versions: [{ ...base, id: "v1", version: 1 }, { ...base, id: "v2", version: 2, review_note: "Acortar el cierre" }] });
  assert.match(ui.text, /Acortar el cierre/);
  await ui.click("Pedir la corrección a Atlas");
  assert.equal(ui.calls.find(c => c.body?.action === "start").body.revision_id, "v2");
  assert.match(ui.text, /Texto corregido/);
  await ui.click("Actualizar estado");
  assert.equal(refreshes, 1);
  await ui.close();
});

test("el catálogo consulta al abrir, conserva monedas y solo autoriza con mercado y moneda explícitos", async () => {
  const offer = { id: "promotion", title: "Oferta de prueba", packages: [
    { name: "Paquete", currency: "USD", base_minutes: 30, bonus_minutes: 4, price: 12 },
    { name: "Paquete", currency: "EUR", base_minutes: 30, bonus_minutes: 4, price: 14 },
  ], scopes: [{ market: "es", currency: "EUR", channel: "instagram", enabled: true, valid: true }] };
  const ui = harness((_url, body) => body ? { ok: true } : { offers: [offer] });
  await ui.mount("OfficeCatalog", {});
  assert.equal(ui.calls.length, 0);
  await act(async () => ui.all("details")[0].props.onToggle({ currentTarget: { open: true } }));
  assert(ui.button("Autorizar uso en borradores").props.disabled);
  await act(async () => ui.all("input")[0].props.onChange({ target: { value: "es" } }));
  await act(async () => ui.all("select")[0].props.onChange({ target: { value: "EUR" } }));
  assert(ui.button("Retirar autorización"));
  await ui.click("Retirar autorización");
  assert.equal(ui.calls.find(c => c.body).body.enabled, false);
  await act(async () => ui.all("input")[0].props.onChange({ target: { value: "pr" } }));
  await act(async () => ui.all("select")[0].props.onChange({ target: { value: "USD" } }));
  assert.equal(ui.calls.filter(c => c.body).length, 1);
  await act(async () => ui.all("form")[0].props.onSubmit({ preventDefault() {} }));
  const posted = ui.calls.filter(c => c.body).at(-1);
  assert.equal(posted.endpoint, "/api/admin/office/catalog");
  assert.deepEqual(posted.body, { promotion_id: "promotion", market: "PR", currency: "USD", channel: "instagram", enabled: true });
  await ui.close();
});

const igVersion = { id: "version-test", version: 2, title: "Pieza de prueba", status: "aprobado" };
const igDraft = {
  eligible: true, caption: "¿Qué quieres explorar?", alt_text: "Una pregunta en una tarjeta vertical",
  media_type: "image/jpeg", media_sha256: "sha-test", offer: null, posts: [],
  connection: { account_id: "123", username: "cuenta_de_prueba", owner_id: "admin-test", can_publish: true,
    connected_at: "2026-11-21T12:00:00Z", checked_at: "2026-11-22T12:00:00Z", permissions: ["instagram_business_content_publish"],
    permission_source: "quota", expires_at: null, bind_on_approval: true },
};
const igPost = { id: "post-test", version_id: igVersion.id, time_zone: "Europe/Madrid", scheduled_at: null, updated_at: "2026-11-22T12:00:00Z",
  container_id: "container-test", external_post_id: null, permalink: null, metrics: null, last_error: null };
const change = (node, value) => act(async () => node.props.onChange({ target: { value } }));
const submit = ui => act(async () => ui.all("form")[0].props.onSubmit({ preventDefault() {} }));
const igStart = "Preparar publicación en Instagram";

test("Instagram exige la vista previa exacta, aprueba una versión pendiente y recupera el recibo sin repetir el envío", async () => {
  let rows = [], approvals = 0, reloaded = 0;
  const ui = harness((url, body) => {
    if (!body) {
      assert.equal(url, "/api/admin/office/instagram?version_id=version-test");
      return { ...igDraft, posts: rows };
    }
    assert.equal(url, "/api/admin/office/instagram");
    if (body.action === "approve") {
      if (++approvals === 1) throw new Error("Respuesta interrumpida");
      rows = [{ ...igPost, status: "verifying" }];
    } else if (body.action === "refresh") {
      rows = [{ ...igPost, status: "published", external_post_id: "media-test", permalink: "https://www.instagram.com/p/prueba/",
        metrics: { likes: 0, reach: null, comments: 2, period: "lifetime", checked_at: igPost.updated_at } }];
    }
    return { ok: true };
  });
  await ui.mount("OfficeInstagram", { version: { ...igVersion, status: "pendiente" }, current: true, onApproved: async () => { reloaded++; } });
  assert.equal(ui.calls.length, 0);
  await ui.click(igStart);
  assert.deepEqual(ui.previews.map(({ version, sha }) => [version, sha]), [[igVersion.id, igDraft.media_sha256]]);
  assert.equal(ui.all("img")[0].props.alt, igDraft.alt_text);
  assert.match(ui.text, /vincularás esta cuenta/);
  assert.match(ui.text, /aprobarás esta versión/);
  assert(ui.button("Aprobar y publicar ahora").props.disabled);
  await submit(ui);
  assert.equal(ui.calls.filter(c => c.body).length, 0);
  await act(async () => ui.all("img")[0].props.onLoad());
  assert.equal(ui.button("Aprobar y publicar ahora").props.disabled, false);
  await submit(ui);
  assert.match(ui.text, /Respuesta interrumpida/);
  await submit(ui);
  const approvalsSent = ui.calls.map(c => c.body).filter(b => b?.action === "approve");
  assert.equal(approvalsSent.length, 2);
  assert.deepEqual(approvalsSent[0], approvalsSent[1]);
  assert.deepEqual(approvalsSent[0], { action: "approve", version_id: igVersion.id, account_id: igDraft.connection.account_id,
    username: igDraft.connection.username, connection_owner: igDraft.connection.owner_id, connected_at: igDraft.connection.connected_at,
    caption: igDraft.caption, alt_text: igDraft.alt_text, offer: igDraft.offer, media_sha256: igDraft.media_sha256,
    scheduled_at: null, time_zone: "Europe/Madrid", request_id: approvalsSent[0].request_id });
  assert.equal(reloaded, 1);
  assert.equal(ui.button("Aprobar y publicar ahora"), undefined);
  assert.equal(ui.button("Cancelar publicación"), undefined);
  assert.equal(ui.timers.size, 1);
  await ui.click("Reanudar comprobación");
  assert.deepEqual(ui.calls.filter(c => c.body).at(-1).body, { action: "refresh", id: igPost.id });
  assert.equal(ui.timers.size, 0);
  assert(ui.all("a").some(a => a.props.href === "https://www.instagram.com/p/prueba/"));
  const values = ui.all("dd").flatMap(n => n.children);
  for (const value of ["media-test", "0", "Sin datos", "2", "Desde la publicación"]) assert(values.includes(value));
  await ui.close();
  assert(ui.previews[0].signal.aborted);
});

test("Instagram programa vídeo en Puerto Rico, distingue las dos horas de Madrid y permite cancelar antes del envío", async () => {
  let rows = [];
  const ui = harness((_url, body) => {
    if (!body) return { ...igDraft, offer: "Oferta de prueba · PR · USD", media_type: "video/mp4", posts: rows };
    if (body.action === "approve") rows = [{ ...igPost, status: "queued", scheduled_at: body.scheduled_at, time_zone: body.time_zone }];
    if (body.action === "cancel") rows = [{ ...rows[0], status: "cancelled" }];
    return { ok: true };
  });
  await ui.mount("OfficeInstagram", { version: igVersion, current: true });
  await ui.click(igStart);
  await act(async () => ui.all("video")[0].props.onLoadedData());
  await change(ui.all("select")[0], "scheduled");
  await change(ui.all("input")[0], "2030-03-31T02:15");
  assert.match(ui.text, /Esta hora no existe/);
  assert(ui.button("Aprobar y programar").props.disabled);
  await change(ui.all("input")[0], "2030-10-27T02:15");
  assert(ui.button("Aprobar y programar").props.disabled);
  await change(ui.all("select")[2], "2030-10-27T01:15:00.000Z");
  assert.equal(ui.button("Aprobar y programar").props.disabled, false);
  await change(ui.all("select")[1], "America/Puerto_Rico");
  await change(ui.all("input")[0], "2030-01-12T10:15");
  assert.equal(ui.calls.filter(c => c.body).length, 0);
  await submit(ui);
  const payload = ui.calls.find(c => c.body).body;
  assert.equal(payload.scheduled_at, "2030-01-12T14:15:00.000Z");
  assert.equal(payload.time_zone, "America/Puerto_Rico");
  assert.equal(payload.offer, "Oferta de prueba · PR · USD");
  assert.match(ui.text, /Programada/);
  await ui.click("Cancelar publicación");
  assert.deepEqual(ui.calls.filter(c => c.body).at(-1).body, { action: "cancel", id: igPost.id });
  assert.match(ui.text, /Cancelada/);
  await ui.close();
});

test("Instagram bloquea la autorización sin permiso, con un archivo ilegible y en versiones sustituidas", async () => {
  for (const current of [true, false]) {
    const ui = harness(() => ({ ...igDraft, connection: { ...igDraft.connection, can_publish: false, message: "Se necesita reconectar Instagram." } }));
    await ui.mount("OfficeInstagram", { version: igVersion, current });
    await ui.click(current ? igStart : "Ver historial de Instagram");
    assert(ui.all("a").some(a => a.props.href === "/admin?tab=redes-sociales"));
    assert.match(ui.text, /Se necesita reconectar/);
    if (current) {
      await act(async () => ui.all("img")[0].props.onLoad());
      assert(ui.button("Aprobar y publicar ahora").props.disabled);
      await act(async () => ui.all("img")[0].props.onError());
      assert.match(ui.text, /no ha podido mostrar el archivo/);
      await submit(ui);
    } else {
      assert.equal(ui.button("Aprobar y publicar ahora"), undefined);
      assert.equal(ui.previews.length, 0);
    }
    assert.equal(ui.calls.filter(c => c.body).length, 0);
    await ui.close();
  }
});

test("la preparación de Instagram está en la ficha y en Revisiones de Marketing sin cargar conexiones al entrar", async () => {
  const previous = { ...igVersion, id: "version-anterior", title: "Texto anterior", version: 1, task_id: task.id, deliverable_id: "serie",
    created_at: igPost.updated_at, body: "", file_type: null, reviewed_at: igPost.updated_at };
  const current = { ...previous, id: igVersion.id, version: 2, status: "pendiente", reviewed_at: null };
  const data = { tasks: [task], versions: [previous, current], departments: [{ id: "marketing", name: "Marketing" }], workers: [] };
  const props = { task, data, reload: async () => {} };
  for (const component of ["WorkDeliverables", "WorkReviews"]) {
    const ui = harness(() => { throw new Error("Consulta inesperada"); });
    await ui.mount("WorkDeliverables", props, component);
    assert.equal(ui.all("button").filter(n => n.children.includes(igStart)).length, 1);
    if (component === "WorkReviews") await ui.click("Historial");
    assert(ui.button("Ver historial de Instagram"));
    assert.equal(ui.calls.length, 0);
    await ui.close();
  }
});
