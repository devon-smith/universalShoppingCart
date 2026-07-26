/**
 * Join conditional class names.
 *
 * Deliberately tiny — the shared UI package holds presentational primitives only
 * and should not pull a class-merging dependency into both the web app and the
 * extension bundle for something this small.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values
    .filter(
      (value): value is string | number =>
        value !== null && value !== undefined && value !== false && value !== '',
    )
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0)
    .join(' ');
}
