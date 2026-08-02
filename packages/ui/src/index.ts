/**
 * Shared presentational primitives for the web app and the extension.
 *
 * Package rules (BUILD_PLAN.md §5.1): presentational only, no data fetching, and
 * no page-level components shared across the two clients.
 *
 * Phase 0 ships the class-name helper the components will be built on; the
 * components themselves arrive with the dashboard in Phase 3.
 */
export { cn } from './cn';
export type { ClassValue } from './cn';
