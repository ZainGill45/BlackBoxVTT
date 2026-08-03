import { describe, expect, it } from 'vitest';
import type { ChatIdentity } from '../../../../../shared/chat';
import { parseChatComposer } from '../../../../../features/play/chat/chatCommands';

const directory: ChatIdentity[] = [
  { displayName: 'Game Master', kind: 'gm' },
  {
    displayName: 'Alice',
    kind: 'player',
    userId: '11111111-1111-4111-8111-111111111111',
  },
  {
    displayName: 'Alice Smith',
    kind: 'player',
    userId: '22222222-2222-4222-8222-222222222222',
  },
  {
    displayName: 'Quote " Slash \\',
    kind: 'player',
    userId: '33333333-3333-4333-8333-333333333333',
  },
];

describe('parseChatComposer', () => {
  it('normalizes public text and escapes a literal leading slash', () => {
    expect(
      parseChatComposer(
        '  hello\r\nworld  ',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toEqual({
      body: 'hello\nworld',
      kind: 'send',
      recipient: null,
    });
    expect(
      parseChatComposer(
        '//help',
        directory,
        { kind: 'player', userId: '11111111-1111-4111-8111-111111111111' },
        false,
      ),
    ).toMatchObject({ body: '/help', kind: 'send', recipient: null });
  });

  it('parses aliases, quoted names, and the two supported escapes', () => {
    expect(
      parseChatComposer(
        '/W alice hello',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({
      body: 'hello',
      kind: 'send',
      recipient: { displayName: 'Alice' },
    });
    expect(
      parseChatComposer(
        '/whisper "Ａlice Smith" hello there',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({
      body: 'hello there',
      kind: 'send',
      recipient: { displayName: 'Alice Smith' },
    });
    expect(
      parseChatComposer(
        '/w "Quote \\" Slash \\\\" secret',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({
      body: 'secret',
      kind: 'send',
      recipient: { displayName: 'Quote " Slash \\' },
    });
  });

  it('keeps malformed commands in the composer through explicit errors', () => {
    expect(
      parseChatComposer(
        '/help now',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toEqual({ kind: 'error', message: 'Usage: /help' });
    expect(
      parseChatComposer(
        '/w "Alice Smith" ',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({ kind: 'error' });
    expect(
      parseChatComposer(
        '/w Alice hello',
        directory,
        { kind: 'player', userId: '11111111-1111-4111-8111-111111111111' },
        false,
      ),
    ).toEqual({
      kind: 'error',
      message: 'You cannot whisper to yourself.',
    });
    expect(
      parseChatComposer(
        '/clear',
        directory,
        { kind: 'player', userId: '11111111-1111-4111-8111-111111111111' },
        false,
      ),
    ).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Unknown command'),
    });
  });

  it('accepts strict role-aware help and clear commands', () => {
    expect(
      parseChatComposer('/HELP', directory, { kind: 'gm' }, true),
    ).toEqual({ kind: 'help' });
    expect(
      parseChatComposer(' /ClEaR ', directory, { kind: 'gm' }, true),
    ).toEqual({ kind: 'clear' });
    expect(
      parseChatComposer('/clear now', directory, { kind: 'gm' }, true),
    ).toEqual({ kind: 'error', message: 'Usage: /clear' });
  });

  it('parses quick rolls, multiline cards, annotations, and escaping', () => {
    expect(
      parseChatComposer('/R 1d20+5', directory, { kind: 'gm' }, true),
    ).toMatchObject({
      definition: {
        category: 'Roll',
        sections: [{ label: '1d20+5', notation: '1d20+5' }],
        title: null,
      },
      kind: 'roll',
      recipient: null,
    });

    expect(
      parseChatComposer(
        '/roll Spell: Flame Blade\nAttack \\(Melee\\) (WIS +2) (Flat -1e0) [Fire]: 1d20\nDamage: 3d6',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({
      definition: {
        category: 'Spell',
        sections: [
          {
            label: 'Attack (Melee)',
            modifiers: [
              { label: 'WIS', value: 2 },
              { label: 'Flat', value: -1 },
            ],
            notation: '1d20',
            typeLabel: 'Fire',
          },
          { label: 'Damage', notation: '3d6' },
        ],
        title: 'Flame Blade',
      },
      kind: 'roll',
    });
  });

  it('nests roll cards under the existing whisper recipient grammar', () => {
    expect(
      parseChatComposer(
        '/w "Alice Smith" /roll Spell: Flame Blade\nDamage [Fire]: 3d6',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({
      definition: { category: 'Spell', title: 'Flame Blade' },
      kind: 'roll',
      recipient: { displayName: 'Alice Smith' },
    });
  });

  it('keeps malformed roll definitions in the composer', () => {
    expect(
      parseChatComposer(
        '/roll Attack\nDamage (WIS 2): 1d20',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({ kind: 'error' });
    expect(
      parseChatComposer('/roll', directory, { kind: 'gm' }, true),
    ).toMatchObject({ kind: 'error' });
    expect(
      parseChatComposer(
        '/roll Attack\nDamage [Fire] (Flat +2): 1d20',
        directory,
        { kind: 'gm' },
        true,
      ),
    ).toMatchObject({ kind: 'error' });
  });
});
