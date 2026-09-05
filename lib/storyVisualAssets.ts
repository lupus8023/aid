import type { AssetVisualIdentity, Character, ObjectItem, Storyboard } from '@/types';
import { characterIdentityIndex } from './characterIdentity';
import { visibleImageCast } from './series/imageCastContract';
import { currentVideoDirection, videoDirectionSourceKey } from './videoDirection';

export type VisualAsset = Pick<ObjectItem, 'id' | 'name' | 'description' | 'imageUrl' | 'imageBase64' | 'visualIdentity'> & { aliases?: string[] };

// A browser-safe source fingerprint. Changing the original or user description
// invalidates the cached understanding; generating a shot never changes it.
export function visualAssetSourceKey(asset: VisualAsset, source = asset.imageUrl || asset.imageBase64 || ''): string {
  const stableSource = source.startsWith('blob:') && asset.imageBase64 ? asset.imageBase64 : source;
  const value = JSON.stringify([asset.id, asset.name, asset.description, stableSource]);
  let hash = 2166136261, second = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ value.charCodeAt(i);
  }
  return `v1:${value.length}:${(hash >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

export function currentVisualIdentity(asset: VisualAsset, source?: string): AssetVisualIdentity | undefined {
  return asset.visualIdentity?.version === 1 && asset.visualIdentity.sourceKey === visualAssetSourceKey(asset, source)
    ? asset.visualIdentity : undefined;
}

export function visualAssetDescription(asset: VisualAsset, source?: string): string {
  const identity = currentVisualIdentity(asset, source);
  if (!identity) return asset.description;
  return `[${identity.kind}] ${identity.appearance}${identity.scale ? ` Scale: ${identity.scale}` : ''}${identity.states ? ` Allowed states: ${identity.states}` : ''}`;
}

export function characterProductionDescription(character: { description: string; visualDescription?: string }): string {
  return [character.description, character.visualDescription ? `Original image facts (appearance authority): ${character.visualDescription}` : ''].filter(Boolean).join('\n');
}

export const VISUAL_ASSET_AUTHORITY = 'VISUAL ASSET AUTHORITY: originals override names and conflicting legacy appearance. Packaging is not its contents. Material references describe product surfaces, not extra props. Keep color, material, cutouts, construction, physical scale and markings; soft products may fold, drape and fit naturally. Keep each mapped face, hair and wardrobe unless a costume change is authored. Preserve authored actions and dialogue; invent no events.';

export function visibleStoryObjects(board: Pick<Storyboard, 'objects' | 'prompt' | 'description' | 'referenceBindings'>, objects: ObjectItem[]): ObjectItem[] {
  const index = characterIdentityIndex(objects);
  const named = new Set((board.objects || []).map(name => index.resolve(name)).filter(Boolean));
  const binding = board.referenceBindings;
  const idsCurrent = !binding?.objectNames || JSON.stringify(binding.objectNames) === JSON.stringify(board.objects);
  // Explicit reference tags and registered names only; do not infer an asset
  // from color similarity or a generic English noun such as "mask".
  for (const object of objects) {
    if (idsCurrent && binding?.objectIds.includes(object.id)) named.add(object);
    const names = [object.name, ...(object.aliases || [])].filter(name => index.resolve(name) === object);
    if (names.some(name => board.prompt?.includes(`[${name}]`) || (board.objects === undefined && (board.prompt?.includes(name) || board.description?.includes(name))))) named.add(object);
  }
  return objects.filter(object => named.has(object));
}

export function bindStoryboardReferences(board: Storyboard, characters: Character[], objects: ObjectItem[]): Storyboard {
  const cast = visibleImageCast(board, characters);
  const props = visibleStoryObjects(board, objects);
  const index = characterIdentityIndex(characters);
  const characterNames = [...new Set([...(board.characters || []).map(name => index.resolve(name)?.name || name), ...cast.map(c => c.name)])];
  const objectIndex = characterIdentityIndex(objects);
  // Binding IDs must not reorder a director's existing visual input and make
  // its motion-brief fingerprint stale merely because the library is sorted.
  const objectNames = [...new Set([
    ...(board.objects || []).map(name => objectIndex.resolve(name)?.name).filter((name): name is string => Boolean(name)),
    ...props.map(object => object.name),
  ])];
  const bound = { ...board,
    characters: characterNames,
    objects: objectNames,
    referenceBindings: { characterIds: cast.map(c => c.id), objectIds: props.map(o => o.id), characterNames, objectNames },
  };
  // This operation resolves references already present in the shot, not new
  // story content. Preserve a valid direction across ID/name normalization.
  try { if (currentVideoDirection(board)) bound.videoDirectionSource = videoDirectionSourceKey(bound); } catch {}
  return bound;
}

export class ImageReferenceCapacityError extends Error {}

export function requireReferenceCapacity(count: number, limit: number, reserved = 0): void {
  if (count > Math.max(0, limit - reserved)) throw new ImageReferenceCapacityError(
    `本次需要 ${count} 张身份/道具/场景参考，另有 ${reserved} 张风格参考，超过模型 ${limit} 张容量；未提交生成，也未丢弃参考图`,
  );
}
