import { z } from 'zod';

export const MAX_TOKEN_INSPECTOR_FIELDS = 256;
export const MAX_TOKEN_INSPECTOR_FIELD_ID_CODE_UNITS = 128;
export const MAX_TOKEN_INSPECTOR_FIELD_LABEL_CODE_UNITS = 128;
export const MAX_TOKEN_INSPECTOR_VALUE_CODE_UNITS = 128;

export type TokenInspectorFieldEditor = 'command' | 'text';

export interface TokenInspectorFieldRoll {
  label: string;
}

export type TokenInspectorField =
  | {
      editor: TokenInspectorFieldEditor | null;
      id: string;
      kind: 'scalar';
      label: string;
      roll?: TokenInspectorFieldRoll;
      selectionLabel?: string;
      value: string;
    }
  | {
      current: string;
      editor: 'command' | null;
      id: string;
      kind: 'resource';
      label: string;
      maximum: string;
      roll?: TokenInspectorFieldRoll;
      selectionLabel?: string;
    };

export type TokenInspectorFieldValue =
  | { kind: 'scalar'; value: string }
  | { current: string; kind: 'resource'; maximum: string };

export type TokenInspectorValueEdit = {
  command: string;
  fieldId: string;
  kind: 'set-value';
  target: 'current' | 'maximum' | 'value';
};

export type TokenInspectorLayoutMutation =
  | { fieldId: string; kind: 'add-field' }
  | { fieldId: string; kind: 'delete-field' }
  | {
      direction: 'down' | 'up';
      fieldId: string;
      kind: 'move-field';
    }
  | {
      beforeFieldId: string | null;
      fieldId: string;
      kind: 'place-field';
    };

export type TokenInspectorMutation =
  | TokenInspectorLayoutMutation
  | TokenInspectorValueEdit;

export interface TokenInspectorPresentation {
  editable: boolean;
  fields: TokenInspectorField[];
  selectedFieldIds: string[];
  tokenId: string;
}

const inspectorDecimalPattern = '[+-]?\\d+(?:\\.\\d{1,2})?';
const inspectorExpressionPattern = new RegExp(
  `^(${inspectorDecimalPattern})\\s*([+-])\\s*(\\d+(?:\\.\\d{1,2})?)$`,
  'u',
);
const inspectorCommandPattern = new RegExp(
  `^([+\\-=]?)(${inspectorDecimalPattern})$`,
  'u',
);
const inspectorDecimalValuePattern = new RegExp(
  `^([+-]?)(\\d+)(?:\\.(\\d{1,2}))?$`,
  'u',
);

function parseInspectorHundredths(value: string): number | null {
  const match = inspectorDecimalValuePattern.exec(value);
  if (!match) return null;
  const whole = Number(match[2]);
  const fraction = Number((match[3] ?? '').padEnd(2, '0'));
  const magnitude = whole * 100 + fraction;
  if (!Number.isSafeInteger(magnitude)) return null;
  return match[1] === '-' ? -magnitude : magnitude;
}

function formatInspectorHundredths(value: number): string {
  const sign = value < 0 ? '-' : '';
  const magnitude = Math.abs(value);
  const whole = Math.floor(magnitude / 100);
  const fraction = magnitude % 100;
  if (fraction === 0) return `${sign}${whole}`;
  return `${sign}${whole}.${String(fraction).padStart(2, '0').replace(/0$/u, '')}`;
}

function addInspectorHundredths(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}

/** Applies strict Inspector numeric commands without evaluating arbitrary expressions. */
export function applyTokenInspectorNumericCommand(
  currentValue: string,
  command: string,
): string | null {
  const normalized = command.trim();
  const expression = inspectorExpressionPattern.exec(normalized);
  if (expression) {
    const left = parseInspectorHundredths(expression[1]);
    const right = parseInspectorHundredths(expression[3]);
    if (left === null || right === null) return null;
    const result = addInspectorHundredths(
      left,
      expression[2] === '+' ? right : -right,
    );
    return result === null ? null : formatInspectorHundredths(result);
  }

  const current = parseInspectorHundredths(currentValue.trim());
  const simple = inspectorCommandPattern.exec(normalized);
  if (current === null || !simple) return null;
  const operand = parseInspectorHundredths(simple[2]);
  if (operand === null) return null;
  const result = simple[1] === '+'
    ? addInspectorHundredths(current, operand)
    : simple[1] === '-'
      ? addInspectorHundredths(current, -operand)
      : operand;
  return result === null ? null : formatInspectorHundredths(result);
}

const boundedString = (maximum: number) => z.string().max(maximum);
const fieldIdSchema = boundedString(MAX_TOKEN_INSPECTOR_FIELD_ID_CODE_UNITS)
  .min(1);
const labelSchema = boundedString(MAX_TOKEN_INSPECTOR_FIELD_LABEL_CODE_UNITS)
  .min(1);
const valueSchema = boundedString(MAX_TOKEN_INSPECTOR_VALUE_CODE_UNITS);

const fieldBaseSchema = z.object({
  id: fieldIdSchema,
  label: labelSchema,
  roll: z.object({ label: labelSchema }).strict().optional(),
  selectionLabel: labelSchema.optional(),
});

export const tokenInspectorFieldSchema = z.discriminatedUnion('kind', [
  fieldBaseSchema.extend({
    editor: z.enum(['command', 'text']).nullable(),
    kind: z.literal('scalar'),
    value: valueSchema,
  }).strict(),
  fieldBaseSchema.extend({
    current: valueSchema,
    editor: z.literal('command').nullable(),
    kind: z.literal('resource'),
    maximum: valueSchema,
  }).strict(),
]);

export const tokenInspectorFieldValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scalar'), value: valueSchema }).strict(),
  z.object({
    current: valueSchema,
    kind: z.literal('resource'),
    maximum: valueSchema,
  }).strict(),
]);

export const tokenInspectorMutationSchema = z.discriminatedUnion('kind', [
  z.object({
    command: boundedString(MAX_TOKEN_INSPECTOR_VALUE_CODE_UNITS),
    fieldId: fieldIdSchema,
    kind: z.literal('set-value'),
    target: z.enum(['current', 'maximum', 'value']),
  }).strict(),
  z.object({ fieldId: fieldIdSchema, kind: z.literal('add-field') }).strict(),
  z.object({ fieldId: fieldIdSchema, kind: z.literal('delete-field') }).strict(),
  z.object({
    direction: z.enum(['down', 'up']),
    fieldId: fieldIdSchema,
    kind: z.literal('move-field'),
  }).strict(),
  z.object({
    beforeFieldId: fieldIdSchema.nullable(),
    fieldId: fieldIdSchema,
    kind: z.literal('place-field'),
  }).strict(),
]);

export const tokenInspectorPresentationSchema = z.object({
  editable: z.boolean(),
  fields: z.array(tokenInspectorFieldSchema).max(MAX_TOKEN_INSPECTOR_FIELDS),
  selectedFieldIds: z.array(fieldIdSchema).max(MAX_TOKEN_INSPECTOR_FIELDS)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Inspector fields must be unique.',
    }),
  tokenId: boundedString(128).min(1),
}).strict();

export function tokenInspectorFieldValueOf(
  field: TokenInspectorField,
): TokenInspectorFieldValue {
  return field.kind === 'scalar'
    ? { kind: 'scalar', value: field.value }
    : {
        current: field.current,
        kind: 'resource',
        maximum: field.maximum,
      };
}
