// Keep existing watch/panel tests focused on their API behavior; real motion is
// exercised by central-assistant-motion and the Atlas browser checks.
module.exports = (evaluate, styles, shared) => evaluate('src/features/admin/atlas/AtlasCharacter.tsx', {
  './Atlas.module.css': { default: styles },
    './voice/AtlasVoiceCompanion.module.css': { default: styles },
    'next/dynamic': { default: () => () => null }, './atlas-watch-types': shared,
  '@/components/atlas/AtlasPortrait': evaluate('src/components/atlas/AtlasPortrait.tsx', { '@/lib/atlas-identity': evaluate('src/lib/central-assistant.ts'), './AtlasPortrait.module.css': { default: styles } }),
  '@/features/central/assistant/useCompanionMotion': { useCompanionMotion: () => ({ ref: { current: null }, moving: false, dragging: false, point() {}, dock() {}, dragProps: {}, positionLabel: '' }) },
}, { window: { matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }) }, document: { hidden: false, addEventListener() {}, removeEventListener() {} } });
