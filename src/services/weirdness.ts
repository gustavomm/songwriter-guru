import type { ChordSuggestion } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Weirdness: how far from the plain key a progression may reach
// ─────────────────────────────────────────────────────────────────────────────
//
// Every chord has a colour distance (see chordColorDistance in
// chordSuggestion.ts): 0 for plain diatonic chords, about 0.3 for colour
// variants (i(maj7), III+), 0.45 for a secondary dominant, 0.5-0.65 for
// borrowed chords (bVII, iv, bVI), 1.0+ for the Neapolitan and tritone subs.
// The weirdness knob (0-1) scales, smoothly:
// - reach: the largest colour distance allowed (0 → plain diatonic only,
//   0.5 → secondary dominants and bVII / iv, 1 → everything)
// - budget: how many colour chords a progression may hold
// - preference: a reachable colour chord starts out slightly penalised (used
//   only when it fits the riff better) and turns into a growing bonus as the
//   knob passes it

/** Colour distance reachable per unit of weirdness */
const REACH_PER_WEIRDNESS = 1.25
/** Colour chords allowed per chord slot at weirdness 1 */
const BUDGET_PER_SLOT = 0.5
/** Preference slope once a colour chord is reachable */
const PREFERENCE_SLOPE = 0.3
/** Small cost for a colour chord right at the edge of the reach */
const PREFERENCE_EDGE_COST = 0.05

/** Fallback distances for chords built without a colorDistance */
const FALLBACK_COLOR_VARIANT_DISTANCE = 0.3
const FALLBACK_NON_DIATONIC_DISTANCE = 0.5

const clamp01 = (w: number) => Math.max(0, Math.min(1, w))

/** Largest colour distance allowed at this weirdness */
export function colorReach(weirdness: number): number {
  return clamp01(weirdness) * REACH_PER_WEIRDNESS
}

/** Colour distance of a chord (0 = plain diatonic) */
export function colorDistanceOf(chord: ChordSuggestion): number {
  if (chord.colorDistance !== undefined) return chord.colorDistance
  if (chord.source !== 'diatonic') return FALLBACK_NON_DIATONIC_DISTANCE
  return chord.colorVariant ? FALLBACK_COLOR_VARIANT_DISTANCE : 0
}

/** Whether a chord counts as a colour chord (anything but plain diatonic) */
export function isColorChord(chord: ChordSuggestion): boolean {
  return colorDistanceOf(chord) > 0
}

/** Whether a chord is within reach at this weirdness */
export function isWithinReach(chord: ChordSuggestion, weirdness: number): boolean {
  return colorDistanceOf(chord) <= colorReach(weirdness) + 1e-9
}

/**
 * Score adjustment for using a chord at this weirdness: 0 for plain diatonic
 * chords, -Infinity beyond the reach, otherwise a small cost at the edge of
 * the reach growing into a bonus as weirdness increases.
 */
export function colorPreference(chord: ChordSuggestion, weirdness: number): number {
  const distance = colorDistanceOf(chord)
  if (distance <= 0) return 0
  if (!isWithinReach(chord, weirdness)) return -Infinity
  const w = clamp01(weirdness)
  return PREFERENCE_SLOPE * (w - distance / REACH_PER_WEIRDNESS) - PREFERENCE_EDGE_COST
}

/** Maximum number of colour chords in a progression of `slots` chords */
export function colorBudget(weirdness: number, slots: number): number {
  return Math.round(clamp01(weirdness) * slots * BUDGET_PER_SLOT)
}
