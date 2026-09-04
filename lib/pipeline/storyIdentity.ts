import { characterIdentityIndex, type NamedCharacter } from '@/lib/characterIdentity';

/** Only registered, unambiguous identities may be folded together. Prose,
 * exact dialogue and camera/action directions are deliberately untouched. */
export function canonicalizeStoryIdentities<T>(value: T, characters: NamedCharacter[]): T {
  const index = characterIdentityIndex(characters);
  const name = (value: string) => index.resolve(value)?.name || value;
  const identityFields = new Set(['character', 'speaker', 'requiredSpeaker', 'protagonist']);
  const visit = (value: any, field = ''): any => {
    if (typeof value === 'string') return identityFields.has(field) || field === 'characters' ? name(value) : value;
    if (Array.isArray(value)) {
      const items = value.map(item => visit(item, field));
      if (field !== 'characters') return items;
      const seen = new Set<string>();
      return items.filter(item => {
        const key = typeof item === 'string' ? item : item?.name;
        if (!key) return true;
        if (seen.has(key)) return false;
        seen.add(key); return true;
      });
    }
    if (!value || typeof value !== 'object') return value;
    const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, field === 'characters' && key === 'name' && typeof item === 'string' ? name(item) : visit(item, key),
    ]));
    if (field === 'characters' && typeof result.name === 'string') {
      const registered = index.resolve(result.name);
      // Do not adopt aliases invented by the model.
      result.aliases = registered?.aliases;
    }
    if (field === 'speech' && typeof result.character === 'string') {
      const registered = index.resolve(result.character);
      if (registered) result.speakerId = `S${characters.indexOf(registered) + 1}`;
    }
    return result;
  };
  return visit(value);
}

export function storyIdentityContract(characters: NamedCharacter[]): string {
  const index = characterIdentityIndex(characters);
  return `角色身份表（仅用于编剧绑定，不是台词或画面文字）：\n${characters.map((character, offset) => {
    const aliases = (character.aliases || []).filter(alias => index.resolve(alias) === character && alias !== character.name);
    return `S${offset + 1} = ${character.name}${aliases.length ? `；同一人物的已登记称呼：${aliases.join('、')}` : ''}`;
  }).join('\n')}\n同一行的姓名、称呼、角色卡是同一个人，不得新增角色或分配第二个 S ID。characters、speaker、speech.character、performance.character 使用正名；speech.speakerId 使用上表 ID。逐字台词内的称呼原样保留。`;
}
