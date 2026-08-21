import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanonicalLoader } from '../../../../components/ui/CanonicalLoader';

describe('CanonicalLoader', () => {
  it('shows only its graphic and progress bar while preserving accessible progress', () => {
    const { rerender } = render(
      <CanonicalLoader label="Checking assets…" />,
    );
    expect(
      screen.getByRole('progressbar', { name: 'Checking assets…' }),
    ).not.toHaveAttribute('aria-valuenow');

    rerender(
      <CanonicalLoader
        completedItems={5}
        label="Downloading assets…"
        totalItems={10}
      />,
    );
    expect(
      screen.getByRole('progressbar', { name: 'Downloading assets…' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText('50%')).not.toBeInTheDocument();
    expect(screen.queryByText('Downloading assets…')).not.toBeInTheDocument();
  });
});
