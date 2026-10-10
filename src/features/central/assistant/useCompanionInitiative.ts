'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ASSISTANT_SECTIONS,type PetId,type Preferences} from '@/lib/central-assistant';

export const INITIATIVE_INTERVAL=120000;
export function invitation(tab:string,pet:PetId,index:number,humor:boolean){
  const contextual:Record<string,string>={
    'mis-clientas':'¿Buscamos clientas que lleven un mes sin llamar? Puedo preparar la consulta contigo.',
    crm:'¿Necesitas localizar a alguien? Podemos buscar en tu cartera por prefijo o por última llamada.',
    incidencias:'¿Revisamos las incidencias? Antes de cerrarlas, comprueba si el tiempo se recuperó o se justificó.',
    tienda:'¿Te ayudo con un bonus? Podemos consultar tu XP y saldo antes de decidir.',
    'tu-sistema-xp':'¿Quieres que te explique cómo conseguir XP y cuál es tu próximo nivel?',
    'recuperar-clientes':'¿Preparamos una búsqueda de clientes inactivos de tu cartera?',
    captacion:'¿Buscamos oportunidades de recuperación en tu cartera? Tú decides el siguiente paso.',
  };
  const options=[contextual[tab]||`${ASSISTANT_SECTIONS[tab]?.help||'Estoy aquí para ayudarte.'} ¿Lo vemos juntos?`,'¿Necesitas ayuda con algo? Puedes pedirme una búsqueda o dejarme una tarea.','¿Hay alguna indicación que quieras que recuerde? La revisamos antes de guardarla.'];
  if(humor)options.push(pet==='sol'?'Pausa de chispa: me estiro un poquito. ¿Seguimos con tu siguiente tarea?':'Mis alas están listas; mi café sigue cargando. ¿Te ayudo a organizar los pendientes?');
  return options[index%options.length];
}
export function useCompanionInitiative({ready,open,busy,mini,tab,pet,workerId,preferences,bubble,say}:{ready:boolean;open:boolean;busy:boolean;mini:boolean;tab:string;pet:PetId;workerId?:string|null;preferences:Preferences;bubble:string;say:(text:string)=>void}){
  const [gesture,setGesture]=useState(''),[speaking,setSpeaking]=useState(false),[voiceReady,setVoiceReady]=useState(false);
  const current=useRef({ready,open,busy,mini,tab,pet,preferences,say});current.current={ready,open,busy,mini,tab,pet,preferences,say};
  const last=useRef(0),quietUntil=useRef(0),counter=useRef(0),gestureTimer=useRef<ReturnType<typeof setTimeout>>(),spoken=useRef<SpeechSynthesisUtterance|null>(null);
  const animate=useCallback((value:string)=>{setGesture(value);clearTimeout(gestureTimer.current);gestureTimer.current=setTimeout(()=>setGesture(''),6500);},[]);
  const hush=useCallback(()=>{quietUntil.current=Date.now()+600000;current.current.say('');if(spoken.current&&'speechSynthesis'in window)window.speechSynthesis.cancel();setSpeaking(false);setGesture('');},[]);
  const entertain=useCallback(()=>{const c=current.current;const i=counter.current++;animate(['greeting','stretching','dancing','turning'][i%4]);c.say(invitation(c.tab,c.pet,i,c.preferences.humor));last.current=Date.now();},[animate]);
  useEffect(()=>{last.current=0;quietUntil.current=0;counter.current=0;return()=>{clearTimeout(gestureTimer.current);if(spoken.current&&'speechSynthesis'in window)window.speechSynthesis.cancel();};},[workerId]);
  useEffect(()=>{
    if(!ready)return;
    const timer=setTimeout(()=>{const c=current.current;if(!c.preferences.proactive||c.open||c.busy||c.mini||document.hidden||Date.now()<quietUntil.current||Date.now()-last.current<30000)return;last.current=Date.now();animate('greeting');c.say(invitation(c.tab,c.pet,0,c.preferences.humor));},14000);
    return()=>clearTimeout(timer);
  },[ready,tab,animate]);
  useEffect(()=>{
    const timer=setInterval(()=>{const c=current.current;const active=document.activeElement;const typing=active instanceof HTMLElement&&(active.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(active.tagName));
      if(!c.ready||!c.preferences.proactive||c.open||c.busy||c.mini||document.hidden||typing||Date.now()<quietUntil.current||Date.now()-last.current<INITIATIVE_INTERVAL)return;
      const i=++counter.current;last.current=Date.now();animate(c.preferences.humor?['greeting','stretching','dancing','turning'][i%4]:'greeting');c.say(invitation(c.tab,c.pet,i,c.preferences.humor));
    },10000);return()=>clearInterval(timer);
  },[animate]);
  useEffect(()=>{const unlock=()=>setVoiceReady(true);window.addEventListener('pointerdown',unlock,{once:true});window.addEventListener('keydown',unlock,{once:true});return()=>{window.removeEventListener('pointerdown',unlock);window.removeEventListener('keydown',unlock);};},[]);
  useEffect(()=>{
    if(!preferences.sound||!voiceReady||!bubble||document.hidden||!('speechSynthesis'in window))return;
    const synth=window.speechSynthesis,utterance=new SpeechSynthesisUtterance(bubble.slice(0,450));utterance.lang='es-ES';utterance.rate=pet==='sol'?1.03:.96;utterance.pitch=pet==='sol'?1.12:.86;
    const voice=synth.getVoices().find(v=>v.lang==='es-ES')||synth.getVoices().find(v=>v.lang.startsWith('es'));if(voice)utterance.voice=voice;
    spoken.current=utterance;utterance.onstart=()=>setSpeaking(true);utterance.onend=utterance.onerror=()=>{setSpeaking(false);spoken.current=null;};synth.speak(utterance);
    const stop=()=>{synth.cancel();setSpeaking(false);};const hide=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hide);
    return()=>{utterance.onstart=utterance.onend=utterance.onerror=null;document.removeEventListener('visibilitychange',hide);if(spoken.current===utterance){synth.cancel();spoken.current=null;}setSpeaking(false);};
  },[bubble,preferences.sound,voiceReady,pet]);
  return {gesture:speaking?'talking':gesture,entertain,hush};
}
