/** Presentation-only choreography. These states never trigger a reading or consume credits. */
export const ORACLE_CHARACTER_ACTIONS = {
  welcome: 'Saluda con la mano y vuelve la mirada hacia ti.',
  idle: 'Respira, parpadea y espera con las manos descansando en la mesa.',
  shuffle: 'Acerca las manos y mezcla dos mitades de la baraja.',
  offer: 'Abre las manos hacia las cartas y te invita a elegir.',
  reveal: 'Acompaña con la mano y la mirada la carta elegida.',
  reading: 'Baja la mirada a las cartas y asiente suavemente.',
  'oracle-open': 'Acerca las manos a la esfera del oráculo.',
  listening: 'Mira la esfera mientras preparas tu pregunta.',
  channeling: 'Traza círculos con las manos alrededor de la esfera mientras llega la respuesta.',
  answer: 'Levanta la mirada y abre una mano para presentar la respuesta.',
  rest: 'Mantiene las manos alrededor de la esfera y descansa mientras lees.',
  recover: 'Detiene el ritual y adopta una postura tranquila de espera.',
} as const;

export type OracleCharacterAction = keyof typeof ORACLE_CHARACTER_ACTIONS;
export type OracleCharacterState = { action: OracleCharacterAction; motion: boolean; selectedIndex: number };
export type Point3 = [number, number, number];
export type OraclePose = {
  left: Point3; right: Point3;
  leftRoll: number; rightRoll: number;
  headX: number; headY: number; headZ: number;
  orb: number; deck: number; fan: number; reveal: number;
};

export function oracleCharacterPose(action: OracleCharacterAction, seconds: number, selectedIndex = 10): OraclePose {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const selection = (Math.min(20, Math.max(0, Number.isFinite(selectedIndex) ? selectedIndex : 10)) - 10) / 10;
  const p: OraclePose = {
    left: [-.68, 1.03, .94], right: [.68, 1.03, .94],
    leftRoll: -.15, rightRoll: .15, headX: -.025, headY: Math.sin(t * .34) * .045, headZ: Math.sin(t * .28) * .025,
    orb: 0, deck: 1, fan: 0, reveal: 0,
  };
  switch (action) {
    case 'welcome':
      p.right = [.73 + Math.sin(t * 2.4) * .045, 1.84 + Math.sin(t * 1.2) * .035, .58];
      p.rightRoll = -.46 + Math.sin(t * 2.4) * .12; p.headZ = -.055;
      break;
    case 'shuffle': {
      const beat = Math.sin(t * 3.8);
      p.left = [-.19 - Math.max(0, beat) * .13, 1.16 + beat * .055, .86];
      p.right = [.19 + Math.max(0, -beat) * .13, 1.17 - beat * .055, .86];
      p.leftRoll = -.2; p.rightRoll = .2; p.headX = .17; p.headY = beat * .018;
      break;
    }
    case 'offer':
      p.left = [-.81, 1.1 + Math.sin(t) * .015, .95]; p.right = [.81, 1.1 + Math.sin(t + 1) * .015, .95];
      p.leftRoll = -.45; p.rightRoll = .45; p.deck = 0; p.fan = 1; p.headX = .06;
      break;
    case 'reveal':
      p.right = [selection * .54 + .12, 1.28, 1.02]; p.headX = .18; p.headY = selection * .14;
      p.deck = 0; p.fan = 1; p.reveal = 1; p.rightRoll = .15;
      break;
    case 'reading':
      p.headX = .14 + Math.sin(t * 1.1) * .018; p.headY = selection * .12;
      p.left = [-.56, 1.08, 1.0]; p.right = [.56, 1.08, 1.0]; p.deck = 0; p.fan = 1;
      break;
    case 'oracle-open':
      p.left = [-.48, 1.34, 1.00]; p.right = [.48, 1.34, 1.00];
      p.leftRoll = -.9; p.rightRoll = .9; p.headX = .13; p.orb = 1; p.deck = 0;
      break;
    case 'listening':
      p.left = [-.45, 1.2 + Math.sin(t * .7) * .025, 1.02]; p.right = [.45, 1.36, 1.02];
      p.leftRoll = -.75; p.rightRoll = .75; p.headX = .16; p.headZ = -.045; p.orb = 1; p.deck = 0;
      break;
    case 'channeling': {
      const angle = t * .8;
      p.left = [-.48 + Math.sin(angle) * .10, 1.38 + Math.cos(angle) * .16, .98 + Math.sin(angle) * .08];
      p.right = [.48 + Math.sin(angle) * .10, 1.38 - Math.cos(angle) * .16, .98 - Math.sin(angle) * .08];
      p.leftRoll = -.8 + Math.cos(angle) * .18; p.rightRoll = .8 + Math.cos(angle) * .18;
      p.headX = .2; p.headY = Math.sin(angle) * .035; p.orb = 1; p.deck = 0;
      break;
    }
    case 'answer':
      p.left = [-.43, 1.20, .98]; p.right = [.65, 1.43 + Math.sin(t * .9) * .025, .97];
      p.leftRoll = -.7; p.rightRoll = .6; p.headX = -.04; p.headZ = -.03; p.orb = 1; p.deck = 0;
      break;
    case 'rest':
      p.left = [-.42, 1.16, 1.01]; p.right = [.42, 1.16, 1.01];
      p.leftRoll = -.7; p.rightRoll = .7; p.headX = .10; p.orb = 1; p.deck = 0;
      break;
    case 'recover':
      p.headX = .015; p.headZ = .035; p.headY = 0; p.deck = 0; p.leftRoll = 0; p.rightRoll = 0;
      break;
  }
  return p;
}
