'use client';

import { useRef, useState } from 'react';

import { useDismissable, useFocusTrap } from '@/features/shell/useDismissable';

import { AVAILABILITY_LABELS } from './format';
import type { ItemAvailability, ItemFilters, ItemPriority } from './query';
import { EMPTY_FILTERS, activeFilterCount } from './query';

const AVAILABILITIES: ItemAvailability[] = [
  'in_stock',
  'out_of_stock',
  'preorder',
  'backorder',
  'unknown',
];

const PRIORITIES: ItemPriority[] = ['high', 'normal', 'low'];

/**
 * The secondary filters, behind one button.
 *
 * They used to be a row of five bare selects and two checkboxes sitting above the results. At
 * 375px that row wrapped to something taller than the first product card, so the dashboard
 * opened on its own controls — the failure this phase exists to fix.
 *
 * Status is deliberately absent: the navigation owns it (see `sections.ts`). Search is
 * deliberately absent too — it stays in the content column where a person can see it.
 */
export function FilterPopover({
  filters,
  onChange,
  retailers,
}: {
  filters: ItemFilters;
  onChange: (filters: ItemFilters) => void;
  retailers: string[];
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useDismissable(open, container, () => setOpen(false));
  useFocusTrap(open, container);

  const count = activeFilterCount(filters);

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        className="uc-button uc-button--secondary uc-focusable"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        Filters
        {count > 0 ? (
          <span className="ml-1.5 rounded-full bg-[var(--uc-primary)] px-1.5 text-xs text-[var(--uc-primary-foreground)] tabular-nums">
            {count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Filters"
          className="uc-surface uc-surface--overlay absolute right-0 z-30 mt-1 flex w-72 flex-col gap-3 p-4"
        >
          <div className="uc-field">
            <label className="uc-field__label" htmlFor="filter-retailer">
              Retailer
            </label>
            <select
              id="filter-retailer"
              className="uc-input uc-focusable"
              value={filters.retailers[0] ?? ''}
              onChange={(event) =>
                onChange({
                  ...filters,
                  retailers: event.target.value ? [event.target.value] : [],
                })
              }
            >
              <option value="">Any retailer</option>
              {retailers.map((retailer) => (
                <option key={retailer} value={retailer}>
                  {retailer}
                </option>
              ))}
            </select>
          </div>

          <div className="uc-field">
            <label className="uc-field__label" htmlFor="filter-availability">
              Availability
            </label>
            <select
              id="filter-availability"
              className="uc-input uc-focusable"
              value={filters.availabilities[0] ?? ''}
              onChange={(event) =>
                onChange({
                  ...filters,
                  availabilities: event.target.value
                    ? [event.target.value as ItemAvailability]
                    : [],
                })
              }
            >
              <option value="">Any availability</option>
              {AVAILABILITIES.map((availability) => (
                <option key={availability} value={availability}>
                  {AVAILABILITY_LABELS[availability]}
                </option>
              ))}
            </select>
          </div>

          <div className="uc-field">
            <label className="uc-field__label" htmlFor="filter-priority">
              Priority
            </label>
            <select
              id="filter-priority"
              className="uc-input uc-focusable"
              value={filters.priorities[0] ?? ''}
              onChange={(event) =>
                onChange({
                  ...filters,
                  priorities: event.target.value ? [event.target.value as ItemPriority] : [],
                })
              }
            >
              <option value="">Any priority</option>
              {PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="uc-focusable"
              checked={filters.onSaleOnly}
              onChange={(event) => onChange({ ...filters, onSaleOnly: event.target.checked })}
            />
            On sale
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="uc-focusable"
              checked={filters.atOrBelowDesiredOnly}
              onChange={(event) =>
                onChange({ ...filters, atOrBelowDesiredOnly: event.target.checked })
              }
            />
            Hit my target
          </label>

          <div className="flex justify-between gap-2 border-t border-[var(--uc-border)] pt-3">
            <button
              type="button"
              className="uc-button uc-button--ghost uc-focusable"
              onClick={() => onChange({ ...EMPTY_FILTERS, search: filters.search })}
            >
              Reset
            </button>
            <button
              type="button"
              className="uc-button uc-button--secondary uc-focusable"
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
