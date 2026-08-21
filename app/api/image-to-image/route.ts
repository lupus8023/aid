import { NextRequest, NextResponse } from 'next/server';
import { createImageTask } from '@/lib/apimart';
import { getImageModelCapabilities } from '@/lib/imageModels';

function buildStudioPrompt(userIntent?: string, scaleNotes?: string) {
  const intent = userIntent?.trim();
  const scale = scaleNotes?.trim();

  return `Use the provided reference images as the primary visual sources.

GOAL:
Create an ultra-realistic professional studio photograph with high-end commercial photography quality.${intent ? `\n\nSCENE / CREATIVE DIRECTION FROM USER:\n${intent}` : ''}${scale ? `\n\nREFERENCE SCALE / DIMENSION NOTES FROM USER:\n${scale}` : ''}

REFERENCE IMAGE RECOGNITION AND CONSISTENCY RULES:
- Treat the reference images as a strict identity, geometry, proportion, material, color, and scale guide.
- Preserve the main subject identity, structure, proportions, silhouette, materials, colors, texture, and all key details from the reference images.
- Keep every recognizable person, object, product, logo/text detail, outfit, accessory, and surface material faithful to the reference images.
- Use all provided reference images together: one may define identity, another may define object details, another may define pose, styling, lighting, or scale.
- If any reference contains a product, preserve its exact shape, packaging, material, color, logo/text details, size impression, and design language.
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

export async function POST(request: NextRequest) {
  try {
    const { referenceImages, referenceImage, userIntent, scaleNotes, aspectRatio, imageModel, apiKey } = await request.json();
    const images = Array.isArray(referenceImages) ? referenceImages : referenceImage ? [referenceImage] : [];

    if (images.length === 0) {
      return NextResponse.json({ error: 'At least one reference image is required' }, { status: 400 });
    }

    const referenceLimit = getImageModelCapabilities(imageModel || 'doubao-seedream-5-0-lite').maxReferenceImages;
    if (images.length > referenceLimit) {
      return NextResponse.json({ error: `The selected model supports up to ${referenceLimit} reference images` }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json({ error: 'API Key is required' }, { status: 400 });
    }

    const prompt = buildStudioPrompt(userIntent, scaleNotes);
    const taskId = await createImageTask(
      prompt,
      images,
      apiKey,
      imageModel || 'doubao-seedream-5-0-lite',
      aspectRatio || '1:1'
    );

    return NextResponse.json({ taskId, prompt });
  } catch (error) {
    console.error('Image-to-image API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create image-to-image task' },
      { status: 500 }
    );
  }
}
