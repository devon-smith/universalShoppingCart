'use client';

import { EmptyState } from '@universal-cart/ui';

import type { SectionId } from './sections';

/**
 * Why the list is empty, and what to do about it.
 *
 * Five different situations that used to share two messages. "Nothing matches those filters"
 * told a person who had typed a search term to go and look at their filters, and told someone
 * opening an empty Archived section that they had filtered something out. A dead end dressed
 * as an explanation is worse than no explanation, because it sends you looking in the wrong
 * place.
 */

export type EmptyReason =
  | { kind: 'no-items' }
  | { kind: 'section-empty'; section: SectionId }
  | { kind: 'no-search-match'; term: string }
  | { kind: 'no-filter-match' };

/**
 * Which of the five applies.
 *
 * Order matters: a search term is the most specific thing the user did, so it is named first
 * even when filters are also active.
 */
export function emptyReason(options: {
  totalItems: number;
  sectionCount: number;
  section: SectionId;
  search: string;
  activeFilters: number;
}): EmptyReason {
  if (options.totalItems === 0) return { kind: 'no-items' };
  if (options.search.trim().length > 0) {
    return { kind: 'no-search-match', term: options.search.trim() };
  }
  if (options.activeFilters > 0) return { kind: 'no-filter-match' };
  return { kind: 'section-empty', section: options.section };
}

const SECTION_EMPTY: Record<SectionId, { title: string; body: string }> = {
  cart: {
    title: 'This cart is empty',
    body: 'Everything you save from the extension lands here.',
  },
  changed: {
    title: 'No price has moved yet',
    body: 'A change appears once a product has been observed twice at different prices. Revisit a saved page to check it again.',
  },
  purchased: {
    title: 'Nothing marked purchased',
    body: 'When you buy something, mark it purchased and it moves here out of your way.',
  },
  archived: {
    title: 'Nothing archived',
    body: 'Archiving puts an item away without deleting it. Anything you archive can be restored from here.',
  },
};

export function ItemsEmptyState({
  reason,
  onClearSearch,
  onClearFilters,
}: {
  reason: EmptyReason;
  onClearSearch: () => void;
  onClearFilters: () => void;
}) {
  if (reason.kind === 'no-items') {
    return (
      <EmptyState
        title="Nothing saved yet"
        body={
          <>
            Install the Universal Cart extension, open any product page, and click{' '}
            <strong>Capture this page</strong> in the side panel. What you save shows up here
            straight away.
          </>
        }
      />
    );
  }

  if (reason.kind === 'no-search-match') {
    return (
      <EmptyState
        title={`No saved product matches “${reason.term}”`}
        body="Search looks at the title, brand, retailer, your note, and the size or colour you picked."
        action={
          <button
            type="button"
            className="uc-button uc-button--secondary uc-focusable"
            onClick={onClearSearch}
          >
            Clear search
          </button>
        }
      />
    );
  }

  if (reason.kind === 'no-filter-match') {
    return (
      <EmptyState
        title="Nothing matches those filters"
        body="There are saved products here, but none of them match every filter at once."
        action={
          <button
            type="button"
            className="uc-button uc-button--secondary uc-focusable"
            onClick={onClearFilters}
          >
            Clear filters
          </button>
        }
      />
    );
  }

  const copy = SECTION_EMPTY[reason.section];
  return <EmptyState title={copy.title} body={copy.body} />;
}
