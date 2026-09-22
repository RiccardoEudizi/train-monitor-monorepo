/** Single app-wide "in ritardo" threshold for counts (home: > 0').
 * Delay-status rule (statoFor) lives in ~/lib/api-types; keep this in sync:
 * statoFor treats delay >= 1 as ritardo, this counts > 0 so +0.x rounds up.
 */
export const DELAY_THRESHOLD = 0;

/** Delay cutoffs shared by statoFor (api-types) and delayClass (format). */
export const DELAY_MIN = 1;
export const DELAY_HEAVY = 15;
