export interface NamedCharacter { name: string; aliases?: string[] }

const key = (value: string) => String(value || '').trim().toLocaleLowerCase();

/** Only explicit names/aliases are identity evidence. Never use substring,
 * gender, voice similarity, or an arbitrary first match to cast a speaker. */
export function characterIdentityIndex<T extends NamedCharacter>(characters: T[]) {
  const names = new Map<string, Set<T>>(), aliases = new Map<string, Set<T>>();
  const add = (map: Map<string, Set<T>>, name: string, character: T) => {
    const normalized = key(name);
    if (!normalized) return;
    const matches = map.get(normalized) || new Set<T>();
    matches.add(character); map.set(normalized, matches);
  };
  for (const character of characters) {
    add(names, character.name, character);
    for (const alias of character.aliases || []) add(aliases, alias, character);
  }
  const matches = (name: string) => names.get(key(name)) || aliases.get(key(name));
  return {
    resolve(name: string): T | undefined {
      const found = matches(name);
      return found?.size === 1 ? [...found][0] : undefined;
    },
    has(name: string) { return Boolean(matches(name)?.size); },
  };
}

/** Reuse voice artifacts under registered aliases without selecting a new voice. */
export function characterAliasValues<T extends NamedCharacter>(values: Record<string, string> = {}, characters: T[]) {
  const index = characterIdentityIndex(characters);
  const result = { ...values };
  for (const character of characters) {
    const keys = [...new Set([character.name, ...(character.aliases || []), ...Object.keys(values)])]
      .filter(name => index.resolve(name) === character);
    const candidates = [...new Set(keys.map(name => values[name]).filter(Boolean))];
    const value = index.resolve(character.name) === character && values[character.name]
      || (candidates.length === 1 ? candidates[0] : undefined);
    if (value) for (const name of keys) result[name] = value;
  }
  return result;
}

export function withoutCharacterValues(values: Record<string, string> = {}, name: string, characters: NamedCharacter[]) {
  const index = characterIdentityIndex(characters), actor = index.resolve(name);
  return Object.fromEntries(Object.entries(values).filter(([key]) => key !== name && (!actor || index.resolve(key) !== actor)));
}
