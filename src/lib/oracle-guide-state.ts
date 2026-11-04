/** Visual states only. Resolving an animation never creates a reading or spends credit. */
export const ORACLE_GUIDE_ACTIONS = ['welcome', 'idle', 'shuffle', 'offer', 'reveal', 'reading', 'oracle-open', 'listening', 'channeling', 'answer', 'rest', 'recover'] as const;
export type OracleGuideAction = typeof ORACLE_GUIDE_ACTIONS[number];
export type OracleGuideMoment = 'welcome' | 'reveal' | 'answer' | null;
export type OracleGuideInput = {
  stage: 'ready' | 'select' | 'result';
  loading: boolean;
  error: boolean;
  busy: string;
  oracleOpen: boolean;
  typing: boolean;
  speaking: boolean;
  moment: OracleGuideMoment;
};

export const ORACLE_GUIDE_LABELS: Record<OracleGuideAction, string> = {
  welcome: 'Bienvenida a tu espacio',
  idle: 'A tu ritmo',
  shuffle: 'Preparando las cartas',
  offer: 'Elige las cartas sobre la mesa',
  reveal: 'Descubriendo tu carta',
  reading: 'Un momento para tu lectura',
  'oracle-open': 'El espacio del Oráculo está abierto',
  listening: 'Prepara tu pregunta con calma',
  channeling: 'Preparando tu respuesta',
  answer: 'Tu respuesta está lista',
  rest: 'Aquí puedes continuar tu lectura',
  recover: 'Podemos retomar la consulta',
};

export function resolveOracleGuideAction(input: OracleGuideInput): OracleGuideAction {
  if (input.loading) return 'idle';
  if (input.error) return 'recover';
  if (input.busy === 'Consultando el Oráculo…') return 'channeling';
  if (input.busy === 'Barajando las cartas…') return 'shuffle';
  if (input.busy === 'Revelando tu carta…') return 'reveal';
  if (input.busy === 'Completando lectura…') return 'reading';
  if (input.busy) return 'idle';
  if (input.oracleOpen) {
    if (input.typing) return 'listening';
    if (input.moment === 'answer') return 'answer';
    if (input.moment === 'welcome') return 'oracle-open';
    return 'rest';
  }
  if (input.moment === 'reveal') return 'reveal';
  if (input.speaking) return 'reading';
  if (input.stage === 'select') return 'offer';
  if (input.stage === 'result') return 'reading';
  return input.moment === 'welcome' ? 'welcome' : 'idle';
}
