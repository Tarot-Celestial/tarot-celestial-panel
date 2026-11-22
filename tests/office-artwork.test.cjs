const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

test("Contenido produce una imagen PNG privada a tamaño de feed con texto y símbolos de la oferta", async () => {
  const source = fs.readFileSync("src/lib/server/office-artwork.ts", "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Buffer, process, Uint8Array, require: id =>
    id === "@/features/office/model" ? { OFFICE_FILE_LIMIT: 2097152 } : require(id) });
  const png = await exports.renderOfficeArtwork({ headline: "Una consulta para ti", lines: [
    "20 min + 5 min de regalo · 15 €", "Mercado ES · Vigente hasta el 30 de noviembre", "Luz & calma",
  ] });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
  assert.ok(png.length < 2 * 1024 * 1024);
  await assert.rejects(exports.renderOfficeArtwork({ headline: "a".repeat(85), lines: ["Hola"] }));
});
