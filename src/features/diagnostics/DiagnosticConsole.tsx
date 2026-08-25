import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  DIAGNOSTIC_EVENT_LIMIT,
  type DiagnosticEvent,
  type DiagnosticLevel,
  type DiagnosticProvider,
  type DiagnosticSnapshot,
  type DiagnosticSource,
  type DiagnosticsApi,
} from '../../shared/diagnostics';
import { Button } from '../../components/ui/Button';
import { DefaultInput } from '../../components/ui/DefaultInput';
import styles from './DiagnosticConsole.module.css';

const COMMANDS = [
  'clear',
  'filter',
  'help',
  'inspect',
  'logs',
  'pause',
  'providers',
  'resume',
  'status',
] as const;

interface DisplayFilter {
  category: string | null;
  level: DiagnosticLevel;
  source: DiagnosticSource | null;
}

interface DiagnosticConsoleProps {
  api: DiagnosticsApi;
  children: ReactNode;
}

const LEVEL_PRIORITY: Record<DiagnosticLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.matches('input, select, textarea') || target.isContentEditable
  );
}

function parseWords(input: string): string[] | null {
  const words: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const character of input.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (current) {
        words.push(current);
        current = '';
      }
    } else {
      current += character;
    }
  }
  if (escaped) current += '\\';
  if (quote) return null;
  if (current) words.push(current);
  return words;
}

function eventLine(event: DiagnosticEvent): string {
  const time = new Date(event.occurredAt).toLocaleTimeString([], {
    hour12: false,
  });
  return `${time} ${event.level.toUpperCase().padEnd(5)} [${event.source}.${event.category}] ${event.message}`;
}

function formatValue(value: unknown, depth = 0): string {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((entry) => `${childIndent}- ${formatValue(entry, depth + 1)}`)
      .join('\n');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return entries
    .map(([key, entry]) => {
      const formatted = formatValue(entry, depth + 1);
      return formatted.includes('\n')
        ? `${childIndent}${key}:\n${formatted}`
        : `${childIndent}${key}: ${formatted}`;
    })
    .join('\n')
    .replace(new RegExp(`^${indent}`), '');
}

function loadFilter(): DisplayFilter {
  try {
    const stored = sessionStorage.getItem('blackbox:diagnostic-filter');
    if (!stored) return { category: null, level: 'info', source: null };
    const value = JSON.parse(stored) as Partial<DisplayFilter>;
    return {
      category: typeof value.category === 'string' ? value.category : null,
      level: value.level && value.level in LEVEL_PRIORITY ? value.level : 'info',
      source: value.source === 'main' || value.source === 'renderer'
        ? value.source
        : null,
    };
  } catch {
    return { category: null, level: 'info', source: null };
  }
}

function matches(event: DiagnosticEvent, filter: DisplayFilter): boolean {
  if (event.kind === 'command') return true;
  return LEVEL_PRIORITY[event.level] >= LEVEL_PRIORITY[filter.level] &&
    (!filter.source || event.source === filter.source) &&
    (!filter.category || event.category.includes(filter.category));
}

function scrollToEnd(element: HTMLDivElement | null): void {
  if (element) element.scrollTop = element.scrollHeight;
}

export function DiagnosticConsole({
  api,
  children,
}: DiagnosticConsoleProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot | null>(null);
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [visibleEvents, setVisibleEvents] = useState<DiagnosticEvent[]>([]);
  const [filter, setFilter] = useState<DisplayFilter>(loadFilter);
  const [paused, setPaused] = useState(false);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef(filter);
  const pausedRef = useRef(paused);
  const followRef = useRef(true);
  const pausedAfterRef = useRef<number | null>(null);
  const commandGenerationRef = useRef(0);

  useEffect(() => {
    let active = true;
    void api.snapshot().then((next) => {
      if (!active) return;
      setSnapshot(next);
      setEvents(next.events);
      setVisibleEvents(next.events.filter((event) => matches(event, filterRef.current)));
      setHistory(
        next.events
          .filter((event) => event.kind === 'command' && event.message.startsWith('> '))
          .map((event) => event.message.slice(2)),
      );
    });
    const remove = api.onChanged((event) => {
      setEvents((current) => [...current, event].slice(-DIAGNOSTIC_EVENT_LIMIT));
      if (!pausedRef.current && matches(event, filterRef.current)) {
        setVisibleEvents((current) =>
          [...current, event].slice(-DIAGNOSTIC_EVENT_LIMIT),
        );
        if (!followRef.current) setUnseen((count) => count + 1);
      }
    });
    const removeOpenRequested = api.onOpenRequested(() => setOpen(true));
    return () => {
      active = false;
      remove();
      removeOpenRequested();
    };
  }, [api]);

  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    sessionStorage.setItem('blackbox:diagnostic-filter', JSON.stringify(filter));
  }, [filter]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.code === 'Backquote' &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        (open || !isEditable(event.target))
      ) {
        event.preventDefault();
        event.stopPropagation();
        setOpen((current) => !current);
      } else if (open && event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', keyDown, true);
    return () => window.removeEventListener('keydown', keyDown, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    pausedRef.current = false;
    followRef.current = true;
    queueMicrotask(() => {
      setPaused(false);
      setUnseen(0);
      inputRef.current?.focus();
    });
  }, [open]);

  useEffect(() => {
    if (!open || !followRef.current) return;
    scrollToEnd(outputRef.current);
  }, [open, visibleEvents]);

  useEffect(() => {
    const originalWarn = console.warn;
    const originalError = console.error;
    console.warn = (...values: unknown[]) => {
      originalWarn(...values);
      api.record({
        category: 'console',
        level: 'warn',
        message: values.map(String).join(' '),
      });
    };
    console.error = (...values: unknown[]) => {
      originalError(...values);
      api.record({
        category: 'console',
        level: 'error',
        message: values.map(String).join(' '),
      });
    };
    const handleError = (event: ErrorEvent) => api.record({
      category: 'renderer',
      level: 'error',
      message: event.message,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    });
    const handleRejection = (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
      api.record({
        category: 'renderer',
        level: 'error',
        message: `Unhandled rejection: ${error.message}`,
        stack: error.stack,
      });
    };
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    return () => {
      console.warn = originalWarn;
      console.error = originalError;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, [api]);

  const recordCommand = (message: string, level: DiagnosticLevel = 'info') => {
    api.record({ category: 'console', kind: 'command', level, message });
  };

  const execute = async (commandLine: string) => {
    const trimmed = commandLine.trim();
    if (!trimmed || running) return;
    const words = parseWords(trimmed);
    setInput('');
    setHistoryIndex(null);
    setHistory((current) => [...current.filter((entry) => entry !== trimmed), trimmed]);
    recordCommand(`> ${trimmed}`);
    if (!words) {
      recordCommand('Command contains an unterminated quote.', 'error');
      return;
    }
    const [command, ...args] = words;
    const generation = ++commandGenerationRef.current;
    setRunning(true);
    try {
      if (command === 'clear') {
        await api.clear();
        setEvents([]);
        setVisibleEvents([]);
        setSnapshot((current) => current ? {
          ...current,
          events: [],
          stats: {
            bytes: 0,
            discarded: { debug: 0, error: 0, info: 0, warn: 0 },
            events: 0,
            truncated: 0,
          },
        } : current);
      } else if (command === 'help') {
        recordCommand(
          args[0]
            ? helpFor(args[0])
            : `Commands: ${COMMANDS.join(', ')}\nUse help <command> for details.`,
        );
      } else if (command === 'providers') {
        const latest = await api.snapshot();
        if (generation !== commandGenerationRef.current) return;
        recordCommand(latest.capabilities.providers.join('\n'));
      } else if (command === 'status') {
        const latest = await api.snapshot();
        if (generation !== commandGenerationRef.current) return;
        setSnapshot(latest);
        recordCommand(formatValue({
          context: latest.context,
          instance: latest.instance,
          stats: latest.stats,
        }));
      } else if (command === 'inspect') {
        const provider = args.find((argument) => !argument.startsWith('--'));
        if (!provider) throw new Error('Usage: inspect <provider> [--content] [--check] [--json]');
        const result = provider === 'renderer'
          ? { provider: 'renderer' as const, value: rendererSnapshot() }
          : provider === 'caches'
            ? { provider: 'caches' as const, value: await cacheSnapshot() }
            : await api.inspect({
                check: args.includes('--check'),
                content: args.includes('--content'),
                provider: provider as DiagnosticProvider,
              });
        if (generation !== commandGenerationRef.current) return;
        recordCommand(
          args.includes('--json')
            ? JSON.stringify(result.value, null, 2)
            : `${result.provider}:\n${formatValue(result.value)}`,
        );
      } else if (command === 'logs') {
        const query = filterFromArgs(args, filter);
        const lines = events.filter((event) => matches(event, query)).map(eventLine);
        recordCommand(lines.length ? lines.join('\n') : 'No matching events.');
      } else if (command === 'filter') {
        const next = args[0] === 'reset'
          ? { category: null, level: 'info' as const, source: null }
          : filterFromArgs(args, filter);
        filterRef.current = next;
        setFilter(next);
        recordCommand(`Live filter: ${formatValue(next)}`);
      } else if (command === 'pause') {
        pausedAfterRef.current = events.at(-1)?.id ?? 0;
        pausedRef.current = true;
        setPaused(true);
        recordCommand('Live display paused. Application activity continues.');
      } else if (command === 'resume') {
        const after = pausedAfterRef.current ?? 0;
        const missed = events.filter((event) => event.id > after && matches(event, filter));
        setVisibleEvents((current) => [...current, ...missed].slice(-DIAGNOSTIC_EVENT_LIMIT));
        pausedAfterRef.current = null;
        pausedRef.current = false;
        setPaused(false);
        recordCommand(`Live display resumed${missed.length ? ` with ${missed.length} buffered events` : ''}.`);
      } else {
        recordCommand(`Unknown command: ${command}. Use help to list commands.`, 'error');
      }
    } catch (error) {
      if (generation === commandGenerationRef.current) {
        recordCommand(error instanceof Error ? error.message : String(error), 'error');
      }
    } finally {
      if (generation === commandGenerationRef.current) setRunning(false);
    }
  };

  const complete = () => {
    const words = parseWords(input) ?? [];
    const candidates = words.length <= 1
      ? COMMANDS
      : words[0] === 'inspect'
        ? snapshot?.capabilities.providers ?? []
        : [];
    const partial = words.at(-1) ?? '';
    const matches = candidates.filter((candidate) => candidate.startsWith(partial));
    if (matches.length === 1) {
      const prefix = input.slice(0, Math.max(0, input.length - partial.length));
      setInput(`${prefix}${matches[0]} `);
    }
  };

  const inputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void execute(input);
    } else if (event.key === 'ArrowUp' && history.length > 0) {
      event.preventDefault();
      const next = historyIndex === null
        ? history.length - 1
        : Math.max(0, historyIndex - 1);
      setHistoryIndex(next);
      setInput(history[next]);
    } else if (event.key === 'ArrowDown' && historyIndex !== null) {
      event.preventDefault();
      const next = historyIndex + 1;
      if (next >= history.length) {
        setHistoryIndex(null);
        setInput('');
      } else {
        setHistoryIndex(next);
        setInput(history[next]);
      }
    } else if (event.key === 'Tab') {
      event.preventDefault();
      complete();
    } else if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      void execute('clear');
    } else if (event.ctrlKey && event.key.toLowerCase() === 'c' && running) {
      event.preventDefault();
      commandGenerationRef.current += 1;
      setRunning(false);
      recordCommand('Command cancelled.', 'warn');
    }
  };

  const renderedEvents = useMemo(() => visibleEvents, [visibleEvents]);

  return (
    <div className={styles.host}>
      <div aria-hidden={open || undefined} className={styles.application} inert={open || undefined}>
        {children}
      </div>
      {open ? (
        <section aria-label="Developer console" aria-modal="true" className={styles.console} role="dialog">
          <div
            aria-label="Console output"
            className={styles.output}
            onScroll={(event) => {
              const element = event.currentTarget;
              followRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 2;
              if (followRef.current) setUnseen(0);
            }}
            ref={outputRef}
            role="log"
          >
            {renderedEvents.map((event) => (
              <pre className={styles.entry} data-level={event.level} key={event.id}>
                {eventLine(event)}
                {event.details !== undefined ? `\n${formatValue(event.details)}` : ''}
                {event.stack ? `\n${event.stack}` : ''}
              </pre>
            ))}
            {unseen > 0 ? (
              <Button
                className={styles.unseen}
                onClick={() => {
                  followRef.current = true;
                  setUnseen(0);
                  scrollToEnd(outputRef.current);
                }}
                size="compact"
                variant="secondary"
              >
                {unseen} new events
              </Button>
            ) : null}
          </div>
          <label className={styles.prompt}>
            <span aria-hidden="true">&gt;</span>
            <span className="sr-only">Console command</span>
            <DefaultInput
              aria-label="Console command"
              autoComplete="off"
              className={styles.input}
              font="mono"
              onChange={(event) => setInput(event.currentTarget.value)}
              onKeyDown={inputKeyDown}
              ref={inputRef}
              spellCheck={false}
              surface="borderless"
              value={input}
            />
          </label>
        </section>
      ) : null}
    </div>
  );
}

function filterFromArgs(
  args: string[],
  current: DisplayFilter,
): DisplayFilter {
  const next = { ...current };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--level') {
      const level = args[index + 1] as DiagnosticLevel | undefined;
      if (!level || !(level in LEVEL_PRIORITY)) throw new Error('Invalid diagnostic level.');
      next.level = level;
      index += 1;
    } else if (argument === '--source') {
      const source = args[index + 1];
      if (source !== 'main' && source !== 'renderer') throw new Error('Invalid diagnostic source.');
      next.source = source;
      index += 1;
    } else if (argument === '--category') {
      next.category = args[index + 1] ?? null;
      index += 1;
    }
  }
  return next;
}

function helpFor(command: string): string {
  const help: Record<string, string> = {
    clear: 'clear — remove all buffered diagnostic events',
    filter: 'filter [reset|--level <level>|--source <source>|--category <text>]',
    help: 'help [command] — show available commands or command help',
    inspect: 'inspect <provider> [--content] [--check] [--json]',
    logs: 'logs [--level <level>] [--source <source>] [--category <text>]',
    pause: 'pause — pause live display without pausing the application',
    providers: 'providers — list providers available in this build',
    resume: 'resume — resume live display and append buffered events',
    status: 'status — print compact instance and application status',
  };
  return help[command] ?? `Unknown command: ${command}.`;
}

function rendererSnapshot() {
  const navigation = performance.getEntriesByType('navigation')[0];
  return {
    document: {
      focused: document.hasFocus(),
      visibility: document.visibilityState,
    },
    navigator: {
      language: navigator.language,
      online: navigator.onLine,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    },
    performance: {
      navigationDurationMs: navigation?.duration ?? null,
      resourceEntries: performance.getEntriesByType('resource').length,
      timeOrigin: performance.timeOrigin,
    },
    viewport: {
      devicePixelRatio: window.devicePixelRatio,
      height: window.innerHeight,
      width: window.innerWidth,
    },
  };
}

async function cacheSnapshot() {
  let browserCaches: string[] = [];
  try {
    browserCaches = 'caches' in window ? await window.caches.keys() : [];
  } catch {
    // Cache enumeration is best-effort diagnostics.
  }
  return {
    browserCaches,
    localStorageEntries: localStorage.length,
    resourceEntries: performance.getEntriesByType('resource').length,
    sessionStorageEntries: sessionStorage.length,
  };
}
