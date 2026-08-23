import type { Character } from '@/types';
import type { PlannedCharacter } from '@/lib/pipeline/types';

export function plannedCharacterCardDescription(character: PlannedCharacter): string {
  return [
    character.role ? `Story role: ${character.role}.` : '',
    character.gender && character.gender !== 'unknown' ? `Gender: ${character.gender}.` : '',
    character.ageGroup && character.ageGroup !== 'unknown' ? `Age group: ${character.ageGroup}.` : '',
    character.want ? `Goal: ${character.want}.` : '',
    character.obstacle ? `Dramatic obstacle: ${character.obstacle}.` : '',
    character.arc ? `Character arc: ${character.arc}.` : '',
    character.subtext ? `Performance subtext: ${character.subtext}.` : '',
    'Design one stable, role-appropriate face or species anatomy, body proportions, silhouette, wardrobe/material system and color palette for reuse across the entire film.',
  ].filter(Boolean).join(' ');
}

/**
 * The complete production cast. Uploaded cards remain authoritative; roles
 * discovered by the screenplay become first-class characters with generated
 * IDs and descriptions so they receive one reusable character bible too.
 */
export function effectiveStoryCast(
  uploadedCharacters: Character[],
  plannedCharacters: PlannedCharacter[] = [],
): Character[] {
  const uploadedNames = new Set(uploadedCharacters.map(character => character.name));
  const generated = plannedCharacters
    .filter(character => character.name && !uploadedNames.has(character.name))
    .map((character): Character => ({
      id: `story-plan:${character.name}`,
      name: character.name,
      description: plannedCharacterCardDescription(character),
      imageUrl: '',
      gender: character.gender,
      ageGroup: character.ageGroup,
      voiceId: character.voiceId,
      voiceProfile: character.voiceProfile,
      voiceSource: character.voiceSource,
    }));
  return [...uploadedCharacters, ...generated];
}
