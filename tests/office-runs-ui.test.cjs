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
  const cache = new Map(), timers = new Map(), calls = [];
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
    vm.runInNewContext(js, { exports, Error, AbortController, console, Date, Intl, crypto: { randomUUID: () => "request-" + ++serial },
      setTimeout: callback => { const id = ++serial; timers.set(id, callback); return id; },
      clearTimeout: id => timers.delete(id),
      require(spec) {
        if (spec === "./office-client") return { officeRequest: request, OfficeRequestError: class extends Error {} };
        if (spec.endsWith(".css")) return { default: {} };
        return spec.startsWith("./") ? load(spec.slice(2)) : require(spec);
      },
    });
    cache.set(name, exports);
    return exports;
  }
  return {
    calls, timers,
    async mount(name, props) { await act(async () => { tree = create(React.createElement(load(name).default, props)); }); },
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
