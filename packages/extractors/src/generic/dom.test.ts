import { describe, expect, it } from 'vitest';

import { domExtractor } from './dom';

function extract(body: string, url = 'https://shop.example/p/1') {
  const document = new DOMParser().parseFromString(
    `<!doctype html><html><head><title>Page</title></head><body>${body}</body></html>`,
    'text/html',
  );
  return domExtractor.extract({ document, url });
}

describe('domExtractor — price discipline', () => {
  it('reads an itemprop-annotated price', () => {
    const result = extract(`
      <span itemprop="price" content="129.00">$129.00</span>
      <meta itemprop="priceCurrency" content="USD" />
    `);

    expect(result.offer?.priceAmount).toBe('129.00');
    expect(result.offer?.currency).toBe('USD');
  });

  it('reads a data-price attribute', () => {
    expect(extract('<div data-price="45.50">Forty-five fifty</div>').offer?.priceAmount).toBe(
      '45.50',
    );
  });

  it('does not pick up unrelated money on the page', () => {
    // The single most important property of the DOM fallback.
    const result = extract(`
      <p>Free shipping on orders over $75.00</p>
      <p>Or 4 payments of $32.25</p>
      <p>Members save $10.00</p>
    `);

    expect(result.offer?.priceAmount).toBeUndefined();
  });

  it('reads an original price from a struck-through element', () => {
    const result = extract(`
      <span itemprop="price" content="80.00">$80.00</span>
      <s class="price--original">$100.00</s>
    `);

    expect(result.offer?.priceAmount).toBe('80.00');
    expect(result.offer?.originalPriceAmount).toBe('100.00');
  });
});

describe('domExtractor — the product root', () => {
  it('ignores a price that is not inside the product', () => {
    // Chewy: `[data-price]` matched the first such attribute in document order, which
    // belonged to a recommendation tile for a different product. Searching the whole
    // document is how a heuristic reads someone else's price.
    const result = extract(`
      <section class="recommendations">
        <div class="current-price">$19.99</div>
      </section>
      <main>
        <h1 class="product-title">The product being viewed</h1>
        <div class="current-price">$129.00</div>
      </main>
    `);

    expect(result.offer?.priceAmount).toBe('129.00');
  });

  it('ignores an add-to-cart control that is not inside the product', () => {
    // Gymshark reported out_of_stock from a disabled button belonging to something else.
    const result = extract(`
      <aside class="also-bought">
        <button class="add-to-cart" disabled>Add to cart</button>
      </aside>
      <main>
        <h1 class="product-title">The product being viewed</h1>
        <button class="add-to-cart">Add to cart</button>
      </main>
    `);

    expect(result.offer?.availability).toBe('in_stock');
  });

  it('prefers an itemtype Product container over main', () => {
    const result = extract(`
      <main>
        <div class="current-price">$1.00</div>
        <div itemscope itemtype="https://schema.org/Product">
          <h1 class="product-title">The product</h1>
          <div class="current-price">$129.00</div>
        </div>
      </main>
    `);

    expect(result.offer?.priceAmount).toBe('129.00');
  });

  it('says so in the evidence when it had to search the whole document', () => {
    // A document-wide search is a materially weaker claim than one scoped to the product,
    // and the capture should carry that difference rather than hide it.
    const scoped = extract(
      '<main><h1 class="product-title">P</h1><div class="current-price">$10.00</div></main>',
    );
    const loose = extract('<div class="current-price">$10.00</div>');

    const scopedEvidence = scoped.evidence.find((item) => item.field === 'offer.priceAmount');
    const looseEvidence = loose.evidence.find((item) => item.field === 'offer.priceAmount');

    expect(looseEvidence?.selector).toContain('document');
    expect(scopedEvidence?.selector).not.toContain('document');
    expect(looseEvidence!.confidence).toBeLessThan(scopedEvidence!.confidence);
  });
});

describe('domExtractor — title and brand', () => {
  it('prefers an itemprop name over an h1', () => {
    const result = extract('<h1>Wrong</h1><span itemprop="name">Right</span>');
    expect(result.product?.title).toBe('Right');
  });

  it('prefers a product-classed h1 over a bare one', () => {
    const result = extract('<h1>Site name</h1><h1 class="product-title">Real product</h1>');
    expect(result.product?.title).toBe('Real product');
  });

  it('records the document title separately from the product title', () => {
    const result = extract('<h1 class="product-title">Real product</h1>');
    expect(result.source?.pageTitle).toBe('Page');
    expect(result.product?.title).toBe('Real product');
  });
});

describe('domExtractor — availability', () => {
  it('reads an itemprop availability link', () => {
    const result = extract('<link itemprop="availability" href="https://schema.org/InStock" />');
    expect(result.offer?.availability).toBe('in_stock');
  });

  it('treats a disabled add-to-cart button as out of stock', () => {
    const result = extract('<button class="add-to-cart" disabled>Add to cart</button>');
    expect(result.offer?.availability).toBe('out_of_stock');
  });

  it('treats aria-disabled the same way', () => {
    const result = extract('<button class="add-to-cart" aria-disabled="true">Add to cart</button>');
    expect(result.offer?.availability).toBe('out_of_stock');
  });

  it('treats an enabled add-to-cart button as in stock, but less confidently', () => {
    const result = extract('<button class="add-to-cart">Add to cart</button>');
    expect(result.offer?.availability).toBe('in_stock');

    const evidence = result.evidence.find((item) => item.field === 'offer.availability');
    expect(evidence?.confidence).toBeLessThan(0.5);
  });

  it('does not call the product sold out because one size is', () => {
    // Gymshark marks L, XL and XXL out of stock while M — the size on screen — is buyable.
    // Reading the first sold-out marker reported the whole product unavailable.
    const result = extract(`
      <main>
        <h1 class="product-title">Shorts</h1>
        <div role="radiogroup" aria-label="Size">
          <label class="size size--out-of-stock">L</label>
          <label class="size size--out-of-stock">XL</label>
          <label class="size">M</label>
        </div>
        <button class="add-to-cart">Add to cart</button>
      </main>
    `);

    expect(result.offer?.availability).toBe('in_stock');
  });

  it('still reads a sold-out marker that is about the product', () => {
    const result = extract(`
      <main>
        <h1 class="product-title">Shorts</h1>
        <p class="sold-out">This item is sold out</p>
      </main>
    `);

    expect(result.offer?.availability).toBe('out_of_stock');
  });

  it('reads an explicit sold-out marker', () => {
    const result = extract('<p class="sold-out">Sold out</p>');
    expect(result.offer?.availability).toBe('out_of_stock');
  });

  it('says nothing when there is no signal', () => {
    expect(extract('<p>Some copy</p>').offer?.availability).toBeUndefined();
  });
});

describe('domExtractor — images', () => {
  it('resolves relative gallery images', () => {
    const result = extract('<div class="product-gallery"><img src="/a.jpg" /></div>');
    expect(result.product?.imageUrls).toEqual(['https://shop.example/a.jpg']);
  });

  it('does not carry inline data images', () => {
    const result = extract(
      '<div class="product-gallery"><img src="data:image/png;base64,AAA" /></div>',
    );
    expect(result.product?.imageUrls).toBeUndefined();
  });

  it('takes the real image from data-src when src holds a lazy placeholder', () => {
    // Lazy loaders park a 1x1 data: URI in src and keep the real URL in data-src. Committing
    // to src merely because the attribute exists loses the image on every such page.
    const result = extract(`
      <div class="product-gallery">
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
             data-src="/hero.jpg" />
      </div>
    `);

    expect(result.product?.imageUrls).toEqual(['https://shop.example/hero.jpg']);
    expect(result.product?.selectedImageUrl).toBe('https://shop.example/hero.jpg');
  });

  it('falls back to the first candidate in a srcset', () => {
    const result = extract(`
      <div class="product-gallery">
        <img data-srcset="/hero-400.jpg 400w, /hero-800.jpg 800w" />
      </div>
    `);

    expect(result.product?.imageUrls).toEqual(['https://shop.example/hero-400.jpg']);
  });

  it('keeps the gallery image ahead of a recommendation tile', () => {
    // Recommendation cards reuse product-ish class names. The gallery selector ranks above
    // the generic one, so the hero image stays the selected one even though both are kept
    // as candidates.
    const result = extract(`
      <section class="recommendations">
        <div class="product-image"><img src="/also-bought.jpg" /></div>
      </section>
      <div class="product-gallery"><img src="/hero.jpg" /></div>
    `);

    expect(result.product?.selectedImageUrl).toBe('https://shop.example/hero.jpg');
  });
});

describe('domExtractor — evidence', () => {
  it('records a selector for every field it claims', () => {
    // Wrapped in <main> so this tests what it says it tests. Loose markup with no product
    // region falls back to a document-wide search, which prefixes the selector — that path
    // has its own test in "the product root".
    const result = extract(`
      <main>
        <h1 class="product-title">A lamp</h1>
        <span itemprop="price" content="10.00">$10.00</span>
      </main>
    `);

    const titleEvidence = result.evidence.find((item) => item.field === 'product.title');
    expect(titleEvidence?.selector).toBe('h1[class*="product"]');
    expect(titleEvidence?.source).toBe('dom');
  });

  it('keeps every confidence below the structured-data range', () => {
    const result = extract(`
      <h1 class="product-title">A lamp</h1>
      <span itemprop="price" content="10.00">$10.00</span>
      <div class="product-gallery"><img src="/a.jpg" /></div>
    `);

    for (const item of result.evidence) {
      expect(item.confidence).toBeLessThanOrEqual(0.6);
    }
  });

  it('always claims to support a page, so there is always a fallback', () => {
    const document = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    expect(domExtractor.supports({ document, url: 'https://shop.example/p' })).toBe(true);
  });
});
