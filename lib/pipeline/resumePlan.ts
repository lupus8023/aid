import type { StoryPlan, WriterCharacter } from './types';
import { storyPlanBeatCount } from './shotCount';
import { storyCastKey } from './storyCastAdaptation';

export function canResumeStoryPlan(plan: StoryPlan | undefined, source: string, count: number, characters: WriterCharacter[]): plan is StoryPlan {
  return Boolean(plan && plan.sourceBrief === source && storyPlanBeatCount(plan) === count &&
    // Old ordinary plans never ran casting adaptation. On an explicit writing
    // retry they must pass through it, rather than resume the duplicate cast.
    (plan.seriesEpisode || plan.castAdaptation?.castKey === storyCastKey(characters)) &&
    characters.every(character => {
      const planned = plan.characters.find(c => c.name === character.name);
      return planned && planned.voiceId === character.voiceId;
    }));
}
