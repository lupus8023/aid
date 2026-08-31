import type { StoryPlan, WriterCharacter } from './types';
import { storyPlanBeatCount } from './shotCount';

export function canResumeStoryPlan(plan: StoryPlan | undefined, source: string, count: number, characters: WriterCharacter[]): plan is StoryPlan {
  return Boolean(plan && plan.sourceBrief === source && storyPlanBeatCount(plan) === count &&
    characters.every(character => {
      const planned = plan.characters.find(c => c.name === character.name);
      return planned && planned.voiceId === character.voiceId;
    }));
}
