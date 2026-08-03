import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Price } from './Price';
import { compareDecimal, formatMoney } from './money';

/**
 * `Price` renders money, so these are the tests that matter most in the package.
 *
 * The three "must be structurally impossible" cases are each drawn from a real page we have
 * captured, not invented: Chewy's 10.99–145.94 aggregate offer, the "or 4 payments of $32.25"
 * line the DOM extractor was explicitly built to ignore, and Chewy's autoship price sitting
 * below its buy-once price in the same slot.
 */

const usd = (amount: string) => ({ amount, currency: 'USD' });

describe('Price — the three ways money gets misrepresented', () => {
  it('cannot render a price range as a discount', () => {
    // The dangerous shape: a naive component handed 10.99 and 145.94 draws a 92% saving on a
    // size nobody sells. `range` has no strikethrough to give, and there is no prop pair that
    // takes two loose amounts, so the mistake has nowhere to happen.
    render(
      <Price value={null} cadence="one_time" range={{ from: usd('10.99'), to: usd('145.94') }} />,
    );

    expect(screen.getByText(/\$10\.99\s+–\s+\$145\.94/)).toBeTruthy();
    expect(document.querySelector('.uc-price__original')).toBeNull();
  });

  it('refuses a "list price" that is not above the current price', () => {
    // A caller who mislabels the low end of a range as a was-price gets no saving drawn,
    // rather than an invented one.
    render(<Price value={usd('145.94')} cadence="one_time" listPrice={usd('10.99')} />);

    expect(document.querySelector('.uc-price__original')).toBeNull();
    expect(document.querySelector('.uc-price__amount')?.textContent).toBe('$145.94');
  });

  it('cannot render an instalment as a total', () => {
    // "Or 4 payments of $32.25". Stating the cadence is not optional, and the marker is
    // rendered from it, so a per-month figure cannot reach the screen looking like a total.
    render(<Price value={usd('32.25')} cadence="per_month" />);

    expect(screen.getByText('/mo')).toBeTruthy();
    expect(screen.getByText(/\$32\.25 per month/)).toBeTruthy();
  });

  it('cannot render a subscription price as a one-time price', () => {
    render(<Price value={usd('47.97')} cadence="per_delivery" />);

    expect(screen.getByText('/delivery')).toBeTruthy();
    expect(screen.getByText(/\$47\.97 per delivery/)).toBeTruthy();
  });
});

describe('Price — what it shows', () => {
  it('formats a decimal string through Intl with the currency attached', () => {
    render(<Price value={usd('98.00')} cadence="one_time" />);
    expect(document.querySelector('.uc-price__amount')?.textContent).toBe('$98.00');
  });

  it('draws a saving only when the list price is genuinely higher', () => {
    render(<Price value={usd('84.00')} cadence="one_time" listPrice={usd('120.00')} />);

    expect(document.querySelector('.uc-price__original')?.textContent).toBe('$120.00');
    expect(screen.getByText('$84.00, reduced from $120.00')).toBeTruthy();
  });

  it('says the price is missing rather than showing zero', () => {
    render(<Price value={null} cadence="one_time" />);
    expect(screen.getByText('No price')).toBeTruthy();
  });

  it('shows the digits without a symbol when the currency is unknown', () => {
    // A guessed `$` is at least four different currencies. Missing beats wrong.
    render(<Price value={{ amount: '35.95', currency: null }} cadence="one_time" />);

    const rendered = document.querySelector('.uc-price__amount')!;
    expect(rendered.textContent).toBe('35.95');
    expect(rendered.textContent).not.toContain('$');
  });

  it('gives a screen reader one sentence rather than three fragments', () => {
    render(<Price value={usd('84.00')} cadence="per_month" listPrice={usd('120.00')} />);

    // The visual parts are hidden from assistive technology; the spoken string carries the
    // relationship between them, which three separate nodes could not.
    expect(screen.getByText('$84.00 per month, reduced from $120.00')).toBeTruthy();
    expect(document.querySelector('.uc-price__contents')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('money helpers', () => {
  it('compares decimal strings exactly, not as floats', () => {
    expect(compareDecimal('9.90', '9.9')).toBe(0);
    expect(compareDecimal('10.00', '9.90')).toBe(1);
    expect(compareDecimal('0.30', '0.1')).toBe(1);
    // 0.1 + 0.2 !== 0.3 in binary floating point; string comparison does not care.
    expect(compareDecimal('0.3', '0.30')).toBe(0);
  });

  it('reports a non-decimal rather than guessing', () => {
    expect(compareDecimal('1e3', '1000')).toBeNull();
    expect(compareDecimal('', '1')).toBeNull();
  });

  it('survives a currency code Intl does not know', () => {
    expect(formatMoney('10.00', 'NOTACODE')).toBe('10.00 NOTACODE');
  });
});

describe('Price discount percentage', () => {
  it('shows the saving beside a genuine list price', () => {
    render(
      <Price
        cadence="one_time"
        value={{ amount: '98.00', currency: 'USD' }}
        listPrice={{ amount: '120.00', currency: 'USD' }}
      />,
    );

    expect(document.querySelector('.uc-price__saving')?.textContent).toBe('−18%');
  });

  it('shows no percentage when there is no list price', () => {
    render(<Price cadence="one_time" value={{ amount: '98.00', currency: 'USD' }} />);
    expect(document.querySelector('.uc-price__saving')).toBeNull();
  });

  it('shows no percentage when the "original" is not higher', () => {
    render(
      <Price
        cadence="one_time"
        value={{ amount: '98.00', currency: 'USD' }}
        listPrice={{ amount: '98.00', currency: 'USD' }}
      />,
    );

    expect(document.querySelector('.uc-price__saving')).toBeNull();
    expect(document.querySelector('.uc-price__original')).toBeNull();
  });

  it('gives a range no percentage, because a range is not a discount', () => {
    render(
      <Price
        cadence="one_time"
        value={null}
        range={{
          from: { amount: '10.99', currency: 'USD' },
          to: { amount: '145.94', currency: 'USD' },
        }}
      />,
    );

    expect(document.querySelector('.uc-price__saving')).toBeNull();
    expect(document.querySelector('.uc-price__original')).toBeNull();
  });

  it('stays silent rather than rounding to a meaningless 0%', () => {
    render(
      <Price
        cadence="one_time"
        value={{ amount: '99.999', currency: 'USD' }}
        listPrice={{ amount: '100.00', currency: 'USD' }}
      />,
    );

    // The strikethrough is honest — it really is lower — but "−0%" is not information.
    expect(document.querySelector('.uc-price__original')).toBeTruthy();
    expect(document.querySelector('.uc-price__saving')).toBeNull();
  });

  it('keeps the percentage out of the spoken string, which already names both amounts', () => {
    render(
      <Price
        cadence="one_time"
        value={{ amount: '98.00', currency: 'USD' }}
        listPrice={{ amount: '120.00', currency: 'USD' }}
      />,
    );

    expect(document.querySelector('.uc-sr-only')?.textContent).toBe('$98.00, reduced from $120.00');
  });
});
