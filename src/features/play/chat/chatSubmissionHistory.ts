import { normalizeChatContent } from '../../../shared/chat';

export const MAX_CHAT_SUBMISSION_HISTORY_ENTRIES = 100;

export interface ChatSubmissionHistoryState {
  cursor: number | null;
  entries: readonly string[];
}

export interface ChatSubmissionHistoryNavigation {
  handled: boolean;
  state: ChatSubmissionHistoryState;
  value: string | null;
}

export function createChatSubmissionHistory(): ChatSubmissionHistoryState {
  return { cursor: null, entries: [] };
}

export function recordChatSubmission(
  state: ChatSubmissionHistoryState,
  submission: string,
): ChatSubmissionHistoryState {
  const normalized = normalizeChatContent(submission);
  if (!normalized || state.entries.at(-1) === normalized) {
    return state.cursor === null ? state : { ...state, cursor: null };
  }
  return {
    cursor: null,
    entries: [...state.entries, normalized].slice(
      -MAX_CHAT_SUBMISSION_HISTORY_ENTRIES,
    ),
  };
}

export function recallOlderChatSubmission(
  state: ChatSubmissionHistoryState,
  currentDraft: string,
): ChatSubmissionHistoryNavigation {
  if (state.entries.length === 0 || (state.cursor === null && currentDraft)) {
    return { handled: false, state, value: null };
  }
  const cursor =
    state.cursor === null
      ? state.entries.length - 1
      : Math.max(0, state.cursor - 1);
  return {
    handled: true,
    state: { ...state, cursor },
    value: state.entries[cursor],
  };
}

export function recallNewerChatSubmission(
  state: ChatSubmissionHistoryState,
): ChatSubmissionHistoryNavigation {
  if (state.cursor === null) {
    return { handled: false, state, value: null };
  }
  if (state.cursor === state.entries.length - 1) {
    return {
      handled: true,
      state: { ...state, cursor: null },
      value: '',
    };
  }
  const cursor = state.cursor + 1;
  return {
    handled: true,
    state: { ...state, cursor },
    value: state.entries[cursor],
  };
}

export function exitChatSubmissionHistory(
  state: ChatSubmissionHistoryState,
): ChatSubmissionHistoryState {
  return state.cursor === null ? state : { ...state, cursor: null };
}
