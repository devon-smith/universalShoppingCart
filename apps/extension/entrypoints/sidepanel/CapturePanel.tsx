import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { fieldsNeedingReview } from '@universal-cart/extractors';
import { useCallback, useEffect, useState } from 'react';

import { requestCapture } from '@/lib/capture/request';
import type { UserFields } from '@/lib/capture/save';
import { saveCapture } from '@/lib/capture/save';
import { getSupabase } from '@/lib/supabase/client';

interface Cart {
  id: string;
  name: string;
  is_default: boolean;
}

type Stage =
  | { name: 'idle' }
  | { name: 'extracting' }
  | { name: 'preview'; capture: ProductCaptureV1; needsReview: string[] }
  | { name: 'saving'; capture: ProductCaptureV1 }
  | { name: 'saved'; title: string; created: boolean }
  | { name: 'error'; message: string };

interface Draft {
  title: string;
  priceAmount: string;
  currency: string;
  note: string;
  quantity: string;
}

function draftFrom(capture: ProductCaptureV1): Draft {
  return {
    title: capture.product.title ?? '',
    priceAmount: capture.offer.priceAmount ?? '',
    currency: capture.offer.currency ?? '',
    note: '',
    quantity: '1',
  };
}

/** Only send fields the user actually changed or filled in. */
function userFieldsFrom(draft: Draft, capture: ProductCaptureV1): UserFields {
  const fields: UserFields = {};

  const title = draft.title.trim();
  if (title && title !== capture.product.title) fields.title = title;

  const price = draft.priceAmount.trim();
  if (price && price !== capture.offer.priceAmount) fields.priceAmount = price;

  const currency = draft.currency.trim().toUpperCase();
  if (currency && currency !== capture.offer.currency) fields.currency = currency;

  const note = draft.note.trim();
  if (note) fields.note = note;

  const quantity = Number.parseInt(draft.quantity, 10);
  if (Number.isFinite(quantity) && quantity > 1) fields.quantity = quantity;

  return fields;
}

/**
 * The tab to capture.
 *
 * Only the id is used. With `activeTab` and no `tabs` permission the URL is not readable
 * from here, which is the point: the injected script checks its own page and refuses the
 * ones the extension promises never to read.
 */
async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export function CapturePanel({ onSaved }: { onSaved: () => void }) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [draft, setDraft] = useState<Draft>({
    title: '',
    priceAmount: '',
    currency: '',
    note: '',
    quantity: '1',
  });
  const [carts, setCarts] = useState<Cart[]>([]);
  const [cartId, setCartId] = useState<string>('');

  useEffect(() => {
    let active = true;

    getSupabase()
      .from('carts')
      .select('id, name, is_default')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!active || !data) return;
        setCarts(data);
        setCartId((current) => current || (data[0]?.id ?? ''));
      });

    return () => {
      active = false;
    };
  }, []);

  const capture = useCallback(async () => {
    setStage({ name: 'extracting' });

    try {
      const tabId = await activeTabId();
      if (tabId === undefined) {
        setStage({ name: 'error', message: 'No active tab to capture.' });
        return;
      }

      const result = await requestCapture({
        scripting: chrome.scripting,
        tabs: chrome.tabs,
        tabId,
      });

      if (!result.ok) {
        setStage({ name: 'error', message: result.issues.join('; ') });
        return;
      }

      setDraft(draftFrom(result.capture));
      setStage({
        name: 'preview',
        capture: result.capture,
        needsReview: fieldsNeedingReview(result.capture),
      });
    } catch (error) {
      setStage({
        name: 'error',
        message: error instanceof Error ? error.message : 'Capture failed.',
      });
    }
  }, []);

  async function save(capturePayload: ProductCaptureV1) {
    setStage({ name: 'saving', capture: capturePayload });

    try {
      const result = await saveCapture({
        client: getSupabase(),
        capture: capturePayload,
        cartId,
        userFields: userFieldsFrom(draft, capturePayload),
      });

      setStage({
        name: 'saved',
        title: result.item.title,
        created: result.created,
      });
      onSaved();
    } catch (error) {
      setStage({
        name: 'error',
        message: error instanceof Error ? error.message : 'Save failed.',
      });
    }
  }

  return (
    <section className="panel__section" aria-labelledby="capture-heading">
      <h2 id="capture-heading" className="panel__section-title">
        Save a product
      </h2>

      {stage.name === 'error' ? (
        <p role="alert" className="panel__error">
          {stage.message}
        </p>
      ) : null}

      {stage.name === 'saved' ? (
        <p role="status" className="panel__success">
          {stage.created
            ? `Saved “${stage.title}”.`
            : `Already saved — “${stage.title}” refreshed.`}
        </p>
      ) : null}

      {stage.name === 'preview' || stage.name === 'saving' ? (
        <form
          className="panel__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(stage.capture);
          }}
        >
          {stage.name === 'preview' && stage.needsReview.length > 0 ? (
            <p className="panel__notice" role="note">
              Check the highlighted fields — the page did not state them clearly.
            </p>
          ) : null}

          {stage.capture.product.selectedImageUrl ? (
            <img
              className="panel__preview-image"
              src={stage.capture.product.selectedImageUrl}
              alt=""
            />
          ) : null}

          <label className="panel__label" htmlFor="capture-title">
            Title
            {stage.name === 'preview' && stage.needsReview.includes('product.title') ? ' ⚠' : ''}
          </label>
          <input
            id="capture-title"
            className="panel__input"
            required
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />

          <label className="panel__label" htmlFor="capture-price">
            Price
            {stage.name === 'preview' && stage.needsReview.includes('offer.priceAmount')
              ? ' ⚠'
              : ''}
          </label>
          <input
            id="capture-price"
            className="panel__input"
            inputMode="decimal"
            placeholder="19.99"
            value={draft.priceAmount}
            onChange={(event) => setDraft({ ...draft, priceAmount: event.target.value })}
          />

          <label className="panel__label" htmlFor="capture-currency">
            Currency
            {stage.name === 'preview' && stage.needsReview.includes('offer.currency') ? ' ⚠' : ''}
          </label>
          <input
            id="capture-currency"
            className="panel__input"
            maxLength={3}
            placeholder="USD"
            value={draft.currency}
            onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
          />

          {Object.keys(stage.capture.selectedVariant).length > 0 ? (
            <ul className="panel__chips" aria-label="Selected options">
              {Object.entries(stage.capture.selectedVariant).map(([name, value]) => (
                <li key={name} className="panel__chip">
                  {name}: {value}
                </li>
              ))}
            </ul>
          ) : null}

          <label className="panel__label" htmlFor="capture-quantity">
            Quantity
          </label>
          <input
            id="capture-quantity"
            className="panel__input"
            inputMode="numeric"
            value={draft.quantity}
            onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
          />

          <label className="panel__label" htmlFor="capture-note">
            Note
          </label>
          <input
            id="capture-note"
            className="panel__input"
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />

          <label className="panel__label" htmlFor="capture-cart">
            Save to
          </label>
          <select
            id="capture-cart"
            className="panel__input"
            value={cartId}
            onChange={(event) => setCartId(event.target.value)}
          >
            {carts.map((cart) => (
              <option key={cart.id} value={cart.id}>
                {cart.name}
                {cart.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="panel__button panel__button--primary"
            disabled={stage.name === 'saving' || !cartId}
          >
            {stage.name === 'saving' ? 'Saving…' : 'Save to cart'}
          </button>
          <button
            type="button"
            className="panel__link-button"
            onClick={() => setStage({ name: 'idle' })}
          >
            Cancel
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="panel__button panel__button--primary"
          disabled={stage.name === 'extracting'}
          onClick={() => void capture()}
        >
          {stage.name === 'extracting' ? 'Reading the page…' : 'Capture this page'}
        </button>
      )}
    </section>
  );
}
