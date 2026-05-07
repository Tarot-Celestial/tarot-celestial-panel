import { NextResponse } from "next/server";

export const runtime = "nodejs";

type CartaInput = {
  nombre?: string;
  email?: string;
  fecha?: string;
  hora?: string;
  ciudad?: string;
  objetivo?: string;
  genero?: string;
};

const SIGNS = [
  { name: "Aries", from: [3, 21], to: [4, 19], element: "Fuego", key: "inicio, valentía y acción", gift: "abrir caminos donde otras personas dudan" },
  { name: "Tauro", from: [4, 20], to: [5, 20], element: "Tierra", key: "presencia, calma y materialización", gift: "convertir deseos en algo estable y real" },
  { name: "Géminis", from: [5, 21], to: [6, 20], element: "Aire", key: "mente, comunicación y versatilidad", gift: "unir ideas, personas y oportunidades" },
  { name: "Cáncer", from: [6, 21], to: [7, 22], element: "Agua", key: "intuición, memoria y protección", gift: "crear hogar emocional allí donde estés" },
  { name: "Leo", from: [7, 23], to: [8, 22], element: "Fuego", key: "brillo, creatividad y liderazgo", gift: "recordar a los demás su propia luz" },
  { name: "Virgo", from: [8, 23], to: [9, 22], element: "Tierra", key: "orden, servicio y mejora", gift: "sanar el caos con precisión y sensibilidad" },
  { name: "Libra", from: [9, 23], to: [10, 22], element: "Aire", key: "belleza, equilibrio y vínculos", gift: "armonizar espacios, relaciones y decisiones" },
  { name: "Escorpio", from: [10, 23], to: [11, 21], element: "Agua", key: "profundidad, transformación y magnetismo", gift: "renacer con más poder después de cada cierre" },
  { name: "Sagitario", from: [11, 22], to: [12, 21], element: "Fuego", key: "expansión, fe y aventura", gift: "dar sentido a lo vivido y abrir horizontes" },
  { name: "Capricornio", from: [12, 22], to: [1, 19], element: "Tierra", key: "estructura, ambición y legado", gift: "construir algo duradero incluso en tiempos difíciles" },
  { name: "Acuario", from: [1, 20], to: [2, 18], element: "Aire", key: "visión, libertad e innovación", gift: "ver el futuro antes de que otros se atrevan" },
  { name: "Piscis", from: [2, 19], to: [3, 20], element: "Agua", key: "sensibilidad, sueños y compasión", gift: "traducir lo invisible en amor y creatividad" },
];

const ELEMENT_COLORS: Record<string, string> = {
  Fuego: "dorado intenso y granate",
  Tierra: "verde profundo y marfil",
  Aire: "azul claro y plata",
  Agua: "violeta, índigo y perla",
};

const MOON_ARCHETYPES = [
  "Luna Guardiana: necesitas seguridad emocional antes de abrirte del todo.",
  "Luna Visionaria: tu intuición aparece como ideas repentinas y señales sutiles.",
  "Luna Magnética: sientes profundamente y atraes vínculos intensos.",
  "Luna Sanadora: vienes a ordenar heridas antiguas con ternura y paciencia.",
];

function clean(v: unknown) {
  return String(v ?? "").trim();
}

function isInRange(month: number, day: number, from: number[], to: number[]) {
  const value = month * 100 + day;
  const start = from[0] * 100 + from[1];
  const end = to[0] * 100 + to[1];
  if (start <= end) return value >= start && value <= end;
  return value >= start || value <= end;
}

function sunSign(fecha: string) {
  const parts = fecha.split("-").map(Number);
  const month = parts[1];
  const day = parts[2];
  return SIGNS.find((s) => isInRange(month, day, s.from, s.to)) || SIGNS[0];
}

function lifePath(fecha: string) {
  const digits = fecha.replace(/\D/g, "").split("").map(Number);
  let n = digits.reduce((a, b) => a + b, 0);
  while (n > 9 && ![11, 22, 33].includes(n)) {
    n = String(n).split("").map(Number).reduce((a, b) => a + b, 0);
  }
  return n;
}

function pseudoAscendente(hora: string, baseIndex: number) {
  const hour = Number((hora || "00:00").split(":")[0] || 0);
  const index = (baseIndex + Math.floor(hour / 2)) % SIGNS.length;
  return SIGNS[index];
}

function moonArchetype(fecha: string, hora: string) {
  const seed = fecha.replace(/\D/g, "").split("").reduce((a, b) => a + Number(b), 0) + Number((hora || "0").slice(0, 2));
  return MOON_ARCHETYPES[seed % MOON_ARCHETYPES.length];
}

function buildReading(input: Required<CartaInput>) {
  const sun = sunSign(input.fecha);
  const sunIndex = SIGNS.findIndex((s) => s.name === sun.name);
  const asc = pseudoAscendente(input.hora, Math.max(0, sunIndex));
  const path = lifePath(input.fecha);
  const moon = moonArchetype(input.fecha, input.hora);
  const color = ELEMENT_COLORS[sun.element] || "violeta y oro";
  const objetivo = input.objetivo || "claridad espiritual, amor y propósito";

  return {
    titulo: `Carta Astral Premium de ${input.nombre}`,
    subtitulo: `${sun.name} con ascendente simbólico ${asc.name}`,
    resumen: `Tu energía central nace bajo ${sun.name}, signo de ${sun.element}, con una vibración orientada a ${sun.key}. Esta lectura híbrida combina cálculo astrológico básico, numerología y una interpretación espiritual personalizada para ${objetivo}.`,
    ficha: {
      nombre: input.nombre,
      email: input.email,
      fecha: input.fecha,
      hora: input.hora,
      ciudad: input.ciudad,
      signoSolar: sun.name,
      elemento: sun.element,
      ascendenteSimbolico: asc.name,
      numeroCaminoVida: path,
      paletaEnergetica: color,
    },
    secciones: [
      {
        titulo: "Tu esencia solar",
        texto: `Como ${sun.name}, tu alma se expresa a través de ${sun.key}. Tu don principal es ${sun.gift}. Cuando estás en equilibrio, transmites una sensación de dirección muy clara: sabes detectar qué te alimenta y qué te apaga. Tu reto aparece cuando dudas de tu propio ritmo y permites que expectativas externas definan tu camino.`,
      },
      {
        titulo: "Ascendente simbólico y primera impresión",
        texto: `El ascendente simbólico calculado para esta lectura es ${asc.name}. Esto habla de cómo te percibe el mundo cuando entras en una etapa nueva: ${asc.key}. Aunque tu signo solar describe tu centro, este ascendente muestra la puerta por la que los demás llegan a ti.`,
      },
      {
        titulo: "Clima emocional lunar",
        texto: `${moon} En relaciones, necesitas que tus emociones sean recibidas sin juicio. Cuando reprimes demasiado lo que sientes, el cuerpo y la intuición empiezan a hablar más fuerte que la mente.`,
      },
      {
        titulo: "Amor y vínculos",
        texto: `En el amor buscas una conexión que no solo sea intensa, sino también coherente. Tu carta sugiere que atraes personas que despiertan partes dormidas de ti. La clave es no confundir química con destino: una relación sana debe darte paz además de magnetismo.`,
      },
      {
        titulo: "Trabajo, dinero y misión",
        texto: `Tu camino profesional mejora cuando unes intuición con estructura. El número ${path} de camino de vida marca una etapa donde debes dejar de dispersarte y elegir una dirección que tenga sentido interno. La abundancia llega cuando tu servicio, tu imagen y tu energía diaria apuntan al mismo objetivo.`,
      },
      {
        titulo: "Mensaje espiritual canalizado",
        texto: `Hay una versión de ti que ya sabe lo que debe cerrar. Esta carta te invita a dejar de pedir permiso para evolucionar. En los próximos meses, tu energía se ordena cuando eliges menos ruido, más verdad y relaciones donde no tengas que minimizar tu luz.`,
      },
      {
        titulo: "Ritual recomendado",
        texto: `Durante 7 noches, escribe una frase comenzando por “me permito”. Enciende una vela blanca o dorada, coloca un vaso de agua cerca y cierra con tres respiraciones profundas. Tu intención: limpiar acuerdos antiguos y abrir una etapa con más claridad.`,
      },
    ],
    afirmaciones: [
      "Honro mi historia, pero no vivo limitada por ella.",
      "Mi intuición merece espacio, tiempo y confianza.",
      "Elijo vínculos que celebran mi evolución.",
    ],
    disclaimer: "Esta carta es una lectura espiritual y simbólica. No sustituye asesoramiento médico, legal, financiero ni psicológico profesional.",
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as CartaInput;
    const input = {
      nombre: clean(body.nombre),
      email: clean(body.email),
      fecha: clean(body.fecha),
      hora: clean(body.hora),
      ciudad: clean(body.ciudad),
      objetivo: clean(body.objetivo),
      genero: clean(body.genero),
    };

    if (!input.nombre || !input.email || !input.fecha || !input.hora || !input.ciudad) {
      return NextResponse.json({ ok: false, error: "FALTAN_DATOS" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, carta: buildReading(input) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
