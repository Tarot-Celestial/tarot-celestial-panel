const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
function load(file) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(path.join("src/lib/server",file), "utf8"), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText;
  vm.runInNewContext(js,{exports,require,Buffer,Date,URL,URLSearchParams,process:{env:{CRON_SECRET:"office-test-only"}}});
  return exports;
}
test("el JPEG final se reproduce byte a byte y el caption excluye los textos internos de revisión",async () => {
  const {prepareInstagramMedia,publicInstagramText} = load("office-instagram-media.ts");
  const input = fs.readFileSync("src/lib/server/office-art/brand-sky.jpg");
  const a = await prepareInstagramMedia(input,"image/jpeg"), b = await prepareInstagramMedia(input,"image/jpeg");
  assert.equal(a.sha,b.sha); assert.deepEqual(a.bytes,b.bytes); assert.equal(a.type,"image/jpeg");
  assert.equal(a.bytes.subarray(0,3).toString("hex"),"ffd8ff");
  const text = publicInstagramText("Texto del feed.\n\nTexto de la imagen\n\nPregunta\n\nTexto alternativo\n\nTarjeta vertical.");
  assert.equal(text.caption,"Texto del feed."); assert.equal(text.alt_text,"Tarjeta vertical.");
  await assert.rejects(prepareInstagramMedia(Buffer.from("invalid"),"image/jpeg"));
});
test("solo la firma del archivo exacto y dentro de su ventana autoriza la descarga",() => {
  const {officeMediaUrl,validOfficeMediaUrl} = load("office-instagram-link.ts");
  const sha = "a".repeat(64), id = "job";
  const p = new URL(officeMediaUrl(id,sha)).searchParams;
  assert.equal(validOfficeMediaUrl(id,sha,p.get("exp"),p.get("sig")),true);
  assert.equal(validOfficeMediaUrl(id,"b".repeat(64),p.get("exp"),p.get("sig")),false);
  assert.equal(validOfficeMediaUrl(id,sha,String(Math.floor(Date.now()/1000)-1),p.get("sig")),false);
});
