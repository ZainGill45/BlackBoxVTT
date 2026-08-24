import { describe, expect, it } from 'vitest';
import { applyTokenInspectorNumericCommand } from '../../shared/tokenInspector';

describe('Token Inspector numeric commands', () => {
  it('supports relative commands and arithmetic formed by editing the value', () => {
    expect(applyTokenInspectorNumericCommand('24', '-5')).toBe('19');
    expect(applyTokenInspectorNumericCommand('24', '24-5')).toBe('19');
    expect(applyTokenInspectorNumericCommand('1.25', '1.25+0.5')).toBe('1.75');
  });

  it('rejects syntax outside the strict two-decimal command grammar', () => {
    expect(applyTokenInspectorNumericCommand('24', '24*5')).toBeNull();
    expect(applyTokenInspectorNumericCommand('24', '24--5')).toBeNull();
    expect(applyTokenInspectorNumericCommand('24', '24.001-5')).toBeNull();
  });
});
