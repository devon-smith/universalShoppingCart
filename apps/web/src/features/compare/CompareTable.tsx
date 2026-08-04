'use client';

import { Price, ProductImage, StatusBadge } from '@universal-cart/ui';

import { formatMoney } from '@/features/items/format';

import type { CompareCell, CompareRow, Comparison } from './compare';

/**
 * The side-by-side view.
 *
 * A real `<table>`, not a grid of divs. A comparison *is* tabular — every cell means "this
 * item's value for this attribute" — and the element gives screen readers row and column
 * navigation, and the "Price, Meridian Wool Runner, $79.95" announcement, for free. Rebuilding
 * that with ARIA would be more code doing the same job worse.
 *
 * ## The rule the whole component exists to honour
 *
 * `compare.ts` marks each row `comparable` or not, and that distinction is the product's
 * honesty in structural form. A **comparable** row is one where agreement across items means
 * something: one really is cheaper, one really is out of stock. Those rows get a verdict —
 * "differs" or "same" — and the differing values are marked.
 *
 * A **descriptive** row gets none of that, ever. Two garments both labelled "M" are not the
 * same size; two both reading "100% cotton" cannot be asserted equal while the strings are
 * raw. So variant, composition and note rows render their values and stop. There is no
 * highlight to suppress and no verdict to soften — the absence is the point, and the footnote
 * says so rather than leaving the user to wonder why size is not being compared.
 */

/** The columns are the items; the first column holds the row labels. */
export function CompareTable({ comparison }: { comparison: Comparison }) {
  const { items, rows, mixedCurrency } = comparison;

  // The image and title rows read as a column header, not as attributes to compare — so they
  // are lifted out of the body. `compare.ts` still returns them as rows; which of them is
  // chrome and which is content is a view decision, and this is the view. The retailer stays
  // a body row — "differs" across sellers is a real verdict — but its value is *also* part of
  // each column's identity, the way a person holds the candidates in mind ("the Zara one,
  // the Uniqlo one"), so the header repeats it beside the photograph.
  const imageRow = rows.find((row) => row.key === 'image');
  const titleRow = rows.find((row) => row.key === 'title');
  const retailerRow = rows.find((row) => row.key === 'retailer');
  const bodyRows = rows.filter((row) => row.key !== 'image' && row.key !== 'title');

  const differing = bodyRows.filter((row) => row.comparable && row.allAgree === false).length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-[var(--uc-foreground-muted)]">
        {differing === 0
          ? 'These items agree on everything that can be compared.'
          : `${differing} of the comparable attributes ${differing === 1 ? 'differs' : 'differ'}.`}{' '}
        Size, colour, composition and your notes are listed but not compared — see below.
      </p>

      {mixedCurrency ? (
        <p
          className="uc-callout uc-callout--warning text-sm"
          data-testid="mixed-currency"
          role="note"
        >
          <span className="uc-callout__title">Different currencies</span>
          <span>
            These items are not priced in the same currency, so nothing here says which is cheapest.
            Converting them would need an exchange rate this app does not have.
          </span>
        </p>
      ) : null}

      {/*
        The table scrolls inside its own box. Four columns cannot fit 375px and never will;
        what matters is that the *page* never scrolls sideways, which the responsive e2e
        asserts. The label column is sticky so a row stays identifiable while you scroll.

        `relative` is load-bearing, not decoration. `overflow` only clips an absolutely
        positioned descendant when the scroll box is also that descendant's containing block
        — and `.uc-sr-only` is `position: absolute`. Without it, every screen-reader-only span
        in the wide part of the table resolved against the viewport instead, escaped the clip,
        and stretched the document to 856px at a 375px viewport: a page that scrolled sideways
        because of text nobody can see.
      */}
      <div className="relative w-full max-w-full overflow-x-auto" data-testid="compare-scroll">
        <table className="w-full min-w-max border-collapse text-sm" data-testid="compare-table">
          <caption className="sr-only">
            {items.map((item) => item.title).join(', ')} compared side by side
          </caption>

          <thead>
            <tr>
              {/* The corner above the label column. `sr-only` alone would collapse it and
                  let the first item column slide underneath the sticky labels. */}
              <th scope="col" className="w-44 min-w-36 p-0">
                <span className="sr-only">Attribute</span>
              </th>
              {items.map((item, index) => {
                const imageCell = imageRow?.cells[index];
                const retailerCell = retailerRow?.cells[index];

                return (
                  <th
                    key={item.id}
                    scope="col"
                    data-testid="compare-column"
                    className="w-72 min-w-64 border-b border-[var(--uc-border)] p-3 text-left align-top font-normal"
                  >
                    {/* The column is the candidate, so it leads with the photograph — large,
                        portrait like garment photography, and framed even when the page gave
                        no image, because one column without a frame would unseat every row
                        beneath it. Choosing between these images *is* using this page. */}
                    <div className="flex flex-col gap-2">
                      <ProductImage
                        src={imageCell?.present ? imageCell.text : null}
                        alt=""
                        className="uc-product-image--portrait w-full"
                      />
                      <span className="flex flex-col gap-0.5">
                        {retailerCell?.present ? (
                          <span className="text-xs font-normal text-[var(--uc-foreground-muted)]">
                            {retailerCell.text}
                          </span>
                        ) : null}
                        <span className="font-semibold">
                          {titleRow?.cells[index]?.text ?? item.title}
                        </span>
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {bodyRows.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-[var(--uc-foreground-muted)]">
        Rows marked <strong>not compared</strong> are shown for reading, not for matching. A size
        “M” at one retailer is not a size “M” at another, and two garments both described as “100%
        cotton” cannot be called identical while the wording is whatever each page happened to
        print.
      </p>
    </div>
  );
}

function Row({ row }: { row: CompareRow }) {
  /*
    `differs` is the negation of `agrees` rather than `allAgree === false`, and that
    asymmetry is deliberate. A comparable row whose `allAgree` were somehow undefined would
    then read as "differs" — imprecise, but survivable. Keying both off the field's exact
    value instead lets such a row fall through to "not compared", which is the one thing this
    table must never say about a row that genuinely is compared. `compare.ts` defines the
    field on every comparable row as of `bed61bf`; this is what happens if that ever slips.
  */
  const agrees = row.comparable && row.allAgree === true;
  const differs = row.comparable && !agrees;

  return (
    <tr
      data-testid="compare-row"
      data-row={row.key}
      data-comparable={row.comparable}
      data-differs={differs}
      className="border-b border-[var(--uc-border)] last:border-b-0"
    >
      <th
        scope="row"
        className={[
          'sticky left-0 z-10 w-44 min-w-36 bg-[var(--uc-background)] p-3 text-left align-top font-medium',
          differs ? 'text-[var(--uc-foreground)]' : 'text-[var(--uc-foreground-muted)]',
        ].join(' ')}
      >
        <span className="flex flex-col gap-0.5">
          <span>{row.label}</span>
          {/*
            The verdict is a word, never a colour or a tint alone (WCAG 1.4.1) — and it is
            absent entirely on a descriptive row, because "same" and "differs" are both
            claims those rows cannot support.
          */}
          {differs ? (
            <span className="text-[0.6875rem] font-normal text-[var(--uc-foreground-muted)]">
              differs
            </span>
          ) : agrees ? (
            <span className="text-[0.6875rem] font-normal text-[var(--uc-foreground-muted)]">
              same
            </span>
          ) : (
            <span className="text-[0.6875rem] font-normal text-[var(--uc-foreground-muted)]">
              not compared
            </span>
          )}
        </span>
      </th>

      {row.cells.map((cell) => (
        <td
          key={cell.itemId}
          data-testid="compare-cell"
          data-present={cell.present}
          className={[
            'p-3 align-top',
            // A tint only ever accompanies the word above; it never carries the meaning.
            differs && cell.present ? 'bg-[var(--uc-surface-muted)]' : '',
          ].join(' ')}
        >
          <Cell row={row} cell={cell} />
        </td>
      ))}
    </tr>
  );
}

/**
 * A missing value says so.
 *
 * "—" with nothing else reads as zero, or as an answer. The page did not say, and that is a
 * different thing from the product being free or unavailable.
 */
function Absent() {
  return (
    <span className="text-[var(--uc-foreground-muted)]">
      <span aria-hidden="true">—</span>
      <span className="uc-sr-only">Not stated on the page</span>
    </span>
  );
}

function Cell({ row, cell }: { row: CompareRow; cell: CompareCell }) {
  if (!cell.present) return <Absent />;

  if (row.key === 'price') return <PriceCell cell={cell} />;
  if (row.key === 'original') return <FormerPriceCell cell={cell} />;
  if (row.key === 'price-change') return <ChangeCell cell={cell} />;
  if (row.key === 'desired-price') return <TargetCell cell={cell} />;
  if (row.kind === 'availability') return <AvailabilityCell cell={cell} />;

  return <span className="whitespace-pre-line">{cell.text}</span>;
}

function PriceCell({ cell }: { cell: CompareCell }) {
  const lowest = cell.annotations.includes('lowest');

  return (
    <span className="flex flex-col items-start gap-1">
      <Price
        size="md"
        cadence="one_time"
        value={cell.amount ? { amount: cell.amount, currency: cell.currency ?? null } : null}
        unknownLabel="Price unknown"
      />
      {/*
        Neutral, not green. `tokens.css` reserves the semantic colours, and green in this
        product means an observed price fell or an action succeeded — never "good price".
        "Lowest" is a fact about this set of items and the word carries it.
      */}
      {lowest ? <StatusBadge tone="neutral">Lowest of these</StatusBadge> : null}
    </span>
  );
}

function FormerPriceCell({ cell }: { cell: CompareCell }) {
  const formatted = formatMoney(cell.amount ?? null, cell.currency ?? null) ?? cell.text;
  return (
    <span className="text-[var(--uc-foreground-muted)]">
      <span aria-hidden="true" className="line-through">
        {formatted}
      </span>
      <span className="uc-sr-only">was {formatted}</span>
    </span>
  );
}

/**
 * "▼ 98.00 → 79.95" as money.
 *
 * `compare.ts` builds that string with raw decimals, which are exact but read poorly without
 * a currency. The two amounts are parsed back out and formatted; anything that does not match
 * the expected shape falls through to the original string, so a change to the core degrades
 * this cell rather than breaking it.
 */
function ChangeCell({ cell }: { cell: CompareCell }) {
  const fell = cell.annotations.includes('price-drop');
  const match = /^([▼▲])\s(\S+)\s→\s(\S+)$/u.exec(cell.text ?? '');

  const body = match
    ? `${formatMoney(match[2]!, cell.currency ?? null) ?? match[2]} → ${
        formatMoney(match[3]!, cell.currency ?? null) ?? match[3]
      }`
    : (cell.text ?? '');

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden="true">{fell ? '▼' : '▲'}</span>
      <span className={fell ? 'text-[var(--uc-success)]' : undefined}>{body}</span>
      <span className="uc-sr-only">
        {fell ? 'cheaper than when saved' : 'dearer than when saved'}
      </span>
    </span>
  );
}

function TargetCell({ cell }: { cell: CompareCell }) {
  const met = cell.annotations.includes('below-target');
  const formatted = formatMoney(cell.amount ?? null, cell.currency ?? null) ?? cell.text;

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="tabular-nums">{formatted}</span>
      {/* The one place green is right: an observation recorded the price at or below it. */}
      {met ? <StatusBadge tone="success">Reached</StatusBadge> : null}
    </span>
  );
}

const PRODUCT_AVAILABILITY_WORD: Record<string, string> = {
  in_stock: 'the product is still sold',
  out_of_stock: 'the product is sold out',
  preorder: 'the product is on preorder',
  backorder: 'the product is on backorder',
  unknown: 'the product’s own status is unknown',
};

function AvailabilityCell({ cell }: { cell: CompareCell }) {
  // Present only when the page's product-level claim disagreed with the selected variant's,
  // which by construction of the ingestion function is the only time it is stored at all.
  const product = cell.annotations
    .find((annotation) => annotation.startsWith('product:'))
    ?.slice('product:'.length);

  return (
    <span className="flex flex-col items-start gap-0.5">
      <span>{cell.text}</span>
      {product ? (
        <span className="text-xs text-[var(--uc-foreground-muted)]">
          for the option you chose — {PRODUCT_AVAILABILITY_WORD[product] ?? product}
        </span>
      ) : null}
    </span>
  );
}
