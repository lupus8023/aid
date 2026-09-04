import type { AssetVisualIdentity, Character, ObjectItem } from '@/types';
import type { createStoryImageRequestPreparer } from './storyImageRequest';
import { readApiJson } from './apiResponse';
import { currentVisualIdentity, visualAssetSourceKey } from './storyVisualAssets';

/** Prepare originals once. Never accepts generated storyboard images. */
export async function prepareStoryAssets(input: {
  characters: Character[]; objects: ObjectItem[]; costumeImages: Record<string, string>;
  apiKey: string; dmxApiKey?: string; scriptProvider?: string; scriptModel?: string;
  prepareImages: ReturnType<typeof createStoryImageRequestPreparer>;
  request: (body: string) => Promise<Response>;
}): Promise<{ characters: Character[]; objects: ObjectItem[] }> {
  const assets = [
    ...input.characters.map(asset => ({ asset, kind: 'character' as const, image: input.costumeImages[asset.name] || asset.imageUrl || asset.imageBase64 || '' })),
    ...input.objects.map(asset => ({ asset, kind: 'object' as const, image: asset.imageUrl || asset.imageBase64 || '' })),
  ].filter(({ asset, image }) => image && !currentVisualIdentity(asset, image));
  if (!assets.length) return { characters: input.characters, objects: input.objects };
  const prepared = JSON.parse(await input.prepareImages({
    storyboard: { id: 'original-asset-understanding', sceneNumber: 0, status: 'pending', prompt: '', description: '', characters: input.characters.map(c => c.name), objects: input.objects.map(o => o.name) },
    characters: input.characters, objects: input.objects, costumeImages: input.costumeImages,
    referenceImages: assets.map(item => item.image), referenceImageLabels: assets.map(item => `${item.kind}:${item.asset.id}`),
    aspectRatio: '1:1', imageModel: 'gpt-image-2', apiKey: input.apiKey,
  }));
  const response = await input.request(JSON.stringify({
    assets: assets.map(({ asset, kind, image }, i) => ({ id: `${kind}:${asset.id}`, kind, name: asset.name, description: asset.description, sourceKey: visualAssetSourceKey(asset, image), imageUrl: prepared.referenceImages[i] })),
    apiKey: input.apiKey, dmxApiKey: input.dmxApiKey, scriptProvider: input.scriptProvider, scriptModel: input.scriptModel,
  }));
  const { identities } = await readApiJson<{ identities: Record<string, AssetVisualIdentity> }>(response, '原图理解失败');
  for (const { asset, kind, image } of assets) {
    if (identities?.[`${kind}:${asset.id}`]?.sourceKey !== visualAssetSourceKey(asset, image)) throw new Error(`“${asset.name}”的原图说明不完整；未提交生图`);
  }
  return {
    characters: input.characters.map(c => identities[`character:${c.id}`] ? { ...c, visualIdentity: identities[`character:${c.id}`] } : c),
    objects: input.objects.map(o => identities[`object:${o.id}`] ? { ...o, visualIdentity: identities[`object:${o.id}`] } : o),
  };
}
