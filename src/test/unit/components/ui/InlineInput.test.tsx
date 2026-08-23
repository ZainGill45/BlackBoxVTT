import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InlineInput } from '../../../../components/ui/InlineInput';

describe('InlineInput', () => {
  it.each([
    ['', '1'],
    ['0', '1'],
    ['-12', '3'],
    ['123456789', '9'],
  ])('provides a content-sizing fallback for %j', (value, expectedSize) => {
    render(
      <InlineInput
        aria-label="Current value"
        sizing="content"
        value={value}
        readOnly
      />,
    );

    expect(screen.getByLabelText('Current value')).toHaveAttribute(
      'size',
      expectedSize,
    );
  });
});
