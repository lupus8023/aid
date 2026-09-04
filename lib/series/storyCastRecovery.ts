import type { Character } from '@/types';
import type { SeriesProject } from './types';

/** Old Story snapshots omitted aliases. Recover only from the owning series
 * and stable character ID; never overwrite the snapshot's selected voice/card. */
export function recoverSeriesStoryAliases(storyId: string, characters: Character[], projects: SeriesProject[]): Character[] {
  const owners = projects.filter(project => project.episodes.some(episode =>
    episode.production?.id === storyId || `${project.id}-${episode.id}-v${episode.version}` === storyId));
  if (owners.length !== 1) return characters;
  return characters.map(character => {
    const matches = owners[0].characters.filter(source => source.id === character.id);
    if (matches.length !== 1) return character;
    const source = matches[0];
    const aliases = [...new Set([...(character.aliases || []), source.name, ...(source.aliases || []), source.casting?.name])]
      .filter((name): name is string => Boolean(name) && name !== character.name);
    return JSON.stringify(aliases) === JSON.stringify(character.aliases || []) ? character : { ...character, aliases };
  });
}
