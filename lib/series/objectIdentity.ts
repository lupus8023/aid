/** Keep frontend preflight and server validation identical. A prop alias must
 * identify one object only; never silently merge packaging with its contents. */
export function fixedObjectIdentityError(
  objects: Array<{ id: string; name: string; aliases?: string[] }>,
  name: string,
  aliases: string[],
  objectId?: string,
): string | undefined {
  const normalize = (value: string) => value.trim().slice(0, 120).toLocaleLowerCase();
  const seen = new Set<string>();
  for (const value of [name, ...aliases]) {
    const key = normalize(value);
    if (!key) continue;
    if (seen.has(key)) return `名称或别名“${value.trim()}”在当前道具中重复，请删除重复项。`;
    seen.add(key);
    const owner = objects.find(object => object.id !== objectId &&
      [object.name, ...(object.aliases || [])].some(existing => normalize(existing) === key));
    if (owner) return `名称或别名“${value.trim()}”已被道具“${owner.name}”使用。请修改当前名称/别名；若指同一道具，请编辑已有道具。`;
  }
}

/**
 * A user-uploaded, more specific package name may supersede an outline's
 * generic package placeholder (for example 面膜盒 -> 金色面膜盒). Keep this
 * intentionally narrow: the shared term must name the same container class,
 * so a mask sheet is never inferred to be its bag or box.
 */
export function inferSupersededObjectIds(
  objects: Array<{ id: string; name: string; aliases?: string[] }>,
  name: string,
): string[] {
  const target = name.trim().toLocaleLowerCase();
  const containerSuffix = target.match(/(?:盒|箱|瓶|罐|袋|托盘|匣|包|box|case|bottle|jar|bag|tray)$/i)?.[0];
  if (!containerSuffix) return [];
  return objects.filter(object => [object.name, ...(object.aliases || [])].some(value => {
    const term = value.trim().toLocaleLowerCase();
    if (term.length < 3 || term === target || !target.includes(term)) return false;
    const suffix = term.match(/(?:盒|箱|瓶|罐|袋|托盘|匣|包|box|case|bottle|jar|bag|tray)$/i)?.[0];
    return suffix?.toLocaleLowerCase() === containerSuffix.toLocaleLowerCase();
  })).map(object => object.id);
}
