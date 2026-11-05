import { createPortrait } from './portrait.js';
import { createCardPerformance } from './cards.js';

const element = id => document.getElementById(id);
const stage = document.querySelector('.stage');
const portrait = createPortrait(element('portrait'), {
  src: './assets/guardiana.webp',
  gazeSrc: './assets/guardiana-mirada.webp',
});
const cards = createCardPerformance(element('cards-layer'));
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const pauseButton = element('pause-button');
const question = element('question');
const form = element('question-form');
const log = element('chat-log');
const stages = {
  idle: 'Te da la bienvenida', listening: 'Escucha tu pregunta',
  channeling: 'Se concentra en la esfera', answer: 'Levanta la mirada',
  shuffle: 'Baraja el mazo', offer: 'Te ofrece las cartas', reveal: 'Descubre tu carta',
};

let mode = 'welcome';
let drawPhase = 'ready';
let selectedIndex = 1;
let latestCard = '';
let typing = false;
let waiting = false;
let answering = false;
let paused = motionPreference.matches;
let userSetMotion = false;
let presentedState = '';
let typingTimer, responseTimer, answerTimer, drawTimer;

function updateScene() {
  const drawing = mode === 'draw' && drawPhase !== 'ready';
  let state = 'idle';
  if (drawing) state = drawPhase === 'complete' ? 'reveal' : drawPhase;
  if (mode === 'oracle') {
    if (waiting) state = 'channeling';
    else if (typing) state = 'listening';
    else if (answering) state = 'answer';
  }
  stage.dataset.state = state;
  if (state !== presentedState) {
    presentedState = state;
    cards.setState(state, selectedIndex);
    portrait.setState(drawing ? 'idle' : state);
    element('stage-status').textContent = stages[state];
  }
  cards.setPaused(paused || document.hidden);
  portrait.setPaused(paused || document.hidden || drawing);
}

function syncPause() {
  const accessibleLabel = paused ? 'Activar movimiento' : 'Pausar movimiento';
  pauseButton.setAttribute('aria-label', accessibleLabel);
  pauseButton.title = accessibleLabel;
  pauseButton.setAttribute('aria-pressed', String(paused));
  pauseButton.querySelector('use').setAttribute('href', paused ? '#play' : '#pause');
  updateScene();
}

function setMode(next) {
  mode = next;
  for (const panel of ['welcome', 'oracle', 'draw']) {
    element(`${panel}-pane`).hidden = panel !== next;
  }
  element('open-oracle').setAttribute('aria-pressed', String(next === 'oracle'));
  element('open-draw').setAttribute('aria-pressed', String(next === 'draw'));
  if (next === 'draw') showDraw();
  updateScene();
}

function syncComposer() {
  element('question-count').textContent = `${question.value.length} / 500`;
  element('ask').disabled = waiting || !question.value.trim();
  question.readOnly = waiting;
  element('question-status').textContent = waiting ? 'Preparando la respuesta de muestra…' : '';
  form.setAttribute('aria-busy', String(waiting));
}

function addMessage(role, message) {
  const bubble = document.createElement('p');
  bubble.className = 'message';
  bubble.dataset.role = role;
  const name = document.createElement('strong');
  name.textContent = role === 'user' ? 'Tu pregunta' : 'La Guardiana';
  bubble.append(name, document.createTextNode(message));
  log.append(bubble);
  log.scrollTop = log.scrollHeight;
}

function sampleReply(input, card) {
  const topic = input.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const aboutCard = /\b(carta|tirada|estrella|oraculo)\b/.test(topic);
  if (card && aboutCard) return 'La Estrella que elegiste representa la esperanza después de una pausa. Piensa en algo que últimamente te haya devuelto las ganas de empezar. ¿Cómo podrías darle un poco más de espacio esta semana?';
  if (/\b(amor|pareja|relacion|carino|enamorad[oa])\b/.test(topic)) return 'Para tu pregunta sobre los vínculos, te propongo separar lo que has observado de lo que te gustaría saber. Elige una conversación que puedas tener con calma. ¿Qué te gustaría poder decir con tus propias palabras?';
  if (/\b(trabajo|dinero|empleo|negocio|ahorr\w*|econom\w*)\b/.test(topic)) return 'Al pensar en el trabajo o el dinero, puede ayudar poner sobre la mesa algo concreto. Elige una opción y anota qué información te falta antes de decidir. ¿Qué dato podrías comprobar esta semana?';
  if (/\b(familia|herman\w*|hij[oa]s?|padre|madre)\b/.test(topic)) return 'Para tu pregunta sobre la familia, piensa en un momento reciente en el que te sentiste escuchada. Tal vez haya en él una pista para el próximo encuentro. ¿Qué te gustaría repetir de aquella conversación?';
  if (/\b(decis\w*|elegir|opcion\w*|camino\w*)\b/.test(topic)) return 'Imagina cada decisión como una carta sobre la mesa. Bajo una escribe lo que esperas ganar y bajo la otra, lo que necesitas cuidar. ¿Cuál te permite dar un primer paso pequeño y que puedas revisar después?';
  if (/\b(energ\w*|cans\w*|descans\w*|calma|pausa)\b/.test(topic)) return 'Detente un instante y piensa en el momento del día en que te sientes más a gusto. ¿Qué cambia en ese momento? Escoge un detalle de ese espacio y prueba a llevarlo a mañana.';
  if (aboutCard) return 'Puedes probar una tirada para situar la pregunta en una carta concreta. Al verla, fíjate primero en un detalle que te llame la atención. ¿Con qué parte de tu pregunta lo relacionarías?';
  return 'Esta muestra invita a mirar tu pregunta desde algo que sí puedas observar. Elige un detalle de lo que te preocupa y piensa en el primer cambio pequeño que te gustaría ver. ¿Qué podrías hacer para acercarte a él?';
}

function submitQuestion(event) {
  event.preventDefault();
  const text = question.value.trim();
  if (!text || waiting || mode !== 'oracle') return;
  window.clearTimeout(typingTimer);
  window.clearTimeout(answerTimer);
  const cardAtSubmission = latestCard;
  waiting = true;
  typing = answering = false;
  question.value = '';
  addMessage('user', text);
  syncComposer();
  updateScene();
  responseTimer = window.setTimeout(() => {
    waiting = false;
    answering = true;
    addMessage('guide', sampleReply(text, cardAtSubmission));
    syncComposer();
    updateScene();
    answerTimer = window.setTimeout(() => { answering = false; updateScene(); }, 3200);
  }, 2500);
}

const drawText = {
  ready: ['Una carta para ti', 'La Guardiana barajará el mazo y pondrá tres cartas sobre la mesa. Tú eliges cuál descubrir.'],
  shuffle: ['La Guardiana está barajando', 'Observa sus manos mientras prepara las cartas.'],
  offer: ['Elige una carta', 'Selecciona una de las tres posiciones de la mesa.'],
  reveal: ['Se revela tu carta', 'La Guardiana gira la carta que has elegido.'],
  complete: ['La Estrella', 'Esta carta representa la esperanza y la confianza que se recupera poco a poco. ¿Qué te ha devuelto la ilusión últimamente?'],
};

function showDraw() {
  const [title, copy] = drawText[drawPhase];
  element('draw-title').textContent = title;
  element('draw-copy').textContent = copy;
  element('card-choices').hidden = drawPhase !== 'offer';
  element('shuffle').hidden = !['ready', 'complete'].includes(drawPhase);
  element('shuffle').querySelector('span').textContent = drawPhase === 'complete' ? 'Volver a barajar' : 'Barajar las cartas';
  element('draw-to-oracle').hidden = drawPhase !== 'complete';
  updateScene();
}

function startDraw() {
  if (mode !== 'draw' || !['ready', 'complete'].includes(drawPhase)) return;
  latestCard = '';
  drawPhase = 'shuffle';
  showDraw();
  element('draw-title').focus({preventScroll: true});
  drawTimer = window.setTimeout(() => {
    drawPhase = 'offer';
    showDraw();
    if (mode === 'draw' && document.activeElement === element('draw-title')) {
      element('card-choices').querySelector('button').focus({preventScroll: true});
    }
  }, 3400);
}

function selectCard(index) {
  if (mode !== 'draw' || drawPhase !== 'offer') return;
  selectedIndex = index;
  drawPhase = 'reveal';
  showDraw();
  element('draw-title').focus({preventScroll: true});
  drawTimer = window.setTimeout(() => {
    latestCard = 'La Estrella';
    drawPhase = 'complete';
    showDraw();
    if (mode === 'draw' && document.activeElement === element('draw-title')) {
      element('draw-to-oracle').focus({preventScroll: true});
    }
  }, 2600);
}

element('open-oracle').addEventListener('click', () => setMode('oracle'));
element('open-draw').addEventListener('click', () => setMode('draw'));
element('shuffle').addEventListener('click', startDraw);
element('draw-to-oracle').addEventListener('click', () => {
  setMode('oracle');
  if (!waiting && !question.value.trim()) question.value = '¿Qué me invita a explorar La Estrella?';
  syncComposer();
  question.focus({preventScroll: true});
});
for (const choice of element('card-choices').querySelectorAll('button')) {
  choice.addEventListener('click', () => selectCard(Number(choice.dataset.index)));
}
form.addEventListener('submit', submitQuestion);
question.addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    form.requestSubmit();
  }
});
question.addEventListener('input', () => {
  window.clearTimeout(typingTimer);
  typing = Boolean(question.value.trim());
  updateScene();
  syncComposer();
  typingTimer = window.setTimeout(() => { typing = false; updateScene(); }, 2000);
});
pauseButton.addEventListener('click', () => {
  paused = !paused;
  userSetMotion = true;
  syncPause();
});
motionPreference.addEventListener('change', event => {
  if (!userSetMotion) { paused = event.matches; syncPause(); }
});
document.addEventListener('visibilitychange', updateScene);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  [typingTimer, responseTimer, answerTimer, drawTimer].forEach(timer => window.clearTimeout(timer));
  cards.destroy();
  portrait.destroy();
});
element('open-oracle').setAttribute('aria-controls', 'oracle-pane');
element('open-draw').setAttribute('aria-controls', 'draw-pane');
syncPause();
syncComposer();
