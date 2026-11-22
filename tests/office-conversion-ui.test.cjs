const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");
const { act, create } = require("react-test-renderer");

function component(file, imports = {}, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } });
  const out = {};
  vm.runInNewContext(outputText, { exports: out, Intl, URLSearchParams, Headers, AbortController, ...globals,
    require(name) { return imports[name] || (name.endsWith(".css") ? { default: {} } : require(name)); },
  });
  return out.default;
}

test("el país cambia numerador, denominador y mediana; un período sin madurar no muestra cero por ciento", async () => {
  const Conversion = component("src/features/office/OfficeCampaignConversion.tsx");
  const total = { country: null, contacts: 100, replied: 25, median_reply_minutes: 90, first_buyers: 7,
    matured_contacts: 60, buyers_within_7d: 3, buyers_after_reply: 2, phone_routed: 5, oracle_routed: 2,
    recorded_consultations: 11, without_reply_or_purchase: 70 };
  const argentina = { ...total, country: "Argentina", contacts: 8, replied: 0, median_reply_minutes: null,
    first_buyers: 1, matured_contacts: 0, buyers_within_7d: 0 };
  const spain = { ...argentina, country: "España", contacts: 1, first_buyers: 0, matured_contacts: 1 };
  const colombia = { ...spain, country: "Colombia", first_buyers: 1, buyers_within_7d: 1 };
  let ui;
  await act(async () => { ui = create(React.createElement(Conversion, { funnel: { total, countries: [argentina, spain, colombia, total] } })); });
  try {
    function checkCounts(accumulated, sevenDays) {
      const captions = ui.root.findAllByType("small");
      assert.equal(captions[0].children.join(""), accumulated + ".");
      assert.equal(captions[2].children.join(""), sevenDays + " con siete días completos de observación.");
    }
    checkCounts("7 primeras compras entre 100 contactos", "3 primeras compras entre 60 contactos");
    assert.match(JSON.stringify(ui.toJSON()), /1 h 30 min/);
    const select = ui.root.findByType("select");
    await act(async () => select.props.onChange({ target: { value: "country:Argentina" } }));
    const text = JSON.stringify(ui.toJSON());
    assert.match(text, /12,5/);
    assert.match(text, /Sin base/);
    assert.match(text, /Sin dato/);
    assert.match(text, /Sin país registrado/);
    checkCounts("1 primera compra entre 8 contactos", "0 primeras compras entre 0 contactos");
    await act(async () => select.props.onChange({ target: { value: "country:España" } }));
    checkCounts("0 primeras compras entre 1 contacto", "0 primeras compras entre 1 contacto");
    await act(async () => select.props.onChange({ target: { value: "country:Colombia" } }));
    checkCounts("1 primera compra entre 1 contacto", "1 primera compra entre 1 contacto");
  } finally { await act(async () => ui.unmount()); }
});

test("entrar al Oráculo sigue disponible aunque no se pueda registrar una visita; vincular sigue siendo explícito", async () => {
  const calls = [];
  const Entry = component("src/app/cliente/vincular-meta/page.tsx", {
    "@/components/cliente/ClientAuthShell": { default: ({ children }) => React.createElement("main", null, children) },
    "@/lib/client-entry": { clientLoginHref: () => "/cliente/login" },
    "@/lib/supabase-browser": { supabaseClienteBrowser: () => { throw new Error("No debe pedir autenticación aquí"); } },
  }, {
    window: { location: { search: "?ref=example" } },
    fetch: async (_url, opts) => {
      calls.push(opts);
      if (opts.method === "GET") return Response.json({ destination: "oracle" });
      throw new Error("Visita no disponible");
    },
  });
  let ui;
  await act(async () => { ui = create(React.createElement(Entry)); });
  try {
    const link = ui.root.findByType("a");
    assert.equal(link.props.href, "/cliente/oraculo");
    await act(async () => link.props.onClick());
    assert.equal(calls[1].keepalive, true);
    assert.deepEqual(JSON.parse(calls[1].body), { action: "visit" });
    assert.match(JSON.stringify(ui.toJSON()), /Vincular mi conversación/);
  } finally { await act(async () => ui.unmount()); }
});
