/**
 * Database shapes generated from the local Supabase schema.
 *
 * Regenerate with `pnpm db:types` after every migration — the generated file is
 * committed so that typechecking works without a running database.
 */
export type { Database, Json, Tables, TablesInsert, TablesUpdate, Enums } from './database.types';

export type CartRole = 'owner' | 'editor' | 'viewer';

/** Roles that may modify a cart and (from Phase 2B) its items. */
export const EDITING_ROLES: readonly CartRole[] = ['owner', 'editor'];

export function canEdit(role: CartRole): boolean {
  return EDITING_ROLES.includes(role);
}
