/**
 * Unit conversion. Every factor here is exact or standard; none are guesses.
 *
 * Volume units are US customary, which is what nutrition labels in the app's
 * primary markets use. A "cup" is therefore 236.588 ml, not the 250 ml metric
 * cup — worth knowing before anyone changes it.
 */
import type { BasisUnit } from '../types.ts';
import { type Result, err, ok } from '../result.ts';

export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'floz' | 'cup';
export type MeasureUnit = MassUnit | VolumeUnit;

/** Grams in one of each mass unit. */
const GRAMS: Record<MassUnit, number> = {
  g: 1,
  kg: 1000,
  oz: 28.349523125,
  lb: 453.59237,
};

/** Millilitres in one of each volume unit. */
const MILLILITRES: Record<VolumeUnit, number> = {
  ml: 1,
  l: 1000,
  tsp: 4.92892159375,
  tbsp: 14.78676478125,
  floz: 29.5735295625,
  cup: 236.5882365,
};

export const MASS_UNITS = Object.keys(GRAMS) as readonly MassUnit[];
export const VOLUME_UNITS = Object.keys(MILLILITRES) as readonly VolumeUnit[];

export function isMassUnit(unit: string): unit is MassUnit {
  return unit in GRAMS;
}

export function isVolumeUnit(unit: string): unit is VolumeUnit {
  return unit in MILLILITRES;
}

export function isMeasureUnit(unit: string): unit is MeasureUnit {
  return isMassUnit(unit) || isVolumeUnit(unit);
}

export function toGrams(quantity: number, unit: MassUnit): number {
  return quantity * GRAMS[unit];
}

export function toMillilitres(quantity: number, unit: VolumeUnit): number {
  return quantity * MILLILITRES[unit];
}

export type ConversionError =
  | { code: 'unknown_unit'; unit: string }
  | { code: 'density_required'; from: 'mass' | 'volume'; to: BasisUnit };

/**
 * Convert a measured quantity into the food's own basis unit.
 *
 * Crossing between mass and volume needs the food's density. Rather than
 * assuming water (a cup of flour and a cup of honey are not the same mass),
 * this returns `density_required` so the caller can hide volume units or ask.
 */
export function convertToBasis(
  quantity: number,
  unit: string,
  basisUnit: BasisUnit,
  gramsPerMl?: number | null,
): Result<number, ConversionError> {
  if (isMassUnit(unit)) {
    const grams = toGrams(quantity, unit);
    if (basisUnit === 'g') return ok(grams);
    if (!gramsPerMl || gramsPerMl <= 0) {
      return err({ code: 'density_required', from: 'mass', to: basisUnit });
    }
    return ok(grams / gramsPerMl);
  }

  if (isVolumeUnit(unit)) {
    const millilitres = toMillilitres(quantity, unit);
    if (basisUnit === 'ml') return ok(millilitres);
    if (!gramsPerMl || gramsPerMl <= 0) {
      return err({ code: 'density_required', from: 'volume', to: basisUnit });
    }
    return ok(millilitres * gramsPerMl);
  }

  return err({ code: 'unknown_unit', unit });
}

// --- body measurements, for onboarding in imperial ---------------------------

export const KG_PER_LB = 0.45359237;
export const CM_PER_INCH = 2.54;

export const lbToKg = (lb: number): number => lb * KG_PER_LB;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;

export const inchesToCm = (inches: number): number => inches * CM_PER_INCH;
export const cmToInches = (cm: number): number => cm / CM_PER_INCH;

export function feetInchesToCm(feet: number, inches: number): number {
  return inchesToCm(feet * 12 + inches);
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cmToInches(cm);
  const feet = Math.floor(totalInches / 12);
  return { feet, inches: totalInches - feet * 12 };
}

export const ML_PER_FLOZ = MILLILITRES.floz;
