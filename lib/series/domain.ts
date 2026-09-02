import type {
  SeriesBible,
  SeriesCharacter,
  SeriesEpisode,
  SeriesProject,
  SeriesShot,
} from "./types";
import type { ProjectData } from "@/hooks/useProject";
import { checkEpisodeTextFields } from './fieldRepair';
import { checkScriptDialogue } from './scriptRepair';

export function seriesId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
export function text(value: unknown, max = 12000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((v) => text(v, 2000)).filter(Boolean)
    : [];
}
function required(value: unknown, label: string): string {
  const v = text(value);
  if (!v) throw new Error(`缺少${label}`);
  return v;
}

// Generated labels alone are not enough to skip a character's visual design.
// Require an explicit invisible/voice-only design; ambiguous roles keep a card.
export function generatedCharacterAppearance(c: { appearance?: unknown; description?: unknown }): SeriesCharacter['appearance'] {
  if (c.appearance !== 'voice_only') return 'on_screen';
  const description = text(c.description);
  return /\b(?:disembodied|voice[- ]only|audio[- ]only|no (?:visible )?(?:body|physical form)|never (?:seen|visible|shown)|never appears (?:on[- ]screen|visually))\b|(?:全程不|始终不|从不|永不)(?:出镜|露脸|显形)|无(?:可见)?(?:身体|实体|形象)|纯(?:旁白|画外音|声音)|仅(?:有)?声音/.test(description.toLowerCase())
    ? 'voice_only' : 'on_screen';
}

export function createSeries(input: Partial<SeriesProject>): SeriesProject {
  const count = Number(input.episodeCount ?? 12);
  if (!Number.isInteger(count) || count < 2 || count > 100)
    throw new Error("集数需为 2–100 的整数");
  const now = new Date().toISOString();
  return {
    id: seriesId("series"),
    revision: 1,
    name: required(input.name, "剧名"),
    brief: required(input.brief, "故事创意"),
    genre: text(input.genre) || "悬疑",
    episodeCount: count,
    shotCount: 18,
    durationSeconds: 120,
    language: input.language === "en" ? "en" : "zh",
    aspectRatio: input.aspectRatio === "1:1" ? "1:1" : input.aspectRatio === "16:9" ? "16:9" : "9:16",
    visualStyle: input.visualStyle || "cinematic-natural",
    characters: [],
    locations: [],
    objects: [],
    episodes: [],
    paused: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function parseOutline(
  raw: any,
  project: SeriesProject,
): Pick<SeriesProject, "bible" | "characters" | "locations" | "objects"> {
  const b = raw?.bible;
  if (
    !b ||
    !Array.isArray(raw.characters) ||
    !raw.characters.length ||
    !Array.isArray(raw.locations) ||
    !raw.locations.length
  )
    throw new Error("总纲需要故事、角色和场景清单");
  const characters: SeriesCharacter[] = raw.characters.map(
    (c: any, i: number) => ({
      id: `c${i + 1}`,
      name: required(c.name, "角色名"),
      aliases: list(c.aliases),
      role: required(c.role, "角色身份"),
      description: required(c.description, "角色外观"),
      want: required(c.want, "角色目标"),
      secret: text(c.secret),
      arc: required(c.arc, "人物变化"),
      voiceBrief: required(c.voiceBrief, "声音简报"),
      speaking: c.speaking !== false,
      appearance: generatedCharacterAppearance(c),
      importance: ["lead", "supporting", "guest"].includes(c.importance)
        ? c.importance
        : "supporting",
      gender: ["female", "male", "nonbinary", "unknown"].includes(c.gender)
        ? c.gender
        : "unknown",
      ageGroup: ["child", "young_adult", "adult", "senior"].includes(c.ageGroup)
        ? c.ageGroup
        : "unknown",
      imageUrl: "",
      locked: false,
      version: 1,
    }),
  );
  const names = characters.flatMap((c) => [c.name, ...c.aliases]);
  if (new Set(names).size !== names.length)
    throw new Error("角色名称／别名重复，请合并同一人物或区分别名");
  const arcs = (Array.isArray(b.arcs) ? b.arcs : []).map((a: any) => ({
    start: Number(a.start),
    end: Number(a.end),
    goal: required(a.goal, "阶段目标"),
    reversal: required(a.reversal, "阶段转折"),
  }));
  let next = 1;
  for (const arc of arcs) {
    if (
      arc.start !== next ||
      !Number.isInteger(arc.end) ||
      arc.end < arc.start ||
      arc.end > project.episodeCount
    )
      throw new Error("阶段故事必须连续覆盖整季");
    next = arc.end + 1;
  }
  if (next !== project.episodeCount + 1)
    throw new Error("阶段故事未覆盖全部集数");
  const promises = (Array.isArray(b.promises) ? b.promises : []).map(
    (p: any, i: number) => {
      const plantedIn = Number(p.plantedIn),
        payoffIn = Number(p.payoffIn);
      if (
        !Number.isInteger(plantedIn) ||
        !Number.isInteger(payoffIn) ||
        plantedIn < 1 ||
        payoffIn < plantedIn ||
        payoffIn > project.episodeCount
      )
        throw new Error("伏笔埋设／回收集数无效");
      return {
        id: `p${i + 1}`,
        question: required(p.question, "伏笔问题"),
        plantedIn,
        payoffIn,
        answer: required(p.answer, "伏笔答案"),
      };
    },
  );
  if (!promises.length)
    throw new Error("总纲至少需要一个有明确回收计划的主线悬念");
  const bible: SeriesBible = {
    logline: required(b.logline, "一句话故事"),
    theme: required(b.theme, "主题"),
    conflictEngine: required(b.conflictEngine, "持续冲突机制"),
    rules: list(b.rules),
    ending: required(b.ending, "结局方向"),
    arcs,
    promises,
  };
  const objects: SeriesProject['objects'] = (Array.isArray(raw.objects) ? raw.objects : []).map((object: any, index: number) => ({
    id: `o${index + 1}`,
    name: required(object.name, "固定道具名称"),
    description: required(object.description, "固定道具描述"),
    aliases: list(object.aliases),
    imageUrl: "",
  }));
  const objectNames = objects.flatMap(object => [object.name, ...object.aliases]).map(name => name.toLocaleLowerCase());
  if (new Set(objectNames).size !== objectNames.length)
    throw new Error('固定道具名称重复，请合并为同一个全剧资产');
  return {
    bible,
    characters,
    locations: raw.locations.map((l: any, i: number) => ({
      id: `l${i + 1}`,
      name: required(l.name, "场景名称"),
      description: required(l.description, "场景描述"),
    })),
    objects,
  };
}

export function parseEpisodes(
  raw: any,
  project: SeriesProject,
  start: number,
  count: number,
): SeriesEpisode[] {
  if (!Array.isArray(raw?.episodes) || raw.episodes.length !== count)
    throw new Error(`必须返回 ${count} 集分集故事`);
  checkEpisodeTextFields(raw.episodes, start, project.episodeCount);
  const characterIds = new Set(project.characters.map((c) => c.id)),
    locationIds = new Set(project.locations.map((l) => l.id));
  const promiseIds = new Set(project.bible?.promises.map((p) => p.id));
  return raw.episodes.map((e: any, i: number) => {
    const number = start + i;
    for (const [key, value] of Object.entries(
      project.episodeNotes?.[`ep-${number}`] || {},
    )) {
      if (text(e[key]) !== value)
        throw new Error(`第${number}集没有保留用户修改的${key}字段`);
    }
    if (Number(e.number) !== number) throw new Error("分集编号不连续");
    const characters = list(e.characterIds),
      locations = list(e.locationIds),
      plants = list(e.plants),
      paysOff = list(e.paysOff);
    if (!characters.length || characters.some((id) => !characterIds.has(id)))
      throw new Error(`第 ${number} 集引用了未登记角色`);
    if (!locations.length || locations.some((id) => !locationIds.has(id)))
      throw new Error(`第 ${number} 集引用了未登记场景`);
    if ([...plants, ...paysOff].some((id) => !promiseIds.has(id)))
      throw new Error("分集引用了不存在的伏笔");
    for (const promise of project.bible?.promises || []) {
      if (promise.plantedIn === number && !plants.includes(promise.id))
        throw new Error(`第 ${number} 集遗漏应埋设伏笔 ${promise.id}`);
      if (promise.payoffIn === number && !paysOff.includes(promise.id))
        throw new Error(`第 ${number} 集遗漏应回收伏笔 ${promise.id}`);
      if (paysOff.includes(promise.id) && promise.payoffIn !== number)
        throw new Error(`伏笔 ${promise.id} 回收集数与总纲不一致`);
    }
    const knowledgeChanges: SeriesEpisode["knowledgeChanges"] = (
      Array.isArray(e.knowledgeChanges) ? e.knowledgeChanges : []
    ).map((k: any) => ({
      characterId: text(k.characterId),
      learns: required(k.learns, "人物新增知情"),
    }));
    if (knowledgeChanges.some((k) => !characterIds.has(k.characterId)))
      throw new Error("人物知情表引用了未登记角色");
    return {
      id: `ep-${number}`,
      number,
      title: required(e.title, "单集标题"),
      synopsis: required(e.synopsis, "单集故事"),
      opening: required(e.opening, "开场承接"),
      goal: required(e.goal, "本集目标"),
      conflict: required(e.conflict, "本集冲突"),
      choice: required(e.choice, "人物选择"),
      resolution: required(e.resolution, "本集回报"),
      hook: required(e.hook, "结尾钩子／终局余韵"),
      hookType: required(e.hookType, "钩子类型"),
      nextOpening:
        number < project.episodeCount
          ? required(e.nextOpening, "下一集承接")
          : "",
      characterIds: characters,
      locationIds: locations,
      plants,
      paysOff,
      stateChanges: list(e.stateChanges),
      knowledgeChanges,
      version: 1,
      deliveries: [],
    };
  });
}

export function parseScript(
  raw: any,
  project: SeriesProject,
  episode: SeriesEpisode,
): SeriesShot[] {
  if (!Array.isArray(raw?.shots) || raw.shots.length !== 18)
    throw new Error("单集剧本必须为18镜");
  const shots: SeriesShot[] = raw.shots.map((s: any, i: number) => {
    const characterIds = list(s.characterIds),
      requestedObjectIds = list(s.objectIds),
      locationId = text(s.locationId),
      seconds = Number(s.seconds);
    if (
      Number(s.number) !== i + 1 ||
      !Number.isFinite(seconds) ||
      seconds < 2 ||
      seconds > 15
    )
      throw new Error("镜头编号或时长无效（单镜2–15秒）");
    if (
      characterIds.some((id) => !episode.characterIds.includes(id)) ||
      !episode.locationIds.includes(locationId)
    )
      throw new Error("镜头引用了本集清单之外的人物／场景");
    if (requestedObjectIds.some(id => !project.objects.some(object => object.id === id)))
      throw new Error("镜头引用了未登记的全剧固定道具");
    const dialogue: SeriesShot["dialogue"] = (
      Array.isArray(s.dialogue) ? s.dialogue : []
    ).map((d: any) => ({
      characterId: text(d.characterId),
      text: required(d.text, "台词"),
      emotion: text(d.emotion) || "自然",
    }));
    if (
      dialogue.some(
        (d) =>
          !characterIds.includes(d.characterId) ||
          !project.characters.find((c) => c.id === d.characterId)?.speaking,
      )
    )
      throw new Error("台词角色未登记为本镜发声角色");
    const visual = required(s.visual, "镜头画面"), action = required(s.action, "镜头行动");
    const inferredObjectIds = seriesShotObjectIds(project, { objectIds: requestedObjectIds, visual, action });
    return {
      number: i + 1,
      seconds,
      locationId,
      characterIds,
      objectIds: inferredObjectIds,
      visual,
      action,
      dialogue,
      sound: text(s.sound),
      purpose: required(s.purpose, "镜头作用"),
    };
  });
  const duration = shots.reduce((n, s) => n + s.seconds, 0);
  if (Math.abs(duration - 120) > 5)
    throw new Error(`镜头总时长 ${duration} 秒，应为115–125秒`);
  checkScriptDialogue(shots, project.language);
  return shots;
}

export function seriesShotObjectIds(
  project: Pick<SeriesProject, 'objects'>,
  shot: Pick<SeriesShot, 'objectIds' | 'visual' | 'action'>,
): string[] {
  const objects = project.objects || [];
  const explicit = new Set((shot.objectIds || []).filter(id => objects.some(object => object.id === id)));
  const haystack = `${shot.visual || ''}\n${shot.action || ''}`.toLocaleLowerCase();
  for (const object of objects) {
    const names = [object.name, ...(object.aliases || [])].map(name => name.trim().toLocaleLowerCase()).filter(Boolean);
    if (names.some(name => /^[a-z0-9][a-z0-9 _-]*$/i.test(name)
      ? new RegExp(`(?:^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`, 'i').test(haystack)
      : haystack.includes(name))) explicit.add(object.id);
  }
  return [...explicit];
}

/** Re-evaluate existing screenplays after the user registers, edits or removes
 * a fixed prop. A prop is attached only to shots whose visual/action text uses
 * its canonical name or alias; uploading once never means every shot. */
export function rescanSeriesObjectUsage(
  project: Pick<SeriesProject, 'objects' | 'episodes'>,
): SeriesEpisode[] {
  return project.episodes.map(episode => episode.script
    ? { ...episode, script: episode.script.map(shot => ({
        ...shot,
        objectIds: seriesShotObjectIds(project, shot),
      })) }
    : episode);
}

export function episodeContext(project: SeriesProject, episode: SeriesEpisode) {
  const previous = project.episodes.filter((e) => e.number < episode.number);
  return {
    bible: project.bible,
    characters: project.characters
      .filter((c) => episode.characterIds.includes(c.id))
      .map(({ id, name, role, want, secret, arc, description, appearance }) => ({
        id,
        name,
        role,
        want,
        secret,
        arc,
        description,
        appearance,
      })),
    locations: project.locations
      .filter((l) => episode.locationIds.includes(l.id))
      .map(({ id, name, description }) => ({ id, name, description })),
    objects: (project.objects || []).map(({ id, name, aliases, description }) => ({ id, name, aliases, description })),
    recent: previous
      .slice(-2)
      .map(({ number, synopsis, resolution, hook, nextOpening }) => ({
        number,
        synopsis,
        resolution,
        hook,
        nextOpening,
      })),
    establishedFacts: previous.flatMap((e) =>
      e.stateChanges.map((fact) => ({ episode: e.number, fact })),
    ),
    knowledge: previous.flatMap((e) =>
      e.knowledgeChanges
        .filter((k) => episode.characterIds.includes(k.characterId))
        .map((k) => ({ episode: e.number, ...k })),
    ),
    episode: {
      ...episode,
      script: undefined,
      production: undefined,
      deliveries: undefined,
    },
  };
}

export function invalidateFrom(
  project: SeriesProject,
  number: number,
  reason: string,
): SeriesProject {
  return {
    ...project,
    episodes: project.episodes.map((e) =>
      e.number < number
        ? e
        : {
            ...e,
            version: e.version + 1,
            script: undefined,
            production: undefined,
            needsReview: reason,
          },
    ),
  };
}

export function episodeScreenplay(
  project: SeriesProject,
  episode: SeriesEpisode,
): string {
  const name = (id: string) =>
    project.characters.find((c) => c.id === id)?.name || id;
  const objectNames = (shot: SeriesShot) => seriesShotObjectIds(project, shot)
    .map(id => project.objects.find(object => object.id === id)?.name)
    .filter(Boolean);
  return [
    `连续剧《${project.name}》第${episode.number}集《${episode.title}》；18镜，约120秒。`,
    "以下是已定稿单集。严格保留事件、角色、顺序和结尾，不要扩写后续集数，不新增有台词角色。用户已锁定下列台词，必须逐字保留。",
    `开场：${episode.opening}\n故事：${episode.synopsis}\n本集回报：${episode.resolution}\n末镜钩子：${episode.hook}`,
    ...(episode.script || []).map(
      (s) =>
        `镜头 ${s.number}（${s.seconds}秒）\n场景：${project.locations.find((l) => l.id === s.locationId)?.name}\n人物：${s.characterIds.map(name).join("、")}\n固定道具：${objectNames(s).join('、') || '无'}\n画面：${s.visual}\n行动：${s.action}\n${s.dialogue.map((d) => `台词：${name(d.characterId)}：“${d.text}”\n表演：${d.emotion}`).join("\n")}\n声音：${s.sound}\n叙事作用：${s.purpose}`,
    ),
  ].join("\n\n");
}

export function buildEpisodeProject(
  project: SeriesProject,
  episode: SeriesEpisode,
): ProjectData {
  if (!episode.script) throw new Error("本集尚无18镜定稿");
  const characters = project.characters.filter((c) =>
    episode.characterIds.includes(c.id),
  );
  if (characters.some((c) => !c.locked || (c.speaking && !c.voiceId)))
    throw new Error("本集角色尚未定稿");
  const now = new Date().toISOString();
  return {
    id: `${project.id}-${episode.id}-v${episode.version}`,
    name: `${project.name}-第${String(episode.number).padStart(2, "0")}集-${episode.title}`,
    characters: characters.map((c) => ({
      ...c,
      voiceLocked: true,
      imageUrl: c.bibleUrl || c.imageUrl,
    })),
    objects: project.objects || [],
    storyContent: episodeScreenplay(project, episode),
    language: project.language,
    targetShotCount: 18,
    aspectRatio: project.aspectRatio,
    visualStyle: project.visualStyle,
    styleReference: project.styleReference,
    storyOutline: "",
    storyboards: [],
    voiceReferences: Object.fromEntries(
      characters
        .filter((c) => c.voiceReferenceUrl)
        .map((c) => [c.name, c.voiceReferenceUrl!]),
    ),
    costumeImages: Object.fromEntries(
      characters
        .filter((c) => c.bibleUrl || c.imageUrl)
        .map((c) => [c.name, c.bibleUrl || c.imageUrl]),
    ),
    sceneImages: project.locations
      .filter((l) => episode.locationIds.includes(l.id) && l.imageUrl)
      .map((l) => l.imageUrl!),
    createdAt: now,
    updatedAt: now,
  };
}
