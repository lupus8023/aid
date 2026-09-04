import { characterIdentityIndex } from '@/lib/characterIdentity';
import type { WriterCharacter } from './types';

export interface StoryCastBinding {
  sourceNames: string[];
  targetName: string;
  targetId?: string;
  dialogueName: string;
  sourceRole: string;
  targetRole: string;
  reason: string;
}

export interface StoryCastAdaptation {
  version: 1;
  mode: 'rewrite-selected-identities';
  castKey: string;
  adaptedSource: string;
  bindings: StoryCastBinding[];
  newCharacters: string[];
}

export class StoryCastAmbiguityError extends Error {}

/** No media, credentials or voice settings participate in the identity decision. */
export function storyCastKey(characters: WriterCharacter[]): string {
  return JSON.stringify(characters.map(({ id, name, aliases, description, gender, ageGroup }) => ({ id, name, aliases, description, gender, ageGroup })));
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const term = (value: unknown) => typeof value === 'string' && value.trim().length <= 40 && !/[\n\r:：。！？!?;；<>]/u.test(value) ? value.trim() : '';

/** One non-cascading replacement pass: only approved identity tokens change.
 * CJK names may touch verbs; Latin names must have word boundaries. */
export function rewriteCastReferences(source: string, bindings: StoryCastBinding[], protectedNames: string[] = []): string {
  const narrative = new Map(bindings.flatMap(binding => binding.sourceNames.map(name => [name, binding.targetName] as const)));
  const dialogue = new Map(bindings.flatMap(binding => binding.sourceNames.map(name => [name, binding.dialogueName] as const)));
  const protectedTerms = new Set([...protectedNames, ...bindings.map(binding => binding.targetName)].filter(name => !narrative.has(name)));
  const tokens = [...new Set([...narrative.keys(), ...protectedTerms])].sort((a, b) => b.length - a.length);
  if (!tokens.length) return source;
  const pattern = new RegExp(tokens.map(token => /\p{Script=Han}/u.test(token)
    ? escape(token) : `(?<![\\p{L}\\p{N}_])${escape(token)}(?![\\p{L}\\p{N}_])`).join('|'), 'gu');
  return source.split(/("(?:\\.|[^"\\])*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}])'(?:\\.|[^'\\\n])*'(?![\p{L}\p{N}]))/gu).map((part, index) => part.replace(pattern, (matched, offset: number) => {
    if (protectedTerms.has(matched)) return matched;
    // A plural crowd or another unnamed person is not the selected individual.
    if (/\p{Script=Han}/u.test(matched) && (/^们/.test(part.slice(offset + matched.length)) || /(?:另一[名个位]?|其他|一群|几名|数名)$/.test(part.slice(Math.max(0, offset - 4), offset)))) return matched;
    return (index % 2 ? dialogue : narrative).get(matched) || matched;
  })).join('');
}

/** Models choose casting, never return a rewritten screenplay. All edits below
 * are restricted to the validated names/titles; plot and action are not mutable. */
export function parseStoryCastAdaptation(
  raw: any, source: string, characters: WriterCharacter[], requiredNames: string[] = [], protectedNames: string[] = [],
): StoryCastAdaptation {
  if (!raw || !Array.isArray(raw.bindings) || !Array.isArray(raw.newCharacters) || !Array.isArray(raw.ambiguous)) throw new Error('人物适配必须返回 bindings、newCharacters 和 ambiguous 数组');
  if (raw.ambiguous.length) throw new StoryCastAmbiguityError(`人物对应关系需明确：${raw.ambiguous.map((item: any) => typeof item === 'string' ? item : item?.sourceName).filter(Boolean).join('、')}；请在人物描述或剧本中注明对应关系，不能直接新增重复人物`);
  const identities = characterIdentityIndex(characters);
  const targets = new Set<string>(), sources = new Map<string, string>();
  const bindings: StoryCastBinding[] = raw.bindings.map((item: any) => {
    const target = characters.find(character => character.name === item?.targetName);
    const sourceNames = Array.isArray(item?.sourceNames) ? [...new Set(item.sourceNames.map(term))] as string[] : [];
    if (!target || !sourceNames.length || sourceNames.some(name => !name || !source.includes(name))) throw new Error('人物适配只能匹配原稿中实际出现的称呼与已选人物');
    if (targets.has(target.name)) throw new Error(`多个独立角色不能合并为“${target.name}”；同一人物的称呼应放在同一个 sourceNames 中`);
    targets.add(target.name);
    for (const name of sourceNames) {
      const registered = identities.resolve(name);
      if (identities.has(name) && (!registered || registered !== target)) throw new Error(`人物适配不能覆盖“${name}”已有的明确选角或歧义关系`);
      if (sources.has(name)) throw new Error(`“${name}”被重复分配人物`);
      if (protectedNames.includes(name)) throw new Error(`“${name}”是登记道具，不能按人物改写`);
      sources.set(name, target.name);
    }
    const dialogueName = term(item.dialogueName), sourceRole = term(item.sourceRole), targetRole = term(item.targetRole);
    if (!dialogueName || !sourceRole || !targetRole || typeof item.reason !== 'string' || !item.reason.trim()) throw new Error('人物适配缺少原身份、目标身份、台词称谓或匹配理由');
    if (identities.has(dialogueName) && identities.resolve(dialogueName) !== target) throw new Error(`台词称谓“${dialogueName}”已对应其他人物，不能覆盖`);
    return { sourceNames, targetName: target.name, targetId: target.id, dialogueName, sourceRole, targetRole, reason: item.reason.trim() };
  });
  const newCharacters = [...new Set(raw.newCharacters.map(term))] as string[];
  if (newCharacters.some(name => !name || !source.includes(name) || sources.has(name) || identities.has(name))) throw new Error('新增人物只能是原稿明确存在、未匹配且未登记的独立人物');
  const missing = requiredNames.filter(name => !characters.some(character => character.name === name) && !sources.has(name) && !newCharacters.includes(name));
  if (missing.length) throw new Error(`人物适配遗漏原稿说话人：${missing.join('、')}`);
  for (const binding of bindings) {
    if (bindings.some(other => other !== binding && (other.dialogueName === binding.dialogueName || other.sourceNames.includes(binding.dialogueName))) || newCharacters.includes(binding.dialogueName)) {
      throw new Error(`适配后称谓“${binding.dialogueName}”对应多人，请用明确的姓名或称呼`);
    }
  }
  return { version: 1, mode: 'rewrite-selected-identities', castKey: storyCastKey(characters),
    bindings, newCharacters, adaptedSource: rewriteCastReferences(source, bindings, [...characters.map(character => character.name), ...protectedNames]) };
}

/** Carry only validated cast aliases into the structured writer/director stages. */
export function adaptedStoryCharacters(characters: WriterCharacter[], adaptation: StoryCastAdaptation): WriterCharacter[] {
  return characters.map(character => {
    const binding = adaptation.bindings.find(binding => binding.targetName === character.name);
    return { ...character,
      // This is prompt context only; the saved library card is never mutated.
      description: binding ? `${character.description}\n本剧锁定身份：${binding.targetRole}。原稿称呼“${binding.sourceNames.join('、')}”已适配为“${binding.targetName}”；历史称呼只用于识别同一个人，不能恢复旧身份或新增第二个角色。` : character.description,
      aliases: [...new Set([
      ...(character.aliases || []), ...(binding?.sourceNames || []), ...(binding ? [binding.dialogueName] : []),
    ])].filter(name => name !== character.name) };
  });
}
