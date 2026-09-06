import type { SeriesImageAsset } from './imagePreparation';
import type { ImageStyleReference } from '../imageStyleReference';
import type {
  AppSettings,
  Character,
  ObjectItem,
  Storyboard,
  VisualStyle,
} from "@/types";
import type { ProjectData } from "@/hooks/useProject";

export interface SeriesCharacter extends Character, SeriesImageAsset {
  aliases: string[];
  role: string;
  want: string;
  secret: string;
  arc: string;
  voiceBrief: string;
  speaking: boolean;
  appearance: "on_screen" | "voice_only";
  importance: "lead" | "supporting" | "guest";
  locked: boolean;
  version: number;
  bibleUrl?: string;
  /** Who approved the current production image. User/library images are final and are never redrawn automatically. */
  imageSource?: "auto" | "user" | "library";
  photographicAnchor?: SeriesImageAsset & {
    designBrief?: string;
    reusedCandidateTaskId?: string;
    imageUrl?: string; imageTaskId?: string;
    review?: { photographic: boolean | null; issues: string[]; revision?: number };
    rejected?: Array<{ imageUrl: string; imageTaskId?: string; issues: string[] }>;
  };
  photographicCardReview?: { photographic: boolean | null; issues: string[] };
  photographicSheetUrl?: string;
  imageTaskId?: string;
  voiceReferenceUrl?: string;
  voiceCandidates?: Array<{
    voiceId: string;
    title: string;
    licensed: boolean;
    source?: 'workspace' | 'licensed' | 'public';
    requiresLanguageCheck?: boolean;
    languageMode?: 'native' | 'cross_language';
    sourceLanguages?: string[];
    score: number;
  }>;
  voiceSelectionReason?: string;
  voiceIssue?: string;
  casting?: SeriesLibraryActor;
}

// A production snapshot, not a live link: library edits cannot change a released cast.
export interface SeriesLibraryActor {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  bibleUrl?: string;
  visualMaster?: Character['visualMaster'];
  voiceId?: string;
  voiceProfile?: string;
  voiceReferenceUrl?: string;
  gender?: Character["gender"];
  ageGroup?: Character["ageGroup"];
}

export interface SeriesLocation extends SeriesImageAsset {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  imageTaskId?: string;
}

export interface SeriesObject extends ObjectItem, SeriesImageAsset {
  aliases: string[];
  /** Missing on legacy records: o1/o2… are outline-generated, object-* are user-created. */
  referenceMode?: "auto" | "upload";
  /** User-added fixed props are story requirements, not library-only assets. */
  narrativeRequired?: boolean;
  /** Older generic prop records superseded by this final, user-specified asset. */
  replacesObjectIds?: string[];
}

export interface SeriesPromise {
  id: string;
  question: string;
  plantedIn: number;
  payoffIn: number;
  answer: string;
}

export interface SeriesBible {
  logline: string;
  theme: string;
  conflictEngine: string;
  rules: string[];
  ending: string;
  arcs: Array<{ start: number; end: number; goal: string; reversal: string }>;
  promises: SeriesPromise[];
}

export interface SeriesShot {
  number: number;
  seconds: number;
  locationId: string;
  characterIds: string[];
  objectIds?: string[];
  visual: string;
  action: string;
  dialogue: Array<{ characterId: string; text: string; emotion: string }>;
  sound: string;
  purpose: string;
  /** Verbatim directing fields retained when the user pasted a formed script. */
  shotSize?: string;
  camera?: string;
  atmosphere?: string;
  imagePrompt?: string;
  sourceSeconds?: number;
}

export interface SeriesEpisode {
  /** One-click visual redo keeps screenplay/shot intent and bypasses script regeneration once. */
  visualRedoPending?: boolean;
  scriptAssetFingerprint?: string;
  scriptAssetsReconciledAt?: string;
  scriptAssetRepairs?: Array<{
    at: string;
    changes: Array<{
      shotNumber: number;
      kind: 'speaker_added' | 'object_grounded' | 'object_removed' | 'shot_count_normalized';
      detail: string;
    }>;
  }>;
  productionDialogueRepairs?: Array<{ at: string; shots: number[] }>;
  dialogueRepairs?: Array<{ at: string; shots: number[]; reason: string; before: Array<Pick<SeriesShot, "number" | "dialogue">>; after: Array<Pick<SeriesShot, "number" | "dialogue">> }>;
  id: string;
  number: number;
  title: string;
  synopsis: string;
  opening: string;
  goal: string;
  conflict: string;
  choice: string;
  resolution: string;
  hook: string;
  hookType: string;
  nextOpening: string;
  characterIds: string[];
  locationIds: string[];
  plants: string[];
  paysOff: string[];
  stateChanges: string[];
  knowledgeChanges: Array<{ characterId: string; learns: string }>;
  script?: SeriesShot[];
  production?: ProjectData;
  version: number;
  needsReview?: string;
  deliveries: Array<{
    id: string;
    fileName: string;
    createdAt: string;
    episodeVersion: number;
    bytes: number;
  }>;
}

export interface SeriesProject {
  styleReference?: ImageStyleReference;
  visualHistory?: Array<{ changedAt: string; reason?: "style_change" | "manual_visual_redo"; styleReference?: ImageStyleReference; characters: SeriesCharacter[]; locations: SeriesLocation[]; objects?: ObjectItem[]; productions: Array<{ episodeId: string; version: number; production: ProjectData }> }>;
  id: string;
  revision: number;
  name: string;
  brief: string;
  genre: string;
  sourceMode?: "authored_screenplay";
  episodeCount: number;
  shotCount: number;
  durationSeconds: number;
  language: "zh" | "en";
  aspectRatio: AppSettings['aspectRatio'];
  visualStyle: VisualStyle;
  bible?: SeriesBible;
  characters: SeriesCharacter[];
  locations: SeriesLocation[];
  objects: SeriesObject[];
  /** Newly added props that still need to be placed meaningfully in episode stories. */
  pendingNarrativeObjectIds?: string[];
  episodes: SeriesEpisode[];
  episodeNotes?: Record<string, Record<string, string>>; // 用户对分集的修改，重规划时保持权威
  paused: boolean;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type SeriesJobKind = "develop" | "prepare" | "script" | "produce";
export type SeriesJobStatus =
  "queued" | "running" | "paused" | "completed" | "failed";
export interface SeriesJob {
  id: string;
  seriesId: string;
  episodeId?: string;
  /** A prepare job may target one character, location, or automatic prop without preparing every asset. */
  assetId?: string;
  kind: SeriesJobKind;
  status: SeriesJobStatus;
  stage: string;
  attempts: number;
  consecutiveInterruptions?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  lease?: string;
  workerId?: string;
  heartbeatAt?: number;
  /** Earliest epoch milliseconds at which a recoverable queued job may be claimed again. */
  resumeAfter?: number;
  cancelRequested?: boolean;
  sealedSettings?: string;
}

export interface SeriesSnapshot {
  projects: SeriesProject[];
  trashedProjects?: Array<Pick<SeriesProject, "id" | "name" | "revision" | "episodeCount"> & {
    deletedAt: string;
    deliveryCount: number;
  }>;
  jobs: SeriesJob[];
  workerOnline: boolean;
  workerMode?: "companion" | "page";
}

export interface SeriesClaim {
  job: SeriesJob;
  project: SeriesProject;
  settings: AppSettings;
}

export interface StoryBridgeEvent {
  type: "aid-story-batch";
  runId: string;
  event: "progress" | "checkpoint" | "completed" | "failed";
  stage?: string;
  error?: string;
  project?: ProjectData;
  blob?: Blob;
  fileName?: string;
}

export type EpisodeProduction = { storyboards: Storyboard[] } & ProjectData;
