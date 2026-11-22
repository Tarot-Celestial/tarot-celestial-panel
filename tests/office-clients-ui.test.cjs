const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const React = require("react");
const { create, act } = require("react-test-renderer");
const ts = require("typescript");

const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const secondId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const first = { id: firstId, display_name: "Cliente uno", country: "España", account_linked: true, capture_stage: "captured", created_at: null };
const second = { ...first, id: secondId, display_name: "Cliente dos", capture_stage: "pending" };
const emptyDetail = row => ({ client: row, first_purchase: null, reservations: [], next_reservations_cursor: null, capture: null });
const totals = { total_clients: 2, captured_clients: 1 };
const base = "https://oficina.test/admin/oficina";

async function renderWorkspace({ search = "?departamento=clientes", request }) {
  const listeners = new Map(), cache = new Map(), calls = [];
  const location = new URL(base + search);
  const history = { state: {}, pushState: setLocation, replaceState: setLocation };
  function setLocation(state, _unused, url) { history.state = state; location.href = url; }
  const window = { location, history, matchMedia: () => ({ matches: false }),
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) };
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const stem = path.join(__dirname, "../src/features/office", name);
    const file = [stem + ".tsx", stem + ".ts"].find(fs.existsSync);
    const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const exports = {};
    vm.runInNewContext(js, { exports, window, Error, URL, URLSearchParams, AbortController, Intl, Date, require(spec) {
      if (spec === "./office-client") return { officeRequest: async (endpoint, init) => {
        const url = new URL(endpoint, base);
        calls.push({ url, signal: init.signal });
        if (url.pathname.endsWith("capture-totals")) return totals;
        return request(url.searchParams);
      } };
      if (["./OfficeCatalog", "./OfficeMap", "./OfficeWork"].includes(spec)) return { default: () => null, DepartmentOwner: () => null };
      if (spec.endsWith(".css")) return { default: {} };
      return spec.startsWith("./") ? load(spec.slice(2)) : require(spec);
    } });
    cache.set(name, exports);
    return exports;
  }
  const Workspace = load("OfficeWorkspace").default;
  const data = { tasks: [], events: [], versions: [], departments: [], workers: [] };
  let tree;
  await act(async () => { tree = create(React.createElement(Workspace, { data, reload: async () => {} })); });
  return {
    calls, location,
    all(tag) { return tree.root.findAllByType(tag); },
    get text() { return JSON.stringify(tree.toJSON()); },
    async click(tag, predicate) {
      const item = this.all(tag).find(predicate);
      assert.ok(item && !item.props.disabled, "Se esperaba un control habilitado");
      await act(async () => { item.props.onClick({ button: 0, preventDefault() {} }); });
    },
    async button(label) { return this.click("button", item => item.children.some(child => typeof child === "string" && child.trim() === label)); },
    async follow(href) { return this.click("a", item => item.props.href === href); },
    async backTo(query) { await act(async () => { history.replaceState({}, "", base + query); listeners.get("popstate")(); }); },
    async close() { await act(async () => { tree.unmount(); }); },
  };
}

test("directorio busca, filtra, pagina y descarta resultados antiguos al cambiar el filtro", async () => {
  let resolvePending;
  const ui = await renderWorkspace({ request(params) {
    if (params.get("stage") === "pending") return new Promise(resolve => { resolvePending = resolve; });
    if (params.get("q")) return { items: [], next_cursor: null };
    if (params.get("cursor")) return { items: [second], next_cursor: null };
    return { items: [first], next_cursor: "pagina-dos" };
  } });
  try {
    assert.match(ui.text, /Cliente uno/);
    await ui.button("Siguiente"); assert.match(ui.text, /Cliente dos/);
    await ui.button("Pendientes");
    const pending = ui.calls.at(-1); assert.equal(pending.url.searchParams.has("cursor"), false);
    await ui.button("Captados"); assert.equal(pending.signal.aborted, true);
    await act(async () => resolvePending({ items: [second], next_cursor: null }));
    assert.match(ui.text, /Cliente uno/); assert.doesNotMatch(ui.text, /Cliente dos/);
    await act(async () => ui.all("input")[0].props.onChange({ target: { value: "  Nadie  " } }));
    await act(async () => ui.all("form")[0].props.onSubmit({ preventDefault() {} }));
    assert.equal(ui.calls.at(-1).url.searchParams.get("q"), "Nadie");
    assert.match(ui.text, /No hay clientes que coincidan/);
  } finally { await ui.close(); }
});

test("ficha profunda conserva cliente y seguimiento al cambiar de departamento y respeta el origen de cada reserva", async () => {
  const lead = "11111111-1111-4111-8111-111111111111";
  const purchase = { id: "compra", source: "crm_cliente_pagos", at: "2025-03-21T18:00:00Z", amount: 12, currency: "USD", status: "refunded" };
  const booking = { id: "reserva-ordinaria", source: "reservas", at: "2026-11-22T18:00:00Z", status: "confirmed", tarotist_name: "Tarotista QA" };
  const clientUrl = "?departamento=clientes&cliente=" + firstId;
  const captureUrl = "?departamento=captacion-reservas&cliente=" + firstId;
  const ui = await renderWorkspace({ search: clientUrl, request(params) {
    if (!params.has("id")) return { items: [first], next_cursor: null };
    const next = params.has("cursor");
    return { ...emptyDetail(first), first_purchase: purchase, capture: { lead_id: lead, status: "contacted", created_at: null },
      reservations: next ? [{ ...booking, id: "primera", source: "first_tarotist_reservations", at: null, status: "cancelled" }] : [booking],
      next_reservations_cursor: next ? null : "reserva-siguiente" };
  } });
  try {
    const hasLink = href => ui.all("a").some(a => a.props.href === href);
    assert.match(ui.text, /Reembolsada/); assert.match(ui.text, /USD/); assert.match(ui.text, /Captado/);
    assert.ok(hasLink("/admin?tab=crm&open_cliente_id=" + firstId));
    assert.ok(hasLink("/admin?tab=reservas&reserva=reserva-ordinaria"));
    await ui.button("Siguientes");
    assert.equal(ui.calls.at(-1).url.searchParams.get("cursor"), "reserva-siguiente");
    assert.match(ui.text, /Sin fecha registrada/); assert.match(ui.text, /Cancelada/); assert.match(ui.text, /Reserva de primera tarotista/);
    assert.equal(hasLink("/admin?tab=reservas&reserva=primera"), false);
    assert.ok(hasLink("/admin?tab=central-primera-tarotista"));
    await ui.follow("/admin/oficina" + captureUrl);
    assert.equal(ui.location.search, captureUrl); assert.match(ui.text, /Resumen histórico de captación/);
    assert.ok(hasLink("/admin?tab=captacion&lead=" + lead));
    await ui.backTo(clientUrl);
    assert.match(ui.text, /Departamento de Clientes/); assert.match(ui.text, /Cliente uno/);
    assert.equal(hasLink("/admin?tab=captacion&lead=" + lead), false);
  } finally { await ui.close(); }
});

test("una ficha fallida ofrece reintento antes de afirmar ausencia de compra o reservas", async () => {
  let available = false;
  const ui = await renderWorkspace({ search: "?departamento=clientes&cliente=" + secondId, request(params) {
    if (!params.has("id")) return { items: [second], next_cursor: null };
    if (!available) throw Error("No se pudo consultar el CRM.");
    return emptyDetail(second);
  } });
  try {
    assert.match(ui.text, /No se pudo consultar el CRM/);
    assert.doesNotMatch(ui.text, /Sin reservas registradas|El CRM todavía no registra/);
    available = true; await ui.button("Reintentar ficha");
    assert.match(ui.text, /Sin reservas registradas/); assert.match(ui.text, /El CRM todavía no registra/);
  } finally { await ui.close(); }
});
