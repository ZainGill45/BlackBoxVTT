import type {
  Dnd5eCharacterFeature,
  Dnd5eCharacterFeatureType,
} from './characterData';

const FEATURE_TYPE_LABELS = {
  feature: 'Feature',
  proficiency: 'Proficiency',
  trait: 'Trait',
  unknown: 'Unknown',
} as const satisfies Record<Dnd5eCharacterFeatureType, string>;

function singleLine(value: string, fallback: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ') || fallback;
}

export function createDnd5eFeatureChatContent(
  feature: Dnd5eCharacterFeature,
): string {
  const description = feature.description.normalize('NFKC').trim();
  const lines = [
    `Feature: ${singleLine(feature.name, 'Unnamed Feature')}`,
    `Type: ${FEATURE_TYPE_LABELS[feature.type]}`,
    `Source: ${singleLine(feature.source, 'None')}`,
    `Source Type: ${singleLine(feature.sourceType, 'None')}`,
  ];
  if (description) lines.push('', description);
  return lines.join('\n');
}
