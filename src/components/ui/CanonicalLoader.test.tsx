import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CanonicalLoader } from './CanonicalLoader';

describe('CanonicalLoader', () => {
  it('switches from indeterminate status to determinate percentage', () => {
    const { rerender } = render(
      <CanonicalLoader label="Checking assets…" totalBytes={null} />,
    );
    expect(
      screen.getByRole('progressbar', { name: 'Checking assets…' }),
    ).not.toHaveAttribute('aria-valuenow');

    rerender(
      <CanonicalLoader
        completedBytes={50}
        currentName="Map.png"
        label="Downloading assets…"
        totalBytes={100}
      />,
    );
    expect(
      screen.getByRole('progressbar', { name: 'Downloading assets…' }),
    ).toHaveAttribute('aria-valuenow', '50');
    expect(screen.getByText('50%')).toBeVisible();
    expect(screen.getByText('Map.png')).toBeVisible();
  });
});
