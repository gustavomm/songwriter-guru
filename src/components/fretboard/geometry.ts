import { STANDARD_TUNING } from '../../services/fretboard'

// Geometry (SVG user units)
export const WIDTH = 1000
export const OPEN_ZONE = 46
export const NUT_X = OPEN_ZONE + 4
export const END_X = WIDTH - 12
export const TOP = 22
export const STRING_GAP = 30
export const STRING_COUNT = STANDARD_TUNING.length
export const BOARD_BOTTOM = TOP + (STRING_COUNT - 1) * STRING_GAP
export const HEIGHT = BOARD_BOTTOM + 48
export const RIFF_THRESHOLD = 0.12

/** Fret wire x position: real guitar spacing blended with equal spacing for readability */
export function fretX(fret: number, fretCount: number): number {
  const real = (1 - Math.pow(2, -fret / 12)) / (1 - Math.pow(2, -fretCount / 12))
  const equal = fret / fretCount
  return NUT_X + (END_X - NUT_X) * (0.6 * real + 0.4 * equal)
}

export function noteX(fret: number, fretCount: number): number {
  if (fret === 0) return OPEN_ZONE / 2
  return (fretX(fret - 1, fretCount) + fretX(fret, fretCount)) / 2
}

/** String 0 is the low E, drawn at the bottom like a tab */
export function stringY(string: number): number {
  return TOP + (STRING_COUNT - 1 - string) * STRING_GAP
}
