import type { CapturePreset } from '@/types';

export interface PhotographicDetailContext {
  view?: 'shot' | 'portrait' | 'character-sheet' | 'full-body' | 'environment' | 'grid' | 'creative';
  shotSize?: string;
  characterCount?: number;
  capturePreset?: CapturePreset;
}

// A short photographic cue, not a material-rendering specification. Identity,
// staging and light come from the shot, never from a fixed portrait recipe.
export function buildGptPhotographicDetail(context: PhotographicDetailContext = {}): string {
  const view = context.view || 'shot';
  const lowDetailCapture = ['phone-bystander', 'surveillance', 'home-video', 'broadcast-candid', 'news-telephoto'].includes(context.capturePreset || '');
  const noFace = view === 'environment' || context.characterCount === 0;
  const wide = view === 'full-body' || /wide|full[ -]?body|long shot|远景|全景|全身/i.test(context.shotSize || '');
  const face = noFace ? '' : wide || lowDetailCapture
    ? 'Faces retain their natural variation at this distance; do not enlarge pores or change the pose and gaze.'
    : 'Natural skin and hair, without beauty smoothing. Keep the specified age, markings, anatomy and gaze; do not invent freckles, scars or makeup.';
  const focus = lowDetailCapture
    ? 'Respect the declared capture device and its natural depth; no added portrait-mode blur.'
    : 'Keep the authored lens, camera distance and focus. Background detail may soften or disappear; the story action stays readable.';
  return `${view === 'grid' || view === 'character-sheet' ? 'Apply separately at each view’s actual scale, without turning every view into a close portrait.\n' : ''}${face ? `${face}\n` : ''}Use the light already present in the scene. Dark areas may remain dark and small lamps may clip; do not add beauty fill or decorative rim light. Ordinary cloth and set surfaces need not shine or show every detail. Do not add dirt, damage or wetness to manufacture realism.
${focus}`;
}
