import { describe, expect, it } from 'vitest';

import {
  extractSelectedVariantFromDom,
  extractSelectedVariantFromUrl,
  mergeVariants,
} from './variant';

function parse(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>${body}</body></html>`,
    'text/html',
  );
}

describe('extractSelectedVariantFromDom — select elements', () => {
  it('reads the selected option with its label', () => {
    const document = parse(`
      <label for="size">Size</label>
      <select id="size">
        <option value="s">Small</option>
        <option value="m" selected>Medium</option>
      </select>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({ Size: 'Medium' });
  });

  it('strips a trailing colon from the label', () => {
    const document = parse(`
      <label for="size">Size:</label>
      <select id="size"><option value="m" selected>Medium</option></select>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({ Size: 'Medium' });
  });

  it('ignores a placeholder option with no value', () => {
    const document = parse(`
      <label for="size">Size</label>
      <select id="size">
        <option value="" selected>Choose a size</option>
        <option value="m">Medium</option>
      </select>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({});
  });

  it('reads a fieldset legend when there is no label', () => {
    const document = parse(`
      <fieldset><legend>Storage</legend>
        <select><option value="256" selected>256 GB</option></select>
      </fieldset>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({ Storage: '256 GB' });
  });
});

describe('extractSelectedVariantFromDom — radio inputs', () => {
  it('reads the checked radio and its group name', () => {
    const document = parse(`
      <fieldset data-option-name="Finish">
        <label for="a">Brushed Brass</label>
        <input type="radio" id="a" name="finish" value="brass" checked />
        <label for="b">Matte Black</label>
        <input type="radio" id="b" name="finish" value="black" />
      </fieldset>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({ Finish: 'Brushed Brass' });
  });

  it('reads a radiogroup labelled by another element', () => {
    const document = parse(`
      <span id="colour-label">Colour</span>
      <div role="radiogroup" aria-labelledby="colour-label">
        <label for="c1">Sand</label>
        <input type="radio" id="c1" name="colour" value="sand" checked />
      </div>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({ Colour: 'Sand' });
  });

  it('reports nothing when no radio is checked', () => {
    const document = parse(`
      <fieldset data-option-name="Finish">
        <input type="radio" id="a" name="finish" value="brass" />
      </fieldset>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({});
  });
});

describe('extractSelectedVariantFromDom — ARIA controls', () => {
  it('reads aria-checked buttons', () => {
    const document = parse(`
      <div role="radiogroup" aria-label="Size">
        <button aria-checked="true" aria-label="US 10">10</button>
        <button aria-checked="false" aria-label="US 11">11</button>
      </div>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({ Size: 'US 10' });
  });

  it('reads aria-pressed buttons', () => {
    const document = parse(`
      <fieldset data-option-name="Length">
        <button aria-pressed="true">Regular</button>
      </fieldset>
    `);

    expect(extractSelectedVariantFromDom(document)).toEqual({ Length: 'Regular' });
  });

  it('never reports the unselected options', () => {
    const document = parse(`
      <div role="radiogroup" aria-label="Size">
        <button aria-checked="true" aria-label="10">10</button>
        <button aria-checked="false" aria-label="11">11</button>
        <button aria-checked="false" aria-label="12">12</button>
      </div>
    `);

    const variant = extractSelectedVariantFromDom(document);
    expect(Object.values(variant)).toEqual(['10']);
  });
});

describe('extractSelectedVariantFromUrl', () => {
  it('reads option-like parameters', () => {
    expect(extractSelectedVariantFromUrl('https://shop.example/p?color=blue&size=M')).toEqual({
      Color: 'blue',
      Size: 'M',
    });
  });

  it('ignores parameters that are not options', () => {
    expect(
      extractSelectedVariantFromUrl('https://shop.example/p?utm_source=x&page=2&ref=abc'),
    ).toEqual({});
  });

  it('returns nothing for an unparseable URL', () => {
    expect(extractSelectedVariantFromUrl('not a url')).toEqual({});
  });
});

describe('mergeVariants', () => {
  it('lets the DOM win over the URL', () => {
    // A client-side variant switch updates the DOM before it updates the URL.
    expect(mergeVariants({ Color: 'Red' }, { Color: 'Blue', Size: 'M' })).toEqual({
      Color: 'Red',
      Size: 'M',
    });
  });
});
