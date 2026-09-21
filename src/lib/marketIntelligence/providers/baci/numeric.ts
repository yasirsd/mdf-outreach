/**
 * BACI values arrive as JSON numbers, so decimal source values can acquire a
 * small IEEE-754 representation tail (for example 675.9999999999999). This
 * stabilizer removes only tails that fit inside a conservative machine-error
 * band. It is intentionally not business rounding: no fixed currency or
 * quantity scale is assumed.
 */
export const BACI_NUMBER_TOLERANCE_MULTIPLIER = 4;
export const BACI_NUMBER_MAX_DECIMAL_PLACES = 15;

export function baciNumberTolerance(value: number): number {
  return BACI_NUMBER_TOLERANCE_MULTIPLIER *
    Number.EPSILON *
    Math.max(1, Math.abs(value));
}

/**
 * Return the shortest decimal-place representation within the documented
 * machine-precision tolerance. Non-zero values are never collapsed to zero;
 * if no candidate is safe, the original finite number is retained.
 */
export function canonicalizeBaciNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError("BACI numeric canonicalization requires a finite number");
  }
  if (value === 0) return 0;

  const tolerance = baciNumberTolerance(value);
  for (let decimalPlaces = 0; decimalPlaces <= BACI_NUMBER_MAX_DECIMAL_PLACES; decimalPlaces += 1) {
    const candidate = Number(value.toFixed(decimalPlaces));
    if (!Number.isFinite(candidate) || candidate === 0) continue;
    if (Math.abs(value - candidate) <= tolerance) return candidate;
  }

  return value;
}
