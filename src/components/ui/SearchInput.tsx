import { Search, X } from 'lucide-react';
import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { DefaultInput } from './DefaultInput';
import { IconButton } from './IconButton';
import styles from './SearchInput.module.css';

interface SearchInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'className' | 'onChange' | 'style' | 'type'
  > {
  clearLabel?: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}

export function SearchInput({
  clearLabel,
  disabled,
  label,
  onChange,
  onKeyDown,
  readOnly,
  value,
  ...props
}: SearchInputProps) {
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(event.currentTarget.value);
  };

  return (
    <div className={styles.search}>
      <Search aria-hidden className={styles.searchIcon} size="1rem" />
      <DefaultInput
        {...props}
        aria-label={label}
        disabled={disabled}
        hasEndAdornment={value.length > 0}
        hasStartAdornment
        readOnly={readOnly}
        type="search"
        value={value}
        onChange={change}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value.length > 0 && !readOnly) {
            event.preventDefault();
            onChange('');
          }
          onKeyDown?.(event);
        }}
      />
      {value.length > 0 && !readOnly ? (
        <span className={styles.clear}>
          <IconButton
            disabled={disabled}
            icon={X}
            label={clearLabel ?? `Clear ${label.toLowerCase()}`}
            variant="embedded"
            onClick={() => onChange('')}
          />
        </span>
      ) : null}
    </div>
  );
}
