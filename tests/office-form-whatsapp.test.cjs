const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = path.join(__dirname, "../src/app/api/admin/office/form-whatsapp/route.ts");
const coverage = { month: "2026-11", submissions: 3, granted: 0, declined: 1, missing: 2, review: 0 };
const script = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function endpoint(authorized, provider) {
  const counts = { select: () => counts, eq: (key) => key === "whatsapp_consent" ? { count: 0 } : counts, count: 12 };
  const access = authorized ? { ok: true, authUserId: "admin", admin: { from: () => counts, rpc: async (name, input) => {
    assert.equal(name, "office_form_whatsapp_coverage"); assert.equal(input.p_actor, "admin"); return { data: coverage };
  } } } : { ok: false, response: new Response(null, { status: 403 }) };
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
    sender: "sandbox", template: "missing", ready: false, enabled: false, forms: 12, consent: 0, coverage
  });
});

test("el diagnóstico revocado no lee al proveedor", async () => {
  let called = false;
  const get = endpoint(false, async () => { called = true; });
  assert.equal((await get(new Request("https://test.invalid"))).status, 403);
  assert.equal(called, false);
});

test("la bienvenida valida el número autorizado al preparar y antes de transmitir", async () => {
  const filePath = path.join(__dirname, "../src/lib/server/office-social-whatsapp.ts");
  const source = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const phone = "+34600000123";
  let allowed = true, transmitted = 0, autonomyChecks = 0;
  const job = { id: "op", request_id: "req", actor_worker_id: "worker", actor_user_id: "user",
    whatsapp_consent: true, client_id: "c", lead_id: "lead", source_id: "101" };
  const db = { async rpc(name, args) {
    assert.equal(name, "office_form_verify_whatsapp_target");
    assert.equal(args.p_phone, phone); assert.equal(args.p_id, job.id); assert.equal(args.p_request, job.request_id);
    return { data: allowed };
  } };
  const dependencies = {
    "server-only": {}, "node:crypto": require("node:crypto"), "./whatsapp-gateway": {},
    "./admin-access": { hasAdminAccess: async () => true },
    "./office-social-policy": { DispatchDecision: class Decision extends Error {} },
    "./captacion-whatsapp": {
      captacionWhatsAppLead: async () => ({ client: { id: "c" }, lead: {}, submission_key: "meta:101" }),
      captacionWhatsAppRecipient: () => phone, captacionWhatsAppName: () => "Fixture",
      captacionWhatsAppTemplate: async () => ({ ready: true, template: {} }), CAPTACION_WHATSAPP_BODY: "Hola {{1}}",
      sendCaptacionWhatsAppOfficial: async (_db, _actor, _context, _req, verify) => {
        await verify(); transmitted++; return { status: "accepted", message_id: "receipt" };
      },
    },
  };
  vm.runInNewContext(source, { exports, require: name => dependencies[name] });
  const check = async () => { autonomyChecks++; };
  const prepared = await exports.prepareFormReply(db, job, check);
  allowed = false;
  await assert.rejects(prepared.send(), /FORM_TARGET_UNVERIFIED/);
  await assert.rejects(exports.prepareFormReply(db, job, check), /FORM_TARGET_UNVERIFIED/);
  assert.equal(transmitted, 0);
  allowed = true;
  const success = await exports.prepareFormReply(db, job, check);
  assert.equal(await success.send(), "receipt");
  assert.equal(transmitted, 1); assert.equal(autonomyChecks, 1);
});
