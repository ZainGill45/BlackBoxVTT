import { Parser } from '@dice-roller/rpg-dice-roller';

interface Dnd5eTokenHealthData {
  defaultToken: { type: 'linked' | 'template' };
  health: {
    currentHitPoints: string;
    maximumHitPoints: string;
  };
}

export const MAX_DND5E_HEALTH_NOTATION_CODE_UNITS = 128;

export interface Dnd5eTokenHealth {
  current: string;
  currentHundredths: number;
  maximum: string;
  maximumHundredths: number;
}

export interface Dnd5eTokenHealthFormula {
  notation: string;
}

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/u;
const FORMULA_DICE_COUNT_PATTERN = /^\+?[1-9]\d*$/u;
const HEALTH_COMMAND_PATTERN =
  /^(current|maximum)\s*([+\-=])\s*([+-]?\d+(?:\.\d{1,2})?)$/iu;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function safeHundredths(value: bigint): number | null {
  return value >= -MAX_SAFE_BIGINT && value <= MAX_SAFE_BIGINT
    ? Number(value)
    : null;
}

export function parseDnd5eHealthDecimal(value: string): number | null {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const magnitude = BigInt(match[2]) * 100n +
    BigInt((match[3] ?? '').padEnd(2, '0') || '0');
  return safeHundredths(match[1] === '-' ? -magnitude : magnitude);
}

export function formatDnd5eHealthDecimal(hundredths: number): string {
  if (!Number.isSafeInteger(hundredths)) {
    throw new TypeError('Health hundredths must be a safe integer.');
  }
  const negative = hundredths < 0;
  const magnitude = Math.abs(hundredths);
  const whole = Math.floor(magnitude / 100);
  const fraction = magnitude % 100;
  const suffix = fraction === 0
    ? ''
    : `.${String(fraction).padStart(2, '0').replace(/0$/u, '')}`;
  return `${negative ? '-' : ''}${whole}${suffix}`;
}

function fixedHealth(
  currentHitPoints: string,
  maximumHitPoints: string,
): Dnd5eTokenHealth | null {
  const currentHundredths = parseDnd5eHealthDecimal(currentHitPoints);
  const maximumHundredths = parseDnd5eHealthDecimal(maximumHitPoints);
  if (currentHundredths === null || maximumHundredths === null) return null;
  return {
    current: formatDnd5eHealthDecimal(currentHundredths),
    currentHundredths,
    maximum: formatDnd5eHealthDecimal(maximumHundredths),
    maximumHundredths,
  };
}

export function parseDnd5eTokenHealthFormula(
  currentHitPoints: string,
  maximumHitPoints: string,
): Dnd5eTokenHealthFormula | null {
  const count = currentHitPoints.trim();
  const expression = maximumHitPoints.trim();
  if (
    !FORMULA_DICE_COUNT_PATTERN.test(count) ||
    expression.length === 0 ||
    expression.length > MAX_DND5E_HEALTH_NOTATION_CODE_UNITS ||
    !/^d/u.test(expression)
  ) {
    return null;
  }
  const notation = `${count.replace(/^\+/u, '')}${expression}`;
  if (notation.length > MAX_DND5E_HEALTH_NOTATION_CODE_UNITS) return null;
  try {
    Parser.parse(notation);
  } catch {
    return null;
  }
  return { notation };
}

export function isValidDnd5eAuthoredHealth(
  data: Dnd5eTokenHealthData,
): boolean {
  if (fixedHealth(
    data.health.currentHitPoints,
    data.health.maximumHitPoints,
  )) {
    return true;
  }
  return data.defaultToken.type === 'template' && Boolean(
    parseDnd5eTokenHealthFormula(
      data.health.currentHitPoints,
      data.health.maximumHitPoints,
    ),
  );
}

export function readDnd5eTokenHealth<T extends Dnd5eTokenHealthData>(
  data: T,
): Dnd5eTokenHealth | null {
  return fixedHealth(
    data.health.currentHitPoints,
    data.health.maximumHitPoints,
  );
}

export function writeDnd5eTokenHealth<T extends Dnd5eTokenHealthData>(
  data: T,
  value: Pick<Dnd5eTokenHealth, 'currentHundredths' | 'maximumHundredths'>,
): T | null {
  if (
    !Number.isSafeInteger(value.currentHundredths) ||
    !Number.isSafeInteger(value.maximumHundredths)
  ) {
    return null;
  }
  const result = structuredClone(data);
  result.health.currentHitPoints = formatDnd5eHealthDecimal(
    value.currentHundredths,
  );
  result.health.maximumHitPoints = formatDnd5eHealthDecimal(
    value.maximumHundredths,
  );
  return result;
}

export function materializeDnd5eTokenHealth<T extends Dnd5eTokenHealthData>(
  data: T,
  roll: (notation: string) => number,
): T | null {
  const fixed = readDnd5eTokenHealth(data);
  if (fixed) {
    const result = structuredClone(data);
    result.health.currentHitPoints = fixed.current;
    result.health.maximumHitPoints = fixed.maximum;
    return result;
  }
  const formula = parseDnd5eTokenHealthFormula(
    data.health.currentHitPoints,
    data.health.maximumHitPoints,
  );
  if (!formula) return null;
  let rolled: number;
  try {
    rolled = roll(formula.notation);
  } catch {
    return null;
  }
  if (!Number.isFinite(rolled)) return null;
  const scaled = rolled * 100;
  const rounded = Math.floor(
    scaled + 0.5 + Number.EPSILON * Math.max(1, Math.abs(scaled)),
  );
  const generated = Number.isSafeInteger(rounded) && rounded > 0 ? rounded : 100;
  const value = formatDnd5eHealthDecimal(generated);
  const result = structuredClone(data);
  result.health.currentHitPoints = value;
  result.health.maximumHitPoints = value;
  return result;
}

function safeAdd(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}

export function applyDnd5eTokenHealthCommand<T extends Dnd5eTokenHealthData>(
  data: T,
  command: string,
): T | null {
  const health = readDnd5eTokenHealth(data);
  const match = HEALTH_COMMAND_PATTERN.exec(command.trim());
  if (!health || !match) return null;
  const operand = parseDnd5eHealthDecimal(match[3]);
  if (operand === null) return null;

  const field = match[1].toLocaleLowerCase('en-US');
  const operation = match[2];
  let current = health.currentHundredths;
  let maximum = health.maximumHundredths;
  if (field === 'current') {
    current = operation === '='
      ? operand
      : safeAdd(current, operation === '+' ? operand : -operand) ?? NaN;
  } else {
    const target = operation === '='
      ? operand
      : safeAdd(maximum, operation === '+' ? operand : -operand);
    if (target === null) return null;
    const delta = safeAdd(target, -maximum);
    if (delta === null) return null;
    maximum = target;
    current = safeAdd(current, delta) ?? NaN;
  }
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(maximum)) {
    return null;
  }
  const result = structuredClone(data);
  result.health.currentHitPoints = formatDnd5eHealthDecimal(current);
  result.health.maximumHitPoints = formatDnd5eHealthDecimal(maximum);
  return result;
}
