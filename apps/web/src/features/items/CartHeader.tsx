'use client';

import { useState } from 'react';

import { FilterPopover } from './FilterPopover';
import { relativeTime } from './format';
import type { FilterChipId, ItemFilters, SortKey } from './query';
import { activeFilterChips, clearFilter } from './query';
import type { Section } from './sections';

export type ItemsLayout = 'list' | 'cards';

const SORT_LABELS: Record<SortKey, string> = {
  'recently-updated': 'Recently updated',
  'recently-added': 'Recently added',
  'price-low': 'Price: low to high',
  'price-high': 'Price: high to low',
  priority: 'Priority',
  title: 'Title',
};

/**
 * The header above the results.
 *
 * What it replaces was a row of five bare selects and two checkboxes, which at 375px wrapped
 * to a block taller than the first product card — so the dashboard opened on its own controls
 * rather than on anything the user saved.
 *
 * Now: what you are looking at and how much of it, a hint about where products come from, and
 * three controls. Everything else is one button away, and whatever is active says so in a chip
 * beside the results rather than hiding inside a closed popover.
 */
export function CartHeader({
  section,
  cartName,
  shown,
  total,
  lastUpdated,
  filters,
  onFiltersChange,
  retailers,
  sort,
  onSortChange,
  layout,
  onLayoutChange,
}: {
  section: Section;
  cartName: string | null;
  shown: number;
  total: number;
  lastUpdated: string | null;
  filters: ItemFilters;
  onFiltersChange: (filters: ItemFilters) => void;
  retailers: string[];
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
  layout: ItemsLayout;
  onLayoutChange: (layout: ItemsLayout) => void;
}) {
  const [showHowTo, setShowHowTo] = useState(false);
  const chips = activeFilterChips(filters);

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 id="items-heading" className="text-xl font-semibold tracking-tight">
            {section.id === 'cart' && cartName ? cartName : section.label}
          </h1>
          <p className="text-sm text-[var(--uc-foreground-muted)]">
            {shown === total ? `${total} item${total === 1 ? '' : 's'}` : `${shown} of ${total}`}
            {lastUpdated ? ` · updated ${relativeTime(lastUpdated)}` : ''}
          </p>
        </div>

        <button
          type="button"
          className="uc-button uc-button--primary uc-focusable"
          aria-expanded={showHowTo}
          onClick={() => setShowHowTo((current) => !current)}
        >
          Add a product
        </button>
      </div>

      {showHowTo ? (
        <div className="uc-callout" role="status">
          <span className="uc-callout__title">Products come from the extension</span>
          <span>
            Open any product page in your browser, click the Universal Cart icon, and press{' '}
            <strong>Capture this page</strong>. It saves the photograph, price, and the size or
            colour you picked — and it only ever reads the page you asked it to.
          </span>
        </div>
      ) : null}

      <p className="text-sm text-[var(--uc-foreground-muted)]">{section.blurb}</p>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <label
            className="text-[0.6875rem] font-semibold tracking-[0.06em] whitespace-nowrap text-[var(--uc-foreground-muted)] uppercase"
            htmlFor="sort"
          >
            Sort by
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(event) => onSortChange(event.target.value as SortKey)}
            className="uc-input uc-focusable text-sm"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <FilterPopover filters={filters} onChange={onFiltersChange} retailers={retailers} />

        <div
          className="ml-auto flex overflow-hidden rounded-[var(--uc-radius-control)] border border-[var(--uc-border)]"
          role="group"
          aria-label="View"
        >
          {(['list', 'cards'] as ItemsLayout[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={layout === option}
              onClick={() => onLayoutChange(option)}
              className={[
                'uc-focusable px-3 py-1.5 text-xs capitalize',
                layout === option
                  ? 'bg-[var(--uc-surface-muted)] font-semibold'
                  : 'text-[var(--uc-foreground-muted)]',
              ].join(' ')}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[var(--uc-foreground-muted)]">Filtered by</span>
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className="uc-focusable flex items-center gap-1 rounded-[var(--uc-radius-pill)] border border-[var(--uc-border-strong)] px-2.5 py-0.5 text-xs"
              onClick={() => onFiltersChange(clearFilter(filters, chip.id as FilterChipId))}
            >
              {chip.label}
              <span aria-hidden="true">×</span>
              <span className="uc-sr-only">Remove this filter</span>
            </button>
          ))}
          <button
            type="button"
            className="uc-focusable rounded-[var(--uc-radius-control)] px-2 py-0.5 text-xs text-[var(--uc-primary)]"
            onClick={() =>
              onFiltersChange({
                ...filters,
                retailers: [],
                availabilities: [],
                priorities: [],
                onSaleOnly: false,
                atOrBelowDesiredOnly: false,
              })
            }
          >
            Clear filters
          </button>
        </div>
      ) : null}
    </header>
  );
}
