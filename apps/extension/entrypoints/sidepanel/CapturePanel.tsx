import type { ProductCaptureV1 } from '@universal-cart/contracts';
import { fieldsNeedingReview } from '@universal-cart/extractors';
import {
  Badge,
  Button,
  Callout,
  IconButton,
  Price,
  ProductImage,
  Skeleton,
  StatusBadge,
  TextInput,
} from '@universal-cart/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Cart } from './PanelHeader';

import { takePendingCapture } from '@/lib/capture/pending';
import { PERMISSION_HELP, requestCapture } from '@/lib/capture/request';
import { isCaptureFailed, isCaptureReady } from '@/lib/messaging/protocol';
import type { RevisitResult } from '@/lib/capture/revisit';
import { itemLookup, refreshFromPage } from '@/lib/capture/revisit';
import type { UserFields } from '@/lib/capture/save';
import { saveCapture } from '@/lib/capture/save';
import { getSupabase } from '@/lib/supabase/client';

type Stage =
  | { name: 'idle' }
  | { name: 'extracting' }
  | { name: 'preview'; capture: ProductCaptureV1; needsReview: string[] }
  | { name: 'saving'; capture: ProductCaptureV1 }
  | { name: 'saved'; title: string; created: boolean }
  | { name: 'refreshed'; title: string; changed: boolean }
  | { name: 'error'; message: string }
  /** The page cannot be read from here. Not a failure — a different gesture is needed. */
  | { name: 'blocked'; message: string };

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

export function CapturePanel({
  onSaved,
  carts,
  cartId,
  onChangeCart,
}: {
  onSaved: () => void;
  carts: Cart[];
  cartId: string;
  /** Moves focus to the header's cart selector, the single control that owns the choice. */
  onChangeCart: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [draft, setDraft] = useState<Draft>({
    title: '',
    priceAmount: '',
    currency: '',
    note: '',
    quantity: '1',
  });

  /** Read the page in front of the user, or explain why it could not be read. */
  const readPage = useCallback(async (): Promise<ProductCaptureV1 | null> => {
    const tabId = await activeTabId();
    if (tabId === undefined) throw new Error('No active tab to capture.');

    const result = await requestCapture({
      scripting: chrome.scripting,
      tabs: chrome.tabs,
      tabId,
    });

    if (!result.ok) throw new Error(result.issues.join('; '));
    return result.capture;
  }, []);

  const capture = useCallback(async () => {
    setStage({ name: 'extracting' });

    try {
      const page = await readPage();
      if (!page) return;

      setDraft(draftFrom(page));
      setStage({ name: 'preview', capture: page, needsReview: fieldsNeedingReview(page) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Capture failed.';
      // A refused page is not a broken one. Chrome ends the grant when the page navigates, and
      // the fix is a different gesture rather than a setting, so this reads as an instruction.
      setStage(
        message === PERMISSION_HELP ? { name: 'blocked', message } : { name: 'error', message },
      );
    }
  }, [readPage]);

  /**
   * Collect a capture the background worker already took.
   *
   * The context-menu and keyboard paths extract *before* this panel is necessarily open,
   * because only those invocations hold `activeTab` for the page (lib/manifest.ts,
   * CAPTURE_INVOCATIONS). The result travels through session storage, so it does not
   * matter whether the panel or the capture got there first; the message below is only a
   * nudge for a panel that was already open.
   */
  useEffect(() => {
    let active = true;

    const collect = () => {
      takePendingCapture(chrome.storage.session)
        .then((pending) => {
          if (!active || !pending) return;

          if (!pending.result.ok) {
            setStage({ name: 'error', message: pending.result.issues.join('; ') });
            return;
          }

          const page = pending.result.capture;
          setDraft(draftFrom(page));
          setStage({ name: 'preview', capture: page, needsReview: fieldsNeedingReview(page) });
        })
        .catch(() => undefined);
    };

    collect();

    const onMessage = (message: unknown) => {
      if (isCaptureReady(message)) collect();
      else if (isCaptureFailed(message)) setStage({ name: 'error', message: message.message });
    };

    chrome.runtime.onMessage.addListener(onMessage);

    return () => {
      active = false;
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  /**
   * Re-observe the page if it is already saved (BUILD_PLAN.md §14.1).
   *
   * Known limitation: this runs on mount, with no user invocation on the tab, so it cannot
   * hold `activeTab` and reads nothing on a page the user navigated to after opening the
   * panel. It fails silently by design — the user did not ask for anything — but that
   * means automatic revisit is effectively inert in a release build. Making it work needs
   * an optional host permission for the origin, granted at the user's request; see
   * docs/RUNBOOK.md.
   *
   * Extraction happens locally; nothing is sent anywhere unless the fingerprint matches
   * something the user already saved, so opening the panel on an unsaved page leaves no
   * trace. Returns null when there was nothing to refresh, including when the page could
   * not be read — the user did not ask for anything, so there is nothing to report.
   */
  const observeCurrentPage = useCallback(async (): Promise<RevisitResult | null> => {
    try {
      const page = await readPage();
      if (!page) return null;

      const supabase = getSupabase();
      return await refreshFromPage({
        client: supabase,
        lookup: itemLookup((fingerprint) =>
          supabase
            .from('items')
            .select('id, cart_id, title')
            .eq('fingerprint', fingerprint)
            .neq('status', 'archived')
            .limit(1),
        ),
        capture: page,
      });
    } catch {
      return null;
    }
  }, [readPage]);

  const showRefreshed = useCallback(
    (result: RevisitResult) => {
      setStage({
        name: 'refreshed',
        title: result.match.title,
        changed: result.observationInserted,
      });
      onSaved();
    },
    [onSaved],
  );

  useEffect(() => {
    let active = true;

    void observeCurrentPage().then((result) => {
      if (!active || !result) return;
      showRefreshed(result);
    });

    return () => {
      active = false;
    };
    // Deliberately once per panel open, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revisit() {
    const result = await observeCurrentPage();
    if (result) showRefreshed(result);
  }

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

  const reviewing = stage.name === 'preview' ? stage.needsReview : [];
  const flagged = (field: string) => reviewing.includes(field);

  // Focus the first field that needs a decision, so a keyboard user lands on the work rather
  // than at the top of a form. Only when review is required — stealing focus otherwise would
  // fight the user who is reaching for Save.
  const firstFlaggedRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (stage.name === 'preview' && stage.needsReview.length > 0) firstFlaggedRef.current?.focus();
  }, [stage]);

  return (
    <section className="capture" aria-labelledby="capture-heading">
      {/* Extraction finishes without a click, so its outcome is announced rather than merely
          rendered. Errors interrupt; a successful read waits for a pause. */}
      {/* `aria-live` without `role="status"`: the role would make this a second status region
          alongside the save and refresh messages, and "the panel's status" should be one
          thing. Announcement comes from the live attribute either way. */}
      <p className="uc-sr-only" aria-live="polite">
        {stage.name === 'preview'
          ? stage.needsReview.length > 0
            ? `Product details read. ${stage.needsReview.length} field needs checking.`
            : 'Product details read.'
          : stage.name === 'extracting'
            ? 'Reading product details.'
            : ''}
      </p>

      {stage.name === 'error' ? (
        <Callout tone="danger" title="Could not read this page">
          {stage.message}
        </Callout>
      ) : null}

      {stage.name === 'saved' ? (
        <Callout tone="success">
          {stage.created
            ? `Saved “${stage.title}”.`
            : `Already saved — “${stage.title}” refreshed.`}
        </Callout>
      ) : null}

      {stage.name === 'refreshed' ? (
        <Callout tone="success">
          {stage.changed
            ? `“${stage.title}” is already saved — price and availability updated.`
            : `“${stage.title}” is already saved — nothing has changed.`}
        </Callout>
      ) : null}

      {stage.name === 'extracting' ? (
        /* A skeleton in the shape the preview will occupy, so nothing jumps when it arrives. */
        <div className="capture__loading" aria-hidden="true">
          <Skeleton height="140px" />
          <Skeleton width="35%" height="0.75rem" />
          <Skeleton width="80%" height="1.25rem" />
          <Skeleton width="45%" height="1.75rem" />
          <div className="capture__loading-row">
            <Skeleton width="72px" height="1.25rem" />
            <Skeleton width="60px" height="1.25rem" />
          </div>
        </div>
      ) : null}

      {stage.name === 'extracting' ? (
        <p className="capture__reading">Reading product details…</p>
      ) : null}

      {stage.name === 'blocked' ? (
        <div className="capture__blocked">
          <h2 id="capture-heading" className="capture__title">
            This page needs your go-ahead
          </h2>
          <p className="capture__lede">{stage.message}</p>
        </div>
      ) : null}

      {stage.name === 'preview' || stage.name === 'saving' ? (
        <PreviewForm
          capture={stage.capture}
          saving={stage.name === 'saving'}
          draft={draft}
          setDraft={setDraft}
          flagged={flagged}
          reviewCount={reviewing.length}
          firstFlaggedRef={firstFlaggedRef}
          cartName={carts.find((cart) => cart.id === cartId)?.name ?? 'your cart'}
          onChangeCart={onChangeCart}
          canSave={Boolean(cartId)}
          onSubmit={() => void save(stage.capture)}
          onCancel={() => setStage({ name: 'idle' })}
        />
      ) : stage.name === 'extracting' ? null : (
        <div className="capture__idle">
          {stage.name === 'blocked' ? null : (
            <h2 id="capture-heading" className="capture__title">
              Save this product
            </h2>
          )}
          {stage.name === 'idle' ? (
            <p className="capture__lede">
              Keep it beside the others you are choosing between, with its price watched from here.
            </p>
          ) : null}

          <Button
            tone="primary"
            fullWidth
            className="capture__action"
            onClick={() => void capture()}
          >
            Capture this page
          </Button>

          <p className="capture__hint">
            or press <kbd className="capture__kbd">⌘⇧U</kbd>
          </p>

          {stage.name === 'refreshed' ? (
            <Button fullWidth onClick={() => void revisit()}>
              Refresh from this page
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * The capture preview.
 *
 * The old form was seven labelled controls in a column, with the title — the field least likely
 * to be wrong — given the most prominent one, and the price third among identical boxes. The
 * user has just looked at the product page; the question is "is this the right thing, and is the
 * price right", and that is answerable at a glance from a photograph and a number.
 *
 * So values we trust render as **product information** with typographic weight matching their
 * importance, each carrying a small edit affordance. Only a value the extractor flagged renders
 * as a control — focused, amber, explained. The default preview therefore has one prominent
 * control: Save item.
 *
 * Nothing here implies certainty the extractor lacks. No discount unless a list price is
 * genuinely present and higher, which `Price` enforces; no availability claim when availability
 * is unknown, which it is on seven of sixteen live pages.
 */
function PreviewForm({
  capture,
  saving,
  draft,
  setDraft,
  flagged,
  reviewCount,
  firstFlaggedRef,
  cartName,
  onChangeCart,
  canSave,
  onSubmit,
  onCancel,
}: {
  capture: ProductCaptureV1;
  saving: boolean;
  draft: Draft;
  setDraft: (draft: Draft) => void;
  flagged: (field: string) => boolean;
  reviewCount: number;
  firstFlaggedRef: React.Ref<HTMLInputElement>;
  cartName: string;
  onChangeCart: () => void;
  canSave: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const [editing, setEditing] = useState<{ title?: boolean; price?: boolean }>({});
  const [showDetails, setShowDetails] = useState(false);
  // A retailer CDN that 404s leaves an image-first layout holding a placeholder where the
  // price should be. Treat a failed load exactly like no image at all.
  const [imageUsable, setImageUsable] = useState(true);

  const image = imageUsable ? capture.product.selectedImageUrl : null;
  const variants = Object.entries(capture.selectedVariant);
  const availability = capture.offer.availability;

  const titleAsControl = flagged('product.title') || editing.title === true;
  const priceAsControl =
    flagged('offer.priceAmount') || flagged('offer.currency') || editing.price === true;

  return (
    <form
      /* No image is not an edge case: original price is present on 2 of 16 live pages and plenty
         of captures have no photograph either. Rather than leaving a large empty box above a
         small price, the modifier hands that space to the title and the price. */
      className={image ? 'capture__form' : 'capture__form capture__form--no-image'}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {reviewCount > 0 ? (
        /* Inherited verbatim from the state the audit found already working: amber, above the
           form, with the ⚠ on the field itself. */
        <Callout tone="warning">
          Check the highlighted fields — the page did not state them clearly.
        </Callout>
      ) : null}

      {image ? (
        <ProductImage
          src={image}
          alt=""
          className="capture__image"
          onUnavailable={() => setImageUsable(false)}
        />
      ) : null}

      <p className="capture__retailer">{capture.source.retailerName}</p>

      {titleAsControl ? (
        <TextInput
          label={flagged('product.title') ? 'Title — please check' : 'Title'}
          invalid={flagged('product.title')}
          message={flagged('product.title') ? 'The page did not state this clearly. ⚠' : undefined}
          required
          ref={flagged('product.title') ? firstFlaggedRef : undefined}
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      ) : (
        <div className="capture__row">
          <h2 id="capture-heading" className="capture__product-title" data-testid="preview-title">
            {draft.title}
          </h2>
          <IconButton
            label="Edit title"
            onClick={() => setEditing({ ...editing, title: true })}
            icon={<EditGlyph />}
          />
        </div>
      )}

      {priceAsControl ? (
        <div className="capture__price-edit">
          <TextInput
            label={flagged('offer.priceAmount') ? 'Price — please check' : 'Price'}
            invalid={flagged('offer.priceAmount')}
            inputMode="decimal"
            placeholder="19.99"
            ref={
              flagged('offer.priceAmount') && !flagged('product.title')
                ? firstFlaggedRef
                : undefined
            }
            value={draft.priceAmount}
            onChange={(event) => setDraft({ ...draft, priceAmount: event.target.value })}
          />
          {/* Currency stays attached to the amount, never a prominent field of its own. */}
          <TextInput
            label="Currency"
            className="capture__currency"
            maxLength={3}
            placeholder="USD"
            value={draft.currency}
            onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
          />
        </div>
      ) : (
        <div className="capture__row" data-testid="preview-price">
          <Price
            size="lg"
            cadence="one_time"
            value={
              draft.priceAmount
                ? { amount: draft.priceAmount, currency: draft.currency || null }
                : null
            }
            listPrice={
              capture.offer.originalPriceAmount
                ? { amount: capture.offer.originalPriceAmount, currency: draft.currency || null }
                : null
            }
            unknownLabel="Price not stated"
          />
          <IconButton
            label="Edit price"
            onClick={() => setEditing({ ...editing, price: true })}
            icon={<EditGlyph />}
          />
        </div>
      )}

      {/* Only when the page said so. Silence is the honest rendering of unknown. */}
      {availability === 'in_stock' ? (
        <StatusBadge tone="neutral">In stock</StatusBadge>
      ) : availability === 'out_of_stock' ? (
        <StatusBadge tone="warning">Out of stock</StatusBadge>
      ) : availability === 'preorder' || availability === 'backorder' ? (
        <StatusBadge tone="neutral">
          {availability === 'preorder' ? 'Pre-order' : 'Backorder'}
        </StatusBadge>
      ) : null}

      {variants.length > 0 ? (
        <ul className="capture__chips" aria-label="Selected options">
          {variants.map(([name, value]) => (
            <li key={name}>
              <Badge>
                {name}: {value}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      <p className="capture__destination">
        Saving to <strong>{cartName}</strong>
        <button type="button" className="capture__change uc-focusable" onClick={onChangeCart}>
          Change
        </button>
      </p>

      <details
        className="capture__details"
        open={showDetails}
        onToggle={(event) => setShowDetails((event.target as HTMLDetailsElement).open)}
      >
        <summary className="capture__summary uc-focusable">Add details</summary>
        <div className="capture__details-body">
          <TextInput
            label="Quantity"
            inputMode="numeric"
            value={draft.quantity}
            onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
          />
          <TextInput
            label="Note"
            placeholder="Why you are considering it"
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </div>
      </details>

      <Button tone="primary" fullWidth type="submit" disabled={saving || !canSave}>
        {saving ? 'Saving…' : 'Save item'}
      </Button>
      <button type="button" className="capture__change uc-focusable" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor">
      <path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3z" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
