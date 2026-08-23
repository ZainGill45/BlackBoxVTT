import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DefaultInput } from '../../../../components/ui/DefaultInput';
import { FormField } from '../../../../components/ui/FormField';

describe('FormField', () => {
  it('associates help and error content with its control', () => {
    render(
      <FormField
        error="Choose a unique name."
        help="Shown to players."
        htmlFor="name"
        label="Name"
        showLabel
      >
        <DefaultInput id="name" value="Human" readOnly />
      </FormField>,
    );

    const input = screen.getByLabelText('Name');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription(
      'Shown to players. Choose a unique name.',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a unique name.');
  });
});
