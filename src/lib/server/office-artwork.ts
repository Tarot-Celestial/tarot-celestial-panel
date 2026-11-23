import { readFile } from "node:fs/promises";
import path from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { OFFICE_FILE_LIMIT } from "@/features/office/model";

export type Poster = { headline: string; lines: string[] };
export type OfficeVisualVariant = 'cartas' | 'ritual' | 'cielo';
export const officeVisualDescriptions = {
  cartas: 'Baraja violeta y dorada sobre un fondo marfil.',
  ritual: 'Vela encendida entre cristales y piedras de un altar.',
  cielo: 'Arcos dorados bajo un cielo estrellado.',
};
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

function validatePoster({ headline, lines }: Poster) {
  if (!headline?.trim() || headline.length > 84 || !Array.isArray(lines) || lines.length < 1 || lines.length > 3 ||
      lines.some(line => typeof line !== "string" || !line.trim() || line.length > 100)) {
    throw new Error("La composición requiere un título breve y hasta tres textos legibles.");
  }
}

export async function renderOfficeArtwork({ headline, lines }: Poster, variant?: OfficeVisualVariant) {
  validatePoster({headline,lines});
  if (variant) return renderComposition({headline,lines},variant);
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
  return rasterize(svg(content.join("")),font,false);
}

const artFolder = 'src/lib/server/office-art';
async function loadVariantAssets(variant: OfficeVisualVariant) {
  const photoName = variant === 'cartas' ? 'cartas.png' : variant + '.jpg';
  const [photo,logo] = await Promise.all([photoName, 'emblema.png'].map(file => readFile(path.join(process.cwd(),artFolder,file))));
  return { photo:'data:image/' + (variant === 'cartas' ? 'png' : 'jpeg') + ';base64,' + photo.toString('base64'),
    logo:'data:image/png;base64,' + logo.toString('base64') };
}
const variantAssets = new Map<OfficeVisualVariant,ReturnType<typeof loadVariantAssets>>();
const image = (src: string, x: number, y: number, w: number, h: number, fit = 'xMidYMid meet') =>
  `<image x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="${fit}" xlink:href="${src}"/>`;

function textBlock(value:string, family:string, size:number, width:number, rows:number, font:ArtworkFont,
  x:number, centerY:number, ink:string, centered=false) {
  for (let px = size; px >= 32; px -= 2) {
    let parts:string[];
    try { parts = fitLines(value,family,px,width,font); }
    catch { continue; }
    if (parts.length > rows) continue;
    const firstBaseline = centerY + px * 0.3 - (parts.length - 1) * px * 0.59;
    return `<g text-anchor="${centered ? 'middle' : 'start'}">` +
      parts.map((line,i) => label(line,x,firstBaseline + i * px * 1.18,px,family,ink)).join('') + '</g>';
  }
  throw new Error('Acorta el texto para que se lea completo en la pieza.');
}

// Feed uses 4:5. Reel frames are composed in 9:16, inside the title and action safe areas.
async function renderComposition(poster:Poster, variant:OfficeVisualVariant, scene?:number) {
  const {font} = await (cached ||= loadArtworkAssets().catch(e => { cached = undefined; throw e; }));
  const load = variantAssets.get(variant) || loadVariantAssets(variant).catch(e => {variantAssets.delete(variant); throw e;});
  variantAssets.set(variant,load);
  const {photo,logo} = await load;
  const reel = scene !== undefined;
  const height = reel ? 1920 : 1350;
  const paper = variant === 'cartas', sky = variant === 'cielo';
  const ink = paper ? '#30203d' : '#fff8ea', accent = paper ? '#79502b' : '#ebc990';
  const headerY = reel ? 236 : 55;
  const content = [
    `<rect width="1080" height="${height}" fill="${paper ? '#f3e9d8' : sky ? '#101829' : '#241923'}"/>`,
  ];
  if (paper) {
    const cardY = reel ? 340 : 68;
    content.push(`<circle cx="${reel ? 540 : 864}" cy="${cardY + (reel ? 284 : 177)}" r="${reel ? 205 : 131}" fill="#e6d6bb"/>`,
      image(photo,reel ? 230 : 685,cardY,reel ? 620 : 360,reel ? 550 : 360));
  } else {
    const photoY = sky ? (reel ? 615 : 708) : 0;
    const photoHeight = sky ? height - photoY : reel ? 850 : 555;
    content.push(image(photo,0,photoY,1080,photoHeight,sky ? 'xMidYMid slice' : 'xMidYMin slice'),
      `<defs><linearGradient id="shade" x2="0%" y2="100%"><stop offset="0" stop-color="${sky ? '#101829' : '#211621'}" stop-opacity="${sky ? 1 : 0.67}"/><stop offset="0.52" stop-color="${sky ? '#101829' : '#211621'}" stop-opacity="${sky ? 0.72 : 0.25}"/><stop offset="1" stop-color="${sky ? '#101829' : '#241923'}" stop-opacity="${sky ? 0.85 : 1}"/></linearGradient></defs>`,
      `<rect y="${photoY}" width="1080" height="${photoHeight}" fill="url(#shade)"/>`);
  }
  const centered = sky;
  content.push(image(logo,centered ? 478 : 80,headerY,centered ? 124 : 87,centered ? 124 : 87));
  content.push(`<g text-anchor="${centered ? 'middle' : 'start'}">` +
    label('TAROT CELESTIAL',centered ? 540 : 184,headerY + (centered ? 161 : 55),28,textFamily,accent) + '</g>');
  if (reel) {
    const line = scene === 0 ? poster.headline : poster.lines[scene! - 1];
    const bodyY = paper ? 1140 : sky ? 700 : 1120;
    const x = sky || paper ? 540 : 92;
    content.push(textBlock(line,titleFamily,scene === 0 ? 92 : 77,830,5,font,x,bodyY,ink,sky || paper));
    const barY = paper || !sky ? 1480 : 970;
    const origin = 540 - ((poster.lines.length + 1) * 45 - 11) / 2;
    for (let i = 0; i <= poster.lines.length; i++) content.push(`<rect x="${origin + i*45}" y="${barY}" width="34" height="5" rx="2.5" fill="${accent}" opacity="${i === scene ? '1' : '.30'}"/>`);
  } else {
    const titleY = paper ? 378 : sky ? 411 : 415;
    const titleX = sky ? 540 : 79;
    content.push(textBlock(poster.headline,titleFamily,paper ? 76 : 83,paper ? 625 : 900,paper ? 4 : 3,font,titleX,titleY,ink,centered));
    const top = 590, stride = 213;
    for (let i = 0; i < poster.lines.length; i++) {
      const y = top + i*stride;
      const start = sky ? 166 : 87, end = sky ? 914 : 986;
      content.push(`<path d="M${start} ${y}H${end}" stroke="${accent}" opacity=".6"/>`);
      content.push(textBlock(poster.lines[i],textFamily,46,sky ? 847 : 880,3,font,sky ? 540 : 91,y + 105,ink,centered));
    }
  }
  const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="${height}">${content.join('')}</svg>`;
  return rasterize(source,font,reel);
}

function rasterize(source:string, font:ArtworkFont, reel:boolean) {
  const renderer = new Resvg(source, {font,...(reel ? {fitTo:{mode:'width' as const,value:720}} : {})});
  try {
    const frame = renderer.render();
    try {
      const bytes = Buffer.from(frame.asPng());
      if (!bytes.length || (!reel && bytes.length > OFFICE_FILE_LIMIT)) throw new Error('La pieza supera los 2 MiB de la Oficina.');
      return bytes;
    } finally { frame.free(); }
  } finally { renderer.free(); }
}

export function renderOfficeReelScene(poster:Poster, variant:OfficeVisualVariant, index:number) {
  validatePoster(poster);
  if (!Number.isInteger(index) || index < 0 || index > poster.lines.length) throw new Error('Escena fuera del encargo.');
  return renderComposition(poster,variant,index);
}
