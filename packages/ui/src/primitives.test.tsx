import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button, IconButton, TextInput } from './controls';
import {
  Badge,
  Callout,
  EmptyState,
  ProductImage,
  Skeleton,
  Spinner,
  StatusBadge,
  Surface,
  Toast,
} from './display';

/**
 * The properties every primitive has to hold: a name in the accessibility tree, a visible
 * focus ring, a real disabled state, and no assumption that content will be well behaved.
 */

describe('Button', () => {
  it('is a real button with an accessible name', () => {
    render(<Button tone="primary">Save to cart</Button>);
    expect(screen.getByRole('button', { name: 'Save to cart' })).toBeTruthy();
  });

  it('defaults to type=button so it cannot submit a form it happens to sit in', () => {
    render(<Button>Compare</Button>);
    expect(screen.getByRole('button', { name: 'Compare' }).getAttribute('type')).toBe('button');
  });

  it('takes focus and carries the focus-ring class', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });

    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.className).toContain('uc-focusable');
  });

  it('does not fire while disabled', () => {
    let clicks = 0;
    render(
      <Button disabled onClick={() => (clicks += 1)}>
        Save
      </Button>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(clicks).toBe(0);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });
});

describe('IconButton', () => {
  it('takes its accessible name from the required label, not the glyph', () => {
    render(<IconButton label="Remove item" icon={<span>×</span>} />);

    const button = screen.getByRole('button', { name: 'Remove item' });
    // The glyph must not be announced; the label is the name.
    expect(button.querySelector('[aria-hidden="true"]')?.textContent).toBe('×');
  });

  it('is focusable', () => {
    render(<IconButton label="Refresh" icon={<span>↻</span>} />);
    const button = screen.getByRole('button', { name: 'Refresh' });

    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe('TextInput', () => {
  it('ties its label to the input without the caller inventing an id', () => {
    render(<TextInput label="Desired price" />);
    expect(screen.getByLabelText('Desired price')).toBeTruthy();
  });

  it('keeps the label for assistive technology when it is visually hidden', () => {
    render(<TextInput label="Search" labelHidden />);

    const input = screen.getByLabelText('Search');
    expect(input).toBeTruthy();
    // Hidden visually, still in the tree.
    expect(document.querySelector('.uc-sr-only')?.textContent).toBe('Search');
  });

  it('announces its error through aria-describedby and aria-invalid', () => {
    render(<TextInput label="Email" invalid message="Enter a valid email address." />);

    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe('Enter a valid email address.');
  });

  it('is focusable and disables cleanly', () => {
    render(<TextInput label="Note" disabled />);
    const input = screen.getByLabelText('Note');
    expect(input.hasAttribute('disabled')).toBe(true);
  });
});

describe('StatusBadge', () => {
  it('never leaves colour as the only carrier of meaning', () => {
    render(<StatusBadge tone="warning">Needs review</StatusBadge>);

    // The word is present, and the dot beside it is explicitly decorative.
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(document.querySelector('.uc-badge__dot')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('adds no tone class for neutral, so a plain label stays plain', () => {
    render(<StatusBadge tone="neutral">Saved</StatusBadge>);
    const badge = document.querySelector('.uc-badge')!;

    expect(badge.className).not.toContain('uc-badge--');
    expect(badge.querySelector('.uc-badge__dot')).toBeNull();
  });

  it('renders a neutral Badge with no semantic colour at all', () => {
    render(<Badge>Zara</Badge>);
    expect(document.querySelector('.uc-badge')!.className).not.toContain('uc-badge--');
  });
});

describe('ProductImage', () => {
  it('keeps its box when there is no image, so nothing reflows', () => {
    render(<ProductImage src={null} alt="Regular fit polo" />);

    const frame = document.querySelector('.uc-product-image')!;
    expect(frame).toBeTruthy();
    expect(frame.querySelector('img')).toBeNull();
    // A drawn fallback, not the browser's broken-image glyph.
    expect(frame.querySelector('svg')).toBeTruthy();
  });

  it('falls back when a retailer CDN 404s after the listing rotates', () => {
    render(<ProductImage src="https://cdn.example/gone.jpg" alt="Polo" />);

    const image = document.querySelector('img')!;
    fireEvent.error(image);

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.uc-product-image__fallback')).toBeTruthy();
  });

  it('passes the alt text through for a real image', () => {
    render(<ProductImage src="https://cdn.example/a.jpg" alt="Regular fit polo" />);
    expect(screen.getByAltText('Regular fit polo')).toBeTruthy();
  });
});

describe('Surface', () => {
  it('renders as the requested element so a card can be a list item', () => {
    render(
      <ul>
        <Surface as="li" elevation="raised">
          A card
        </Surface>
      </ul>,
    );

    const item = screen.getByRole('listitem');
    expect(item.className).toContain('uc-surface--raised');
  });
});

describe('loading and feedback', () => {
  it('keeps an unlabelled skeleton out of the accessibility tree', () => {
    render(<Skeleton />);
    expect(document.querySelector('.uc-skeleton')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('announces a labelled spinner as a status', () => {
    render(<Spinner label="Reading the page" />);
    expect(screen.getByRole('status', { name: 'Reading the page' })).toBeTruthy();
  });

  it('gives an empty state a way forward', () => {
    render(
      <EmptyState
        title="Nothing saved yet"
        body="Open a product page and press the toolbar button."
        action={<Button tone="primary">Install the extension</Button>}
      />,
    );

    expect(screen.getByText('Nothing saved yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Install the extension' })).toBeTruthy();
  });

  it('interrupts for an error and waits for anything else', () => {
    const { unmount } = render(<Callout tone="danger">Could not reach the page.</Callout>);
    expect(screen.getByRole('alert')).toBeTruthy();
    unmount();

    render(<Callout tone="warning">Check the price before saving.</Callout>);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('puts a toast in a polite live region and keeps its action reachable', () => {
    render(<Toast message="Item archived" action={<Button>Undo</Button>} />);

    const toast = screen.getByRole('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});

describe('Toast announcing', () => {
  it('is its own live region by default', () => {
    render(<Toast message="Archived" />);
    expect(screen.getByRole('status').textContent).toContain('Archived');
  });

  it('stays silent when the surrounding region already announces it', () => {
    // Nesting two status roles makes a screen reader say it twice and a role query match
    // twice; the dashboard owns one persistent region and swaps toasts inside it.
    render(<Toast message="Archived" announce={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('.uc-toast')?.textContent).toContain('Archived');
  });
});
