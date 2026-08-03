import type { HTMLAttributes, ReactElement, ReactNode } from 'react';
import { useEffect, useState } from 'react';

import { cn } from './cn';

/**
 * Presentational primitives: badges, product imagery, surfaces, and the loading and empty
 * states that stand in for content.
 */

export interface BadgeProps {
  children: ReactNode;
  className?: string;
}

/** A neutral label. Carries no judgement, and no colour beyond the muted default. */
export function Badge({ children, className }: BadgeProps): ReactElement {
  return <span className={cn('uc-badge', className)}>{children}</span>;
}

/**
 * The three meanings colour is allowed to carry.
 *
 * Named for what happened, not for how it feels: `success` is an observed price fall or a
 * completed action, `warning` is a field that needs review, `danger` is destructive or
 * broken. There is deliberately no `good` or `deal` — the data cannot support that claim,
 * and a green badge saying so would be the interface inventing an opinion.
 */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface StatusBadgeProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

export function StatusBadge({ tone, children, className }: StatusBadgeProps): ReactElement {
  return (
    <span
      className={cn('uc-badge', tone !== 'neutral' && `uc-badge--${tone}`, className)}
      data-tone={tone}
    >
      {/* Never the sole carrier of meaning — the text beside it says the same thing, for
          anyone who cannot distinguish the colours. */}
      {tone === 'neutral' ? null : <span aria-hidden="true" className="uc-badge__dot" />}
      {children}
    </span>
  );
}

export interface ProductImageProps {
  src: string | null;
  /**
   * What the image shows — normally the product title. Empty string marks it decorative,
   * which is right when the title sits directly beside it and would otherwise be read twice.
   */
  alt: string;
  /** Rendered width. The box is square regardless, so nothing reflows when a src fails. */
  width?: number;
  className?: string;
  /**
   * Called once when there is no usable image — none given, or the given one failed to load.
   *
   * A caller that lays out image-first needs to know, because a frame that has quietly become
   * a placeholder is worse than no frame: it takes the space the price should have had. The
   * component still renders its own fallback, so a caller that ignores this is not broken.
   */
  onUnavailable?: () => void;
}

/**
 * A product photograph in a frame we control.
 *
 * Retailer CDNs return whatever they like: on the live pages, four of five serve a
 * deliberately downscaled file, some are 1x1 tracking pixels dressed as images, and several
 * 404 once a listing rotates. So the box has a fixed aspect ratio and the image is contained
 * inside it — a missing or broken source costs no layout shift, and never gets the browser's
 * broken-image glyph.
 */
export function ProductImage({
  src,
  alt,
  width,
  className,
  onUnavailable,
}: ProductImageProps): ReactElement {
  const [failed, setFailed] = useState(false);
  const showImage = src !== null && src.length > 0 && !failed;

  const missing = src === null || src.length === 0;
  useEffect(() => {
    if (missing) onUnavailable?.();
  }, [missing, onUnavailable]);

  return (
    <div
      className={cn('uc-product-image', className)}
      style={width === undefined ? undefined : { width, maxWidth: '100%' }}
    >
      {showImage ? (
        <img
          className="uc-product-image__img"
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => {
            setFailed(true);
            onUnavailable?.();
          }}
        />
      ) : (
        <span
          className="uc-product-image__fallback"
          // The frame is not the product; if the alt text mattered the caller passed it, and
          // announcing "no image" adds nothing a sighted user is told either.
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor">
            <rect x="3" y="4" width="18" height="16" rx="2" strokeWidth="1.5" />
            <path d="M3 15l4-4 4 4 3-3 4 4" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </div>
  );
}

export type SurfaceElevation = 'flat' | 'plain' | 'raised' | 'overlay';

export interface SurfaceProps extends Omit<HTMLAttributes<HTMLElement>, 'className'> {
  elevation?: SurfaceElevation;
  /** A card in a list should be an `li`; a standalone panel a `div`. */
  as?: 'div' | 'section' | 'article' | 'li';
  className?: string;
  children: ReactNode;
}

/**
 * A panel.
 *
 * Elevation is shadow, not border. Bordered cards inside a bordered list read as table
 * cells, which is the database look this redesign exists to leave behind.
 */
export function Surface({
  elevation = 'plain',
  as: Tag = 'div',
  className,
  children,
  ...rest
}: SurfaceProps): ReactElement {
  return (
    <Tag
      className={cn('uc-surface', elevation !== 'plain' && `uc-surface--${elevation}`, className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export interface SkeletonProps {
  /** CSS length. Defaults to filling its container. */
  width?: string;
  height?: string;
  className?: string;
  /** What is loading, for assistive technology. Omit inside a labelled busy region. */
  label?: string;
}

export function Skeleton({
  width,
  height = '1rem',
  className,
  label,
}: SkeletonProps): ReactElement {
  return (
    <span
      className={cn('uc-skeleton', className)}
      style={{ display: 'block', width: width ?? '100%', height }}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export interface SpinnerProps {
  /** Announced while it spins. Silent when the surrounding region already says so. */
  label?: string;
  className?: string;
}

export function Spinner({ label, className }: SpinnerProps): ReactElement {
  return (
    <span
      className={cn('uc-spinner', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export interface EmptyStateProps {
  title: string;
  body?: ReactNode;
  /** A way forward. An empty state without one is a dead end. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, body, action, className }: EmptyStateProps): ReactElement {
  return (
    <div className={cn('uc-empty-state', className)}>
      <p className="uc-empty-state__title">{title}</p>
      {body ? <p className="uc-empty-state__body">{body}</p> : null}
      {action}
    </div>
  );
}

export interface CalloutProps {
  tone: StatusTone;
  title?: string;
  children: ReactNode;
  className?: string;
  /**
   * Whether this callout is its own live region.
   *
   * Default true. Set false when the surrounding surface already announces the same thing —
   * two live regions saying one sentence make a screen reader repeat it, and they collide as
   * two `status` roles for anything querying by role.
   */
  announce?: boolean;
}

/**
 * An inline explanation attached to the thing it is about.
 *
 * `warning` is the tone for "this field needs your eye before saving", which is the most
 * common case in this product and the reason the component exists.
 */
export function Callout({
  tone,
  title,
  children,
  className,
  announce = true,
}: CalloutProps): ReactElement {
  return (
    <div
      className={cn('uc-callout', tone !== 'neutral' && `uc-callout--${tone}`, className)}
      // Errors interrupt; everything else waits for a pause.
      role={announce ? (tone === 'danger' ? 'alert' : 'status') : undefined}
    >
      {title ? <span className="uc-callout__title">{title}</span> : null}
      <span>{children}</span>
    </div>
  );
}

export interface ToastProps {
  message: ReactNode;
  /** An undo, normally. Destructive actions need one within reach, not in a menu. */
  action?: ReactNode;
  className?: string;
  /**
   * Whether this toast is its own live region.
   *
   * Default true. Set false when the surrounding region already announces it — the dashboard
   * mounts one persistent region and swaps the toast inside it, and two nested `status` roles
   * make a screen reader say the message twice and `getByRole('status')` match twice.
   * Same flag, same reason, as `Callout`.
   */
  announce?: boolean;
}

export function Toast({ message, action, className, announce = true }: ToastProps): ReactElement {
  return (
    <div
      className={cn('uc-toast', className)}
      role={announce ? 'status' : undefined}
      aria-live={announce ? 'polite' : undefined}
    >
      <span className="uc-toast__message">{message}</span>
      {action}
    </div>
  );
}
