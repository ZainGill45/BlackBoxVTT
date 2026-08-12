import { describe, expect, it } from 'vitest';
import { createDnd5eFeatureChatContent } from '../../../systems/dnd5e/characterFeatureChat';

describe('D&D 5e Feature chat formatting', () => {
  it('includes every authored field and preserves description lines', () => {
    expect(createDnd5eFeatureChatContent({
      description: 'Gain advantage on Strength checks.\nUsable while raging.',
      id: '11111111-1111-4111-8111-111111111111',
      name: '  Rage  ',
      source: 'Barbarian 1',
      sourceType: 'Class Feature',
      type: 'feature',
    })).toBe([
      'Feature: Rage',
      'Type: Feature',
      'Source: Barbarian 1',
      'Source Type: Class Feature',
      '',
      'Gain advantage on Strength checks.',
      'Usable while raging.',
    ].join('\n'));
  });

  it('labels empty Feature fields explicitly', () => {
    expect(createDnd5eFeatureChatContent({
      description: '',
      id: '22222222-2222-4222-8222-222222222222',
      name: '',
      source: '',
      sourceType: '',
      type: 'unknown',
    })).toBe([
      'Feature: Unnamed Feature',
      'Type: Unknown',
      'Source: None',
      'Source Type: None',
    ].join('\n'));
  });
});
