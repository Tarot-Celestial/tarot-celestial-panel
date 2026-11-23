const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");

function moduleFor(name, mocks={}) {
  const source = fs.readFileSync("src/lib/server/" + name + ".ts", "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, Buffer, process, Uint8Array, require: id =>
    id === "@/features/office/model" ? { OFFICE_FILE_LIMIT: 2097152 } : mocks[id] || require(id) });
  return exports;
}
const art = moduleFor("office-artwork");

test("Contenido produce una imagen PNG privada a tamaño de feed con texto y símbolos de la oferta", async () => {
  const png = await art.renderOfficeArtwork({ headline: "Una consulta para ti", lines: [
    "20 min + 5 min de regalo · 15 €", "Mercado ES · Vigente hasta el 30 de noviembre", "Luz & calma",
  ] });
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
  assert.ok(png.length < 2 * 1024 * 1024);
  await assert.rejects(art.renderOfficeArtwork({ headline: "a".repeat(85), lines: ["Hola"] }));
});

test("las tres composiciones mantienen las dimensiones del feed y entregan archivos distintos por debajo de 2 MiB", async () => {
  const copy={headline:"Antes de elegir tu próximo paso",lines:["¿Qué necesita hoy tu atención?","¿Qué te gustaría ver con más claridad?","¿Qué decisión está en tus manos?"]};
  const hashes = new Set();
  for(const variant of ["cartas","ritual","cielo"]) {
    const png = await art.renderOfficeArtwork(copy,variant);
    assert.equal(png.readUInt32BE(16),1080);
    assert.equal(png.readUInt32BE(20),1350);
    assert.ok(png.length <= 2*1024*1024);
    hashes.add(createHash("sha256").update(png).digest("hex"));
  }
  assert.equal(hashes.size,3);
});

test("el Reel se decodifica en H.264, presenta varias escenas legibles y pasa el verificador de publicación", async () => {
  const reel=moduleFor("office-reel",{"./office-artwork":art});
  const media=moduleFor("office-instagram-media");
  const copy={headline:"Tu primera consulta",lines:["Una pregunta para empezar","¿Desde qué país nos escribes?"]};
  const bytes=await reel.renderOfficeReel(copy,"cartas");
  assert.ok(bytes.length > 10000 && bytes.length < 2*1024*1024);
  const prepared=await media.prepareInstagramMedia(bytes,"video/mp4");
  assert.equal(prepared.sha,createHash("sha256").update(bytes).digest("hex"));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"test-office-reel-"));
  try {
    const file=path.join(dir,"reel.mp4");
    fs.writeFileSync(file,bytes);
    const binary=process.env.FFMPEG_PATH || require("ffmpeg-static");
    const {stderr}=require("node:child_process").spawnSync(binary,["-hide_banner","-i",file,"-frames:v","1","-f","null","-"],{encoding:"utf8",windowsHide:true});
    assert.match(stderr,/Duration: 00:00:09\.60/);
    assert.match(stderr,/Video: h264[^\n]*720x1280[^\n]*30 fps/);
    const samples=[1,4.5,7.5].map(t=>execFileSync(binary,["-loglevel","error","-ss",String(t),"-i",file,"-frames:v","1","-vf","scale=100:178","-f","framemd5","-"],{encoding:"utf8",windowsHide:true}).trim().split(",").at(-1).trim());
    assert.equal(new Set(samples).size,3);
    const caption=media.publicInstagramText("Texto público\n\nTexto del vídeo\n\nTexto en pantalla\n\nTexto alternativo\n\nDescripción");
    assert.equal(caption.caption,"Texto público"); assert.equal(caption.alt_text,"Descripción");
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
