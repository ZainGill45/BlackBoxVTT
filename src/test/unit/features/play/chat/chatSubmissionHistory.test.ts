import { describe, expect, it } from 'vitest';
import {
  MAX_CHAT_SUBMISSION_HISTORY_ENTRIES,
  createChatSubmissionHistory,
  exitChatSubmissionHistory,
  recallNewerChatSubmission,
  recallOlderChatSubmission,
  recordChatSubmission,
} from '../../../../../features/play/chat/chatSubmissionHistory';

describe('chat submission history', () => {
  it('normalizes submissions and collapses only consecutive duplicates', () => {
    let state = createChatSubmissionHistory();
    state = recordChatSubmission(state, '  /r 1d20\r\n  ');
    state = recordChatSubmission(state, '/r 1d20\n');
    state = recordChatSubmission(state, '/r 1d6');
    state = recordChatSubmission(state, '/r 1d20');

    expect(state.entries).toEqual(['/r 1d20', '/r 1d6', '/r 1d20']);
  });

  it('keeps the newest one hundred entries without mutating prior states', () => {
    const initial = createChatSubmissionHistory();
    let state = initial;
    for (let index = 0; index <= MAX_CHAT_SUBMISSION_HISTORY_ENTRIES; index += 1) {
      state = recordChatSubmission(state, `message ${index}`);
    }

    expect(initial.entries).toEqual([]);
    expect(state.entries).toHaveLength(MAX_CHAT_SUBMISSION_HISTORY_ENTRIES);
    expect(state.entries[0]).toBe('message 1');
    expect(state.entries.at(-1)).toBe('message 100');
  });

  it('walks older without wrapping, then walks newer to a blank draft', () => {
    let state = createChatSubmissionHistory();
    state = recordChatSubmission(state, 'first');
    state = recordChatSubmission(state, 'second');

    let navigation = recallOlderChatSubmission(state, '');
    expect(navigation).toMatchObject({ handled: true, value: 'second' });
    navigation = recallOlderChatSubmission(navigation.state, 'second');
    expect(navigation).toMatchObject({ handled: true, value: 'first' });
    navigation = recallOlderChatSubmission(navigation.state, 'first');
    expect(navigation).toMatchObject({ handled: true, value: 'first' });

    navigation = recallNewerChatSubmission(navigation.state);
    expect(navigation).toMatchObject({ handled: true, value: 'second' });
    navigation = recallNewerChatSubmission(navigation.state);
    expect(navigation).toMatchObject({ handled: true, value: '' });
    expect(navigation.state.cursor).toBeNull();
    expect(recallNewerChatSubmission(navigation.state).handled).toBe(false);
  });

  it('starts recall only from an empty draft', () => {
    const state = recordChatSubmission(createChatSubmissionHistory(), 'sent');

    expect(recallOlderChatSubmission(state, 'unsent')).toMatchObject({
      handled: false,
      value: null,
    });
    expect(recallOlderChatSubmission(state, '')).toMatchObject({
      handled: true,
      value: 'sent',
    });
  });

  it('exits browsing without changing immutable entries', () => {
    const recorded = recordChatSubmission(
      createChatSubmissionHistory(),
      'original',
    );
    const recalled = recallOlderChatSubmission(recorded, '').state;
    const exited = exitChatSubmissionHistory(recalled);

    expect(exited.cursor).toBeNull();
    expect(exited.entries).toBe(recorded.entries);
  });
});
