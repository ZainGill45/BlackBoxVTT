import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DefaultInput } from '../../../../components/ui/DefaultInput';

describe('DefaultInput', () => {
  it('renders ordinary input types through its input interface', () => {
    render(
      <DefaultInput
        aria-label="Password"
        autoComplete="current-password"
        type="password"
      />,
    );

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });

  it('renders multiline content through its one polymorphic interface', () => {
    render(<DefaultInput as="textarea" aria-label="Description" rows={4} />);

    expect(screen.getByLabelText('Description').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Description')).toHaveAttribute('rows', '4');
  });

  it('preserves native validation and read-only state', () => {
    render(
      <DefaultInput
        aria-invalid="true"
        aria-label="Port"
        readOnly
        value="3000"
      />,
    );

    expect(screen.getByLabelText('Port')).toBeInvalid();
    expect(screen.getByLabelText('Port')).toHaveAttribute('readonly');
  });
});
