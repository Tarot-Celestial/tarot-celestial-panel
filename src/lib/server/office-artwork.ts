import { readFile } from "node:fs/promises";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { OFFICE_FILE_LIMIT } from "@/features/office/model";

type Poster = { headline: string; lines: string[] };
const textFamily = "Noto Sans", titleFamily = "Gloock";
const svg = (content: string) => '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1350">' + content + '</svg>';
const escapeText = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const label = (value: string, x: number, y: number, size: number, family = textFamily, fill = "#fff5e8") =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" fill="${fill}">${escapeText(value)}</text>`;

async function loadArtworkAssets() {
  const [background, display, text, wasm] = await Promise.all([
    readFile(path.join(process.cwd(), "src/lib/server/office-art/brand-sky.jpg")),
    readFile(path.join(process.cwd(), "src/lib/server/office-art/Gloock-Regular.ttf")),
    readFile(path.join(process.cwd(), "node_modules/next/dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf")),
    readFile(path.join(process.cwd(), "node_modules/@resvg/resvg-wasm/index_bg.wasm")),
  ]);
  await initWasm(new Uint8Array(wasm));
  return { background: background.toString("base64"), font: { fontBuffers: [display, text], defaultFontFamily: textFamily } };
}
let cached: ReturnType<typeof loadArtworkAssets> | undefined;
type ArtworkFont = Awaited<ReturnType<typeof loadArtworkAssets>>["font"];

function fitLines(value: string, family: string, size: number, width: number, font: ArtworkFont) {
  const lines: string[] = [];
  let current = "";
  const measure = (text: string) => {
    const probe = new Resvg(svg(label(text, 0, 140, size, family)), { font });
    try {
      const box = probe.innerBBox();
      if (!box) return 0;
      try { return box.width; } finally { box.free(); }
    } finally { probe.free(); }
  };
  for (const word of value.trim().split(/\s+/)) {
    const next = current ? current + " " + word : word;
    if (measure(next) <= width) { current = next; continue; }
    if (!current || measure(word) > width) throw new Error("El texto contiene una palabra demasiado larga para la pieza.");
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

export async function renderOfficeArtwork({ headline, lines }: Poster) {
  if (!headline?.trim() || headline.length > 84 || !Array.isArray(lines) || lines.length < 1 || lines.length > 3 ||
      lines.some(line => typeof line !== "string" || !line.trim() || line.length > 100)) {
    throw new Error("La composición requiere un título breve y hasta tres textos legibles.");
  }
  const { background, font } = await (cached ||= loadArtworkAssets().catch(e => { cached = undefined; throw e; }));
  const titleSize = headline.length > 54 ? 70 : 84;
  const titles = fitLines(headline, titleFamily, titleSize, 896, font);
  if (titles.length > 3) throw new Error("Acorta el título para que quepa en el cartel.");
  const gold = "#ebcd94";
  const content = [
    `<image width="1080" height="1350" xlink:href="data:image/jpeg;base64,${background}"/>`,
    '<text x="82" y="106" font-family="Noto Sans" font-size="25" letter-spacing="5" fill="#ebcd94">TAROT CELESTIAL</text>',
    ...titles.map((line, i) => label(line, 78, 450 - (titles.length - 1 - i) * (titleSize + 7), titleSize, titleFamily)),
    '<path d="M82 512H998" stroke="#bfa575" stroke-width="2"/>',
  ];
  lines.forEach((line, i) => {
    const size = line.length > 68 ? 40 : 46;
    const rows = fitLines(line, textFamily, size, 800, font);
    if (rows.length > 3) throw new Error("Acorta el texto para que quepa en la pieza.");
    const middle = 622 + i * 212;
    content.push(label("0" + (i + 1), 83, middle + 11, 33, titleFamily, gold));
    rows.forEach((row, n) => content.push(label(row, 174, middle + size / 3 + (n - (rows.length - 1) / 2) * (size + 10), size)));
    content.push(`<path d="M82 ${middle + 102}H998" stroke="#796b81"/>`);
  });
  const renderer = new Resvg(svg(content.join("")), { font });
  try {
    const image = renderer.render();
    try {
      const bytes = Buffer.from(image.asPng());
      if (!bytes.length || bytes.length > OFFICE_FILE_LIMIT) throw new Error("La imagen supera los 2 MiB de la Oficina.");
      return bytes;
    } finally { image.free(); }
  } finally { renderer.free(); }
}
