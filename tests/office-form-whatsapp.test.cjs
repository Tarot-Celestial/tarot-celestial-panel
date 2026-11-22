const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.join(__dirname, "../src/app/api/admin/office/form-whatsapp/route.ts");
const script = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function endpoint(authorized, provider) {
  const counts = { select: () => counts, eq: (key) => key === "whatsapp_consent" ? { count: 0 } : counts, count: 12 };
  const access = authorized ? { ok: true, admin: { from: () => counts } } : { ok: false, response: new Response(null, { status: 403 }) };
  const exports = {};
  vm.runInNewContext(script, { exports, require(id) {
    if (id.endsWith("/office-access")) return { officeAccess: async () => access, officeJson: Response.json, officeError: (_message, status) => new Response(null, { status }) };
    if (id.endsWith("/captacion-whatsapp")) return { captacionWhatsAppTemplate: provider };
    throw Error("Unexpected dependency");
  } });
  return exports.GET;
}

test("el estado de formularios muestra la falta de consentimiento y separa el sandbox de la plantilla sin exponer credenciales", async () => {
  const get = endpoint(true, async () => ({ ready: false, reason: "NOT_CONFIGURED", template: null,
    config: { from: "whatsapp:+14155238886", sid: "", enabled: false, account: "private-test-id", token: "private-test-token" } }));
  assert.deepEqual(await (await get(new Request("https://test.invalid"))).json(), {
    sender: "sandbox", template: "missing", ready: false, enabled: false, forms: 12, consent: 0
  });
});

test("el diagnóstico revocado no lee al proveedor", async () => {
  let called = false;
  const get = endpoint(false, async () => { called = true; });
  assert.equal((await get(new Request("https://test.invalid"))).status, 403);
  assert.equal(called, false);
});
