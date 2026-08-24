import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { ContextMenuController, type ContextMenuEntry } from '../../components/ui/contextMenu';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../components/ui/deleteConfirmation';
import { ErrorModal } from '../../components/ui/ErrorModal';
import { IconButton } from '../../components/ui/IconButton';
import { InlineInput } from '../../components/ui/InlineInput';
import { OrderedCollectionController } from '../../components/ui/orderedCollection';
import { SearchInput } from '../../components/ui/SearchInput';
import type { SceneApi } from '../../shared/scenes';
import type { NetworkApi } from '../../shared/network';
import { CHAT_ROLL_SEND_TIMEOUT_MS } from '../../shared/chatRoll';
import {
  applyTokenInspectorNumericCommand,
  type TokenInspectorField,
  type TokenInspectorMutation,
  type TokenInspectorPresentation,
} from '../../shared/tokenInspector';
import styles from './TokenInspector.module.css';

interface TokenInspectorProps {
  campaignId: string;
  networkApi: Pick<NetworkApi, 'sendChatRoll'>;
  sceneId: string;
  sceneRevision: number;
  sceneApi: SceneApi;
  tokenId: string;
}

interface ReorderState {
  activeId: string;
  orderedIds: readonly string[];
}

function optimisticMutation(
  current: TokenInspectorPresentation,
  mutation: TokenInspectorMutation,
): TokenInspectorPresentation {
  const next = structuredClone(current);
  const index = next.selectedFieldIds.indexOf(mutation.fieldId);
  if (mutation.kind === 'add-field') {
    if (index < 0) next.selectedFieldIds.push(mutation.fieldId);
    return next;
  }
  if (mutation.kind === 'delete-field') {
    if (index >= 0) next.selectedFieldIds.splice(index, 1);
    return next;
  }
  if (mutation.kind === 'move-field') {
    const target = index + (mutation.direction === 'down' ? 1 : -1);
    if (index >= 0 && target >= 0 && target < next.selectedFieldIds.length) {
      [next.selectedFieldIds[index], next.selectedFieldIds[target]] =
        [next.selectedFieldIds[target], next.selectedFieldIds[index]];
    }
    return next;
  }
  if (mutation.kind === 'place-field') {
    if (index < 0) return next;
    next.selectedFieldIds.splice(index, 1);
    const target = mutation.beforeFieldId === null
      ? next.selectedFieldIds.length
      : next.selectedFieldIds.indexOf(mutation.beforeFieldId);
    next.selectedFieldIds.splice(target < 0 ? next.selectedFieldIds.length : target, 0, mutation.fieldId);
    return next;
  }
  const field = next.fields.find(({ id }) => id === mutation.fieldId);
  if (!field) return next;
  if (field.kind === 'scalar' && mutation.target === 'value') {
    field.value = field.editor === 'text'
      ? mutation.command
      : applyTokenInspectorNumericCommand(field.value, mutation.command) ?? field.value;
  } else if (field.kind === 'resource' && mutation.target !== 'value') {
    field[mutation.target] = applyTokenInspectorNumericCommand(
      field[mutation.target],
      mutation.command,
    ) ?? field[mutation.target];
  }
  return next;
}

function InspectorInput({
  fieldId,
  label,
  onCommit,
  selectOnFocus,
  target,
  value,
}: {
  fieldId: string;
  label: string;
  onCommit: (mutation: TokenInspectorMutation) => void;
  selectOnFocus: boolean;
  target: 'current' | 'maximum' | 'value';
  value: string;
}) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(draft);
  const committed = useRef(false);
  const suppressBlur = useRef(false);
  const valueRef = useRef(value);
  const commitRef = useRef(onCommit);
  useEffect(() => {
    valueRef.current = value;
    commitRef.current = onCommit;
  }, [onCommit, value]);
  useEffect(() => () => {
    if (!committed.current && draftRef.current !== valueRef.current) {
      commitRef.current({
        command: draftRef.current,
        fieldId,
        kind: 'set-value',
        target,
      });
    }
  }, [fieldId, target]);
  const commit = () => {
    if (suppressBlur.current) {
      suppressBlur.current = false;
      return;
    }
    if (draft !== value) {
      committed.current = true;
      onCommit({ command: draft, fieldId, kind: 'set-value', target });
    }
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      suppressBlur.current = true;
      committed.current = true;
      draftRef.current = value;
      setDraft(value);
      event.currentTarget.blur();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  return (
    <InlineInput
      align="right"
      aria-label={`${label} ${target}`}
      density="compact"
      onBlur={commit}
      onChange={(event) => {
        committed.current = false;
        draftRef.current = event.currentTarget.value;
        setDraft(event.currentTarget.value);
      }}
      onClick={(event) => {
        if (selectOnFocus) event.currentTarget.select();
      }}
      onFocus={(event) => {
        if (selectOnFocus) event.currentTarget.select();
      }}
      onKeyDown={keyDown}
      sizing="content"
      surface="borderless"
      value={draft}
    />
  );
}

function TokenInspectorSession({
  campaignId,
  networkApi,
  sceneApi,
  sceneId,
  sceneRevision,
  tokenId,
}: TokenInspectorProps) {
  const [presentation, setPresentation] = useState<TokenInspectorPresentation | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reorder, setReorder] = useState<ReorderState | null>(null);
  const [rollingFieldIds, setRollingFieldIds] = useState<ReadonlySet<string>>(new Set());
  const menu = useRef<ContextMenuController | null>(null);
  const order = useRef<OrderedCollectionController | null>(null);
  const pending = useRef<TokenInspectorMutation[]>([]);
  const queues = useRef(new Map<string, Promise<void>>());
  const failedQueues = useRef(new Map<string, number>());
  const requestGeneration = useRef(0);
  const loaded = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const rollingFields = useRef(new Set<string>());

  const renderPending = (base: TokenInspectorPresentation) => {
    setPresentation(pending.current.reduce(optimisticMutation, base));
  };

  const refresh = async (generation = requestGeneration.current) => {
    const result = await sceneApi.getTokenInspector({ campaignId, sceneId, tokenId });
    if (generation !== requestGeneration.current) return null;
    if (!result.ok) {
      loaded.current = false;
      setPresentation(null);
      return null;
    }
    loaded.current = true;
    renderPending(result.value);
    return result.value;
  };

  useEffect(() => {
    menu.current = new ContextMenuController();
    return () => menu.current?.close();
  }, []);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    void sceneApi.getTokenInspector({ campaignId, sceneId, tokenId }).then((result) => {
      if (generation !== requestGeneration.current) return;
      if (!result.ok) {
        loaded.current = false;
        setPresentation(null);
        return;
      }
      loaded.current = true;
      renderPending(result.value);
    });
  }, [campaignId, sceneApi, sceneId, tokenId]);

  useEffect(() => {
    if (!loaded.current) return;
    const generation = ++requestGeneration.current;
    void sceneApi.getTokenInspector({ campaignId, sceneId, tokenId }).then((result) => {
      if (generation !== requestGeneration.current) return;
      if (!result.ok) {
        loaded.current = false;
        setPresentation(null);
        return;
      }
      renderPending(result.value);
    });
  }, [campaignId, sceneApi, sceneId, sceneRevision, tokenId]);

  const mutate = (mutation: TokenInspectorMutation) => {
    const base = presentation;
    if (!base?.editable) return;
    pending.current.push(mutation);
    setPresentation(optimisticMutation(base, mutation));
    const fieldLabel = base.fields.find(({ id }) => id === mutation.fieldId)?.label ?? 'Field';
    const queueVersion = failedQueues.current.get(mutation.fieldId) ?? 0;
    const previous = queues.current.get(mutation.fieldId) ?? Promise.resolve();
    const task = previous.then(async () => {
      if ((failedQueues.current.get(mutation.fieldId) ?? 0) !== queueVersion) return;
      const result = await sceneApi.mutateTokenInspector({
        campaignId,
        mutation,
        operationId: crypto.randomUUID(),
        sceneId,
        tokenId,
      });
      pending.current = pending.current.filter((candidate) => candidate !== mutation);
      if (!result.ok && result.error.code !== 'invalid_input') {
        failedQueues.current.set(mutation.fieldId, queueVersion + 1);
        pending.current = pending.current.filter(({ fieldId }) => fieldId !== mutation.fieldId);
        setError(`${fieldLabel}: ${result.error.message}`);
      }
      await refresh();
    }).catch(async () => {
      failedQueues.current.set(mutation.fieldId, queueVersion + 1);
      pending.current = pending.current.filter(({ fieldId }) => fieldId !== mutation.fieldId);
      setError(`${fieldLabel}: The change could not be saved.`);
      await refresh();
    });
    queues.current.set(mutation.fieldId, task);
  };

  const rollField = async (field: TokenInspectorField) => {
    if (!field.roll || rollingFields.current.has(field.id)) return;
    rollingFields.current.add(field.id);
    setRollingFieldIds(new Set(rollingFields.current));
    let timer = 0;
    try {
      const resolved = await sceneApi.resolveTokenInspectorRoll({
        campaignId,
        fieldId: field.id,
        sceneId,
        tokenId,
      });
      if (!resolved.ok) {
        setError(`${field.label}: ${resolved.error.message}`);
        return;
      }
      const timeout = new Promise<Awaited<ReturnType<NetworkApi['sendChatRoll']>>>(
        (resolve) => {
          timer = window.setTimeout(() => resolve({
            error: {
              code: 'timeout',
              message: 'The host did not acknowledge this roll.',
            },
            ok: false,
          }), CHAT_ROLL_SEND_TIMEOUT_MS);
        },
      );
      const sent = await Promise.race([
        networkApi.sendChatRoll({
          campaignId,
          clientMessageId: crypto.randomUUID(),
          definition: resolved.value,
          recipient: null,
        }),
        timeout,
      ]);
      if (!sent.ok) setError(`${field.label}: ${sent.error.message}`);
    } catch {
      setError(`${field.label}: The roll could not be sent.`);
    } finally {
      window.clearTimeout(timer);
      rollingFields.current.delete(field.id);
      setRollingFieldIds(new Set(rollingFields.current));
    }
  };

  const fieldsById = new Map(presentation?.fields.map((field) => [field.id, field]) ?? []);
  const orderedIds = reorder?.orderedIds ?? presentation?.selectedFieldIds ?? [];
  const normalizedSearch = search.trim().toLocaleLowerCase('en-US');
  const displayed = orderedIds.flatMap((id) => {
    const field = fieldsById.get(id);
    return field && (!normalizedSearch || field.label.toLocaleLowerCase('en-US').includes(normalizedSearch))
      ? [field]
      : [];
  });
  const addable = presentation?.fields.filter(
    ({ id }) => !presentation.selectedFieldIds.includes(id),
  ) ?? [];

  const beginReorder = (field: TokenInspectorField) => {
    if (!presentation?.editable) return;
    setSearch('');
    const controller = new OrderedCollectionController(
      () => presentation.selectedFieldIds,
      async (orderedIds) => {
        const index = orderedIds.indexOf(field.id);
        mutate({
          beforeFieldId: orderedIds[index + 1] ?? null,
          fieldId: field.id,
          kind: 'place-field',
        });
        return true;
      },
    );
    order.current = controller;
    const snapshot = controller.begin(field.id);
    if (snapshot) setReorder(snapshot);
  };

  useEffect(() => {
    if (!reorder) return undefined;
    const move = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-inspector-field-id]');
      if (!target) return;
      const snapshot = order.current?.active;
      const index = snapshot?.orderedIds.indexOf(target.dataset.inspectorFieldId!) ?? 0;
      const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
      const changed = order.current?.placeAt(index + (after ? 1 : 0));
      if (changed) setReorder(changed);
    };
    const down = (event: PointerEvent) => {
      if (event.button === 2 || !listRef.current?.contains(event.target as Node)) {
        order.current?.cancel();
        setReorder(null);
      } else if (event.button === 0) {
        event.preventDefault();
        void order.current?.commit().then(() => setReorder(null));
      }
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        order.current?.cancel();
        setReorder(null);
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        const changed = order.current?.step(event.key === 'ArrowUp' ? 'up' : 'down');
        if (changed) setReorder(changed);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        void order.current?.commit().then(() => setReorder(null));
      }
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [reorder]);

  if (!presentation) return null;

  const openFieldMenu = (
    field: TokenInspectorField,
    event: React.MouseEvent<HTMLElement>,
  ) => {
    if (!presentation.editable) return;
    event.preventDefault();
    const index = presentation.selectedFieldIds.indexOf(field.id);
    let deleteArmedUntil = 0;
    const entries: ContextMenuEntry[] = [
      {
        disabled: index <= 0,
        kind: 'action',
        label: 'Move Field Up',
        onSelect: () => mutate({ direction: 'up', fieldId: field.id, kind: 'move-field' }),
      },
      {
        disabled: index === presentation.selectedFieldIds.length - 1,
        kind: 'action',
        label: 'Move Field Down',
        onSelect: () => mutate({ direction: 'down', fieldId: field.id, kind: 'move-field' }),
      },
      {
        kind: 'action',
        label: 'Reorder Field Freely',
        onSelect: () => beginReorder(field),
      },
      { kind: 'divider' },
      {
        danger: true,
        kind: 'action',
        label: 'Delete Field',
        onSelect: (button) => {
          const now = Date.now();
          if (now > deleteArmedUntil) {
            deleteArmedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
            const armedUntil = deleteArmedUntil;
            button.textContent = 'Confirm Delete Field';
            button.setAttribute('aria-label', `Confirm deletion of ${field.label}`);
            button.setAttribute('aria-pressed', 'true');
            window.setTimeout(() => {
              if (button.isConnected && deleteArmedUntil === armedUntil && Date.now() >= armedUntil) {
                button.textContent = 'Delete Field';
                button.removeAttribute('aria-label');
                button.setAttribute('aria-pressed', 'false');
              }
            }, DELETE_CONFIRMATION_TIMEOUT_MS);
            return false;
          }
          mutate({ fieldId: field.id, kind: 'delete-field' });
        },
      },
    ];
    menu.current?.open(
      event.clientX,
      event.clientY,
      `${field.label} actions`,
      entries,
      () => event.currentTarget.focus(),
    );
  };

  return (
    <>
      <aside aria-label="Token Inspector" className={styles.inspector}>
        <div className={styles.toolbar}>
          <SearchInput
            label="Search inspector fields"
            onChange={setSearch}
            placeholder="Search fields"
            value={search}
          />
          <IconButton
            disabled={!presentation.editable || addable.length === 0}
            icon={Plus}
            label="Add inspector field"
            onClick={(event) => {
              const trigger = event.currentTarget;
              const bounds = trigger.getBoundingClientRect();
              menu.current?.open(
                bounds.left,
                bounds.bottom + 4,
                'Choose inspector field',
                addable.map((field) => ({
                  kind: 'action' as const,
                  label: field.selectionLabel ?? field.label,
                  onSelect: () => mutate({ fieldId: field.id, kind: 'add-field' }),
                })),
                () => trigger.focus(),
              );
            }}
          />
        </div>
        <div aria-label="Inspector fields" className={styles.fields} ref={listRef} role="list">
          {displayed.length === 0 ? (
            <p className={styles.empty}>
              {presentation.selectedFieldIds.length === 0 ? 'No fields added' : 'No matching fields'}
            </p>
          ) : displayed.map((field) => (
            <div
              className={styles.field}
              data-inspector-field-id={field.id}
              data-reordering={reorder?.activeId === field.id || undefined}
              key={field.id}
              onContextMenu={(event) => openFieldMenu(field, event)}
              role="listitem"
              tabIndex={presentation.editable ? 0 : undefined}
            >
              {field.roll ? (
                <span className={styles.label}>
                  <Button
                    align="left"
                    aria-busy={rollingFieldIds.has(field.id)}
                    aria-label={field.roll.label}
                    disabled={rollingFieldIds.has(field.id)}
                    layout="block"
                    onClick={() => void rollField(field)}
                    title={field.roll.label}
                    type="button"
                    variant="text"
                  >
                    {field.label}
                  </Button>
                </span>
              ) : (
                <span className={styles.label}>{field.label}</span>
              )}
              <span className={styles.value}>
                {field.kind === 'scalar' ? (
                  field.editor ? (
                    <InspectorInput fieldId={field.id} key={`value:${field.value}`} label={field.label} onCommit={mutate} selectOnFocus={field.editor === 'command'} target="value" value={field.value} />
                  ) : field.value
                ) : (
                  <>
                    {field.editor ? (
                      <InspectorInput fieldId={field.id} key={`current:${field.current}`} label={field.label} onCommit={mutate} selectOnFocus={field.editor === 'command'} target="current" value={field.current} />
                    ) : field.current}
                    <span aria-hidden className={styles.separator}>/</span>
                    {field.editor ? (
                      <InspectorInput fieldId={field.id} key={`maximum:${field.maximum}`} label={field.label} onCommit={mutate} selectOnFocus={field.editor === 'command'} target="maximum" value={field.maximum} />
                    ) : field.maximum}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </aside>
      <ErrorModal
        dismissLabel="Dismiss"
        isOpen={error !== null}
        message={error ?? ''}
        onDismiss={() => setError(null)}
        title="Token Inspector action failed"
      />
    </>
  );
}

export function TokenInspector(props: TokenInspectorProps) {
  return (
    <TokenInspectorSession
      {...props}
      key={`${props.campaignId}:${props.sceneId}:${props.tokenId}`}
    />
  );
}
