import { NextResponse } from "next/server";

export const runtime = "nodejs";

const signos = [
  "Aries", "Tauro", "Géminis", "Cáncer", "Leo", "Virgo", "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis",
];

const meses = [
  ["Capricornio", 20], ["Acuario", 19], ["Piscis", 20], ["Aries", 20], ["Tauro", 21], ["Géminis", 21],
  ["Cáncer", 23], ["Leo", 23], ["Virgo", 23], ["Libra", 23], ["Escorpio", 22], ["Sagitario", 22],
] as const;

function sunSign(date: string) {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Solar";
  const month = d.getMonth();
  const day = d.getDate();
  const [current, cutoff] = meses[month];
  if (day < cutoff) return current;
  return signos[(signos.indexOf(current) + 1) % signos.length];
}

function pick<T>(arr: T[], seed: number) {
  return arr[Math.abs(seed) % arr.length];
}

function seedFrom(input: string) {
  return Array.from(input).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const nombre = String(body?.nombre || "").trim();
    const email = String(body?.email || "").trim();
    const fechaNacimiento = String(body?.fechaNacimiento || "").trim();
    const horaNacimiento = String(body?.horaNacimiento || "").trim();
    const ciudadNacimiento = String(body?.ciudadNacimiento || "").trim();
    const temaPrincipal = String(body?.temaPrincipal || "general").trim();
    const pregunta = String(body?.pregunta || "").trim();

    if (!nombre || !email || !fechaNacimiento || !horaNacimiento || !ciudadNacimiento) {
      return NextResponse.json({ ok: false, error: "Faltan datos para crear la muestra." }, { status: 400 });
    }

    const signo = sunSign(fechaNacimiento);
    const seed = seedFrom(`${nombre}-${email}-${fechaNacimiento}-${horaNacimiento}-${ciudadNacimiento}-${temaPrincipal}`);
    const luna = pick(["Luna de Agua", "Luna de Fuego", "Luna de Tierra", "Luna de Aire", "Luna Intuitiva", "Luna Protectora"], seed + 3);
    const asc = pick(["Ascendente Magnético", "Ascendente Serena/o", "Ascendente Visionario", "Ascendente Sanador", "Ascendente Solar", "Ascendente Misterioso"], seed + 7);
    const arquetipo = pick(["La Sacerdotisa", "La Estrella", "El Sol Interior", "La Emperatriz", "El Ermitaño Luminoso", "La Templanza"], seed + 11);

    const temaTexto: Record<string, string> = {
      amor: "En el amor, tu carta habla de vínculos que deben sentirse seguros, honestos y elegidos desde la calma. Cuando dudas de tu valor, puedes atraer relaciones que te obligan a demostrar demasiado.",
      dinero: "En dinero y abundancia, tu cielo pide ordenar tu energía antes de tomar decisiones. Cuando confías en tu intuición práctica, detectas oportunidades que otros no ven.",
      vocacion: "En vocación, aparece un llamado a usar tu sensibilidad como brújula. Tu camino crece cuando mezclas intuición, servicio y una estructura clara.",
      sanacion: "En sanación emocional, la carta muestra una etapa de cierre de patrones antiguos. No estás perdiendo fuerza: estás recuperando energía que antes entregabas de más.",
      general: "Tu lectura general muestra un momento de reajuste interno. Hay una versión de ti más clara, más intuitiva y más valiente esperando espacio para expresarse.",
    };

    const resumen = `${nombre}, esta muestra de tu carta astral parte de tu Sol en ${signo}, una energía que marca tu forma natural de brillar y tomar decisiones. Tu ${luna} describe un mundo emocional profundo: sientes mucho, aunque no siempre lo enseñes. Tu ${asc} habla de cómo los demás perciben tu campo energético al conocerte. ${temaTexto[temaPrincipal] || temaTexto.general}${pregunta ? ` Sobre tu pregunta, “${pregunta}”, la carta sugiere mirar primero qué parte de ti busca seguridad antes de pedir una respuesta externa.` : ""}`;

    const puntos = [
      { titulo: "☉ Sol", valor: signo, detalle: "Tu esencia, identidad y manera de recuperar poder personal." },
      { titulo: "☾ Luna", valor: luna, detalle: "Tu necesidad emocional y lo que te calma por dentro." },
      { titulo: "↟ Ascendente", valor: asc, detalle: "La energía que proyectas al mundo y cómo te leen los demás." },
    ];

    const mensaje = pick([
      "No estás tarde: estás llegando a una versión de ti que ya no acepta migajas emocionales.",
      "Tu intuición no está exagerando; solo necesita silencio para convertirse en decisión.",
      "El amor que viene para ti requiere que dejes de perseguir claridad en personas confusas.",
      "Tu abundancia empieza cuando tu energía deja de dispersarse en lo que ya no te elige.",
    ], seed + 15);

    const ritual = pick([
      "Escribe una intención en papel blanco, colócala bajo una vela dorada durante 7 minutos y repite: ‘elijo verme con claridad’. Luego guarda el papel en un lugar privado.",
      "Antes de dormir, pon una mano en el pecho y otra en el vientre. Respira 9 veces y pregunta: ‘¿qué verdad estoy evitando escuchar?’ Anota la primera frase que aparezca.",
      "Durante tres noches, escribe una cosa que sueltas y una que eliges. La repetición abre una puerta simbólica de cierre y atracción.",
    ], seed + 19);

    return NextResponse.json({ ok: true, arquetipo, resumen, puntos, mensaje, ritual });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "Error generando carta astral." }, { status: 500 });
  }
}
