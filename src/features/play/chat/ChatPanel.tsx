import { MessageSquare } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../../components/ui/Button';
import type { ApplicationApi } from '../../../shared/application';
import {
  CHAT_SEND_TIMEOUT_MS,
  MAX_CHAT_MESSAGE_BYTES,
  MAX_LOADED_CHAT_MESSAGES,
  chatUtf8ByteLength,
  countChatGraphemes,
  normalizeChatContent,
  type ChatBootstrap,
  type ChatEvent,
  type ChatIdentity,
  type ChatMessage,
  type ChatParticipantEvent,
  type ChatPrincipal,
  type ChatResult,
} from '../../../shared/chat';
import type { NetworkApi } from '../../../shared/network';
import {
  CHAT_ROLL_SEND_TIMEOUT_MS,
  type ChatRollDefinition,
} from '../../../shared/chatRoll';
import type { PlaySession } from '../types';
import { parseChatComposer } from './chatCommands';
import { playChatMessageSound } from './chatMessageSound';
import {
  createChatSubmissionHistory,
  exitChatSubmissionHistory,
  recallNewerChatSubmission,
  recallOlderChatSubmission,
  recordChatSubmission,
} from './chatSubmissionHistory';
import { DiceRollCard, PendingDiceRollCard } from './DiceRollCard';
import styles from './ChatPanel.module.css';

interface ChatPanelProps {
  applicationApi: ApplicationApi;
  /**
   * Chat as it was read before this panel existed. It paints the first render,
   * then the panel re-reads after subscribing so events that landed between
   * the preload and this mount cannot be lost.
   */
  bootstrap?: ChatBootstrap;
  networkApi: NetworkApi;
  session: PlaySession;
  visible: boolean;
}

type PendingChatRow = {
  clientMessageId: string;
  createdAt: string;
  error: string | null;
  generation: string;
  recipient: ChatIdentity | null;
  state: 'failed' | 'pending';
} & (
  | { body: string; kind: 'text' }
  | { definition: ChatRollDefinition; draft: string; kind: 'roll' }
);

interface HelpRow {
  id: string;
  occurredAt: string;
}

type TimelineRow =
  | { key: string; kind: 'accepted'; message: ChatMessage; occurredAt: string }
  | { event: ChatParticipantEvent; key: string; kind: 'system'; occurredAt: string }
  | { help: HelpRow; key: string; kind: 'help'; occurredAt: string }
  | { key: string; kind: 'pending'; occurredAt: string; pending: PendingChatRow };

function identityPrincipal(identity: ChatIdentity): ChatPrincipal {
  return identity.kind === 'gm'
    ? { kind: 'gm' }
    : { kind: 'player', userId: identity.userId };
}

function recipientPrincipal(
  identity: ChatIdentity | null,
): ChatPrincipal | null {
  return identity ? identityPrincipal(identity) : null;
}

function messageIdentity(session: PlaySession): ChatIdentity {
  return session.role === 'gm'
    ? { displayName: 'Game Master', kind: 'gm' }
    : {
        displayName: session.username,
        kind: 'player',
        userId: session.userId,
      };
}

function viewerPrincipal(session: PlaySession): ChatPrincipal {
  return session.role === 'gm'
    ? { kind: 'gm' }
    : { kind: 'player', userId: session.userId };
}

function submissionHistoryScope(session: PlaySession): string {
  return session.role === 'gm'
    ? `${session.campaignId}:gm`
    : `${session.campaignId}:player:${session.userId}`;
}

const historyExitNavigationKeys = new Set([
  'ArrowLeft',
  'ArrowRight',
  'End',
  'Home',
  'PageDown',
  'PageUp',
]);

function mergeMessages(
  current: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
  keep: 'newest' | 'oldest',
): { dropped: boolean; messages: ChatMessage[] } {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    byId.set(message.id, message);
  }
  let messages = [...byId.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const dropped = messages.length > MAX_LOADED_CHAT_MESSAGES;
  if (dropped) {
    messages =
      keep === 'oldest'
        ? messages.slice(0, MAX_LOADED_CHAT_MESSAGES)
        : messages.slice(-MAX_LOADED_CHAT_MESSAGES);
  }
  return { dropped, messages };
}

function createClientMessageId(): string {
  return crypto.randomUUID();
}

const urlPattern = /https?:\/\/[^\s<>"']+/giu;

function trimUrlPunctuation(candidate: string): string {
  let url = candidate.replace(/[.,!?;:]+$/u, '');
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const;
  for (const [opening, closing] of pairs) {
    while (
      url.endsWith(closing) &&
      url.split(closing).length > url.split(opening).length
    ) {
      url = url.slice(0, -1);
    }
  }
  return url;
}

function isExternalHttpUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0
    );
  } catch {
    return false;
  }
}

function ChatText({
  applicationApi,
  children,
}: {
  applicationApi: ApplicationApi;
  children: string;
}) {
  const fragments: ReactNode[] = [];
  let position = 0;
  for (const match of children.matchAll(urlPattern)) {
    const start = match.index;
    const original = match[0];
    const url = trimUrlPunctuation(original);
    if (start > position) {
      fragments.push(children.slice(position, start));
    }
    fragments.push(
      isExternalHttpUrl(url) ? (
        <button
          className={styles.link}
          key={`${start}:${url}`}
          type="button"
          onClick={() => void applicationApi.openExternal(url)}
        >
          {url}
        </button>
      ) : (
        url
      ),
    );
    const trailing = original.slice(url.length);
    if (trailing) {
      fragments.push(trailing);
    }
    position = start + original.length;
  }
  if (position < children.length) {
    fragments.push(children.slice(position));
  }
  return <>{fragments}</>;
}

function rowDate(row: TimelineRow): Date {
  return new Date(row.occurredAt);
}

export function ChatPanel({
  applicationApi,
  bootstrap,
  networkApi,
  session,
  visible,
}: ChatPanelProps) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable'>(
    bootstrap ? 'ready' : 'loading',
  );
  const [unavailableMessage, setUnavailableMessage] = useState(
    'Campaign chat is unavailable.',
  );
  const [generation, setGeneration] = useState(bootstrap?.generation ?? '');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    ...(bootstrap?.messages ?? []),
  ]);
  const [systemRows, setSystemRows] = useState<ChatParticipantEvent[]>(() => [
    ...(bootstrap?.systemEvents ?? []),
  ]);
  const [helpRows, setHelpRows] = useState<HelpRow[]>([]);
  const [pendingRows, setPendingRows] = useState<PendingChatRow[]>([]);
  const [directory, setDirectory] = useState<ChatIdentity[]>(() => [
    ...(bootstrap?.directory ?? []),
  ]);
  const [maxMessageCharacters, setMaxMessageCharacters] = useState(
    bootstrap?.maxMessageCharacters ?? 10_000,
  );
  const [pageDirection, setPageDirection] = useState<'newer' | 'older' | null>(
    null,
  );
  const [pageError, setPageError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const submissionHistoryRef = useRef(createChatSubmissionHistory());
  const placeComposerCaretAtEndRef = useRef(false);
  const generationRef = useRef(bootstrap?.generation ?? '');
  const messagesRef = useRef<ChatMessage[]>([
    ...(bootstrap?.messages ?? []),
  ]);
  const hasOlderRef = useRef(bootstrap?.hasOlder ?? false);
  const hasNewerRef = useRef(bootstrap?.hasNewer ?? false);
  const visibleRef = useRef(visible);
  const atBottomRef = useRef(true);
  const requestBottomRef = useRef(bootstrap !== undefined);
  const anchorRef = useRef<{ height: number; top: number } | null>(null);
  const bootstrapQueueRef = useRef<ChatEvent[]>([]);
  const soundedMessageIdsRef = useRef(
    new Set(bootstrap?.messages.map(({ id }) => id) ?? []),
  );
  const bootstrappingRef = useRef(true);
  // The first authoritative read keeps a warm timeline visible while it lands.
  const preserveSeedRef = useRef(bootstrap !== undefined);
  const composingRef = useRef(false);
  const loadingPageRef = useRef(false);
  const bootstrapRef = useRef<() => Promise<void>>(async () => undefined);
  const viewer = useMemo(() => viewerPrincipal(session), [session]);
  const sender = useMemo(() => messageIdentity(session), [session]);
  const historyScope = submissionHistoryScope(session);

  const updateMessages = (
    update:
      | ChatMessage[]
      | ((current: ChatMessage[]) => ChatMessage[]),
  ) => {
    const next =
      typeof update === 'function'
        ? update(messagesRef.current)
        : update;
    messagesRef.current = next;
    setMessages(next);
  };

  const updateHasOlder = (value: boolean) => {
    hasOlderRef.current = value;
  };

  const updateHasNewer = (value: boolean) => {
    hasNewerRef.current = value;
  };

  const soundNewMessage = (message: ChatMessage) => {
    if (soundedMessageIdsRef.current.has(message.id)) {
      return;
    }
    soundedMessageIdsRef.current.add(message.id);
    playChatMessageSound();
  };

  const resetGeneration = (nextGeneration: string) => {
    generationRef.current = nextGeneration;
    setGeneration(nextGeneration);
    updateMessages([]);
    setSystemRows([]);
    setHelpRows([]);
    setPendingRows([]);
    updateHasOlder(false);
    updateHasNewer(false);
    setPageError(null);
  };

  const applyEvent = (event: ChatEvent) => {
    if (event.campaignId !== session.campaignId) {
      return;
    }
    if (event.type === 'history_cleared') {
      if (event.generation === generationRef.current) {
        return;
      }
      resetGeneration(event.generation);
      requestBottomRef.current = true;
      return;
    }
    if (event.type === 'directory_changed') {
      setDirectory(event.directory);
      return;
    }
    if (event.type === 'limit_changed') {
      setMaxMessageCharacters(event.maxMessageCharacters);
      return;
    }
    if (
      event.type === 'participant_joined' ||
      event.type === 'participant_left'
    ) {
      if (event.generation !== generationRef.current) {
        return;
      }
      setSystemRows((current) =>
        current.some((row) => row.eventId === event.eventId)
          ? current
          : [...current, event],
      );
      if (atBottomRef.current && visibleRef.current) {
        requestBottomRef.current = true;
      }
      return;
    }
    if (event.type !== 'message') {
      return;
    }
    if (event.message.generation !== generationRef.current) {
      return;
    }
    soundNewMessage(event.message);
    if (hasNewerRef.current) {
      updateHasNewer(true);
      return;
    }
    const merged = mergeMessages(messagesRef.current, [event.message], 'newest');
    const timeline = timelineRef.current;
    if (merged.dropped && !atBottomRef.current && timeline) {
      anchorRef.current = {
        height: timeline.scrollHeight,
        top: timeline.scrollTop,
      };
    }
    updateMessages(merged.messages);
    if (merged.dropped) {
      updateHasOlder(true);
    }
    setPendingRows((current) =>
      current.filter(
        (row) => row.clientMessageId !== event.message.clientMessageId,
      ),
    );
    if (atBottomRef.current && visibleRef.current) {
      requestBottomRef.current = true;
    }
  };

  const loadBootstrap = async () => {
    const preserveSeed = preserveSeedRef.current;
    preserveSeedRef.current = false;
    if (!preserveSeed) {
      setPhase('loading');
    }
    setComposerError(null);
    bootstrappingRef.current = true;
    bootstrapQueueRef.current = [];
    const result = await networkApi.getChatBootstrap({
      campaignId: session.campaignId,
    });
    if (!result.ok) {
      bootstrappingRef.current = false;
      setUnavailableMessage(result.error.message);
      setPhase('unavailable');
      return;
    }
    const previousGeneration = generationRef.current;
    const generationChanged =
      previousGeneration.length > 0 &&
      previousGeneration !== result.value.generation;
    generationRef.current = result.value.generation;
    setGeneration(result.value.generation);
    for (const message of result.value.messages) {
      soundedMessageIdsRef.current.add(message.id);
    }
    updateMessages(result.value.messages);
    setSystemRows(result.value.systemEvents);
    setDirectory(result.value.directory);
    setMaxMessageCharacters(result.value.maxMessageCharacters);
    updateHasOlder(result.value.hasOlder);
    updateHasNewer(result.value.hasNewer);
    if (generationChanged) {
      setHelpRows([]);
      setPendingRows([]);
    } else {
      const acceptedClientIds = new Set(
        result.value.messages.map((message) => message.clientMessageId),
      );
      setPendingRows((current) =>
        current.filter(
          (row) => !acceptedClientIds.has(row.clientMessageId),
        ),
      );
    }
    setPageError(null);
    setPhase('ready');
    requestBottomRef.current = true;
    bootstrappingRef.current = false;
    const queued = bootstrapQueueRef.current.splice(0);
    for (const event of queued) {
      applyEvent(event);
    }
  };
  useEffect(() => {
    bootstrapRef.current = loadBootstrap;
  });

  useEffect(() => {
    visibleRef.current = visible;
    if (visible && atBottomRef.current) {
      requestBottomRef.current = true;
    }
  }, [visible]);

  useEffect(() => {
    submissionHistoryRef.current = createChatSubmissionHistory();
    soundedMessageIdsRef.current = new Set(
      messagesRef.current.map(({ id }) => id),
    );
    placeComposerCaretAtEndRef.current = false;
  }, [historyScope]);

  useEffect(() => {
    const unsubscribe = networkApi.onChatEvent((event) => {
      if (event.campaignId !== session.campaignId) {
        return;
      }
      if (bootstrappingRef.current) {
        bootstrapQueueRef.current.push(event);
      } else {
        applyEvent(event);
      }
    });
    void bootstrapRef.current();
    return unsubscribe;
    // This session-specific controller is intentionally created once and
    // remains mounted while the Chat tab is hidden.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkApi, session.campaignId]);

  useLayoutEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    if (anchorRef.current) {
      const anchor = anchorRef.current;
      anchorRef.current = null;
      timeline.scrollTop =
        anchor.top + (timeline.scrollHeight - anchor.height);
    } else if (requestBottomRef.current && visible) {
      requestBottomRef.current = false;
      timeline.scrollTop = timeline.scrollHeight;
      atBottomRef.current = true;
    }
  }, [helpRows, messages, pendingRows, systemRows, visible]);

  useLayoutEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = 'auto';
    const computed = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(computed.lineHeight);
    const verticalChrome =
      Number.parseFloat(computed.paddingTop) +
      Number.parseFloat(computed.paddingBottom) +
      Number.parseFloat(computed.borderTopWidth) +
      Number.parseFloat(computed.borderBottomWidth);
    const sixLineHeight =
      Number.isFinite(lineHeight) && Number.isFinite(verticalChrome)
        ? lineHeight * 6 + verticalChrome
        : 112;
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      sixLineHeight,
    )}px`;
    if (placeComposerCaretAtEndRef.current) {
      placeComposerCaretAtEndRef.current = false;
      textarea.setSelectionRange(draft.length, draft.length);
    }
  }, [draft]);

  const loadPage = async (direction: 'newer' | 'older') => {
    if (
      loadingPageRef.current ||
      phase !== 'ready' ||
      !generationRef.current ||
      (direction === 'older' && !hasOlderRef.current) ||
      (direction === 'newer' && !hasNewerRef.current)
    ) {
      return;
    }
    const loaded = messagesRef.current;
    if (loaded.length === 0) {
      void bootstrapRef.current();
      return;
    }
    const boundary =
      direction === 'older'
        ? loaded[0].sequence
        : loaded[loaded.length - 1].sequence;
    const timeline = timelineRef.current;
    if (direction === 'older' && timeline) {
      anchorRef.current = {
        height: timeline.scrollHeight,
        top: timeline.scrollTop,
      };
    }
    loadingPageRef.current = true;
    setPageDirection(direction);
    setPageError(null);
    const result = await networkApi.getChatHistory({
      campaignId: session.campaignId,
      direction,
      generation: generationRef.current,
      sequence: boundary,
    });
    loadingPageRef.current = false;
    setPageDirection(null);
    if (!result.ok) {
      if (result.error.code === 'history_changed') {
        void bootstrapRef.current();
      } else {
        anchorRef.current = null;
        setPageError(result.error.message);
      }
      return;
    }
    if (result.value.generation !== generationRef.current) {
      void bootstrapRef.current();
      return;
    }
    const merged = mergeMessages(
      messagesRef.current,
      result.value.messages,
      direction === 'older' ? 'oldest' : 'newest',
    );
    updateMessages(merged.messages);
    if (direction === 'older') {
      updateHasOlder(result.value.hasOlder);
      updateHasNewer(result.value.hasNewer || merged.dropped);
    } else {
      updateHasNewer(result.value.hasNewer);
      updateHasOlder(result.value.hasOlder || merged.dropped);
      if (atBottomRef.current) {
        requestBottomRef.current = true;
      }
    }
  };

  const handleScroll = () => {
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    const distanceFromBottom =
      timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop;
    atBottomRef.current = distanceFromBottom <= 2;
    if (timeline.scrollTop <= 48) {
      void loadPage('older');
    } else if (distanceFromBottom <= 96) {
      void loadPage('newer');
    }
  };

  const sendPending = async (pending: PendingChatRow) => {
    setPendingRows((current) =>
      current.map((row) =>
        row.clientMessageId === pending.clientMessageId
          ? { ...row, error: null, state: 'pending' }
          : row,
      ),
    );
    if (atBottomRef.current) {
      requestBottomRef.current = true;
    }
    let timer = 0;
    const timeout = new Promise<ChatResult<ChatMessage>>((resolve) => {
      timer = window.setTimeout(
        () =>
          resolve({
            error: {
              code: 'timeout',
              message: 'The host did not acknowledge this message.',
            },
            ok: false,
          }),
        pending.kind === 'roll'
          ? CHAT_ROLL_SEND_TIMEOUT_MS
          : CHAT_SEND_TIMEOUT_MS,
      );
    });
    let result: ChatResult<ChatMessage>;
    try {
      const send =
        pending.kind === 'roll'
          ? networkApi.sendChatRoll({
              campaignId: session.campaignId,
              clientMessageId: pending.clientMessageId,
              definition: pending.definition,
              recipient: recipientPrincipal(pending.recipient),
            })
          : networkApi.sendChatMessage({
              campaignId: session.campaignId,
              clientMessageId: pending.clientMessageId,
              content: pending.body,
              recipient: recipientPrincipal(pending.recipient),
            });
      result = await Promise.race([send, timeout]);
    } catch {
      result = {
        error: {
          code: 'unavailable',
          message: 'Message could not be sent.',
        },
        ok: false,
      };
    } finally {
      window.clearTimeout(timer);
    }
    if (pending.generation !== generationRef.current) {
      return;
    }
    if (!result.ok) {
      if (pending.kind === 'roll' && result.error.code === 'invalid_input') {
        setPendingRows((current) =>
          current.filter(
            (row) => row.clientMessageId !== pending.clientMessageId,
          ),
        );
        setDraft((current) => current || pending.draft);
        setComposerError(result.error.message);
        composerRef.current?.focus();
        return;
      }
      setPendingRows((current) =>
        current.map((row) =>
          row.clientMessageId === pending.clientMessageId
            ? { ...row, error: result.error.message, state: 'failed' }
            : row,
        ),
      );
      return;
    }
    if (result.value.generation !== generationRef.current) {
      void bootstrapRef.current();
      return;
    }
    soundNewMessage(result.value);
    if (hasNewerRef.current) {
      // A confirmed send belongs at the live edge. Reloading the newest page
      // avoids creating a sequence gap inside an older paged window.
      void bootstrapRef.current();
      return;
    }
    const merged = mergeMessages(messagesRef.current, [result.value], 'newest');
    updateMessages(merged.messages);
    if (merged.dropped) {
      updateHasOlder(true);
    }
    setPendingRows((current) =>
      current.filter(
        (row) => row.clientMessageId !== pending.clientMessageId,
      ),
    );
    if (atBottomRef.current) {
      requestBottomRef.current = true;
    }
  };

  const parsedDraft = useMemo(
    () => parseChatComposer(draft, directory, viewer, session.role === 'gm'),
    [directory, draft, session.role, viewer],
  );
  const draftBody =
    parsedDraft.kind === 'send'
      ? parsedDraft.body
      : normalizeChatContent(draft);
  const draftCount = countChatGraphemes(draftBody);
  const draftBytes = chatUtf8ByteLength(draftBody);
  const overCharacterLimit = draftCount > maxMessageCharacters;
  const overByteLimit = draftBytes > MAX_CHAT_MESSAGE_BYTES;
  const limitError = overCharacterLimit
    ? `${draftCount.toLocaleString()} / ${maxMessageCharacters.toLocaleString()} characters`
    : overByteLimit
      ? 'Message exceeds the 512 KiB storage limit.'
      : null;

  const handleSubmit = async () => {
    if (phase !== 'ready' || clearing || limitError) {
      return;
    }
    const parsed = parseChatComposer(
      draft,
      directory,
      viewer,
      session.role === 'gm',
    );
    if (parsed.kind === 'error') {
      setComposerError(parsed.message);
      return;
    }
    submissionHistoryRef.current = recordChatSubmission(
      submissionHistoryRef.current,
      draft,
    );
    setComposerError(null);
    if (parsed.kind === 'help') {
      setDraft('');
      setHelpRows((current) => [
        ...current,
        { id: createClientMessageId(), occurredAt: new Date().toISOString() },
      ]);
      requestBottomRef.current = true;
      composerRef.current?.focus();
      return;
    }
    if (parsed.kind === 'clear') {
      setClearing(true);
      const result = await networkApi.clearChatHistory({
        campaignId: session.campaignId,
      });
      setClearing(false);
      if (!result.ok) {
        setComposerError(result.error.message);
      } else {
        setDraft('');
        if (generationRef.current !== result.value.generation) {
          resetGeneration(result.value.generation);
        }
      }
      composerRef.current?.focus();
      return;
    }
    const common = {
      clientMessageId: createClientMessageId(),
      createdAt: new Date().toISOString(),
      error: null,
      generation,
      recipient: parsed.recipient,
      state: 'pending' as const,
    };
    const pending: PendingChatRow =
      parsed.kind === 'roll'
        ? {
            ...common,
            definition: parsed.definition,
            draft: normalizeChatContent(draft),
            kind: 'roll',
          }
        : { ...common, body: parsed.body, kind: 'text' };
    setPendingRows((current) => [...current, pending]);
    setDraft('');
    requestBottomRef.current = true;
    composerRef.current?.focus();
    await sendPending(pending);
  };

  const handleComposerKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ) => {
    const isComposing =
      event.nativeEvent.isComposing || composingRef.current;
    if (isComposing) {
      return;
    }
    const isPlainKey =
      !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (isPlainKey && event.key === 'ArrowUp') {
      const navigation = recallOlderChatSubmission(
        submissionHistoryRef.current,
        draft,
      );
      if (navigation.handled && navigation.value !== null) {
        event.preventDefault();
        submissionHistoryRef.current = navigation.state;
        setComposerError(null);
        if (navigation.value === draft) {
          event.currentTarget.setSelectionRange(draft.length, draft.length);
        } else {
          placeComposerCaretAtEndRef.current = true;
          setDraft(navigation.value);
        }
        return;
      }
    }
    if (isPlainKey && event.key === 'ArrowDown') {
      const navigation = recallNewerChatSubmission(
        submissionHistoryRef.current,
      );
      if (navigation.handled && navigation.value !== null) {
        event.preventDefault();
        submissionHistoryRef.current = navigation.state;
        setComposerError(null);
        placeComposerCaretAtEndRef.current = true;
        setDraft(navigation.value);
        return;
      }
    }
    if (
      submissionHistoryRef.current.cursor !== null &&
      (historyExitNavigationKeys.has(event.key) ||
        ((event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
          !isPlainKey) ||
        ((event.ctrlKey || event.metaKey) &&
          event.key.toLocaleLowerCase('en-US') === 'a'))
    ) {
      submissionHistoryRef.current = exitChatSubmissionHistory(
        submissionHistoryRef.current,
      );
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !isComposing
    ) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const timelineRows = useMemo<TimelineRow[]>(() => {
    const rows: TimelineRow[] = messages
      .map(
        (message): TimelineRow => ({
          key: `message:${message.id}`,
          kind: 'accepted',
          message,
          occurredAt: message.acceptedAt,
        }),
      )
      .sort((left, right) => {
        if (left.kind !== 'accepted' || right.kind !== 'accepted') {
          return 0;
        }
        return left.message.sequence - right.message.sequence;
      });
    const transientRows: TimelineRow[] = [
      ...systemRows.map(
        (event): TimelineRow => ({
          event,
          key: `system:${event.eventId}`,
          kind: 'system',
          occurredAt: event.occurredAt,
        }),
      ),
      ...helpRows.map(
        (help): TimelineRow => ({
          help,
          key: `help:${help.id}`,
          kind: 'help',
          occurredAt: help.occurredAt,
        }),
      ),
      ...pendingRows.map(
        (pending): TimelineRow => ({
          key: `pending:${pending.clientMessageId}`,
          kind: 'pending',
          occurredAt: pending.createdAt,
          pending,
        }),
      ),
    ].sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.key.localeCompare(right.key),
    );
    for (const transient of transientRows) {
      const insertion = rows.findIndex((row) => {
        const timeOrder = row.occurredAt.localeCompare(
          transient.occurredAt,
        );
        return (
          timeOrder > 0 ||
          (timeOrder === 0 && row.key.localeCompare(transient.key) > 0)
        );
      });
      if (insertion < 0) {
        rows.push(transient);
      } else {
        rows.splice(insertion, 0, transient);
      }
    }
    return rows;
  }, [helpRows, messages, pendingRows, systemRows]);

  const timeFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    [],
  );
  const messageDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [],
  );

  const renderCard = (row: TimelineRow) => {
    const date = rowDate(row);
    const time = timeFormatter.format(date);
    if (row.kind === 'system') {
      return (
        <article className={styles.systemCard}>
          <span>
            {row.event.identity.displayName}{' '}
            {row.event.type === 'participant_joined' ? 'joined' : 'left'}
          </span>
          <time dateTime={row.event.occurredAt}>{time}</time>
        </article>
      );
    }
    if (row.kind === 'help') {
      return (
        <article className={styles.helpCard}>
          <div className={styles.cardHeader}>
            <strong>Chat help</strong>
            <time dateTime={row.help.occurredAt}>{time}</time>
          </div>
          <ul>
            <li>Type a message to send it publicly.</li>
            <li>
              Use <code>/w Alice message</code> or{' '}
              <code>/whisper &quot;Alice Smith&quot; message</code>.
            </li>
            <li>
              Use <code>/r 1d20+5</code> for a quick roll.
            </li>
            <li>
              Use <code>/roll Spell: Flame Blade</code>, then add lines such as{' '}
              <code>Attack (WIS +2): 1d20</code> for a roll card.
            </li>
            <li>
              Start with <code>//</code> to send a literal leading slash.
            </li>
            {session.role === 'gm' ? (
              <li>
                Use <code>/clear</code> to permanently clear all chat history.
              </li>
            ) : null}
          </ul>
        </article>
      );
    }
    if (row.kind === 'pending') {
      return (
        <article
          className={styles.messageCard}
          data-state={row.pending.state}
          data-whisper={row.pending.recipient !== null}
        >
          <div className={styles.cardHeader}>
            <strong>{sender.displayName}</strong>
            <time dateTime={row.pending.createdAt}>
              {messageDateFormatter.format(date)}
            </time>
          </div>
          {row.pending.kind === 'roll' ? (
            <PendingDiceRollCard definition={row.pending.definition} />
          ) : (
            <div className={styles.messageBody}>{row.pending.body}</div>
          )}
          <div className={styles.pendingStatus}>
            {row.pending.state === 'pending' ? (
              <span>Sending…</span>
            ) : (
              <>
                <span role="alert">
                  {row.pending.error ?? 'Message could not be sent.'}
                </span>
                <Button
                  size="compact"
                  onClick={() => void sendPending(row.pending)}
                >
                  Retry
                </Button>
              </>
            )}
          </div>
        </article>
      );
    }
    const whisper = row.message.recipient !== null;
    return (
      <article className={styles.messageCard} data-whisper={whisper}>
        <div className={styles.cardHeader}>
          <strong>{row.message.sender.displayName}</strong>
          <time dateTime={row.message.acceptedAt}>
            {messageDateFormatter.format(date)}
          </time>
        </div>
        {row.message.payload.kind === 'roll' ? (
          <DiceRollCard card={row.message.payload.card} />
        ) : (
          <div className={styles.messageBody}>
            <ChatText applicationApi={applicationApi}>
              {row.message.payload.text}
            </ChatText>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className={styles.panel} data-phase={phase}>
      <div
        ref={timelineRef}
        aria-busy={phase === 'loading'}
        aria-live={visible ? 'polite' : 'off'}
        aria-label="Campaign chat"
        className={styles.timeline}
        role="log"
        onScroll={handleScroll}
      >
        {pageDirection === 'older' ? (
          <p className={styles.pagingStatus} role="status">
            Loading older messages…
          </p>
        ) : null}
        {pageError ? (
          <div className={styles.pageError} role="alert">
            <span>{pageError}</span>
            <Button size="compact" onClick={() => void loadPage('older')}>
              Retry
            </Button>
          </div>
        ) : null}
        {phase === 'loading' ? (
          <div className={styles.inlineState} role="status">
            <span className={styles.loaderBars} aria-hidden>
              <i />
              <i />
              <i />
            </span>
            <span>Loading chat…</span>
          </div>
        ) : phase === 'unavailable' ? (
          <div className={styles.inlineState} role="alert">
            <strong>Chat unavailable</strong>
            <span>{unavailableMessage}</span>
            <Button size="compact" onClick={() => void bootstrapRef.current()}>
              Retry
            </Button>
          </div>
        ) : timelineRows.length === 0 ? (
          <div className={styles.empty} data-sidebar-icon="chat">
            <MessageSquare aria-hidden size="5rem" strokeWidth={1} />
          </div>
        ) : (
          timelineRows.map((row) => (
            <div className={styles.timelineRow} key={row.key}>
              {renderCard(row)}
            </div>
          ))
        )}
        {pageDirection === 'newer' ? (
          <p className={styles.pagingStatus} role="status">
            Loading newer messages…
          </p>
        ) : null}
      </div>

      <div className={styles.composerArea}>
        <div className={styles.composer}>
          <textarea
            ref={composerRef}
            aria-label="Message"
            disabled={phase !== 'ready' || clearing}
            placeholder="Message"
            rows={1}
            value={draft}
            onChange={(event) => {
              submissionHistoryRef.current = exitChatSubmissionHistory(
                submissionHistoryRef.current,
              );
              setDraft(event.currentTarget.value);
              setComposerError(null);
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onKeyDown={handleComposerKeyDown}
            onPointerDown={() => {
              submissionHistoryRef.current = exitChatSubmissionHistory(
                submissionHistoryRef.current,
              );
            }}
          />
        </div>
        {composerError || limitError ? (
          <p className={styles.composerError} role="alert">
            {composerError ?? limitError}
          </p>
        ) : null}
      </div>
    </div>
  );
}
