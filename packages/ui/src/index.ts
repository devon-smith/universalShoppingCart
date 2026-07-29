/**
 * Shared presentational primitives for the web app and the extension.
 *
 * Package rules (BUILD_PLAN.md §5.1): presentational only, no data fetching, and no
 * page-level components shared across the two clients.
 *
 * Consumers must import the two stylesheets once, in their shell:
 *
 *   @universal-cart/ui/tokens.css      the semantic token set
 *   @universal-cart/ui/components.css  the primitives' styles
 *
 * The set is deliberately small. Phases 2 to 4 consume exactly these; a primitive nobody
 * renders is a maintenance cost with no user, so the rest wait until something needs them.
 */
export { cn } from './cn';
export type { ClassValue } from './cn';

export { compareDecimal, formatMoney } from './money';

export { Button, IconButton, TextInput } from './controls';
export type { ButtonProps, ButtonTone, IconButtonProps, TextInputProps } from './controls';

export {
  Badge,
  Callout,
  EmptyState,
  ProductImage,
  Skeleton,
  Spinner,
  StatusBadge,
  Surface,
  Toast,
} from './display';
export type {
  BadgeProps,
  CalloutProps,
  EmptyStateProps,
  ProductImageProps,
  SkeletonProps,
  SpinnerProps,
  StatusBadgeProps,
  StatusTone,
  SurfaceElevation,
  SurfaceProps,
  ToastProps,
} from './display';

export { Price } from './Price';
export type { PriceAmount, PriceCadence, PriceProps } from './Price';
