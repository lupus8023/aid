import type { CapturePreset, VisualStyle } from '@/types';
import { getProductionStylePreset } from './promptArchitecture';
import { getCapturePreset } from './capturePresets';

/** Image-only priorities. No video prompt, sampling or H3 defaults live here. */
export interface ImageStyleControls {
  visualStyle?: VisualStyle;
  capturePreset?: CapturePreset;
  hasCharacterReference?: boolean;
  hasStyleReference?: boolean;
}

export function buildImageStyleControls(input: ImageStyleControls): string {
  const style = input.visualStyle && input.visualStyle !== 'follow-reference' ? getProductionStylePreset(input.visualStyle) : undefined;
  const capture = input.capturePreset && input.capturePreset !== 'follow-reference' ? getCapturePreset(input.capturePreset) : undefined;
  return [
    input.hasCharacterReference ? `CHARACTER DESIGN AUTHORITY: preserve the referenced face identity, age, anatomy, hair, clothing, jewelry and materials. ${style || input.hasStyleReference ? 'Change rendering only, not the actor or design.' : 'Inherit the approved medium, palette, skin treatment, material detail, grain and light softness; do not beautify, neutralize or restyle it.'}` : '',
    style ? `SELECTED IMAGE STYLE: ${style.value}\n${style.imageContract}.` : input.hasStyleReference ? 'STYLE SOURCE: the separately mapped style image supplies medium, palette, lighting mood and surface treatment; it is not another actor, costume, product or location.' : '',
    capture ? `SELECTED CAPTURE METHOD: ${capture.value}\n${capture.image}` : input.hasCharacterReference ? 'Inherit the reference capture method while executing the authored shot size, viewpoint and action.' : '',
    style || capture || input.hasStyleReference ? 'PRIORITY: preserve identity/product design and authored actions. Selected style controls medium; style image controls palette/mood; selected capture controls camera perspective/depth/exposure. Render capture geometry within the selected medium. Add no people, rain, props or events to demonstrate style.' : '',
  ].filter(Boolean).join('\n');
}
