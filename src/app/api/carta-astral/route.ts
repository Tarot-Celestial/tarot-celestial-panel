import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const nombre = body?.nombre || 'Consultante';
    const fecha = body?.fecha || '';
    const hora = body?.hora || '';
    const ciudad = body?.ciudad || '';

    const texto = `
✨ Carta Astral de ${nombre}

Fecha de nacimiento: ${fecha}
Hora: ${hora}
Ciudad: ${ciudad}

☀️ Energía Solar
Tu carta muestra una personalidad intuitiva, sensible y magnética.

🌙 Luna Emocional
Tienes una conexión espiritual muy fuerte y una gran capacidad de percibir emociones ajenas.

💫 Destino
Este año marca una etapa de transformación profunda y crecimiento personal.

❤️ Amor
Las conexiones emocionales serán especialmente importantes durante los próximos meses.

💰 Trabajo y abundancia
Tu energía está entrando en un ciclo favorable para atraer estabilidad y nuevas oportunidades.
`;

    return NextResponse.json({
      ok: true,
      titulo: `Carta Astral Premium · ${nombre}`,
      texto,
    });
  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e?.message || 'ERR' }, { status:500 });
  }
}
