import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Checkbox } from '../../../components/ui/Checkbox';
import { FormField, SelectInput, TextInput } from '../../../components/ui/FormField';
import { Modal } from '../../../components/ui/Modal';
import type { CampaignSystemState, JsonValue } from '../../../shared/gameSystems';
import {
  JOURNAL_AUTOSAVE_DELAY_MS,
  MAX_JOURNAL_TITLE_INPUT_CODE_UNITS,
  normalizeJournalTitle,
  type JournalApi,
  type JournalEntry,
  type SystemJournalEntry,
} from '../../../shared/journal';
import type { NetworkApi } from '../../../shared/network';
import { DND5E_5_5E_CLASSES } from '../characterData';
import { DND5E_SPELL_ENTRY_TYPE_ID } from '../definition';
import {
  DND5E_SPELL_LEVELS,
  DND5E_SPELL_SCHOOLS,
  MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS,
  MAX_DND5E_SPELL_FIELD_CODE_UNITS,
  applyDnd5eSpellRollStepMutations,
  createDefaultDnd5eSpellData,
  isDnd5eSpellData,
  type Dnd5eSpellData,
  type Dnd5eSpellLevel,
  type Dnd5eSpellRollStepMutation,
  type Dnd5eSpellSchool,
  type Dnd5eSpellValueTerm,
} from '../spellData';
import {
  SpellRollActionEditor,
  spellRollStepMutationTarget,
} from './SpellRollActionEditor';
import styles from './SpellSheetModal.module.css';

export interface SpellSheetModalProps {
  campaignId: string;
  entry: SystemJournalEntry;
  journalApi: JournalApi;
  networkApi?: NetworkApi;
  onDismiss: () => void;
  onUpdated: (entry: SystemJournalEntry) => void;
  system: CampaignSystemState;
}

type SpellEntry = SystemJournalEntry & { data: Dnd5eSpellData };
type SpellFieldValue = JsonValue;

function isSpellEntry(entry: JournalEntry): entry is SpellEntry {
  return entry.kind === 'system' &&
    entry.typeId === DND5E_SPELL_ENTRY_TYPE_ID &&
    isDnd5eSpellData(entry.data);
}

function parseSpellEntry(entry: JournalEntry): SpellEntry | null {
  return isSpellEntry(entry) ? entry : null;
}

function readField(data: Dnd5eSpellData, path: string): SpellFieldValue {
  let value: unknown = data;
  for (const part of path.split('.')) {
    value = (value as Record<string, unknown>)[part];
  }
  return structuredClone(value as SpellFieldValue);
}

function writeField(
  data: Dnd5eSpellData,
  path: string,
  value: SpellFieldValue,
): Dnd5eSpellData {
  const next = structuredClone(data);
  const parts = path.split('.');
  let target = next as unknown as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    target = target[part] as Record<string, unknown>;
  }
  target[parts.at(-1)!] = structuredClone(value);
  return next;
}

function sameValue(left: SpellFieldValue, right: SpellFieldValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeDraft(
  data: Dnd5eSpellData,
  fields: ReadonlyMap<string, SpellFieldValue>,
  mutations: readonly Dnd5eSpellRollStepMutation[],
) {
  let next = structuredClone(data);
  for (const [path, value] of fields) next = writeField(next, path, value);
  const applied = applyDnd5eSpellRollStepMutations(next.rollSteps, mutations);
  return {
    data: { ...next, rollSteps: applied.steps },
    missingIds: applied.missingIds,
  };
}

function levelLabel(level: Dnd5eSpellLevel): string {
  return level === 0 ? 'Cantrip' : `${level}${level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th'} Level`;
}

function classCountLabel(count: number): string {
  return count === 0 ? 'No Classes' : count === 1 ? '1 Class' : `${count} Classes`;
}

function normalizeStepsForLevel(data: Dnd5eSpellData, level: Dnd5eSpellLevel) {
  return data.rollSteps.map((step) => {
    if (!('terms' in step)) return step;
    const terms = step.terms.map((term): Dnd5eSpellValueTerm => {
      if (level === 0 && term.kind === 'cast-level') {
        return { kind: 'flat', value: 0 };
      }
      if (level === 0 && term.kind === 'dice' && term.scaling === 'cast-level') {
        return { ...term, scaling: 'fixed', tiers: [] };
      }
      return term;
    });
    return { ...step, terms };
  });
}

export function SpellSheetModal({
  campaignId,
  entry,
  journalApi,
  onDismiss,
  onUpdated,
}: SpellSheetModalProps) {
  const normalized = parseSpellEntry(entry);
  const initialEntry = normalized ?? entry;
  const initialData = normalized
    ? structuredClone(normalized.data)
    : createDefaultDnd5eSpellData();
  const [current, setCurrent] = useState(initialEntry);
  const [draft, setDraft] = useState(initialData);
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(
    normalized ? null : 'The Spell data returned by the campaign is invalid.',
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const currentRef = useRef(initialEntry);
  const draftRef = useRef(initialData);
  const nameRef = useRef(entry.name);
  const dirtyFieldsRef = useRef(new Map<string, SpellFieldValue>());
  const rollMutationsRef = useRef<Dnd5eSpellRollStepMutation[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const saveQueueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const refreshRequestRef = useRef(0);

  const canEdit = isSpellEntry(current) && current.capabilities.edit;
  const hasDirtyDraft = useCallback(() =>
    dirtyFieldsRef.current.size > 0 ||
    rollMutationsRef.current.length > 0 ||
    nameRef.current !== currentRef.current.name,
  []);

  const discardPending = useCallback((updated: SpellEntry) => {
    dirtyFieldsRef.current.clear();
    rollMutationsRef.current = [];
    nameRef.current = updated.name;
    setName(updated.name);
    draftRef.current = structuredClone(updated.data);
    setDraft(structuredClone(updated.data));
  }, []);

  const applyServerEntry = useCallback((
    updated: SystemJournalEntry,
    savedFields?: ReadonlyMap<string, SpellFieldValue>,
    savedMutations?: readonly Dnd5eSpellRollStepMutation[],
    savedName?: string,
  ): boolean => {
    const nextEntry = parseSpellEntry(updated);
    if (!nextEntry) {
      setError('The Spell data returned by the campaign is invalid.');
      return false;
    }
    const editRevoked = currentRef.current.capabilities.edit && !nextEntry.capabilities.edit;
    if (editRevoked) {
      discardPending(nextEntry);
      currentRef.current = nextEntry;
      setCurrent(nextEntry);
      setNotice('Edit access was removed. Unsaved changes were discarded and this Spell is now read-only.');
      setError(null);
      onUpdated(nextEntry);
      return true;
    }
    if (savedFields) {
      for (const [path, value] of savedFields) {
        const pending = dirtyFieldsRef.current.get(path);
        if (pending !== undefined && sameValue(pending, value)) {
          dirtyFieldsRef.current.delete(path);
        }
      }
    }
    if (savedMutations) {
      const saved = new Set(savedMutations);
      rollMutationsRef.current = rollMutationsRef.current.filter(
        (mutation) => !saved.has(mutation),
      );
    }
    const pendingName = nameRef.current;
    const nameWasDirty = pendingName !== currentRef.current.name;
    const nextName = savedName !== undefined && normalizeJournalTitle(pendingName) === savedName
      ? nextEntry.name
      : nameWasDirty
        ? pendingName
        : nextEntry.name;
    nameRef.current = nextName;
    setName(nextName);
    currentRef.current = nextEntry;
    setCurrent(nextEntry);

    let merged = mergeDraft(
      nextEntry.data,
      dirtyFieldsRef.current,
      rollMutationsRef.current,
    );
    if (merged.missingIds.length > 0) {
      const missing = new Set(merged.missingIds);
      rollMutationsRef.current = rollMutationsRef.current.filter((mutation) => {
        const target = spellRollStepMutationTarget(mutation);
        return target === null || !missing.has(target);
      });
      merged = mergeDraft(
        nextEntry.data,
        dirtyFieldsRef.current,
        rollMutationsRef.current,
      );
      setNotice('A Roll Action was deleted remotely, so its pending local edit was discarded.');
    }
    if (!isDnd5eSpellData(merged.data)) {
      setError('Pending changes could not be applied to the latest Spell.');
      return false;
    }
    draftRef.current = merged.data;
    setDraft(merged.data);
    onUpdated(nextEntry);
    return true;
  }, [discardPending, onUpdated]);

  const refreshCurrent = useCallback(async () => {
    const request = ++refreshRequestRef.current;
    const result = await journalApi.getEntry({
      campaignId,
      entryId: currentRef.current.id,
    });
    if (request !== refreshRequestRef.current) return;
    if (!result.ok) {
      if (result.error.code === 'not_found' || result.error.code === 'permission_denied') {
        onDismiss();
      } else {
        setError(result.error.message);
      }
      return;
    }
    if (result.value.kind !== 'system') {
      setError('The Spell entry returned by the campaign is invalid.');
      return;
    }
    if (result.value.revision >= currentRef.current.revision ||
      result.value.permissionRevision >= currentRef.current.permissionRevision) {
      applyServerEntry(result.value);
    }
  }, [applyServerEntry, campaignId, journalApi, onDismiss]);

  const save = useCallback(async function persistDraft(): Promise<boolean> {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (saveInFlightRef.current) {
      const saved = await saveInFlightRef.current;
      return saved ? persistDraft() : false;
    }
    const active = currentRef.current;
    if (!active.capabilities.edit || !isSpellEntry(active)) return true;
    const fields = new Map(dirtyFieldsRef.current);
    let rollMutations = [...rollMutationsRef.current];
    const pendingName = normalizeJournalTitle(nameRef.current);
    if (pendingName.length === 0) {
      setError('Spell Name is required.');
      return false;
    }
    const nameChanged = pendingName !== active.name;
    if (fields.size === 0 && rollMutations.length === 0 && !nameChanged) {
      if (nameRef.current !== active.name) {
        nameRef.current = active.name;
        setName(active.name);
      }
      return saveQueueRef.current;
    }

    const queued = saveQueueRef.current.then(async () => {
      let next = currentRef.current;
      if (!isSpellEntry(next) || !next.capabilities.edit) return false;
      if (fields.size > 0 || rollMutations.length > 0) {
        let merged = mergeDraft(next.data, fields, rollMutations);
        if (merged.missingIds.length > 0) {
          const missing = new Set(merged.missingIds);
          rollMutations = rollMutations.filter((mutation) => {
            const target = spellRollStepMutationTarget(mutation);
            return target === null || !missing.has(target);
          });
          rollMutationsRef.current = rollMutationsRef.current.filter((mutation) => {
            const target = spellRollStepMutationTarget(mutation);
            return target === null || !missing.has(target);
          });
          merged = mergeDraft(next.data, fields, rollMutations);
          setNotice('A Roll Action was deleted remotely, so its pending local edit was discarded.');
        }
        if (!isDnd5eSpellData(merged.data)) {
          setError('The Spell data is invalid.');
          return false;
        }
        let result = fields.size > 0 || rollMutations.length > 0
          ? await journalApi.updateEntryData({
              campaignId,
              data: merged.data,
              entryId: next.id,
              expectedRevision: next.revision,
            })
          : { ok: true as const, value: next };
        if (!result.ok && result.error.code === 'conflict') {
          const refreshed = await journalApi.getEntry({ campaignId, entryId: next.id });
          const refreshedSpell = refreshed.ok ? parseSpellEntry(refreshed.value) : null;
          if (!refreshed.ok || !refreshedSpell) {
            setError(refreshed.ok
              ? 'The Spell data returned by the campaign is invalid.'
              : refreshed.error.message);
            return false;
          }
          if (!applyServerEntry(refreshedSpell)) return false;
          merged = mergeDraft(refreshedSpell.data, fields, rollMutations);
          if (merged.missingIds.length > 0) {
            const missing = new Set(merged.missingIds);
            rollMutations = rollMutations.filter((mutation) => {
              const target = spellRollStepMutationTarget(mutation);
              return target === null || !missing.has(target);
            });
            merged = mergeDraft(refreshedSpell.data, fields, rollMutations);
            setNotice('A Roll Action was deleted remotely, so its pending local edit was discarded.');
          }
          if (!isDnd5eSpellData(merged.data)) {
            setError('The Spell data is invalid.');
            return false;
          }
          result = fields.size > 0 || rollMutations.length > 0
            ? await journalApi.updateEntryData({
                campaignId,
                data: merged.data,
                entryId: refreshedSpell.id,
                expectedRevision: refreshedSpell.revision,
              })
            : { ok: true as const, value: refreshedSpell };
        }
        if (!result.ok || result.value.kind !== 'system') {
          setError(result.ok
            ? 'The Spell entry returned by the campaign is invalid.'
            : result.error.message);
          return false;
        }
        if (!applyServerEntry(result.value, fields, rollMutations)) return false;
      }

      next = currentRef.current;
      if (pendingName !== next.name) {
        let result = await journalApi.renameEntry({
          campaignId,
          entryId: next.id,
          expectedRevision: next.revision,
          name: pendingName,
        });
        if (!result.ok && result.error.code === 'conflict') {
          const refreshed = await journalApi.getEntry({ campaignId, entryId: next.id });
          const refreshedSpell = refreshed.ok ? parseSpellEntry(refreshed.value) : null;
          if (!refreshed.ok || !refreshedSpell) {
            setError(refreshed.ok
              ? 'The Spell data returned by the campaign is invalid.'
              : refreshed.error.message);
            return false;
          }
          if (!applyServerEntry(refreshedSpell)) return false;
          result = await journalApi.renameEntry({
            campaignId,
            entryId: refreshedSpell.id,
            expectedRevision: refreshedSpell.revision,
            name: pendingName,
          });
        }
        if (!result.ok || result.value.kind !== 'system') {
          setError(result.ok
            ? 'The Spell entry returned by the campaign is invalid.'
            : result.error.message);
          return false;
        }
        if (!applyServerEntry(result.value, undefined, undefined, pendingName)) return false;
      }
      setError(null);
      return true;
    });
    saveQueueRef.current = queued.catch(() => false);
    saveInFlightRef.current = queued;
    try {
      return await queued;
    } finally {
      if (saveInFlightRef.current === queued) saveInFlightRef.current = null;
    }
  }, [applyServerEntry, campaignId, journalApi]);

  const changeField = (path: string, value: SpellFieldValue): boolean => {
    const next = writeField(draftRef.current, path, value);
    if (!isDnd5eSpellData(next)) return false;
    draftRef.current = next;
    setDraft(next);
    const saved = isSpellEntry(currentRef.current)
      ? readField(currentRef.current.data, path)
      : null;
    if (sameValue(value, saved)) dirtyFieldsRef.current.delete(path);
    else dirtyFieldsRef.current.set(path, structuredClone(value));
    return true;
  };

  const commitField = (path: string, value: SpellFieldValue) => {
    if (changeField(path, value)) void save();
  };

  const changeRollStep = (mutation: Dnd5eSpellRollStepMutation): boolean => {
    const applied = applyDnd5eSpellRollStepMutations(draftRef.current.rollSteps, [mutation]);
    if (applied.missingIds.length > 0) {
      setError('The Roll Action no longer exists.');
      return false;
    }
    const next = { ...draftRef.current, rollSteps: applied.steps };
    if (!isDnd5eSpellData(next)) return false;
    rollMutationsRef.current.push(mutation);
    draftRef.current = next;
    setDraft(next);
    return true;
  };

  const commitRollStep = async (mutation: Dnd5eSpellRollStepMutation) =>
    changeRollStep(mutation) && save();

  const changeLevel = (level: Dnd5eSpellLevel) => {
    const prior = draftRef.current;
    const steps = normalizeStepsForLevel(prior, level);
    const next = { ...prior, level, rollSteps: steps };
    if (!isDnd5eSpellData(next)) return;
    draftRef.current = next;
    setDraft(next);
    const savedLevel = isSpellEntry(currentRef.current)
      ? currentRef.current.data.level
      : null;
    if (level === savedLevel) dirtyFieldsRef.current.delete('level');
    else dirtyFieldsRef.current.set('level', level);
    for (let index = 0; index < steps.length; index += 1) {
      if (sameValue(steps[index] as unknown as JsonValue, prior.rollSteps[index] as unknown as JsonValue)) {
        continue;
      }
      changeRollStep({
        id: steps[index].id,
        kind: 'update',
        step: steps[index],
      });
    }
    void save();
  };

  const toggleClass = (className: (typeof DND5E_5_5E_CLASSES)[number]) => {
    const classes = draftRef.current.classes.includes(className)
      ? draftRef.current.classes.filter((candidate) => candidate !== className)
      : [...draftRef.current.classes, className];
    commitField('classes', classes);
  };

  useEffect(() => {
    if (!canEdit || !hasDirtyDraft()) return undefined;
    saveTimerRef.current = window.setTimeout(
      () => void save(),
      JOURNAL_AUTOSAVE_DELAY_MS,
    );
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [canEdit, draft, hasDirtyDraft, name, save]);

  useEffect(() => journalApi.onChanged((event) => {
    if (
      event.campaignId === campaignId &&
      (!event.entryId || event.entryId === currentRef.current.id)
    ) {
      void refreshCurrent();
    }
  }), [campaignId, journalApi, refreshCurrent]);

  useEffect(() => {
    if (
      entry.revision > currentRef.current.revision ||
      entry.permissionRevision > currentRef.current.permissionRevision
    ) {
      applyServerEntry(entry);
    }
  }, [applyServerEntry, entry]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
  }, []);

  const close = useCallback(async () => {
    if (closing) return;
    setClosing(true);
    const saved = !hasDirtyDraft() || await save();
    if (saved) onDismiss();
    else setClosing(false);
  }, [closing, hasDirtyDraft, onDismiss, save]);

  return (
    <Modal
      accessibleLabel={`${current.name} spell sheet`}
      className={styles.modal}
      contentClassName={styles.content}
      dismissDisabled={closing}
      initialFocus="dialog"
      isOpen
      onDismiss={() => void close()}
    >
      <main className={styles.sheet}>
        {notice ? <div className={styles.notice} role="status">{notice}</div> : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}

        <FormField htmlFor={`spell-${entry.id}-name`} label="Spell Name" showLabel>
          <TextInput
            id={`spell-${entry.id}-name`}
            autoComplete="off"
            maxLength={MAX_JOURNAL_TITLE_INPUT_CODE_UNITS}
            readOnly={!canEdit}
            value={name}
            onBlur={() => void save()}
            onChange={(event) => {
              nameRef.current = event.currentTarget.value;
              setName(event.currentTarget.value);
            }}
          />
        </FormField>

        <div className={styles.primaryMetadataGrid}>
          <FormField htmlFor={`spell-${entry.id}-level`} label="Level" showLabel>
            <SelectInput
              id={`spell-${entry.id}-level`}
              disabled={!canEdit}
              value={draft.level}
              onChange={(event) => changeLevel(Number(event.currentTarget.value) as Dnd5eSpellLevel)}
            >
              {DND5E_SPELL_LEVELS.map((level) => (
                <option key={level} value={level}>{levelLabel(level)}</option>
              ))}
            </SelectInput>
          </FormField>
          <FormField htmlFor={`spell-${entry.id}-school`} label="School" showLabel>
            <SelectInput
              id={`spell-${entry.id}-school`}
              disabled={!canEdit}
              value={draft.school}
              onChange={(event) => commitField('school', event.currentTarget.value as Dnd5eSpellSchool)}
            >
              {DND5E_SPELL_SCHOOLS.map((school) => (
                <option key={school} value={school}>{school}</option>
              ))}
            </SelectInput>
          </FormField>
          <FormField htmlFor={`spell-${entry.id}-classes`} label="Classes" showLabel>
            <SpellClassPicker
              classes={draft.classes}
              disabled={!canEdit}
              id={`spell-${entry.id}-classes`}
              key={canEdit ? 'editable-classes' : 'read-only-classes'}
              onClear={() => commitField('classes', [])}
              onToggle={toggleClass}
            />
            {!canEdit ? (
              <p className={styles.classSummary}>
                {draft.classes.length > 0 ? draft.classes.join(', ') : 'No Classes'}
              </p>
            ) : null}
          </FormField>
        </div>

        <div className={styles.secondaryMetadataGrid}>
          <SpellTextField
            id={`spell-${entry.id}-target`}
            label="Target"
            readOnly={!canEdit}
            value={draft.target}
            onBlur={() => void save()}
            onChange={(value) => changeField('target', value)}
          />
          <SpellTextField
            id={`spell-${entry.id}-range`}
            label="Range"
            readOnly={!canEdit}
            value={draft.range}
            onBlur={() => void save()}
            onChange={(value) => changeField('range', value)}
          />
          <SpellTextField
            id={`spell-${entry.id}-duration`}
            label="Duration"
            readOnly={!canEdit}
            value={draft.duration}
            onBlur={() => void save()}
            onChange={(value) => changeField('duration', value)}
          />
          <SpellTextField
            id={`spell-${entry.id}-casting-time`}
            label="Casting Time"
            readOnly={!canEdit}
            value={draft.castingTime}
            onBlur={() => void save()}
            onChange={(value) => changeField('castingTime', value)}
          />
        </div>

        <fieldset className={styles.components}>
          <legend>Spell Options and Components</legend>
          <Checkbox
            checked={draft.concentration}
            disabled={!canEdit}
            onChange={(event) => commitField('concentration', event.currentTarget.checked)}
          >
            Concentration
          </Checkbox>
          <Checkbox
            checked={draft.ritual}
            disabled={!canEdit}
            onChange={(event) => commitField('ritual', event.currentTarget.checked)}
          >
            Ritual
          </Checkbox>
          <Checkbox
            checked={draft.components.verbal}
            disabled={!canEdit}
            onChange={(event) => commitField('components.verbal', event.currentTarget.checked)}
          >
            Verbal
          </Checkbox>
          <Checkbox
            checked={draft.components.somatic}
            disabled={!canEdit}
            onChange={(event) => commitField('components.somatic', event.currentTarget.checked)}
          >
            Somatic
          </Checkbox>
          <Checkbox
            checked={draft.components.material}
            disabled={!canEdit}
            onChange={(event) => commitField('components.material', event.currentTarget.checked)}
          >
            Material
          </Checkbox>
        </fieldset>

        {draft.components.material ? (
          <SpellTextField
            id={`spell-${entry.id}-material`}
            label="Material Description"
            readOnly={!canEdit}
            value={draft.components.materialDescription}
            onBlur={() => void save()}
            onChange={(value) => changeField('components.materialDescription', value)}
          />
        ) : null}

        <SpellTextarea
          id={`spell-${entry.id}-description`}
          label="Spell Description"
          readOnly={!canEdit}
          value={draft.description}
          onBlur={() => void save()}
          onChange={(value) => changeField('description', value)}
        />
        <SpellTextarea
          className={styles.higherLevelTextarea}
          id={`spell-${entry.id}-higher-level`}
          label="Higher-Level Casting"
          readOnly={!canEdit}
          value={draft.higherLevelDescription}
          onBlur={() => void save()}
          onChange={(value) => changeField('higherLevelDescription', value)}
        />

        <SpellRollActionEditor
          canEdit={canEdit}
          level={draft.level}
          steps={draft.rollSteps}
          onChange={changeRollStep}
          onCommit={commitRollStep}
          onError={setError}
          onSave={save}
        />
      </main>
    </Modal>
  );
}

function SpellClassPicker({
  classes,
  disabled,
  id,
  onClear,
  onToggle,
}: {
  classes: Dnd5eSpellData['classes'];
  disabled: boolean;
  id: string;
  onClear: () => void;
  onToggle: (className: (typeof DND5E_5_5E_CLASSES)[number]) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={styles.classPicker}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        aria-controls={`${id}-options`}
        aria-expanded={open}
        aria-label="Spell classes"
        className={styles.classTrigger}
        disabled={disabled}
        title="Spell classes"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{classCountLabel(classes.length)}</span>
        <ChevronDown aria-hidden size="0.9rem" strokeWidth={1.7} />
      </button>
      {open ? (
        <div
          aria-label="Spell class options"
          className={styles.classPickerPanel}
          id={`${id}-options`}
          role="group"
        >
          <div className={styles.classOptions} id={id}>
            {DND5E_5_5E_CLASSES.map((className) => (
              <Checkbox
                checked={classes.includes(className)}
                disabled={disabled}
                key={className}
                onChange={() => onToggle(className)}
              >
                {className}
              </Checkbox>
            ))}
            <Button
              disabled={disabled || classes.length === 0}
              size="compact"
              onClick={onClear}
            >
              Clear All
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SpellTextField({
  id,
  label,
  onBlur,
  onChange,
  readOnly,
  value,
}: {
  id: string;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  readOnly: boolean;
  value: string;
}) {
  return (
    <FormField htmlFor={id} label={label} showLabel>
      <TextInput
        id={id}
        maxLength={MAX_DND5E_SPELL_FIELD_CODE_UNITS}
        readOnly={readOnly}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </FormField>
  );
}

function SpellTextarea({
  className,
  id,
  label,
  onBlur,
  onChange,
  readOnly,
  value,
}: {
  className?: string;
  id: string;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  readOnly: boolean;
  value: string;
}) {
  return (
    <FormField htmlFor={id} label={label} showLabel>
      <textarea
        className={[styles.textarea, className].filter(Boolean).join(' ')}
        id={id}
        maxLength={MAX_DND5E_SPELL_DESCRIPTION_CODE_UNITS}
        readOnly={readOnly}
        value={value}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </FormField>
  );
}
