/**
 * Where one spec column renders, and which of its flags depend on which.
 *
 * Four independent-looking checkboxes are not four independent decisions, and
 * the dependencies between them are the sort of rule that rots quietly inside
 * an `onChange` handler — so they live here, with tests, and the editor calls
 * them.
 */

export type ColumnFlags = {
  /** A column in the catalog spec table. */
  inTable: boolean;
  /** A row in the expanded product detail. */
  inDetail: boolean;
  /** Carried onto the collapsed phone card. */
  mobile: boolean;
  /** Offered as a facet in the filter sidebar. */
  filterable: boolean;
};

/**
 * Turning the table column off takes the two flags that depend on it.
 *
 * `mobile` because the phone card *is* the collapsed table row — with nothing
 * in the table there is nothing for it to carry. `filterable` because an
 * operator switching a column off means "I do not want this column", and
 * leaving a facet behind for a column nobody can see is a filter that narrows
 * results by something invisible.
 *
 * `inDetail` is deliberately untouched: the expanded row is a separate
 * decision, and clearing it here would make a detail-only column — the tier
 * most of a forty-column family lives in — impossible to reach in one step.
 * Hiding a column everywhere is turning both off.
 *
 * Turning the table column back on does not restore `mobile`. It was cleared
 * because it was meaningless, not because it was hidden, and silently
 * re-ticking a box the operator last saw unticked is how a phone card grows a
 * column nobody asked for.
 */
export function setInTable(flags: ColumnFlags, inTable: boolean): ColumnFlags {
  return inTable
    ? { ...flags, inTable: true }
    : { ...flags, inTable: false, mobile: false, filterable: false };
}

/** `mobile` is only answerable for a column the table actually shows. */
export function mobileAvailable(flags: Pick<ColumnFlags, "inTable">): boolean {
  return flags.inTable;
}

/**
 * A column that renders nowhere.
 *
 * Its values stay in `products.specs`, its facet rows stay put, and it stays in
 * the search document — hiding is reversible and loses nothing. Deleting the
 * column is the separate, destructive action.
 */
export function isHidden(flags: Pick<ColumnFlags, "inTable" | "inDetail">): boolean {
  return !flags.inTable && !flags.inDetail;
}
