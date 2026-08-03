export { classifyRefresh, normalizeRefreshDomain } from './classify';
export type { ClassifiableItem, RefreshStrategy } from './classify';

export {
  assertSafeUrl,
  isBlockedIp,
  isPublicUnicastIp,
  safeFetch,
  SafeFetchError,
} from './safe-fetch';
export type {
  SafeFetchDeps,
  SafeFetchOptions,
  SafeFetchReason,
  SafeFetchResult,
} from './safe-fetch';
