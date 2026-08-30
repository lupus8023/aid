import type {
  SeriesCharacter,
  SeriesLibraryActor,
  SeriesProject,
} from "./types";

const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const key = (value: unknown) => text(value).toLocaleLowerCase();
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
const genders = ["female", "male", "nonbinary", "unknown"];
const ages = ["child", "young_adult", "adult", "senior", "unknown"];

// Only used while browsing. The server whitelists the chosen production snapshot.
export type SeriesLibraryEntry = SeriesLibraryActor & { imageCandidates: string[] };
const imageCandidates = (values: unknown[]) => [...new Set(values.map(text).filter(value =>
  /^https:\/\//i.test(value) || /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value),
))];

export function selectLibraryImage(actor: SeriesLibraryEntry, source: string): SeriesLibraryActor {
  if (!actor.imageCandidates.includes(source)) throw new Error("请选择已加载的角色图片");
  const { imageCandidates: _candidates, ...snapshot } = actor;
  // Never carry a failed full-card address into production after showing a fallback.
  return { ...snapshot, imageUrl: source, bibleUrl: source === actor.bibleUrl ? source : undefined };
}

// Read both existing libraries without migrating or overwriting the user's data.
// Design cards provide the appearance; matching history may provide a saved voice.
export function seriesCastLibrary(
  history: unknown[],
  designs: unknown[],
): SeriesLibraryEntry[] {
  const saved = history.map(record);
  const candidates: Record<string, unknown>[] = [
    ...designs.map((value) => {
      const d = record(value);
      const h =
        saved.find((item) => text(d.id) && item.id === d.id) ||
        saved.find((item) => key(d.name) && key(item.name) === key(d.name)) ||
        {};
      return {
        ...h,
        ...d,
        description: [text(d.description), text(d.costumeDesc)]
          .filter(Boolean)
          .join("；"),
        imageUrl: text(d.conceptUrl) || text(d.bibleUrl) || text(h.imageUrl),
        imageCandidates: [d.bibleUrl, d.conceptUrl, d.imageUrl, d.imageBase64, h.bibleUrl, h.imageUrl, h.imageBase64],
        voiceId: text(d.voiceId) || text(h.voiceId),
        voiceProfile: text(d.voiceProfile) || text(h.voiceProfile),
        voiceReferenceUrl:
          text(d.voiceReferenceUrl) ||
          (text(d.voiceId) && d.voiceId !== h.voiceId
            ? ""
            : text(h.voiceReferenceUrl)),
      };
    }),
    ...saved,
  ];
  const names = new Set<string>();
  return candidates.flatMap((raw) => {
    const id = text(raw.id),
      name = text(raw.name),
      imageUrl = text(raw.imageUrl) || text(raw.imageBase64);
    if (!id || !name || !imageUrl || names.has(key(name))) return [];
    names.add(key(name));
    return [
      {
        id,
        name,
        imageUrl,
        description: text(raw.description),
        bibleUrl: text(raw.bibleUrl) || undefined,
        imageCandidates: imageCandidates(Array.isArray(raw.imageCandidates)
          ? raw.imageCandidates : [raw.bibleUrl, raw.imageUrl, raw.imageBase64]),
        voiceId: text(raw.voiceId) || undefined,
        voiceProfile: text(raw.voiceProfile) || undefined,
        voiceReferenceUrl: text(raw.voiceReferenceUrl) || undefined,
        gender: genders.includes(text(raw.gender))
          ? (raw.gender as SeriesLibraryActor["gender"])
          : undefined,
        ageGroup: ages.includes(text(raw.ageGroup))
          ? (raw.ageGroup as SeriesLibraryActor["ageGroup"])
          : undefined,
      },
    ];
  });
}

function httpsUrl(value: unknown, label: string, required = false) {
  const result = text(value);
  if (!result && !required) return undefined;
  try {
    const url = new URL(result);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error();
  } catch {
    throw new Error(`${label}需要持久HTTPS地址，请重新保存角色图片后再选用`);
  }
  return result;
}

export function applyLibraryActor(
  character: SeriesCharacter,
  input: unknown,
): SeriesCharacter {
  const raw = record(input);
  const actor: SeriesLibraryActor = {
    id: text(raw.id).slice(0, 200),
    name: text(raw.name).slice(0, 200),
    description: text(raw.description).slice(0, 12000),
    imageUrl: httpsUrl(raw.imageUrl, "角色图片", true)!,
    bibleUrl: httpsUrl(raw.bibleUrl, "角色卡"),
    voiceId: text(raw.voiceId).slice(0, 200) || undefined,
    voiceProfile: text(raw.voiceProfile).slice(0, 1000) || undefined,
    voiceReferenceUrl: text(raw.voiceId)
      ? httpsUrl(raw.voiceReferenceUrl, "音色参考")
      : undefined,
    gender: genders.includes(text(raw.gender))
      ? (raw.gender as SeriesLibraryActor["gender"])
      : undefined,
    ageGroup: ages.includes(text(raw.ageGroup))
      ? (raw.ageGroup as SeriesLibraryActor["ageGroup"])
      : undefined,
  };
  if (!actor.id || !actor.name) throw new Error("角色库记录缺少编号或名字");
  if (JSON.stringify(character.casting) === JSON.stringify(actor))
    return character;
  const manualVoice =
    character.voiceSource === "user" &&
    character.voiceId !== character.casting?.voiceId
      ? character.voiceId
      : undefined;
  const voiceId = actor.voiceId || manualVoice;
  const voiceReferenceUrl = voiceId
    ? (voiceId === character.voiceId
        ? character.voiceReferenceUrl
        : undefined) || actor.voiceReferenceUrl
    : undefined;
  const next: SeriesCharacter = {
    ...character,
    casting: actor,
    description: actor.description || character.description,
    imageUrl: actor.imageUrl,
    // Selection approves an existing image, even for legacy actors without a full card.
    bibleUrl: actor.bibleUrl || actor.imageUrl,
    gender: actor.gender || character.gender,
    ageGroup: actor.ageGroup || character.ageGroup,
    voiceId,
    voiceReferenceUrl,
    voiceSource: voiceId ? "user" : "auto",
    voiceProfile: actor.voiceId
      ? actor.voiceProfile || `角色库 · ${actor.name}`
      : manualVoice
        ? character.voiceProfile
        : undefined,
    voiceLocked: Boolean(voiceId),
    voiceCandidates: undefined,
    voiceSelectionReason: actor.voiceId
      ? `复用角色库「${actor.name}」的指定音色`
      : undefined,
    imageTaskId: undefined,
    locked: !character.speaking || Boolean(voiceId && voiceReferenceUrl),
  };
  // Re-selecting the same actor is not a new production version and retains completed work.
  if (JSON.stringify(next) === JSON.stringify(character)) return character;
  next.version = character.version + 1;
  return next;
}

export function castSeriesRole(
  project: SeriesProject,
  characterId: string,
  actor: unknown,
): boolean {
  const index = project.characters.findIndex((c) => c.id === characterId);
  if (index < 0) throw new Error("角色不存在");
  const next = applyLibraryActor(project.characters[index], actor);
  if (next === project.characters[index]) return false;
  project.characters[index] = next;
  project.episodes = project.episodes.map((episode) =>
    episode.characterIds.includes(characterId)
      ? { ...episode, version: episode.version + 1, production: undefined }
      : episode,
  );
  return true;
}
