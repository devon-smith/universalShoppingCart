/**
 * Display-layer tidying for values the retailer chose, not values we derived.
 *
 * Nothing here re-extracts. The stored `title` is what the page said and stays the record of
 * that; these functions decide what to *show*. Keeping the two apart matters because the
 * extractor's fixtures pin exact strings, and because a trimming rule that turns out to be
 * wrong should be fixable without re-capturing anything.
 *
 * Both rules below are conservative in the same direction: when in doubt, show the original.
 * A title with a bit of noise on the end is a small annoyance; a title with its actual product
 * name trimmed off is unusable.
 */

/** Separators retailers use to bolt marketing onto a page title. */
const SEGMENT_SPLIT = /\s+[|·—–]\s+|\s+-\s+/;

/**
 * Tail segments worth dropping. Each must be the *whole* segment — matching a substring
 * would eat real product names ("Free People", "Review Camera Bag").
 */
const NOISE_SEGMENT = [
  /^&?\s*reviews?$/i,
  /^ratings?\s*&?\s*reviews?$/i,
  /^free (shipping|delivery|returns)$/i,
  /^buy online$/i,
  /^shop (now|online)$/i,
  /^official (site|store)$/i,
  /^official$/i,
  /^online shopping$/i,
  /^[a-z]{2,3}$/i, // a locale tail such as "US", "UK", "CA"
];

/** Trailing marketing glued on without a separator, e.g. "Sofa & Reviews". */
const NOISE_SUFFIX = /\s*&\s*reviews?\s*$/i;

/** Loose comparison for "is this segment naming the shop we already know about". */
function sameThing(a: string, b: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const left = normalize(a);
  const right = normalize(b);
  return left.length > 0 && left === right;
}

/**
 * The labels of a host, any of which might be the shop's name.
 *
 * Not "the part before the first dot" — that is `shop` in `shop.northwind.example` and
 * `www` half the time. Comparing against every label costs nothing and gets the real cases
 * right without shipping a public-suffix list. A false match can only ever remove a trailing
 * segment that reads like part of the hostname, which is a segment worth removing anyway.
 */
function domainWords(domain: string): string[] {
  return domain.split('.').filter((label) => label.length > 0);
}

/**
 * The product title, with page-title furniture removed.
 *
 * Retailers put the shop name, the review count and a shipping promise into `<title>`, and
 * several of our sources fall back to it. "Alcott 3-Seater Sofa & Reviews | Wayfair" is one
 * product name and two things the user already knows — they are looking at a Wayfair item, in
 * a row that says Wayfair beside it.
 *
 * The first segment is never dropped, whatever it says. That is the rule that makes this safe
 * to run on every title including ones nobody has looked at.
 */
export function displayTitle(
  title: string,
  retailerName?: string | null,
  domain?: string | null,
): string {
  const trimmed = title.trim();
  if (trimmed.length === 0) return title;

  const segments = trimmed.split(SEGMENT_SPLIT);
  if (segments.length === 0) return trimmed;

  const shopWords = [retailerName ?? '', ...(domain ? domainWords(domain) : [])].filter(
    (value) => value.length > 0,
  );

  // Walk in from the end, keeping at least the first segment.
  let end = segments.length;
  while (end > 1) {
    const candidate = (segments[end - 1] ?? '').trim();
    const isShop = shopWords.some((word) => sameThing(candidate, word));
    const isNoise = NOISE_SEGMENT.some((pattern) => pattern.test(candidate));
    if (!isShop && !isNoise) break;
    end -= 1;
  }

  const kept = segments.slice(0, end).join(' | ').trim();
  const withoutSuffix = kept.replace(NOISE_SUFFIX, '').trim();

  // Never return nothing. If the rules ate the title, the title wins.
  return withoutSuffix.length > 0 ? withoutSuffix : trimmed;
}

export interface SourceLine {
  /** What to show. One entry when brand and retailer are the same fact. */
  parts: string[];
  text: string;
}

/**
 * Who is selling this, said once.
 *
 * Many captures set `brand` from the same node the retailer name came from, so a card would
 * read "Northwind · Northwind". That is not two facts, and printing it twice makes the data
 * look careless in a place where the user is deciding whether to trust it.
 */
export function sourceLine(brand: string | null, retailerName: string): SourceLine {
  const cleanBrand = (brand ?? '').trim();

  const parts =
    cleanBrand.length === 0 || sameThing(cleanBrand, retailerName)
      ? [retailerName]
      : [cleanBrand, retailerName];

  return { parts, text: parts.join(' · ') };
}
