import type { Character, ObjectItem, Storyboard } from '@/types';
import { visibleImageCast } from './series/imageCastContract';

/** Fixed source references, never the preceding generated frame (which can drift). */
export function midjourneyShotInput(board: Storyboard, characters: Character[], objects: ObjectItem[], costumes: Record<string, string>, sceneImage?: string) {
  const cast = visibleImageCast(board, characters);
  const references: Array<{ url: string; role: string }> = [];
  const identities = cast.map(c => {
    const url = costumes[c.name] || c.imageUrl || c.imageBase64;
    if (url) references.push({ url, role: `Character ${c.name}: keep this same face, species, body, hair and costume; one instance only` });
    return `${c.name}: ${c.description}${board.characterCostume?.[c.name] ? `; locked wardrobe: ${board.characterCostume[c.name]}` : ''}`;
  });
  // Never silently drop a required actor to make room for scenery or props.
  if (references.length > 4) throw new Error('MJ 单镜最多4张角色参考；请先调整该镜选角，不会静默丢弃人物参考');
  for (const o of objects.filter(o => board.objects?.includes(o.name))) {
    const url = o.imageUrl || o.imageBase64;
    if (url && references.length < 4) references.push({ url, role: `OBJECT IDENTITY ONLY — ${o.name}: ${o.description}; preserve its exact physical design` });
  }
  if (sceneImage && references.length < 4) references.push({ url: sceneImage, role: 'Environment only: keep location, architecture, palette and light; ignore people and layout' });
  const prompt = `IMAGE GOAL:
${board.prompt}
Physical action: ${board.action || board.description}.
Shot design: ${[board.shotSize, board.angle, board.cameraMove].filter(Boolean).join(', ')}.
Environment: ${board.sceneStyle || 'the described story location'}.

LOCKED IDENTITIES:
${identities.join('\n') || 'No visible characters.'}

REFERENCE ROLES:
${references.map((r, i) => `Image ${i + 1}: ${r.role}.`).join('\n')}

CAST LOCK:
Exactly ${cast.length} distinct characters: ${cast.map(c => c.name).join(', ') || 'none'}. Preserve each identity and wardrobe separately; no merged faces or duplicated actors. References are identity and environment evidence only, never a layout to reproduce. Stage one new complete film frame with the requested action and viewpoint. No collage, panels, contact sheet, typography, caption or printed page. Do not imitate reference poses or copy its framing.`;
  return { prompt, imageUrls: references.map(r => r.url), hasPeople: cast.length > 0 };
}
