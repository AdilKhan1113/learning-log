/**
 * A success-or-failure value.
 *
 * The domain layer never throws for an outcome the user can cause — an unknown
 * unit, a food without a density, a portion that does not exist. Those are
 * results the UI has to render as an explicit state, so they are returned as
 * values with a machine-readable code rather than raised as exceptions.
 *
 * Genuine programmer errors (a null that should be impossible) still throw.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Narrowing helper for callers that only need the happy path. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
