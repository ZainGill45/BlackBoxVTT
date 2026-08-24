import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultDnd5eCharacterData,
  prepareDnd5eCharacterDataForSave,
} from '../../../systems/dnd5e/characterData';
import {
  applyDnd5eTokenHealthCommand,
  formatDnd5eHealthDecimal,
  isValidDnd5eAuthoredHealth,
  materializeDnd5eTokenHealth,
  parseDnd5eHealthDecimal,
  parseDnd5eTokenHealthFormula,
  readDnd5eTokenHealth,
  writeDnd5eTokenHealth,
} from '../../../systems/dnd5e/tokenHealth';

function character(current: string, maximum: string, type: 'linked' | 'template' = 'template') {
  const data = createDefaultDnd5eCharacterData();
  data.defaultToken.type = type;
  data.health.currentHitPoints = current;
  data.health.maximumHitPoints = maximum;
  return data;
}

describe('D&D token health', () => {
  it('parses and canonicalizes signed decimals using exact hundredths', () => {
    expect(parseDnd5eHealthDecimal('-20.50')).toBe(-2050);
    expect(parseDnd5eHealthDecimal('.5')).toBeNull();
    expect(parseDnd5eHealthDecimal('1.234')).toBeNull();
    expect(formatDnd5eHealthDecimal(-2050)).toBe('-20.5');
    expect(formatDnd5eHealthDecimal(2_000)).toBe('20');
  });

  it('accepts fixed health for either token type and formulas only for Templates', () => {
    expect(isValidDnd5eAuthoredHealth(character('-2.5', '20', 'linked'))).toBe(true);
    expect(isValidDnd5eAuthoredHealth(character('8', 'd10 + 10'))).toBe(true);
    expect(isValidDnd5eAuthoredHealth(character('8', 'd10 + 10', 'linked'))).toBe(false);
    expect(parseDnd5eTokenHealthFormula('2', 'd6kh1 + 3')).toEqual({
      notation: '2d6kh1 + 3',
    });
    expect(parseDnd5eTokenHealthFormula('0', 'd8')).toBeNull();
    expect(parseDnd5eTokenHealthFormula('-1', 'd8')).toBeNull();
    expect(parseDnd5eTokenHealthFormula('2', 'd6 + level')).toBeNull();
  });

  it('materializes a formula once, rounds half up, and starts at full health', () => {
    const roll = vi.fn(() => 42.125);
    const materialized = materializeDnd5eTokenHealth(
      character('8', 'd10 + 10'),
      roll,
    );
    expect(roll).toHaveBeenCalledWith('8d10 + 10');
    expect(materialized?.health.currentHitPoints).toBe('42.13');
    expect(materialized?.health.maximumHitPoints).toBe('42.13');
    expect(readDnd5eTokenHealth(materialized!)).toMatchObject({
      currentHundredths: 4_213,
      maximumHundredths: 4_213,
    });
  });

  it('materializes a Template formula once when its root becomes Linked', () => {
    const data = character('8', 'd10 + 10', 'linked');
    const roll = vi.fn(() => 48);
    const prepared = prepareDnd5eCharacterDataForSave(data, roll);
    expect(roll).toHaveBeenCalledWith('8d10 + 10');
    expect(prepared).toMatchObject({
      defaultToken: { type: 'linked' },
      health: { currentHitPoints: '48', maximumHitPoints: '48' },
    });
  });

  it('clamps nonpositive generated totals to one without clamping fixed health', () => {
    const generated = materializeDnd5eTokenHealth(
      character('1', 'd4 - 10'),
      () => -6,
    );
    expect(generated?.health.currentHitPoints).toBe('1');
    expect(readDnd5eTokenHealth(character('-8', '-2'))).toMatchObject({
      currentHundredths: -800,
      maximumHundredths: -200,
    });
  });

  it('adjusts current independently and maximum while preserving the deficit', () => {
    expect(applyDnd5eTokenHealthCommand(
      character('10', '20'),
      ' Current - 2.50 ',
    )?.health).toMatchObject({ currentHitPoints: '7.5', maximumHitPoints: '20' });
    expect(applyDnd5eTokenHealthCommand(
      character('10', '20'),
      'maximum+10',
    )?.health).toMatchObject({ currentHitPoints: '20', maximumHitPoints: '30' });
    expect(applyDnd5eTokenHealthCommand(
      character('10', '20'),
      'Maximum=5',
    )?.health).toMatchObject({ currentHitPoints: '-5', maximumHitPoints: '5' });
    expect(applyDnd5eTokenHealthCommand(
      character('10', '20'),
      'maximum-15',
    )?.health).toMatchObject({ currentHitPoints: '-5', maximumHitPoints: '5' });
  });

  it('writes a system-neutral health value back to the Character fields', () => {
    expect(writeDnd5eTokenHealth(character('8', 'd10 + 10'), {
      currentHundredths: -125,
      maximumHundredths: 2_050,
    })?.health).toMatchObject({
      currentHitPoints: '-1.25',
      maximumHitPoints: '20.5',
    });
  });

  it('rejects invalid commands and arithmetic outside safe hundredths', () => {
    expect(applyDnd5eTokenHealthCommand(character('10', '20'), 'HP-2')).toBeNull();
    expect(applyDnd5eTokenHealthCommand(character('10', '20'), 'Current-1.001')).toBeNull();
    expect(applyDnd5eTokenHealthCommand(
      character(String(Number.MAX_SAFE_INTEGER), '20'),
      'Current+1',
    )).toBeNull();
  });
});
