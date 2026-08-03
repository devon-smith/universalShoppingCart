import { extractProductCapture } from '@universal-cart/extractors';
import type { ParsedObservation } from '@universal-cart/refresh';
import { parseHTML } from 'linkedom';

/**
 * Turn fetched HTML into an observation, using the same extractor pipeline the extension runs but
 * over a server DOM (`linkedom`). Returns null when the page yields no usable price — a background
 * refresh records only what it actually observed, never a "price became unknown" from a parse
 * that simply found none.
 *
 * Only the structured-data and meta tiers are expected to fire here: a background fetch sees raw
 * server HTML, which is exactly why client-rendered domains are classified `browser_required` and
 * never reach this path (packages/refresh, classifyRefresh).
 */
export function parseObservation(html: string, url: string): ParsedObservation | null {
  const { document } = parseHTML(html);
  const result = extractProductCapture({ document: document as unknown as Document, url });
  if (!result.ok || result.capture.offer.priceAmount === null) return null;

  const { offer, extraction } = result.capture;
  return {
    price: offer.priceAmount,
    originalPrice: offer.originalPriceAmount,
    currency: offer.currency,
    availability: offer.availability,
    extractorId: extraction.extractorId,
    extractorVersion: extraction.extractorVersion,
    confidence: extraction.overallConfidence,
  };
}
