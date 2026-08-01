import { useState, type KeyboardEvent } from 'react';
import { FormField, TextInput } from '../../components/ui/FormField';
import styles from './ToolSettingsControls.module.css';

const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function handleFieldKeyDown(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

export function ColorControl({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [edit, setEdit] = useState({ base: value, text: value });
  const draft = edit.base === value ? edit.text : value;
  const revert = () => setEdit({ base: value, text: value });
  const commit = () => {
    const candidate = draft.trim().toLowerCase();
    if (!COLOR_PATTERN.test(candidate) || candidate === value) {
      revert();
      return;
    }
    onChange(candidate);
  };

  return (
    <FormField
      className={styles.field}
      htmlFor={`${id}-text`}
      label={label}
      showLabel
    >
      <div className={styles.colorRow}>
        <label
          aria-label={`${label} picker`}
          className={styles.colorSwatch}
          htmlFor={`${id}-picker`}
          style={{ backgroundColor: value }}
        >
          <input
            id={`${id}-picker`}
            type="color"
            value={value}
            onChange={(event) => onChange(event.currentTarget.value)}
          />
        </label>
        <TextInput
          autoComplete="off"
          className={styles.hexInput}
          id={`${id}-text`}
          maxLength={7}
          spellCheck={false}
          value={draft}
          onBlur={commit}
          onChange={(event) =>
            setEdit({ base: value, text: event.currentTarget.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              revert();
              return;
            }
            handleFieldKeyDown(event);
          }}
        />
      </div>
    </FormField>
  );
}

export function NumberControl({
  id,
  label,
  max,
  min,
  onChange,
  suffix,
  value,
}: {
  id: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix: string;
  value: number;
}) {
  const [edit, setEdit] = useState({ base: value, text: String(value) });
  const draft = edit.base === value ? edit.text : String(value);
  const revert = () => setEdit({ base: value, text: String(value) });
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(parsed)) {
      revert();
      return;
    }
    const next = Math.min(max, Math.max(min, Math.round(parsed)));
    if (next === value) {
      revert();
      return;
    }
    onChange(next);
  };

  return (
    <FormField className={styles.field} htmlFor={id} label={label} showLabel>
      <span className={styles.numberShell}>
        <TextInput
          className={styles.numberInput}
          id={id}
          inputMode="numeric"
          max={max}
          min={min}
          step={1}
          type="number"
          value={draft}
          onBlur={commit}
          onChange={(event) =>
            setEdit({ base: value, text: event.currentTarget.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              revert();
              return;
            }
            handleFieldKeyDown(event);
          }}
        />
        <span aria-hidden>{suffix}</span>
      </span>
    </FormField>
  );
}
