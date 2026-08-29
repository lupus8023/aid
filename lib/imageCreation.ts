import { isComfyUIZImageTurbo, isMidjourneyImageModel } from './imageModels';

export function imageCreationInputError(input: {
  model: string;
  referenceCount: number;
  userIntent?: string;
}): string {
  if (isComfyUIZImageTurbo(input.model) || isMidjourneyImageModel(input.model)) {
    return input.userIntent?.trim() ? '' : '使用文生图模型时，请先描述目标画面';
  }
  return input.referenceCount > 0 ? '' : '请至少上传一张参考图片';
}

export function buildStudioImagePrompt(input: {
  userIntent?: string;
  scaleNotes?: string;
  usesReferenceImages: boolean;
}): string {
  const intent = input.userIntent?.trim();
  const scale = input.scaleNotes?.trim();

  if (!input.usesReferenceImages) {
    return `Create one polished image that follows the user's creative direction exactly.

USER CREATIVE DIRECTION:
${intent || 'Create a premium, visually coherent commercial image.'}${scale ? `\n\nPROPORTION / DIMENSION NOTES FROM USER:\n${scale}` : ''}

CREATIVE RULES:
- The user's requested subject, setting, medium, visual style, color palette, composition, camera viewpoint, lighting, and mood are authoritative.
- Preserve believable anatomy, object geometry, material response, contact, perspective, and scale relationships.
- Keep the composition intentional, visually coherent, and production-ready.
- Do not replace a requested illustration, graphic, animation, painting, or other stylized medium with photography.
- Do not invent additional subjects, products, props, logos, or story elements that conflict with the request.

OUTPUT RULES:
- One clean finished image only.
- No random text, watermark, subtitles, captions, signature, border, UI, split screen, contact sheet, or comparison layout.
- No deformation, warped anatomy, extra limbs, duplicate subjects, broken object geometry, or incoherent reflections.`;
  }

  return `Use the provided reference images as the primary visual sources.

GOAL:
Create an ultra-realistic professional studio photograph with high-end commercial photography quality.${intent ? `\n\nSCENE / CREATIVE DIRECTION FROM USER:\n${intent}` : ''}${scale ? `\n\nREFERENCE SCALE / DIMENSION NOTES FROM USER:\n${scale}` : ''}

REFERENCE IMAGE RECOGNITION AND CONSISTENCY RULES:
- Treat the reference images as a strict identity, geometry, proportion, material, color, and scale guide.
- Preserve the main subject identity, structure, proportions, silhouette, materials, colors, texture, and all key details from the reference images.
- Keep every recognizable person, object, product, logo/text detail, outfit, accessory, and surface material faithful to the reference images.
- Use all provided reference images together: one may define identity, another may define object details, another may define pose, styling, lighting, or scale.
- If any reference contains a product, preserve its exact shape, packaging, material, color, logo/text details, size impression, and design language.
- Treat every referenced object or product as an immutable design source. Preserve its exact silhouette, dimensions, proportions, component layout, construction, material, surface finish, color, texture, seams, closures, interfaces, intentional markings, wear, and small identifying details.
- Change a referenced object only in viewpoint, placement, lighting, and physically possible articulation required by the user's scene. Never redesign, simplify, stretch, melt, substitute, or add/remove parts.
- If any reference contains a person, preserve facial identity, hairstyle, body proportions, clothing identity, accessories, pose logic, and natural skin texture.
- Preserve the relative scale relationship between people and objects: hand-to-object size, body-to-product size, object height/width/depth impression, distance, placement, contact points, and perspective.
- Do not enlarge, shrink, stretch, flatten, or redesign referenced objects unless the user explicitly asks.
- If user scale or dimension notes are provided, follow them as hard constraints for object proportions and person-object scale relationships.

STUDIO PHOTOGRAPHY QUALITY:
- Professional studio photo shoot, ultra realistic, premium commercial photography.
- Clean high-end set design, controlled softbox lighting, natural contact shadows, realistic reflections.
- Sharp details, realistic texture, balanced highlights, no overexposure.
- 50mm or 85mm lens look, shallow depth of field when appropriate, crisp subject separation.
- Premium editorial composition, polished but natural.

NEGATIVE RULES:
- No deformation, no warped anatomy, no extra limbs, no duplicate subjects.
- No random text, no watermark, no subtitles, no UI elements.
- Do not add logos or text unless they already exist in the reference images and should be preserved.
- Do not change the core subject into a different object or person.`;
}
