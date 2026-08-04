import type { CSSProperties } from 'react';
import type {
  JournalFontFamily,
  JournalTitleStyle,
} from '../../../shared/journal';

export const JOURNAL_FONT_OPTIONS: ReadonlyArray<{
  cssFamily: string | null;
  label: string;
  value: JournalFontFamily;
}> = [
  { cssFamily: null, label: 'Default', value: 'default' },
  { cssFamily: '"Inter Variable"', label: 'Inter', value: 'inter' },
  { cssFamily: '"Lora Variable"', label: 'Lora', value: 'lora' },
  { cssFamily: '"Cinzel Variable"', label: 'Cinzel', value: 'cinzel' },
  { cssFamily: '"Noto Sans Variable"', label: 'Noto Sans', value: 'noto-sans' },
  { cssFamily: '"Noto Sans SC Variable"', label: 'Noto Sans SC', value: 'noto-sans-sc' },
  { cssFamily: '"Roboto Mono Variable"', label: 'Roboto Mono', value: 'roboto-mono' },
  { cssFamily: '"Unifont"', label: 'Unifont', value: 'unifont' },
];

export function journalFontCss(value: JournalFontFamily): string | null {
  return JOURNAL_FONT_OPTIONS.find((option) => option.value === value)?.cssFamily ?? null;
}

export function journalFontValue(cssFamily: unknown): JournalFontFamily {
  if (typeof cssFamily !== 'string') return 'default';
  const normalized = cssFamily.replaceAll('"', '').trim().toLocaleLowerCase();
  return JOURNAL_FONT_OPTIONS.find(
    (option) => option.cssFamily?.replaceAll('"', '').toLocaleLowerCase() === normalized,
  )?.value ?? 'default';
}

export function journalTitleStyleProperties(style: JournalTitleStyle): CSSProperties {
  const decorations = [
    style.underline ? 'underline' : '',
    style.strike ? 'line-through' : '',
  ].filter(Boolean).join(' ');
  return {
    color: style.color ?? undefined,
    fontFamily: journalFontCss(style.fontFamily) ?? undefined,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontWeight: style.bold ? 600 : 400,
    textAlign: style.alignment === 'default' ? undefined : style.alignment,
    textDecoration: decorations || 'none',
  };
}
