/**
 * Physical grid limits shared by Arnold's sheet reader and writer.
 *
 * The writer checks every batch against the same numbers the reader enforces,
 * so a write can never produce a file Arnold itself refuses to read.
 */
export const ARNOLD_SHEETS_LIMITS = Object.freeze({
  /** Rows per table, including the header row. */
  rows: 10_000,
  columns: 64,
  /** Cells per table (rows × columns). */
  cells: 1_000_000,
});
