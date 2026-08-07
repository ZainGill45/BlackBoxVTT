import { z } from 'zod';

export const CHAT_ROLL_SEND_TIMEOUT_MS = 12_000;
export const MAX_CHAT_ROLL_SECTIONS = 100;
export const MAX_CHAT_ROLL_LABEL_CHARACTERS = 50_000;
export const MAX_CHAT_ROLL_NOTATION_CHARACTERS = 50_000;
export const MAX_CHAT_ROLL_MODIFIERS = 32;

export interface ChatRollModifierDefinition {
  label: string;
  value: number;
}

export interface ChatRollSectionDefinition {
  label: string;
  modifiers: ChatRollModifierDefinition[];
  notation: string;
  typeLabel: string | null;
}

export interface ChatRollDefinition {
  category: string;
  sections: ChatRollSectionDefinition[];
  title: string | null;
}

export interface ChatRollValueResult {
  calculationValue: number;
  initialValue: number;
  modifiers: string[];
  useInTotal: boolean;
  value: number;
}

export type ChatRollDieKind = 'fudge' | 'percentile' | 'standard';

export interface ChatRollDieNode {
  dieKind: ChatRollDieKind;
  kind: 'die';
  max: number;
  min: number;
  notation: string;
  results: ChatRollValueResult[];
  sides: number | string;
}

export interface ChatRollGroupNode {
  children: ChatRollExpressionNode[];
  kind: 'group';
  modifiers: string[];
  useInTotal: boolean;
  value: number;
}

export interface ChatRollNumberNode {
  kind: 'number';
  value: number;
}

export interface ChatRollTokenNode {
  kind: 'token';
  value: string;
}

export type ChatRollExpressionNode =
  | ChatRollDieNode
  | ChatRollGroupNode
  | ChatRollNumberNode
  | ChatRollTokenNode;

export interface ChatRollSectionResult extends ChatRollSectionDefinition {
  baseTotal: number;
  expression: ChatRollExpressionNode[];
  total: number;
}

export interface ChatRollCard {
  category: string;
  sections: ChatRollSectionResult[];
  title: string | null;
}

const labelSchema = z
  .string()
  .min(1)
  .max(MAX_CHAT_ROLL_LABEL_CHARACTERS)
  .refine((value) => value.normalize('NFKC').trim() === value, {
    message: 'Roll labels must be normalized and trimmed.',
  });

export const chatRollModifierDefinitionSchema = z
  .object({
    label: labelSchema,
    value: z.number().finite(),
  })
  .strict();

export const chatRollSectionDefinitionSchema = z
  .object({
    label: labelSchema,
    modifiers: z
      .array(chatRollModifierDefinitionSchema)
      .max(MAX_CHAT_ROLL_MODIFIERS),
    notation: z.string().trim().min(1).max(MAX_CHAT_ROLL_NOTATION_CHARACTERS),
    typeLabel: labelSchema.nullable(),
  })
  .strict();

export const chatRollDefinitionSchema = z
  .object({
    category: labelSchema,
    sections: z
      .array(chatRollSectionDefinitionSchema)
      .min(1)
      .max(MAX_CHAT_ROLL_SECTIONS),
    title: labelSchema.nullable(),
  })
  .strict()
  .superRefine((definition, context) => {
    if ([...serializeChatRollDefinition(definition)].length > 50_000) {
      context.addIssue({
        code: 'custom',
        message: 'Roll definition exceeds the maximum chat character limit.',
      });
    }
  });

const rollValueResultSchema = z
  .object({
    calculationValue: z.number().finite(),
    initialValue: z.number().finite(),
    modifiers: z.array(z.string().min(1).max(64)).max(64),
    useInTotal: z.boolean(),
    value: z.number().finite(),
  })
  .strict();

const rollExpressionNodeSchema: z.ZodType<ChatRollExpressionNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z
      .object({
        dieKind: z.enum(['fudge', 'percentile', 'standard']),
        kind: z.literal('die'),
        max: z.number().finite(),
        min: z.number().finite(),
        notation: z.string().min(1).max(MAX_CHAT_ROLL_NOTATION_CHARACTERS),
        results: z.array(rollValueResultSchema).max(1_000_000),
        sides: z.union([z.number().int().positive(), z.string().min(1).max(16)]),
      })
      .strict(),
    z
      .object({
        children: z.array(rollExpressionNodeSchema).max(1_000_000),
        kind: z.literal('group'),
        modifiers: z.array(z.string().min(1).max(64)).max(64),
        useInTotal: z.boolean(),
        value: z.number().finite(),
      })
      .strict(),
    z.object({ kind: z.literal('number'), value: z.number().finite() }).strict(),
    z.object({ kind: z.literal('token'), value: z.string().min(1).max(128) }).strict(),
  ]),
);

export const chatRollCardSchema: z.ZodType<ChatRollCard> = z
  .object({
    category: labelSchema,
    sections: z
      .array(
        chatRollSectionDefinitionSchema.extend({
          baseTotal: z.number().finite(),
          expression: z.array(rollExpressionNodeSchema).max(1_000_000),
          total: z.number().finite(),
        }),
      )
      .min(1)
      .max(MAX_CHAT_ROLL_SECTIONS),
    title: labelSchema.nullable(),
  })
  .strict();

function normalizeLabel(value: string): string {
  return value.normalize('NFKC').trim();
}

function unescapeHeading(value: string): string | null {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      if (':()[]'.includes(character)) return null;
      output += character;
      continue;
    }
    const escaped = value[index + 1];
    if (!escaped || !':()[]\\'.includes(escaped)) {
      return null;
    }
    output += escaped;
    index += 1;
  }
  const normalized = normalizeLabel(output);
  return normalized ? normalized : null;
}

function findUnescaped(value: string, target: string, start = 0): number {
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === target) {
      return index;
    }
  }
  return -1;
}

function findClosing(value: string, opening: number, closing: string): number {
  return findUnescaped(value, closing, opening + 1);
}

function parseSectionHeader(
  source: string,
): Omit<ChatRollSectionDefinition, 'notation'> | null {
  let position = 0;
  let labelEnd = source.length;
  for (const delimiter of ['(', '[']) {
    const found = findUnescaped(source, delimiter);
    if (found >= 0) {
      labelEnd = Math.min(labelEnd, found);
    }
  }
  const label = unescapeHeading(source.slice(0, labelEnd));
  if (!label) {
    return null;
  }
  position = labelEnd;
  const modifiers: ChatRollModifierDefinition[] = [];
  let typeLabel: string | null = null;
  while (position < source.length) {
    while (/\s/u.test(source[position] ?? '')) position += 1;
    if (position >= source.length) break;
    const opening = source[position];
    if (opening !== '(' && opening !== '[') return null;
    const closing = opening === '(' ? ')' : ']';
    const end = findClosing(source, position, closing);
    if (end < 0) return null;
    const content = source.slice(position + 1, end);
    if (opening === '[') {
      if (typeLabel !== null) return null;
      typeLabel = unescapeHeading(content);
      if (!typeLabel) return null;
    } else {
      if (typeLabel !== null) return null;
      if (modifiers.length >= MAX_CHAT_ROLL_MODIFIERS) return null;
      const match =
        /^(.*\S)\s+([+-](?:(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?))$/iu.exec(
          content.trim(),
        );
      if (!match) return null;
      const modifierLabel = unescapeHeading(match[1]);
      const modifierValue = Number(match[2]);
      if (!modifierLabel || !Number.isFinite(modifierValue)) return null;
      modifiers.push({ label: modifierLabel, value: modifierValue });
    }
    position = end + 1;
  }
  return { label, modifiers, typeLabel };
}

function parseCardHeading(source: string): {
  category: string;
  title: string | null;
} | null {
  const trimmed = source.trim();
  if (!trimmed) return { category: 'Roll', title: null };
  const colon = findUnescaped(trimmed, ':');
  if (colon < 0) {
    const title = unescapeHeading(trimmed);
    return title ? { category: 'Roll', title } : null;
  }
  const category = unescapeHeading(trimmed.slice(0, colon));
  const title = unescapeHeading(trimmed.slice(colon + 1));
  return category && title ? { category, title } : null;
}

export type ParsedRollDefinition =
  | { definition: ChatRollDefinition; ok: true }
  | { message: string; ok: false };

/** Parse a normalized `/r` or `/roll` command without rolling any dice. */
export function parseRollCommand(command: string): ParsedRollDefinition {
  const lines = command.replace(/\r\n?/gu, '\n').trim().split('\n');
  const match = /^\/(?:r|roll)(?:\s+([^\n]*))?$/iu.exec(lines[0].trim());
  if (!match) {
    return { message: 'Usage: /r notation or /roll followed by roll sections.', ok: false };
  }
  const firstLineBody = match[1]?.trim() ?? '';
  if (lines.length === 1) {
    if (!firstLineBody) {
      return { message: 'Enter dice notation to roll.', ok: false };
    }
    const definition = {
      category: 'Roll',
      sections: [
        {
          label: firstLineBody,
          modifiers: [],
          notation: firstLineBody,
          typeLabel: null,
        },
      ],
      title: null,
    } satisfies ChatRollDefinition;
    return chatRollDefinitionSchema.safeParse(definition).success
      ? { definition, ok: true }
      : { message: 'Dice notation is too large.', ok: false };
  }

  const heading = parseCardHeading(firstLineBody);
  if (!heading) {
    return { message: 'The roll card heading is invalid.', ok: false };
  }
  const sections: ChatRollSectionDefinition[] = [];
  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = findUnescaped(line, ':');
    if (colon < 0) {
      return { message: 'Each roll section must use “Label: notation”.', ok: false };
    }
    const header = parseSectionHeader(line.slice(0, colon));
    const notation = line.slice(colon + 1).trim();
    if (!header || !notation) {
      return { message: 'A roll section heading or notation is invalid.', ok: false };
    }
    sections.push({ ...header, notation });
  }
  const definition = { ...heading, sections } satisfies ChatRollDefinition;
  const parsed = chatRollDefinitionSchema.safeParse(definition);
  return parsed.success
    ? { definition: parsed.data, ok: true }
    : { message: 'The roll card is empty or exceeds its limits.', ok: false };
}

/** Canonical user-facing form used for campaign character-limit accounting. */
export function serializeChatRollDefinition(
  definition: ChatRollDefinition,
): string {
  if (
    definition.category === 'Roll' &&
    definition.title === null &&
    definition.sections.length === 1 &&
    definition.sections[0].label === definition.sections[0].notation &&
    definition.sections[0].modifiers.length === 0 &&
    definition.sections[0].typeLabel === null
  ) {
    return `/r ${definition.sections[0].notation}`;
  }
  const heading =
    definition.category === 'Roll'
      ? definition.title ?? ''
      : `${definition.category}: ${definition.title ?? ''}`;
  return [
    `/roll${heading ? ` ${heading}` : ''}`,
    ...definition.sections.map((section) => {
      const modifiers = section.modifiers
        .map(
          (modifier) =>
            ` (${modifier.label} ${modifier.value >= 0 ? '+' : ''}${modifier.value})`,
        )
        .join('');
      const type = section.typeLabel ? ` [${section.typeLabel}]` : '';
      return `${section.label}${modifiers}${type}: ${section.notation}`;
    }),
  ].join('\n');
}

export type ChatRollOutcome = 'failure' | 'mixed' | 'neutral' | 'success';

const successFlags = new Set(['critical-success', 'target-success']);
const failureFlags = new Set(['critical-failure', 'target-failure']);

export function classifyRollResultOutcome(
  die: ChatRollDieNode,
  result: ChatRollValueResult,
  included = true,
): ChatRollOutcome {
  if (!included || !result.useInTotal) return 'neutral';
  const success =
    result.initialValue === die.max ||
    result.modifiers.some((modifier) => successFlags.has(modifier));
  const failure =
    result.initialValue === die.min ||
    result.modifiers.some((modifier) => failureFlags.has(modifier));
  if (success && failure) return 'mixed';
  if (success) return 'success';
  if (failure) return 'failure';
  return 'neutral';
}

export function classifyRollOutcome(
  nodes: readonly ChatRollExpressionNode[],
): ChatRollOutcome {
  let success = false;
  let failure = false;
  const visit = (node: ChatRollExpressionNode, included: boolean) => {
    if (node.kind === 'group') {
      for (const child of node.children) visit(child, included && node.useInTotal);
      for (const modifier of node.modifiers) {
        if (included && successFlags.has(modifier)) success = true;
        if (included && failureFlags.has(modifier)) failure = true;
      }
      return;
    }
    if (node.kind !== 'die' || !included) return;
    for (const result of node.results) {
      const outcome = classifyRollResultOutcome(node, result);
      if (outcome === 'success' || outcome === 'mixed') success = true;
      if (outcome === 'failure' || outcome === 'mixed') failure = true;
    }
  };
  for (const node of nodes) visit(node, true);
  if (success && failure) return 'mixed';
  if (success) return 'success';
  if (failure) return 'failure';
  return 'neutral';
}
