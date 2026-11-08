export const CHAT_CHARACTERS = [
  { id: 'moon', label: 'Luna', emoji: '🌙' },
  { id: 'star', label: 'Estrella', emoji: '⭐' },
  { id: 'owl', label: 'Búho', emoji: '🦉' },
  { id: 'cat', label: 'Gato', emoji: '🐈' },
  { id: 'butterfly', label: 'Mariposa', emoji: '🦋' },
  { id: 'flower', label: 'Flor', emoji: '🌸' },
] as const;
export const CHAT_WALLPAPERS = [
  { id: 'aurora', label: 'Aurora', color: '#29233d' },
  { id: 'midnight', label: 'Medianoche', color: '#101927' },
  { id: 'forest', label: 'Bosque', color: '#15372f' },
  { id: 'sand', label: 'Arena', color: '#463626' },
] as const;
export const CHAT_EMOJI = ['😀','😊','🥰','😘','😂','😉','🤗','😍','😴','😅','😭','😮','🤔','🙏','🙌','👍','👋','💪','❤️','💜','✨','🌟','🌙','🔮','🦉','☕','🍽️','🎉','✅','⏳','📞','💐'];
export const CHAT_STICKERS = [
  { id: 'hello', emoji: '👋', label: '¡Hola!', color: '#bf9be8' },
  { id: 'thanks', emoji: '💜', label: '¡Gracias!', color: '#d7adf1' },
  { id: 'ready', emoji: '✨', label: 'Lista para ti', color: '#ffe09b' },
  { id: 'hug', emoji: '🤗', label: 'Un abrazo', color: '#f8bdab' },
  { id: 'great', emoji: '🙌', label: '¡Genial!', color: '#a9e8d5' },
  { id: 'coffee', emoji: '☕', label: 'Un momentito', color: '#dfc4ac' },
  { id: 'stars', emoji: '🌟', label: 'Buen turno', color: '#f6df96' },
  { id: 'okay', emoji: '👍', label: '¡Hecho!', color: '#a4cfee' },
] as const;
export type StaffChatProfile = { worker_id: string; avatar_kind: 'initials' | 'character' | 'photo'; character: string | null; photo_url: string | null; revision: number };
export type StaffChatPreference = { wallpaper: string; background_url: string | null; revision: number };
export type StaffChatAppearance = { profile: StaffChatProfile; preference: StaffChatPreference; profiles: Record<string, StaffChatProfile> };
export function defaultChatAppearance(workerId: string): StaffChatAppearance {
  return { profile: { worker_id: workerId, avatar_kind: 'initials', character: null, photo_url: null, revision: 0 }, preference: { wallpaper: 'aurora', background_url: null, revision: 0 }, profiles: {} };
}
export async function createStaffSticker(id: string): Promise<File> {
  const sticker = CHAT_STICKERS.find(item => item.id === id);
  if (!sticker) throw new Error('Sticker no disponible.');
  const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 360;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo preparar el sticker en este navegador.');
  ctx.fillStyle = sticker.color; ctx.beginPath(); ctx.arc(180, 174, 147, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 9; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '126px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  ctx.fillText(sticker.emoji, 180, 149);
  ctx.font = 'bold 27px Arial, sans-serif'; ctx.fillStyle = '#251c36'; ctx.fillText(sticker.label, 180, 260);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('No se pudo preparar el sticker.')), 'image/png'));
  return new File([blob], `sticker-${sticker.id}.png`, { type: 'image/png' });
}
