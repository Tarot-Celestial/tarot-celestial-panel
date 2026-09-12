export type LeoMood = "welcome" | "promo" | "oracle" | "reward" | "calm";

export type LeoPose = "sentinel" | "guide" | "curious" | "oracle" | "proud" | "calm";

export type LeoPersonalityMessage = {
  title: string;
  message: string;
  mood: LeoMood;
  pose: LeoPose;
  href?: string;
  actionLabel?: string;
};

function dashboardGreeting(hour: number) {
  if (hour < 12) return "Buenos días, viajera";
  if (hour < 20) return "Buenas tardes, viajera";
  return "Buenas noches, viajera";
}

export function getLeoMessageVariants(pathname: string, promoActive: boolean, hour = 12): LeoPersonalityMessage[] {
  if (pathname === "/cliente/precios-ofertas") {
    return promoActive
      ? [
          { title: "Hay magia activa", message: "He encontrado la promoción de hoy. Mira dónde me he colocado.", mood: "promo", pose: "guide", actionLabel: "Ver promoción" },
          { title: "Una oportunidad especial", message: "La promoción activa reúne beneficios que pueden acompañar mejor tu consulta.", mood: "promo", pose: "curious", actionLabel: "Descubrirla" },
          { title: "He marcado el camino", message: "Observa el pack destacado y comprueba con calma todo lo que incluye.", mood: "promo", pose: "sentinel", actionLabel: "Ir al pack" },
        ]
      : [
          { title: "Precios claros", message: "Aquí puedes comparar minutos y beneficios antes de elegir.", mood: "calm", pose: "sentinel" },
          { title: "Elige a tu ritmo", message: "Cada opción muestra lo que recibirás. Yo vigilaré el camino.", mood: "calm", pose: "calm" },
          { title: "Todo ante tus ojos", message: "Revisa cada pack con calma y escoge solo el que encaje contigo.", mood: "calm", pose: "curious" },
        ];
  }

  if (pathname === "/cliente/oraculo") {
    return [
      { title: "Escucha tu intuición", message: "El Oráculo está preparado. Elige tu pregunta con calma.", mood: "oracle", pose: "oracle" },
      { title: "Haz espacio al mensaje", message: "Respira un instante y piensa en aquello que de verdad deseas comprender.", mood: "oracle", pose: "calm" },
      { title: "Tu pregunta abre el camino", message: "Cuanto más clara sea tu intención, más fácil será interpretar la respuesta.", mood: "oracle", pose: "curious" },
    ];
  }

  if (pathname === "/cliente/ruleta") {
    return [
      { title: "Tu premio te espera", message: "Cada giro disponible guarda una recompensa. Me quedaré cerca.", mood: "reward", pose: "proud" },
      { title: "La fortuna ya está en marcha", message: "Si tienes un giro, úsalo cuando estés lista para descubrir tu premio.", mood: "reward", pose: "curious" },
      { title: "Gira con confianza", message: "Yo celebraré contigo cuando el premio quede confirmado.", mood: "reward", pose: "sentinel" },
    ];
  }

  if (pathname === "/cliente/sorteo") {
    return [
      { title: "Destino y fortuna", message: "Aquí puedes consultar los sorteos activos y tus oportunidades.", mood: "reward", pose: "curious" },
      { title: "Tu suerte también viaja", message: "Revisa tus participaciones y no pierdas de vista las novedades.", mood: "reward", pose: "sentinel" },
      { title: "Puede haber una señal", message: "Observa los sorteos disponibles; quizá alguno lleve tu nombre.", mood: "reward", pose: "guide" },
    ];
  }

  if (pathname === "/cliente/notificaciones") {
    return [
      { title: "Nada se te escapa", message: "Aquí están tus novedades, regalos y movimientos importantes.", mood: "calm", pose: "sentinel" },
      { title: "He vigilado tus señales", message: "Revisa los avisos recientes para conocer cada cambio de tu cuenta.", mood: "calm", pose: "curious" },
      { title: "Tus novedades, reunidas", message: "Este es el lugar para confirmar premios, compras y regalos.", mood: "calm", pose: "guide" },
    ];
  }

  if (pathname === "/cliente/perfil") {
    return [
      { title: "Tu espacio", message: "Mantén tus datos y preferencias al día desde esta sección.", mood: "calm", pose: "calm" },
      { title: "Este rincón es tuyo", message: "Aquí puedes revisar la información que da forma a tu experiencia.", mood: "calm", pose: "sentinel" },
      { title: "Todo en orden", message: "Un perfil actualizado ayuda a que tu acceso siga siendo sencillo.", mood: "calm", pose: "curious" },
    ];
  }

  if (pathname === "/cliente/tarotistas") {
    return [
      { title: "Elige con confianza", message: "Conoce a las profesionales y encuentra la energía que conecte contigo.", mood: "oracle", pose: "guide" },
      { title: "Cada voz tiene su don", message: "Explora sus perfiles y escucha cuál despierta tu intuición.", mood: "oracle", pose: "curious" },
      { title: "Tu conexión importa", message: "No hay prisa: descubre quién puede acompañarte mejor hoy.", mood: "oracle", pose: "calm" },
    ];
  }

  if (pathname === "/cliente/resenas") {
    return [
      { title: "Experiencias reales", message: "Las reseñas muestran cómo otras personas viven Tarot Celestial.", mood: "calm", pose: "curious" },
      { title: "Otras viajeras te orientan", message: "Sus experiencias pueden ayudarte a elegir con más confianza.", mood: "calm", pose: "guide" },
      { title: "Historias que dejan huella", message: "Lee con calma y descubre las conexiones que ya han florecido.", mood: "calm", pose: "calm" },
    ];
  }

  if (promoActive) {
    return [
      { title: dashboardGreeting(hour), message: "Hoy he detectado una promoción activa. Puedo acompañarte hasta ella.", mood: "promo", pose: "guide", href: "/cliente/precios-ofertas", actionLabel: "Ver la promoción" },
      { title: "Tengo algo que mostrarte", message: "Hay una promoción esperándote en Precios de hoy.", mood: "promo", pose: "curious", href: "/cliente/precios-ofertas", actionLabel: "Descubrirla" },
      { title: "Una señal para tu viaje", message: "La promoción de hoy ya está activa. Revísala cuando quieras.", mood: "promo", pose: "sentinel", href: "/cliente/precios-ofertas", actionLabel: "Ir a precios" },
    ];
  }

  return [
    { title: dashboardGreeting(hour), message: "Soy Leo Celestial. Estoy aquí para orientarte en cada paso.", mood: "welcome", pose: "sentinel" },
    { title: "Seguimos el viaje", message: "Explora tu panel con calma. Si aparece algo importante, te avisaré.", mood: "welcome", pose: "calm" },
    { title: "Todo está preparado", message: "Puedo guiarte hacia tus consultas, premios y novedades.", mood: "welcome", pose: "guide" },
  ];
}

export function getLeoContextTips(pathname: string, promoActive: boolean): LeoPersonalityMessage[] {
  if (pathname === "/cliente/precios-ofertas") {
    return promoActive
      ? [
          { title: "Consejo de Leo", message: "Compara minutos y beneficios del pack destacado antes de decidir.", mood: "promo", pose: "curious", actionLabel: "Revisar el pack" },
          { title: "Mira cada beneficio", message: "Coins, giros y Oráculo aparecen junto al pack cuando están incluidos.", mood: "promo", pose: "guide", actionLabel: "Ver detalles" },
        ]
      : [{ title: "Consejo de Leo", message: "Elige por lo que necesitas hoy, no solo por el tamaño del pack.", mood: "calm", pose: "curious" }];
  }

  if (pathname === "/cliente/oraculo") {
    return [{ title: "Una pausa ayuda", message: "Formula una sola pregunta clara antes de abrir tu lectura.", mood: "oracle", pose: "oracle" }];
  }

  if (pathname === "/cliente/ruleta") {
    return [{ title: "Cuando estés lista", message: "El resultado confirmado se añadirá a tu cuenta automáticamente.", mood: "reward", pose: "sentinel" }];
  }

  if (pathname === "/cliente/notificaciones") {
    return [{ title: "Busca la confirmación", message: "Los avisos recientes te permiten comprobar compras, premios y regalos.", mood: "calm", pose: "guide" }];
  }

  if (pathname === "/cliente/tarotistas") {
    return [{ title: "Déjate orientar", message: "La especialidad y la disponibilidad pueden ayudarte a decidir.", mood: "oracle", pose: "curious" }];
  }

  if (pathname === "/cliente/dashboard") {
    return promoActive
      ? [{ title: "He visto una novedad", message: "Puedes revisar la promoción activa sin perder tu lugar en el viaje.", mood: "promo", pose: "guide", href: "/cliente/precios-ofertas", actionLabel: "Verla ahora" }]
      : [{ title: "Todo en un vistazo", message: "Desde aquí puedes consultar tu saldo, recompensas y accesos principales.", mood: "calm", pose: "sentinel" }];
  }

  return [];
}
