import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { ContextMenuController } from '../../../components/ui/contextMenu';
import { DELETE_CONFIRMATION_TIMEOUT_MS } from '../../../components/ui/deleteConfirmation';
import { Modal } from '../../../components/ui/Modal';
import type { ChatRollDefinition } from '../../../shared/chatRoll';
import type { SystemJournalEntry, SystemJournalEntrySummary } from '../../../shared/journal';
import type {
  CharacterSheetJournalApi,
  CharacterSheetNetworkApi,
} from '../../../shared/journalWindows';
import {
  DND5E_SPELL_SLOT_LEVELS,
  MAX_DND5E_CHARACTER_SPELLS,
  type Dnd5eCharacterData,
  type Dnd5eCharacterSpellMutation,
  type Dnd5eCharacterSpellReference,
  type Dnd5eDerivedCharacterValues,
  type Dnd5eSpellPreparation,
  type Dnd5eSpellSlotLevel,
} from '../characterData';
import { DND5E_SPELL_ENTRY_TYPE_ID } from '../definition';
import {
  compileDnd5eSpellCast,
  type Dnd5eSpellCastMode,
} from '../spellCasting';
import {
  isDnd5eSpellData,
  type Dnd5eSpellData,
  type Dnd5eSpellLevel,
} from '../spellData';
import { CharacterSheetAddEntryButton } from './CharacterSheetAddEntryButton';
import styles from './CharacterSheetModal.module.css';

type SpellEntry = SystemJournalEntry & { data: Dnd5eSpellData };
type SpellEntryCache = Map<
  string,
  { entry: SpellEntry | null; revision: number }
>;

interface CharacterSpellPanelProps {
  campaignId: string;
  canEdit: boolean;
  characterEntryId: string;
  data: Dnd5eCharacterData;
  derived: Dnd5eDerivedCharacterValues;
  journalApi: CharacterSheetJournalApi;
  networkApi?: CharacterSheetNetworkApi;
  onConsumeSpellSlot: (
    level: Dnd5eSpellSlotLevel,
    compile: (
      character: Dnd5eCharacterData,
      derived: Dnd5eDerivedCharacterValues,
    ) => ChatRollDefinition | null,
  ) => Promise<ChatRollDefinition | null>;
  onCommitSpells: (
    mutations: readonly Dnd5eCharacterSpellMutation[],
  ) => Promise<boolean>;
  onError: (message: string) => void;
  onPreparedSummaryChange: (summary: {
    current: number;
    incomplete: boolean;
    overMaximum: boolean;
  }) => void;
  onRefundSpellSlot: (level: Dnd5eSpellSlotLevel) => Promise<boolean>;
  onSendRoll: (key: string, definition: Parameters<
    CharacterSheetNetworkApi['sendChatRoll']
  >[0]['definition']) => Promise<boolean>;
}

const PREPARATION_LABELS: Record<Dnd5eSpellPreparation, string> = {
  'always-prepared': 'Always Prepared',
  prepared: 'Prepared',
  unprepared: 'Unprepared',
};

function isSpellEntry(entry: unknown): entry is SpellEntry {
  return !!entry && typeof entry === 'object' &&
    (entry as SystemJournalEntry).kind === 'system' &&
    (entry as SystemJournalEntry).typeId === DND5E_SPELL_ENTRY_TYPE_ID &&
    isDnd5eSpellData((entry as SystemJournalEntry).data);
}

function levelLabel(level: Dnd5eSpellLevel): string {
  if (level === 0) return 'Cantrips';
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
  return `${level}${suffix} Level`;
}

function preparationAfter(state: Dnd5eSpellPreparation): Dnd5eSpellPreparation {
  return state === 'unprepared'
    ? 'prepared'
    : state === 'prepared'
      ? 'always-prepared'
      : 'unprepared';
}

function spellSearchText(entry: SpellEntry): string {
  const data = entry.data;
  return [
    entry.name,
    levelLabel(data.level),
    data.school,
    data.castingTime,
    ...data.classes,
    data.concentration ? 'concentration' : '',
    data.ritual ? 'ritual' : '',
    data.components.verbal ? 'verbal v' : '',
    data.components.somatic ? 'somatic s' : '',
    data.components.material ? 'material m' : '',
  ].join(' ').toLocaleLowerCase();
}

function sortedSpells(entries: readonly SpellEntry[]): SpellEntry[] {
  return [...entries].sort((left, right) =>
    left.data.level - right.data.level ||
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }),
  );
}

function castModeValue(mode: Dnd5eSpellCastMode): string {
  return mode.kind === 'slot' ? `slot:${mode.level}` : mode.kind;
}

function modeFromValue(value: string): Dnd5eSpellCastMode {
  if (value === 'ritual') return { kind: 'ritual' };
  if (value.startsWith('slot:')) {
    return {
      kind: 'slot',
      level: Number(value.slice(5)) as Exclude<Dnd5eSpellLevel, 0>,
    };
  }
  return { kind: 'without-slot' };
}

async function loadEntries(
  campaignId: string,
  summaries: readonly SystemJournalEntrySummary[],
  journalApi: CharacterSheetJournalApi,
  cache: SpellEntryCache,
): Promise<Map<string, SpellEntry | null>> {
  const results = new Map<string, SpellEntry | null>();
  let index = 0;
  const worker = async () => {
    while (index < summaries.length) {
      const summary = summaries[index++];
      const cached = cache.get(summary.id);
      if (cached?.revision === summary.revision) {
        results.set(summary.id, cached.entry);
        continue;
      }
      const result = await journalApi.getEntry({ campaignId, entryId: summary.id });
      const entry = result.ok && isSpellEntry(result.value) ? result.value : null;
      results.set(summary.id, entry);
      if (result.ok) cache.set(summary.id, { entry, revision: summary.revision });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, summaries.length) }, () => worker()),
  );
  return results;
}

export function CharacterSpellPanel({
  campaignId,
  canEdit,
  characterEntryId,
  data,
  derived,
  journalApi,
  networkApi,
  onConsumeSpellSlot,
  onCommitSpells,
  onError,
  onPreparedSummaryChange,
  onRefundSpellSlot,
  onSendRoll,
}: CharacterSpellPanelProps) {
  const [entries, setEntries] = useState<ReadonlyMap<string, SpellEntry | null>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerSelection, setPickerSelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [castChoice, setCastChoice] = useState<{
    mode: Dnd5eSpellCastMode;
    spellId: string;
  } | null>(null);
  const [castPending, setCastPending] = useState(false);
  const loadRequestRef = useRef(0);
  const menuRef = useRef<ContextMenuController | null>(null);
  const spellEntryCacheRef = useRef<SpellEntryCache>(new Map());
  const spellReferencesRef = useRef(data.spellcasting.spells);

  useEffect(() => {
    spellReferencesRef.current = data.spellcasting.spells;
  }, [data.spellcasting.spells]);

  useEffect(() => {
    menuRef.current = new ContextMenuController();
    return () => menuRef.current?.close();
  }, []);

  const refresh = useCallback(async () => {
    const request = ++loadRequestRef.current;
    const listed = await journalApi.list({ campaignId });
    if (request !== loadRequestRef.current) return;
    if (!listed.ok) {
      setLoadError(listed.error.message);
      setLoading(false);
      return;
    }
    const spellSummaries = listed.value.entries.filter(
      (entry): entry is SystemJournalEntrySummary =>
        entry.kind === 'system' && entry.typeId === DND5E_SPELL_ENTRY_TYPE_ID,
    );
    const loaded = await loadEntries(
      campaignId,
      spellSummaries,
      journalApi,
      spellEntryCacheRef.current,
    );
    if (request !== loadRequestRef.current) return;
    const referenceIds = new Set(
      spellReferencesRef.current.map(({ entryId }) => entryId),
    );
    const firstAccessible = sortedSpells(
      [...loaded.values()].filter((entry): entry is SpellEntry =>
        entry !== null && referenceIds.has(entry.id),
      ),
    )[0];
    setSelectedId((current) => current && referenceIds.has(current)
      ? current
      : firstAccessible?.id ?? null);
    setEntries(loaded);
    setLoadError(null);
    setLoading(false);
  }, [campaignId, journalApi]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void refresh();
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => journalApi.onChanged((event) => {
    if (
      event.campaignId === campaignId &&
      (!event.entryId || event.entryId !== characterEntryId)
    ) {
      void refresh();
    }
  }), [campaignId, characterEntryId, journalApi, refresh]);

  const referencesById = useMemo(
    () => new Map(data.spellcasting.spells.map((spell) => [spell.entryId, spell])),
    [data.spellcasting.spells],
  );
  const attachedEntries = useMemo(
    () => sortedSpells(
      data.spellcasting.spells
        .map(({ entryId }) => entries.get(entryId))
        .filter((entry): entry is SpellEntry => Boolean(entry)),
    ),
    [data.spellcasting.spells, entries],
  );
  const unavailable = useMemo(
    () => data.spellcasting.spells.filter(({ entryId }) => !entries.get(entryId)),
    [data.spellcasting.spells, entries],
  );

  const effectiveSelectedId = selectedId && referencesById.has(selectedId)
    ? selectedId
    : attachedEntries[0]?.id ?? null;
  const selected = effectiveSelectedId
    ? entries.get(effectiveSelectedId) ?? null
    : null;
  const selectedReference = effectiveSelectedId
    ? referencesById.get(effectiveSelectedId) ?? null
    : null;
  const preparedCurrent = data.spellcasting.spells.reduce((count, reference) => {
    const spell = entries.get(reference.entryId);
    return count + (
      reference.preparation === 'prepared' && spell && spell.data.level > 0 ? 1 : 0
    );
  }, 0);
  const unavailablePrepared = unavailable.some(
    ({ preparation }) => preparation === 'prepared',
  );
  const overPrepared = preparedCurrent > derived.spellcasting.preparedMaximum;

  useEffect(() => onPreparedSummaryChange({
    current: preparedCurrent,
    incomplete: unavailablePrepared,
    overMaximum: overPrepared,
  }), [
    onPreparedSummaryChange,
    overPrepared,
    preparedCurrent,
    unavailablePrepared,
  ]);

  const filteredEntries = useMemo(() => {
    const search = query.normalize('NFKC').trim().toLocaleLowerCase();
    return search
      ? attachedEntries.filter((entry) => spellSearchText(entry).includes(search))
      : attachedEntries;
  }, [attachedEntries, query]);
  const groupedEntries = useMemo(() => {
    const groups = new Map<Dnd5eSpellLevel, SpellEntry[]>();
    for (const entry of filteredEntries) {
      const group = groups.get(entry.data.level) ?? [];
      group.push(entry);
      groups.set(entry.data.level, group);
    }
    return groups;
  }, [filteredEntries]);

  const availableSlotLevels = useMemo(() => selected
    ? DND5E_SPELL_SLOT_LEVELS.filter((level) =>
        Number(level) >= selected.data.level &&
        data.spellcasting.slots[level].current > 0,
      )
    : [], [data.spellcasting.slots, selected]);

  const castMode = useMemo<Dnd5eSpellCastMode>(() => {
    if (!selected) return { kind: 'without-slot' };
    if (selected.data.level === 0) return { kind: 'cantrip' };
    const fallback: Dnd5eSpellCastMode = canEdit && availableSlotLevels.length > 0
      ? {
          kind: 'slot',
          level: Number(availableSlotLevels[0]) as Exclude<Dnd5eSpellLevel, 0>,
        }
      : { kind: 'without-slot' };
    if (castChoice?.spellId !== selected.id) return fallback;
    const chosen = castChoice.mode;
    return chosen.kind === 'without-slot' ||
      (chosen.kind === 'ritual' && selected.data.ritual) ||
      (chosen.kind === 'slot' &&
        canEdit &&
        availableSlotLevels.includes(String(chosen.level) as Dnd5eSpellSlotLevel))
      ? chosen
      : fallback;
  }, [availableSlotLevels, canEdit, castChoice, selected]);

  const compiled = useMemo(() => selected
    ? compileDnd5eSpellCast(selected.name, selected.data, data, derived, castMode)
    : null, [castMode, data, derived, selected]);

  const commitPreparation = async (
    reference: Dnd5eCharacterSpellReference,
  ) => {
    await onCommitSpells([{
      entryId: reference.entryId,
      kind: 'set-preparation',
      preparation: preparationAfter(reference.preparation),
    }]);
  };

  const openRemoveMenu = (
    event: MouseEvent,
    reference: Dnd5eCharacterSpellReference,
  ) => {
    event.preventDefault();
    let armedUntil = 0;
    menuRef.current?.open(event.clientX, event.clientY, 'Spell actions', [{
      danger: true,
      kind: 'action',
      label: 'Remove from Character',
      onSelect: (button) => {
        const now = Date.now();
        if (now > armedUntil) {
          armedUntil = now + DELETE_CONFIRMATION_TIMEOUT_MS;
          const expected = armedUntil;
          button.textContent = 'Confirm Remove from Character';
          button.setAttribute('aria-label', 'Confirm removal from character');
          button.setAttribute('aria-pressed', 'true');
          window.setTimeout(() => {
            if (button.isConnected && armedUntil === expected && Date.now() >= expected) {
              button.textContent = 'Remove from Character';
              button.setAttribute('aria-pressed', 'false');
            }
          }, DELETE_CONFIRMATION_TIMEOUT_MS);
          return false;
        }
        void onCommitSpells([{
          entryId: reference.entryId,
          kind: 'remove',
        }]);
      },
    }]);
  };

  const attachPickerSelection = async () => {
    const remaining = MAX_DND5E_CHARACTER_SPELLS - data.spellcasting.spells.length;
    const ids = [...pickerSelection].slice(0, Math.max(0, remaining));
    if (ids.length !== pickerSelection.size) {
      onError(`A character can reference at most ${MAX_DND5E_CHARACTER_SPELLS} spells.`);
      return;
    }
    const saved = await onCommitSpells(ids.map((entryId) => ({
      kind: 'add' as const,
      spell: { entryId, preparation: 'unprepared' as const },
    })));
    if (saved) {
      setPickerOpen(false);
      setPickerQuery('');
      setPickerSelection(new Set());
      if (ids[0]) setSelectedId(ids[0]);
    }
  };

  const cast = async () => {
    if (!selected || !compiled?.ok || castPending || !networkApi) return;
    setCastPending(true);
    try {
      const latest = await journalApi.getEntry({ campaignId, entryId: selected.id });
      if (!latest.ok || !isSpellEntry(latest.value)) {
        onError('This spell is no longer available.');
        await refresh();
        return;
      }
      const latestSpell = latest.value as SpellEntry;
      let definition: ChatRollDefinition;
      let consumedLevel: Dnd5eSpellSlotLevel | null = null;
      if (castMode.kind === 'slot') {
        if (!canEdit) {
          onError('Editing permission is required to consume a spell slot.');
          return;
        }
        const level = String(castMode.level) as Dnd5eSpellSlotLevel;
        const consumed = await onConsumeSpellSlot(
          level,
          (latestCharacter, latestDerived) => {
            const result = compileDnd5eSpellCast(
              latestSpell.name,
              latestSpell.data,
              latestCharacter,
              latestDerived,
              castMode,
            );
            if (result.ok) return result.definition;
            onError(result.issues[0]?.message ?? 'This spell cannot be cast.');
            return null;
          },
        );
        if (!consumed) return;
        definition = consumed;
        consumedLevel = level;
      } else {
        const latestCompiled = compileDnd5eSpellCast(
          latestSpell.name,
          latestSpell.data,
          data,
          derived,
          castMode,
        );
        if (!latestCompiled.ok) {
          onError(latestCompiled.issues[0]?.message ?? 'This spell cannot be cast.');
          return;
        }
        definition = latestCompiled.definition;
      }
      const sent = await onSendRoll(`spell:${selected.id}`, definition);
      if (!sent && consumedLevel) {
        const refunded = await onRefundSpellSlot(consumedLevel);
        onError(refunded
          ? 'The cast was not sent. The spell slot was refunded.'
          : 'The cast was not sent, and the spell slot could not be refunded.');
      }
    } finally {
      setCastPending(false);
    }
  };

  const pickerEntries = useMemo(() => {
    const search = pickerQuery.normalize('NFKC').trim().toLocaleLowerCase();
    return sortedSpells(
      [...entries.values()].filter((entry): entry is SpellEntry =>
        Boolean(entry) && (!search || spellSearchText(entry!).includes(search)),
      ),
    );
  }, [entries, pickerQuery]);

  return (
    <>
      <section className={styles.spellBrowser} aria-label="Character spells">
        <div className={styles.spellListPane}>
          <div className={styles.spellListToolbar}>
            <input
              aria-label="Search character spells"
              className={styles.spellSearchInput}
              placeholder="Search spells"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
            <CharacterSheetAddEntryButton
              aria-label="Add spells to character"
              disabled={!canEdit}
              label="+"
              onClick={() => setPickerOpen(true)}
            />
          </div>
          {overPrepared ? (
            <p className={styles.spellListWarning} role="status">
              Prepared spells exceed the current maximum.
            </p>
          ) : null}
          {unavailablePrepared ? (
            <p className={styles.spellListWarning} role="status">
              The count excludes unavailable Prepared spells.
            </p>
          ) : null}
          <div className={styles.spellList}>
            {loading ? <p className={styles.spellPanelState}>Loading spells…</p> : null}
            {loadError ? (
              <div className={styles.spellPanelState} role="alert">
                <p>{loadError}</p>
                <Button size="compact" onClick={() => {
                  setLoadError(null);
                  setLoading(true);
                  void refresh();
                }}>Retry</Button>
              </div>
            ) : null}
            {!loading && !loadError && data.spellcasting.spells.length === 0 ? (
              <p className={styles.spellPanelState}>No spells attached to this character.</p>
            ) : null}
            {!loading && !loadError && data.spellcasting.spells.length > 0 &&
              filteredEntries.length === 0 && unavailable.length === 0 ? (
                <p className={styles.spellPanelState}>No spells match this search.</p>
              ) : null}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => {
              const group = groupedEntries.get(level as Dnd5eSpellLevel);
              if (!group?.length) return null;
              return (
                <section className={styles.spellLevelGroup} key={level}>
                  <h3>{levelLabel(level as Dnd5eSpellLevel)}</h3>
                  {group.map((spell) => {
                    const reference = referencesById.get(spell.id)!;
                    const preparation = PREPARATION_LABELS[reference.preparation];
                    return (
                      <div
                        className={styles.spellListRow}
                        data-selected={effectiveSelectedId === spell.id}
                        key={spell.id}
                        onContextMenu={(event) => openRemoveMenu(event, reference)}
                      >
                        <button
                          aria-label={`View ${spell.name}`}
                          className={styles.spellSelectButton}
                          type="button"
                          onClick={() => setSelectedId(spell.id)}
                        >
                          <strong>{spell.name}</strong>
                          <span>{spell.data.level === 0 ? 'Cantrip' : levelLabel(spell.data.level)} · {spell.data.school} · {spell.data.castingTime}</span>
                        </button>
                        <Checkbox
                          aria-label={`${spell.name}: ${preparation}`}
                          checked={reference.preparation === 'prepared'}
                          className={styles.spellPreparationCheckbox}
                          disabled={!canEdit}
                          indeterminate={reference.preparation === 'always-prepared'}
                          title={preparation}
                          onChange={() => void commitPreparation(reference)}
                        >
                          <span className={styles.visuallyHidden}>{preparation}</span>
                        </Checkbox>
                      </div>
                    );
                  })}
                </section>
              );
            })}
            {unavailable.length > 0 && !query.trim() ? (
              <section className={styles.spellLevelGroup}>
                <h3>Unavailable</h3>
                {unavailable.map((reference) => (
                  <div
                    className={styles.spellListRow}
                    data-selected={effectiveSelectedId === reference.entryId}
                    key={reference.entryId}
                    onContextMenu={(event) => openRemoveMenu(event, reference)}
                  >
                    <button
                      aria-label="View unavailable spell"
                      className={styles.spellSelectButton}
                      type="button"
                      onClick={() => setSelectedId(reference.entryId)}
                    >
                      <strong>Unavailable spell</strong>
                      <span>Permission removed, deleted, or invalid</span>
                    </button>
                    <Checkbox
                      aria-label={`Unavailable spell: ${PREPARATION_LABELS[reference.preparation]}`}
                      checked={reference.preparation === 'prepared'}
                      className={styles.spellPreparationCheckbox}
                      disabled={!canEdit}
                      indeterminate={reference.preparation === 'always-prepared'}
                      onChange={() => void commitPreparation(reference)}
                    >
                      <span className={styles.visuallyHidden}>
                        {PREPARATION_LABELS[reference.preparation]}
                      </span>
                    </Checkbox>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        </div>

        <article className={styles.spellDetailPane} aria-label="Selected spell details">
          {selected ? (
            <>
              <header className={styles.spellDetailHeader}>
                <div>
                  <h2>{selected.name}</h2>
                  <p>{selected.data.level === 0 ? 'Cantrip' : levelLabel(selected.data.level)} · {selected.data.school}</p>
                </div>
                <div className={styles.spellCastControls}>
                  {selected.data.level > 0 ? (
                    <select
                      aria-label="Spell cast mode"
                      disabled={castPending}
                      value={castModeValue(castMode)}
                      onChange={(event) => setCastChoice({
                        mode: modeFromValue(event.currentTarget.value),
                        spellId: selected.id,
                      })}
                    >
                      {availableSlotLevels.map((level) => (
                        <option disabled={!canEdit} key={level} value={`slot:${level}`}>
                          Cast at {levelLabel(Number(level) as Dnd5eSpellLevel)} ({data.spellcasting.slots[level].current} available)
                        </option>
                      ))}
                      <option value="without-slot">Cast without slot</option>
                      {selected.data.ritual ? <option value="ritual">Cast as ritual</option> : null}
                    </select>
                  ) : null}
                  <Button
                    aria-busy={castPending}
                    disabled={castPending || !networkApi || !compiled?.ok}
                    size="compact"
                    onClick={() => void cast()}
                  >
                    Cast
                  </Button>
                </div>
              </header>
              {!compiled?.ok ? (
                <p className={styles.spellListWarning} role="status">
                  {compiled?.issues[0]?.message ?? 'This spell cannot be cast.'}
                </p>
              ) : null}
              <div className={styles.spellTags} aria-label="Spell tags">
                {selected.data.classes.map((className) => <span key={className}>{className}</span>)}
                {selected.data.concentration ? <span>Concentration</span> : null}
                {selected.data.ritual ? <span>Ritual</span> : null}
                {selected.data.components.verbal ? <span>V</span> : null}
                {selected.data.components.somatic ? <span>S</span> : null}
                {selected.data.components.material ? <span>M</span> : null}
              </div>
              <dl className={styles.spellMetadataGrid}>
                <div><dt>Casting Time</dt><dd>{selected.data.castingTime || '—'}</dd></div>
                <div><dt>Range</dt><dd>{selected.data.range || '—'}</dd></div>
                <div><dt>Target</dt><dd>{selected.data.target || '—'}</dd></div>
                <div><dt>Duration</dt><dd>{selected.data.duration || '—'}</dd></div>
                <div><dt>Preparation</dt><dd>{selectedReference ? PREPARATION_LABELS[selectedReference.preparation] : '—'}</dd></div>
              </dl>
              <div className={styles.spellDescription}>
                {selected.data.components.material && selected.data.components.materialDescription ? (
                  <section><h3>Material</h3><p>{selected.data.components.materialDescription}</p></section>
                ) : null}
                <section><h3>Description</h3><p>{selected.data.description || 'No description.'}</p></section>
                {selected.data.higherLevelDescription ? (
                  <section><h3>Higher-Level Casting</h3><p>{selected.data.higherLevelDescription}</p></section>
                ) : null}
              </div>
            </>
          ) : effectiveSelectedId ? (
            <p className={styles.spellPanelState}>This spell is unavailable.</p>
          ) : (
            <p className={styles.spellPanelState}>
              Select a spell to view its details.
            </p>
          )}
        </article>
      </section>

      <Modal
        accessibleLabel="Add spells to character"
        isOpen={pickerOpen}
        onDismiss={() => {
          setPickerOpen(false);
          setPickerSelection(new Set());
        }}
      >
        <div className={styles.spellPicker}>
          <h2>Add Spells</h2>
          <input
            aria-label="Search available spells"
            className={styles.spellSearchInput}
            placeholder="Search available spells"
            type="search"
            value={pickerQuery}
            onChange={(event) => setPickerQuery(event.currentTarget.value)}
          />
          <div className={styles.spellPickerList}>
            {pickerEntries.length > 0 ? pickerEntries.map((spell) => {
              const attached = referencesById.has(spell.id);
              return (
                <Checkbox
                  checked={attached || pickerSelection.has(spell.id)}
                  disabled={attached}
                  key={spell.id}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setPickerSelection((current) => {
                      const next = new Set(current);
                      if (checked) next.add(spell.id);
                      else next.delete(spell.id);
                      return next;
                    });
                  }}
                >
                  <span>
                    <strong>{spell.name}</strong>
                    {' — '}{spell.data.level === 0 ? 'Cantrip' : levelLabel(spell.data.level)} {spell.data.school}
                    {attached ? ' (Already added)' : ''}
                  </span>
                </Checkbox>
              );
            }) : <p>No visible spells match this search.</p>}
          </div>
          <div className={styles.spellPickerActions}>
            <Button onClick={() => {
              setPickerOpen(false);
              setPickerSelection(new Set());
            }}>Cancel</Button>
            <Button
              disabled={pickerSelection.size === 0}
              variant="primary"
              onClick={() => void attachPickerSelection()}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
