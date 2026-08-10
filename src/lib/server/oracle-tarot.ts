import { createHash } from "crypto";

export type OracleTopic = "general" | "amor" | "dinero" | "energia";

export type TarotCard = {
  id: string;
  name: string;
  image: string;
  keyword: string;
  advice: string;
  base: string;
  topics: Record<OracleTopic, string>;
};

function commonsImage(filename: string) {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=520`;
}

export const TAROT_CARDS: TarotCard[] = [
  {
    id: "fool",
    name: "El Loco",
    image: commonsImage("RWS Tarot 00 Fool.jpg"),
    keyword: "Comienzo",
    advice: "Avanza con curiosidad, pero sin ignorar las señales.",
    base: "El Loco abre una etapa nueva. Hoy conviene confiar en tu impulso sin perder el sentido práctico.",
    topics: {
      general: "Una oportunidad inesperada puede sacarte de la rutina y mostrarte un camino distinto.",
      amor: "En amor habla de espontaneidad, apertura y de no forzar etiquetas antes de tiempo.",
      dinero: "En dinero invita a explorar opciones nuevas, pero sin asumir riesgos que no entiendas bien.",
      energia: "Tu energía pide aire, movimiento y menos control. Cambiar de perspectiva puede desbloquearte.",
    },
  },
  {
    id: "magician",
    name: "El Mago",
    image: commonsImage("RWS Tarot 01 Magician.jpg"),
    keyword: "Iniciativa",
    advice: "Usa lo que ya tienes antes de buscar más recursos.",
    base: "El Mago indica capacidad de acción. Tienes herramientas suficientes para mover una situación a tu favor.",
    topics: {
      general: "Hoy funciona mejor actuar con intención clara que esperar una señal perfecta.",
      amor: "En amor favorece conversaciones directas, iniciativa y química cuando existe reciprocidad.",
      dinero: "En dinero habla de habilidad, negociación y una oportunidad que mejora si tomas la iniciativa.",
      energia: "Tu energía está concentrada y disponible. Elige una prioridad y dirígela hacia allí.",
    },
  },
  {
    id: "high-priestess",
    name: "La Sacerdotisa",
    image: commonsImage("RWS Tarot 02 High Priestess.jpg"),
    keyword: "Intuición",
    advice: "Escucha lo que percibes antes de pedir más pruebas.",
    base: "La Sacerdotisa habla de información que todavía no está completamente visible. La intuición tiene más peso de lo habitual.",
    topics: {
      general: "No todo necesita una respuesta inmediata. Observa lo que se repite y lo que alguien evita decir.",
      amor: "En amor puede señalar sentimientos profundos, silencios o una conexión que aún no se expresa del todo.",
      dinero: "En dinero recomienda analizar antes de decidir y desconfiar de propuestas demasiado rápidas.",
      energia: "Tu energía necesita silencio y protección. Menos estímulos te ayudarán a escuchar mejor tu intuición.",
    },
  },
  {
    id: "empress",
    name: "La Emperatriz",
    image: commonsImage("RWS Tarot 03 Empress.jpg"),
    keyword: "Expansión",
    advice: "Cuida lo que quieres hacer crecer.",
    base: "La Emperatriz trae crecimiento, creatividad y capacidad de nutrir algo valioso.",
    topics: {
      general: "Un proyecto, vínculo o idea puede desarrollarse si le das constancia y atención.",
      amor: "En amor favorece afecto, sensualidad, cuidado mutuo y relaciones que pueden crecer.",
      dinero: "En dinero sugiere expansión gradual, creatividad rentable y resultados de algo bien cultivado.",
      energia: "Tu energía mejora cuando vuelves al cuerpo, al descanso y a aquello que te hace sentir en abundancia.",
    },
  },
  {
    id: "emperor",
    name: "El Emperador",
    image: commonsImage("RWS Tarot 04 Emperor.jpg"),
    keyword: "Estructura",
    advice: "Pon límites claros y ordena lo importante.",
    base: "El Emperador pide estabilidad, decisión y estructura. Lo que se organiza hoy gana fuerza.",
    topics: {
      general: "Conviene tomar una decisión firme y dejar menos espacio a la improvisación.",
      amor: "En amor señala necesidad de seguridad, compromiso claro y límites saludables.",
      dinero: "En dinero favorece planificación, control de gastos y decisiones basadas en datos.",
      energia: "Tu energía necesita orden y rutina. Recuperar estructura puede devolverte sensación de control.",
    },
  },
  {
    id: "hierophant",
    name: "El Hierofante",
    image: commonsImage("RWS Tarot 05 Hierophant.jpg"),
    keyword: "Guía",
    advice: "Apóyate en una experiencia probada sin dejar de escuchar tu criterio.",
    base: "El Hierofante habla de aprendizaje, consejo y estructuras que ofrecen orientación.",
    topics: {
      general: "Una conversación con alguien experimentado puede ayudarte a ordenar una decisión.",
      amor: "En amor puede señalar compromiso, valores compartidos o la necesidad de definir qué espera cada parte.",
      dinero: "En dinero favorece métodos probados, asesoramiento profesional y decisiones conservadoras.",
      energia: "Tu energía se beneficia de rituales, hábitos y prácticas que ya sabes que te centran.",
    },
  },
  {
    id: "lovers",
    name: "Los Enamorados",
    image: commonsImage("RWS Tarot 06 Lovers.jpg"),
    keyword: "Elección",
    advice: "Elige lo que también esté alineado con tus valores.",
    base: "Los Enamorados hablan de vínculo y de una elección que requiere coherencia emocional.",
    topics: {
      general: "Una decisión importante puede aclararse cuando distingues deseo inmediato de verdadera compatibilidad.",
      amor: "En amor señala atracción, conexión y la necesidad de elegir desde la reciprocidad.",
      dinero: "En dinero puede hablar de una alianza, sociedad o decisión entre dos caminos.",
      energia: "Tu energía mejora cuando dejas de dividirte entre lo que quieres y lo que crees que deberías querer.",
    },
  },
  {
    id: "chariot",
    name: "El Carro",
    image: commonsImage("RWS Tarot 07 Chariot.jpg"),
    keyword: "Avance",
    advice: "Dirige tu energía hacia una sola meta.",
    base: "El Carro marca movimiento y determinación. Una situación puede avanzar si mantienes el rumbo.",
    topics: {
      general: "Es un buen momento para tomar iniciativa y no dispersarte entre demasiadas opciones.",
      amor: "En amor indica avance, decisión y necesidad de hablar claramente sobre hacia dónde va el vínculo.",
      dinero: "En dinero favorece objetivos concretos, negociación y movimiento profesional.",
      energia: "Tu energía está activa; canalizarla bien evitará que termine convirtiéndose en tensión.",
    },
  },
  {
    id: "strength",
    name: "La Fuerza",
    image: commonsImage("RWS Tarot 08 Strength.jpg"),
    keyword: "Confianza",
    advice: "La firmeza tranquila puede más que la presión.",
    base: "La Fuerza habla de autocontrol, valentía y capacidad para sostener una situación sin reaccionar impulsivamente.",
    topics: {
      general: "Hoy ganas más manteniendo la calma que intentando demostrar algo.",
      amor: "En amor favorece paciencia, afecto y conversaciones donde la vulnerabilidad no se confunde con debilidad.",
      dinero: "En dinero recomienda constancia y negociación serena antes que decisiones impulsivas.",
      energia: "Tu energía es más fuerte de lo que parece. Cuídala y no la gastes en luchas innecesarias.",
    },
  },
  {
    id: "hermit",
    name: "El Ermitaño",
    image: commonsImage("RWS Tarot 09 Hermit.jpg"),
    keyword: "Claridad",
    advice: "Reduce el ruido antes de decidir.",
    base: "El Ermitaño invita a tomar distancia para encontrar una respuesta más auténtica.",
    topics: {
      general: "No necesitas resolverlo todo hoy. Una pausa consciente puede mostrarte lo que estabas pasando por alto.",
      amor: "En amor puede indicar necesidad de espacio, reflexión o una conversación después de ordenar lo que sientes.",
      dinero: "En dinero recomienda análisis, prudencia y revisar detalles antes de comprometer recursos.",
      energia: "Tu energía pide recogimiento y descanso mental. Estar contigo puede resultar especialmente reparador.",
    },
  },
  {
    id: "wheel",
    name: "La Rueda de la Fortuna",
    image: commonsImage("RWS Tarot 10 Wheel of Fortune.jpg"),
    keyword: "Cambio",
    advice: "Aprovecha el giro sin intentar controlar cada detalle.",
    base: "La Rueda señala un cambio de ciclo. Algo puede moverse de manera inesperada, abriendo una oportunidad distinta.",
    topics: {
      general: "La situación no está tan fija como parecía. Mantente flexible para aprovechar el cambio.",
      amor: "En amor puede marcar reencuentros, cambios de dinámica o una etapa nueva dentro de un vínculo.",
      dinero: "En dinero habla de movimiento, oportunidades variables y necesidad de adaptarte rápido.",
      energia: "Tu energía está cambiando de ritmo. No te aferres a una fase que ya está terminando.",
    },
  },
  {
    id: "justice",
    name: "La Justicia",
    image: commonsImage("RWS Tarot 11 Justice.jpg"),
    keyword: "Equilibrio",
    advice: "Decide con hechos, no solo con emociones del momento.",
    base: "La Justicia pide equilibrio, responsabilidad y una mirada objetiva sobre lo que está ocurriendo.",
    topics: {
      general: "Una decisión mejora cuando evalúas consecuencias y responsabilidades con claridad.",
      amor: "En amor señala conversaciones honestas, límites y necesidad de reciprocidad real.",
      dinero: "En dinero favorece contratos claros, cuentas ordenadas y decisiones bien documentadas.",
      energia: "Tu energía pide equilibrio entre lo que das y lo que recibes.",
    },
  },
  {
    id: "hanged-man",
    name: "El Colgado",
    image: commonsImage("RWS Tarot 12 Hanged Man.jpg"),
    keyword: "Perspectiva",
    advice: "No fuerces una solución antes de verla desde otro ángulo.",
    base: "El Colgado habla de pausa y cambio de perspectiva. El avance llega después de comprender algo de otra manera.",
    topics: {
      general: "Algo que parece detenido puede estar pidiéndote una mirada diferente, no más esfuerzo.",
      amor: "En amor puede indicar espera, distancia temporal o necesidad de soltar una expectativa concreta.",
      dinero: "En dinero recomienda frenar una decisión hasta entender mejor el escenario.",
      energia: "Tu energía necesita soltar tensión y aceptar que no todo se resuelve acelerando.",
    },
  },
  {
    id: "death",
    name: "La Muerte",
    image: commonsImage("RWS Tarot 13 Death.jpg"),
    keyword: "Transformación",
    advice: "Deja espacio para lo nuevo cerrando lo que ya terminó.",
    base: "La Muerte representa cierre y transformación, no una predicción literal. Algo necesita terminar para que otra etapa empiece.",
    topics: {
      general: "Hoy puede ser importante aceptar un cambio que ya venía gestándose.",
      amor: "En amor puede señalar una transformación profunda, cierre de dinámica o nueva forma de relacionarse.",
      dinero: "En dinero aconseja abandonar una estrategia agotada y reorganizar recursos.",
      energia: "Tu energía está en proceso de limpieza y renovación. Soltar puede sentirse más útil que insistir.",
    },
  },
  {
    id: "temperance",
    name: "La Templanza",
    image: commonsImage("RWS Tarot 14 Temperance.jpg"),
    keyword: "Armonía",
    advice: "Busca el punto medio y deja que el proceso madure.",
    base: "La Templanza habla de equilibrio, integración y avances que se consolidan sin prisa.",
    topics: {
      general: "Una solución intermedia puede ser más efectiva que irte a un extremo.",
      amor: "En amor favorece reconciliación, diálogo tranquilo y construcción progresiva de confianza.",
      dinero: "En dinero recomienda equilibrio, ahorro y crecimiento sostenido antes que apuestas rápidas.",
      energia: "Tu energía pide regulación: descanso, hidratación, rutina y menos extremos.",
    },
  },
  {
    id: "devil",
    name: "El Diablo",
    image: commonsImage("RWS Tarot 15 Devil.jpg"),
    keyword: "Apego",
    advice: "Observa qué deseo te está quitando libertad.",
    base: "El Diablo señala apegos, tentaciones o dinámicas intensas que conviene mirar con honestidad.",
    topics: {
      general: "Una situación puede estar consumiendo más energía de la que merece. Detectar el patrón ya es un avance.",
      amor: "En amor puede hablar de química fuerte, celos, dependencia o una relación difícil de soltar.",
      dinero: "En dinero alerta sobre impulsos, deudas, promesas demasiado atractivas o decisiones tomadas por presión.",
      energia: "Tu energía pide revisar hábitos o vínculos que generan intensidad pero poco bienestar.",
    },
  },
  {
    id: "tower",
    name: "La Torre",
    image: commonsImage("RWS Tarot 16 Tower.jpg"),
    keyword: "Revelación",
    advice: "No sostengas algo solo porque siempre estuvo ahí.",
    base: "La Torre trae una verdad que rompe una estructura frágil. Puede ser incómoda, pero también libera.",
    topics: {
      general: "Una información inesperada puede obligarte a reorganizar planes o expectativas.",
      amor: "En amor puede indicar una conversación intensa, ruptura de ilusión o cambio brusco de dinámica.",
      dinero: "En dinero aconseja revisar riesgos y crear margen ante cambios imprevistos.",
      energia: "Tu energía necesita descargar tensión. No intentes mantener una apariencia de calma si algo requiere atención real.",
    },
  },
  {
    id: "star",
    name: "La Estrella",
    image: commonsImage("RWS Tarot 17 Star.jpg"),
    keyword: "Esperanza",
    advice: "Sigue cuidando aquello que te devuelve confianza.",
    base: "La Estrella aporta esperanza, alivio y sensación de dirección después de una etapa exigente.",
    topics: {
      general: "Una señal positiva puede devolverte claridad y motivación para continuar.",
      amor: "En amor favorece apertura, sinceridad, reconciliación emocional y vínculos con más autenticidad.",
      dinero: "En dinero indica recuperación gradual, inspiración y proyectos que empiezan a mostrar potencial.",
      energia: "Tu energía entra en una fase más ligera. Permítete confiar sin exigir resultados inmediatos.",
    },
  },
  {
    id: "moon",
    name: "La Luna",
    image: commonsImage("RWS Tarot 18 Moon.jpg"),
    keyword: "Sensibilidad",
    advice: "No conviertas una sensación en certeza sin comprobarla.",
    base: "La Luna habla de emociones intensas, intuición y situaciones donde todavía faltan datos.",
    topics: {
      general: "Puede haber confusión o información incompleta. Espera antes de sacar conclusiones definitivas.",
      amor: "En amor señala sensibilidad, dudas, idealización o mensajes ambiguos que necesitan claridad.",
      dinero: "En dinero recomienda precaución con promesas vagas y revisar bien cualquier detalle oculto.",
      energia: "Tu energía está muy receptiva. Descanso y límites te ayudarán a no absorber demasiado del entorno.",
    },
  },
  {
    id: "sun",
    name: "El Sol",
    image: commonsImage("RWS Tarot 19 Sun.jpg"),
    keyword: "Claridad",
    advice: "Aprovecha la claridad para avanzar sin complicar lo sencillo.",
    base: "El Sol aporta claridad, vitalidad y una energía favorable para mostrarte tal como eres.",
    topics: {
      general: "Hoy puede sentirse más fácil ver qué funciona y qué merece tu atención.",
      amor: "En amor favorece alegría, sinceridad, cercanía y momentos compartidos con menos tensión.",
      dinero: "En dinero señala resultados visibles, reconocimiento y oportunidades con mayor transparencia.",
      energia: "Tu energía está más abierta y luminosa. Es buen momento para moverte y recuperar entusiasmo.",
    },
  },
  {
    id: "judgement",
    name: "El Juicio",
    image: commonsImage("RWS Tarot 20 Judgement.jpg"),
    keyword: "Despertar",
    advice: "Responde a lo que ya sabes que necesita un cambio.",
    base: "El Juicio marca evaluación, comprensión y una llamada a actuar de forma más consciente.",
    topics: {
      general: "Una situación del pasado puede mostrarte con claridad qué has aprendido y qué toca decidir ahora.",
      amor: "En amor puede traer conversaciones pendientes, reconciliaciones o decisiones definitivas.",
      dinero: "En dinero recomienda revisar resultados y corregir una estrategia con lo aprendido.",
      energia: "Tu energía pide dejar de repetir un patrón que ya reconoces claramente.",
    },
  },
  {
    id: "world",
    name: "El Mundo",
    image: commonsImage("RWS Tarot 21 World.jpg"),
    keyword: "Culminación",
    advice: "Reconoce lo que ya has completado antes de empezar lo siguiente.",
    base: "El Mundo habla de cierre favorable, integración y sensación de haber llegado a una etapa importante.",
    topics: {
      general: "Un ciclo puede cerrarse con más claridad de la que esperabas, dejando espacio para algo nuevo.",
      amor: "En amor señala plenitud, consolidación o comprensión completa de lo que un vínculo representa.",
      dinero: "En dinero favorece finalización de proyectos, resultados y expansión después de un proceso sostenido.",
      energia: "Tu energía pide celebrar el camino recorrido y completar lo pendiente antes de abrir otro frente.",
    },
  },
];

export function normalizeOracleTopic(value: unknown): OracleTopic {
  const key = String(value || "general").trim().toLowerCase();
  return key === "amor" || key === "dinero" || key === "energia" ? key : "general";
}

export function resolveTarotCard(params: {
  clientId: string;
  shuffleId: string;
  position: number;
  topic: OracleTopic;
  secret: string;
}): TarotCard {
  const position = Math.max(0, Math.min(20, Math.floor(params.position)));
  const seed = createHash("sha256")
    .update(`${params.secret}:${params.clientId}:${params.shuffleId}:${position}:${params.topic}`)
    .digest("hex");
  const index = parseInt(seed.slice(0, 12), 16) % TAROT_CARDS.length;
  return TAROT_CARDS[index];
}

export function buildTarotReading(card: TarotCard, topic: OracleTopic) {
  const topicText = card.topics[topic] || card.topics.general;
  return {
    title: card.name,
    message: `${card.base}\n\n${topicText}`,
    keyword: card.keyword,
    advice: card.advice,
  };
}

export function answerTarotFollowup(params: {
  question: string; topic: OracleTopic; card: TarotCard; reading: string;
  cards?: Array<{ position?: string; cardName?: string; keyword?: string; interpretation?: string }>;
  initialQuestion?: string; context?: string; history?: Array<{ role: string; contenido: string }>;
}) {
  const q = params.question.trim();
  const lower = q.toLocaleLowerCase("es");
  const cards = Array.isArray(params.cards) && params.cards.length ? params.cards : [{ position: "Mensaje", cardName: params.card.name, keyword: params.card.keyword, interpretation: params.reading }];
  const named = cards.find(c => lower.includes(String(c.cardName || "").toLocaleLowerCase("es"))) || cards.find(c => lower.includes(String(c.position || "").toLocaleLowerCase("es"))) || cards[0];
  const cardName = String(named?.cardName || params.card.name);
  const position = String(named?.position || "Mensaje");
  const interpretation = String(named?.interpretation || params.reading);
  const keyword = String(named?.keyword || params.card.keyword).toLowerCase();
  const previousUser = [...(params.history || [])].reverse().find(m => m.role === "user")?.contenido || "";
  const continuity = previousUser ? `Teniendo en cuenta lo que acababas de preguntar sobre “${previousUser.slice(0,120)}”, ` : "";
  const positionLead = position && position !== "Mensaje" ? `Al aparecer ${cardName} en la posición «${position}», ` : `${cardName} sugiere que `;
  const direct = /por qu[eé]|porque/.test(lower)
    ? `${continuity}${positionLead}la lectura pone el foco en ${keyword}, no como una sentencia literal, sino como una forma de entender el patrón que estás señalando.`
    : /puede|podr[ií]a|es posible|significa/.test(lower)
    ? `Sí, puede encajar con esa posibilidad. ${positionLead}lo importante es cómo se manifiesta ${keyword} en los hechos y en tus decisiones, más que tomar el símbolo de forma literal.`
    : `${continuity}${positionLead}${interpretation.charAt(0).toLowerCase()}${interpretation.slice(1)}`;
  const contextLine = params.initialQuestion ? `En relación con tu pregunta inicial —“${params.initialQuestion.slice(0,160)}”— conviene contrastarlo con lo que estás viviendo ahora y observar qué parte se repite de forma concreta.` : `Úsalo como una orientación para observar hechos, emociones y decisiones concretas, no como una certeza inevitable.`;
  const suggestion = (params.history || []).length % 4 === 0 ? `\n\nSi quieres profundizar, puedes preguntarme cómo se manifiesta esta posición en una situación concreta.` : "";
  return `${direct}\n\n${contextLine}${suggestion}`;
}

export function resolveTarotSpreadCard(params: {
  clientId: string;
  shuffleId: string;
  position: number;
  pickIndex: number;
  topic: OracleTopic;
  secret: string;
}): TarotCard {
  const ordered = TAROT_CARDS.map((card) => ({
    card,
    key: createHash("sha256")
      .update(`${params.secret}:${params.clientId}:${params.shuffleId}:${params.topic}:${card.id}`)
      .digest("hex"),
  })).sort((a, b) => a.key.localeCompare(b.key));
  const visualPosition = Math.max(0, Math.floor(params.position));
  const pickIndex = Math.max(0, Math.floor(params.pickIndex));
  return ordered[(visualPosition + pickIndex * 7) % ordered.length].card;
}

export function buildPositionReading(params: {
  card: TarotCard;
  topic: OracleTopic;
  position: string;
  question?: string;
  context?: string;
}) {
  const topicText = params.card.topics[params.topic] || params.card.topics.general;
  const role: Record<string, string> = {
    "Situación actual": "describe la energía que domina ahora mismo",
    Fortaleza: "señala el recurso que juega a tu favor",
    Obstáculo: "muestra aquello que puede frenar o confundir el avance",
    Consejo: "indica la actitud más útil para avanzar",
    Respuesta: "resume hacia dónde apunta la situación si mantienes el rumbo actual",
    Pasado: "muestra la influencia que todavía pesa desde atrás",
    Presente: "describe la energía que está activa ahora",
    Futuro: "señala la tendencia que puede desarrollarse próximamente",
  };
  const positionText = role[params.position] || "aporta una pieza concreta a esta lectura";
  const context = params.context ? ` En el contexto “${params.context}”,` : "";
  const question = params.question ? ` respecto a “${params.question}”` : "";
  return `${params.card.name} ${positionText}.${context} ${topicText}${question}. ${params.card.advice}`.replace(/\s+/g, " ").trim();
}
