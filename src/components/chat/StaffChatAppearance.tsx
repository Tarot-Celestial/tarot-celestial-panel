'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ImagePlus, Palette, UserRound, X } from 'lucide-react';
import { chatRequest, ChatRequestError } from '@/lib/staff-chat-client';
import { CHAT_CHARACTERS, CHAT_WALLPAPERS, defaultChatAppearance, type StaffChatAppearance, type StaffChatProfile } from '@/lib/staff-chat-appearance';
import styles from './StaffDirectChatPanel.module.css';

export function StaffChatAvatar({ name, profile }: { name: string; profile?: StaffChatProfile }) {
  if (profile?.avatar_kind === 'photo' && profile.photo_url) return <img className={styles.profileImage} src={profile.photo_url} alt=""/>;
  const character = profile?.avatar_kind === 'character' ? CHAT_CHARACTERS.find(item => item.id === profile.character) : null;
  return <>{character?.emoji || name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'TC'}</>;
}
export function useStaffChatAppearance(workerId: string, threadId: string) {
  const key = `${workerId}:${threadId}`;
  const [snapshot, setSnapshot] = useState(() => ({ key, appearance: defaultChatAppearance(workerId) }));
  const [error, setError] = useState('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!workerId) return;
    const current = generation.current;
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    try {
      const result = await chatRequest(`/api/chat/preferences${threadId ? `?thread_id=${encodeURIComponent(threadId)}` : ''}`, { signal: request.signal });
      if (!request.signal.aborted && current === generation.current && result.profile?.worker_id === workerId) { setSnapshot({ key, appearance: result }); setError(''); }
    } catch (reason) { if (!request.signal.aborted && current === generation.current) setError(reason instanceof Error ? reason.message : 'No se pudo cargar la personalización.'); }
  }, [workerId, threadId, key]);
  const setAppearance = useCallback((value: StaffChatAppearance) => {
    if (value.profile.worker_id !== workerId) return;
    // A GET started before this save must never restore the previous photo/fondo.
    generation.current++; controller.current?.abort(); setSnapshot({ key, appearance: value }); setError('');
  }, [key, workerId]);
  useEffect(() => {
    generation.current++; setError(''); void refresh();
    const whenVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(whenVisible, 240000);
    document.addEventListener('visibilitychange', whenVisible);
    return () => { generation.current++; controller.current?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', whenVisible); };
  }, [workerId, threadId, refresh]);
  return { appearance: snapshot.key === key ? snapshot.appearance : defaultChatAppearance(workerId), error, refresh, setAppearance };
}

export default function StaffChatAppearanceSettings({ workerId, threadId, name, value, disabled, onClose, onSaved, onReload, loadError }: {
  workerId: string; threadId: string; name: string; value: StaffChatAppearance; disabled: boolean;
  onClose: () => void; onSaved: (value: StaffChatAppearance) => void; onReload: () => Promise<void>; loadError: string;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const titleId = useId();
  const profileInput = useRef<HTMLInputElement>(null), backgroundInput = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDivElement>(null), closeButton = useRef<HTMLButtonElement>(null);
  const active = useRef(true), saving = useRef(false);
  useEffect(() => {
    active.current = true; const previous = document.activeElement as HTMLElement | null; closeButton.current?.focus();
    return () => { active.current = false; previous?.focus?.(); };
  }, []);
  async function save(scope: 'profile' | 'background', body: Record<string, unknown>, file?: File) {
    if (saving.current || disabled) return;
    if (file && (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size <= 0 || file.size > 2097152)) { setError('Elige una imagen JPG, PNG o WebP de hasta 2 MB.'); return; }
    saving.current = true; setBusy(true); setError(''); setSuccess('');
    const revision = scope === 'profile' ? value.profile.revision : value.preference.revision;
    try {
      let result;
      if (file) {
        const form = new FormData(); form.set('scope', scope); form.set('thread_id', threadId); form.set('revision', String(revision)); form.set('expected_worker_id', workerId); form.set('file', file);
        result = await chatRequest('/api/chat/preferences', { method: 'POST', body: form });
      } else result = await chatRequest('/api/chat/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, scope, revision, thread_id: threadId, expected_worker_id: workerId }) });
      if (active.current && result.profile?.worker_id === workerId) { onSaved(result); setSuccess(scope === 'profile' ? 'Tu perfil se ha actualizado.' : 'Fondo guardado solo para ti en esta conversación.'); }
    } catch (reason) {
      if (active.current) {
        setError(reason instanceof ChatRequestError && reason.code === 'APPEARANCE_CHANGED' ? 'La personalización cambió en otra pestaña. La he actualizado; vuelve a elegir tu opción.' : reason instanceof Error ? reason.message : 'No se pudo guardar.');
        await onReload();
      }
    } finally { saving.current = false; if (active.current) setBusy(false); }
  }
  const locked = disabled || busy;
  return <div className={styles.appearanceBackdrop}>
    <div className={styles.appearanceDialog} ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not([hidden]):not(:disabled), [tabindex="0"]');
        if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <header><div><span className={styles.eyebrow}>A TU MANERA</span><h3 id={titleId}>Tu espacio de equipo</h3></div><button ref={closeButton} type="button" aria-label="Cerrar personalización" onClick={onClose}><X size={20}/></button></header>
      {error || loadError ? <p className={styles.mediaError} role="alert">{error || loadError}</p> : null}
      {success ? <p className={styles.appearanceSuccess} role="status">{success}</p> : null}
      <section><h4><UserRound size={17}/> Tu foto o personaje</h4><p>Tu equipo verá este perfil junto a tu nombre.</p>
        <div className={styles.profilePreview}><span className={styles.avatar}><StaffChatAvatar name={name} profile={value.profile}/></span><strong>{name}</strong></div>
        <div className={styles.characterChoices}>{CHAT_CHARACTERS.map(character => <button key={character.id} type="button" aria-label={`Usar personaje ${character.label}`} aria-pressed={value.profile.avatar_kind === 'character' && value.profile.character === character.id} disabled={locked} onClick={() => void save('profile', { avatar_kind: 'character', character: character.id })}><span>{character.emoji}</span>{character.label}</button>)}</div>
        <div className={styles.appearanceActions}><button type="button" disabled={locked} onClick={() => profileInput.current?.click()}><ImagePlus size={16}/> Subir foto</button><button type="button" disabled={locked} onClick={() => void save('profile', { avatar_kind: 'initials' })}>Usar iniciales</button></div>
        <input hidden type="file" accept="image/jpeg,image/png,image/webp" ref={profileInput} aria-label="Foto de perfil" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void save('profile', {}, file); }}/>
      </section>
      <section><h4><Palette size={17}/> Fondo de esta conversación</h4><p>El fondo cambia solo para ti. Los mensajes siguen siendo los mismos.</p>
        <div className={styles.wallpaperChoices}>{CHAT_WALLPAPERS.map(wallpaper => <button key={wallpaper.id} type="button" disabled={locked || !threadId} aria-pressed={value.preference.wallpaper === wallpaper.id} style={{ backgroundColor: wallpaper.color }} onClick={() => void save('background', { wallpaper: wallpaper.id })}>{wallpaper.label}</button>)}</div>
        <button type="button" className={styles.uploadBackground} disabled={locked || !threadId} onClick={() => backgroundInput.current?.click()}><ImagePlus size={16}/> Elegir foto de mis archivos</button>
        <input hidden type="file" accept="image/jpeg,image/png,image/webp" ref={backgroundInput} aria-label="Foto para el fondo del chat" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void save('background', {}, file); }}/>
        <small>JPG, PNG o WebP · Hasta 2 MB. Elige un color para quitar tu foto de fondo.</small>
      </section>
      {busy ? <p role="status">Guardando personalización…</p> : null}
    </div>
  </div>;
}
