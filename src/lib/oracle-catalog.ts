export const ORACLE_TOPICS = [
  { id: 'general', label: 'General' }, { id: 'amor', label: 'Amor' },
  { id: 'dinero', label: 'Trabajo y dinero' }, { id: 'familia', label: 'Familia' },
  { id: 'energia', label: 'Energía' }, { id: 'decisiones', label: 'Decisiones' },
] as const;
export type OracleTopic = typeof ORACLE_TOPICS[number]['id'];
export type OracleSpread = { id: string; label: string; description: string; topic: OracleTopic; positions: string[]; question: string };
export const ORACLE_SPREADS: OracleSpread[] = [
  { id: 'clarity', label: 'Claridad', description: 'Comprende tu situación y encuentra un siguiente paso.', topic: 'general', positions: ['Situación', 'Dificultad', 'Siguiente paso'], question: '¿Qué necesito comprender de esta situación?' },
  { id: 'love', label: 'Amor', description: 'Una mirada al vínculo, tus necesidades y el diálogo.', topic: 'amor', positions: ['Situación actual', 'Energía afectiva', 'Consejo'], question: '¿Cómo puedo cuidar mis vínculos afectivos?' },
  { id: 'relationships', label: 'Vínculos', description: 'Cinco perspectivas para comprender una relación.', topic: 'amor', positions: ['Situación actual', 'Fortaleza', 'Obstáculo', 'Consejo', 'Respuesta'], question: '¿Qué necesito comprender sobre esta relación?' },
  { id: 'family', label: 'Familia', description: 'Espacio para la convivencia, los cuidados y los límites.', topic: 'familia', positions: ['Situación', 'Necesidades', 'Siguiente paso'], question: '¿Cómo puedo mejorar la convivencia familiar?' },
  { id: 'work', label: 'Trabajo y dinero', description: 'Revisa recursos, dificultades y próximos pasos.', topic: 'dinero', positions: ['Situación', 'Recursos', 'Siguiente paso'], question: '¿Qué debo revisar antes de mi próximo paso profesional?' },
  { id: 'energy', label: 'Pausa y energía', description: 'Observa tu ritmo, tus necesidades y lo que te sostiene.', topic: 'energia', positions: ['Situación', 'Necesidades', 'Consejo'], question: '¿Qué puedo cuidar mejor en mi día a día?' },
  { id: 'decision', label: 'Dos caminos', description: 'Contrasta dos opciones desde tus propios valores.', topic: 'decisiones', positions: ['Situación', 'Camino A', 'Camino B', 'Lo que falta saber', 'Siguiente paso'], question: '¿Qué necesito considerar al comparar estas dos opciones?' },
  { id: 'celtic', label: 'Cruz celta', description: 'Diez posiciones para explorar una situación con perspectiva.', topic: 'general', positions: ['Situación', 'Dificultad', 'Raíz', 'Pasado', 'Aspiración', 'Posibilidad', 'Tu actitud', 'Entorno', 'Esperanzas y temores', 'Síntesis'], question: '¿Qué perspectivas me ayudarían a comprender este momento?' },
  { id: 'daily', label: 'Carta del día', description: 'Una carta para detenerte y reflexionar.', topic: 'general', positions: ['Mensaje'], question: '¿Dónde puedo poner mi atención hoy?' },
  { id: 'yes_no', label: 'Sí, no y matices', description: 'Explora una decisión sin convertirla en una certeza.', topic: 'general', positions: ['Respuesta'], question: '¿Qué matices debería considerar antes de decidir?' },
  { id: 'choice', label: 'Elección', description: 'Tres cartas para comparar dos caminos.', topic: 'general', positions: ['Camino A', 'Camino B', 'Consejo'], question: '¿Qué debo considerar antes de decidir?' },
  { id: 'question', label: 'Tu pregunta', description: 'Una consulta abierta con tres perspectivas.', topic: 'general', positions: ['Situación actual', 'Consejo', 'Respuesta'], question: '¿Qué necesito comprender ahora?' },
  { id: 'monthly', label: 'Panorama del mes', description: 'Cuatro áreas para organizar tus próximas semanas.', topic: 'general', positions: ['Amor', 'Trabajo', 'Dinero', 'Bienestar'], question: '¿Qué aspectos quiero cuidar durante este mes?' },
];
export const ORACLE_SPREAD_BY_ID: Record<string, OracleSpread> = Object.fromEntries(ORACLE_SPREADS.map(s => [s.id, s]));
