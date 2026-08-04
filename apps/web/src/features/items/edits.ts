import { z } from 'zod';

/**
 * Validation for the user-authored fields of a saved item.
 *
 * Shared by the server action and by the optimistic update in the browser, so the value
 * the UI shows immediately is the value the database will accept — or the edit is rejected
 * before it is shown at all.
 *
 * Only user-authored fields appear here. The retailer-observed ones are not editable by a
 * client at all, enforced by a trigger (see supabase/migrations/…_protect_observed_fields).
 */

export const itemStatusSchema = z.enum(['saved', 'cart', 'purchased', 'archived']);
export const itemPrioritySchema = z.enum(['low', 'normal', 'high']);

const decimalInput = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,6})?$/, { error: 'Enter an amount like 79.99' });

export const itemEditSchema = z.object({
  note: z
    .string()
    .max(2000, { error: 'A note can be at most 2000 characters' })
    .transform((value) => value.trim())
    .transform((value) => (value.length > 0 ? value : null))
    .nullable(),
  // The purchase this candidate is for ("winter jacket"). Empty means unassigned — null,
  // not '', so the database's length check and the dashboard's grouping agree on absence.
  // `nullish`, not `nullable`: a tab loaded before this field shipped submits edits without
  // it, and rejecting those saves until a reload would be a worse failure than the field.
  decision: z
    .string()
    .max(120, { error: 'A decision name can be at most 120 characters' })
    .transform((value) => value.trim())
    .transform((value) => (value.length > 0 ? value : null))
    .nullish()
    .transform((value) => value ?? null),
  quantity: z
    .number()
    .int({ error: 'Quantity must be a whole number' })
    .min(1, { error: 'Quantity must be at least 1' })
    .max(999, { error: 'Quantity must be 999 or fewer' }),
  priority: itemPrioritySchema,
  desiredPrice: decimalInput
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value)),
  status: itemStatusSchema,
});

export type ItemEdit = z.infer<typeof itemEditSchema>;

export interface ParsedEdit {
  ok: boolean;
  edit?: ItemEdit;
  errors?: Record<string, string>;
}

/**
 * Parse a form submission into an edit.
 *
 * An empty desired-price field means "no target", not zero — the difference matters,
 * because zero would make every item permanently below its target.
 */
export function parseItemEditForm(form: {
  get(name: string): FormDataEntryValue | null;
}): ParsedEdit {
  const rawQuantity = form.get('quantity')?.toString().trim() ?? '1';
  const rawDesired = form.get('desiredPrice')?.toString().trim() ?? '';

  const result = itemEditSchema.safeParse({
    note: form.get('note')?.toString() ?? null,
    decision: form.get('decision')?.toString() ?? null,
    quantity: Number.parseInt(rawQuantity, 10),
    priority: form.get('priority')?.toString() ?? 'normal',
    desiredPrice: rawDesired.length > 0 ? rawDesired : null,
    status: form.get('status')?.toString() ?? 'saved',
  });

  if (result.success) {
    return { ok: true, edit: result.data };
  }

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !(field in errors)) {
      errors[field] = issue.message;
    }
  }

  return { ok: false, errors };
}

/** The database column names for an edit. */
export function toColumns(edit: ItemEdit): {
  note: string | null;
  decision: string | null;
  quantity: number;
  priority: ItemEdit['priority'];
  desired_price: string | null;
  status: ItemEdit['status'];
} {
  return {
    note: edit.note,
    decision: edit.decision,
    quantity: edit.quantity,
    priority: edit.priority,
    desired_price: edit.desiredPrice,
    status: edit.status,
  };
}
