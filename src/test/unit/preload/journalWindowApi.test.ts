import { describe, expect, it, vi } from 'vitest';
import { createJournalWindowApi } from '../../../preload/journalWindowApi';
import { journalWindowIpcChannels } from '../../../shared/journalWindows';

describe('createJournalWindowApi', () => {
  it('exposes explicit open, focus, and campaign-close operations', async () => {
    const invoke = vi.fn(async () => ({ ok: true, value: false }));
    const api = createJournalWindowApi(invoke);
    const entry = {
      campaignId: '11111111-1111-4111-8111-111111111111',
      entryId: '22222222-2222-4222-8222-222222222222',
    };

    await api.focusCharacter(entry);
    await api.openCharacter({
      ...entry,
      geometry: {
        contentHeight: 900,
        contentWidth: 700,
        rootFontSize: 16,
      },
    });
    await api.closeCampaign({ campaignId: entry.campaignId });

    expect(Object.keys(api)).toEqual([
      'closeCampaign',
      'focusCharacter',
      'openCharacter',
    ]);
    expect(
      (invoke.mock.calls as unknown[][]).map(([channel]) => channel),
    ).toEqual([
      journalWindowIpcChannels.focusCharacter,
      journalWindowIpcChannels.openCharacter,
      journalWindowIpcChannels.closeCampaign,
    ]);
  });
});
