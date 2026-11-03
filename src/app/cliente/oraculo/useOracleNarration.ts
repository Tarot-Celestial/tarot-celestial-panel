'use client';
import { useEffect, useRef, useState } from 'react';

export function useOracleNarration(text: string) {
  const [state, setState] = useState<'idle' | 'speaking' | 'paused'>('idle');
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  const generation = useRef(0);
  const queue = useRef<string[]>([]);
  const stop = () => { ++generation.current; queue.current = []; if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel(); setState('idle'); };
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    const update = () => {
      voice.current = synth.getVoices().find(v => v.localService && /^es[-_]/i.test(v.lang)) || null;
      setAvailable(Boolean(voice.current));
    };
    update(); synth.addEventListener('voiceschanged', update);
    const onHide = () => { if(document.hidden) stop(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { ++generation.current; synth.cancel(); synth.removeEventListener('voiceschanged', update); document.removeEventListener('visibilitychange', onHide); };
  }, []);
  useEffect(() => { stop(); setError(''); }, [text]);
  function play() {
    if (!voice.current || !text.trim()) return;
    const synth = window.speechSynthesis;
    if (state === 'speaking') { synth.pause(); setState('paused'); return; }
    if (state === 'paused') { synth.resume(); setState('speaking'); return; }
    const current = ++generation.current;
    queue.current = text.match(/[^.!?\n]+[.!?]?/g) || [text];
    setError(''); setState('speaking');
    const next = () => {
      if (generation.current !== current) return;
      const sentence = queue.current.shift();
      if (!sentence) { setState('idle'); return; }
      const utterance = new SpeechSynthesisUtterance(sentence.trim());
      utterance.voice = voice.current; utterance.lang = voice.current!.lang; utterance.rate = .93;
      utterance.onend = next;
      utterance.onerror = event => { if (generation.current === current) { setState('idle'); if(event.error !== 'canceled' && event.error !== 'interrupted') setError('No se pudo reproducir la voz. Puedes seguir leyendo la interpretación.'); } };
      synth.speak(utterance);
    };
    next();
  }
  return { state, available, error, play, stop };
}
