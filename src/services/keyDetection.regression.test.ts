import { describe, it, expect } from 'vitest'
import { analyzeHarmony } from './harmonyAnalysis'
import { extractFeatures } from './featureExtraction'
import type { TranscribedNote } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Key-detection regression set: synthetic guitar riffs with a known key.
//
// Notes are written as [midi, beats] (or [midi, beats, velocity]) played one
// after another at 0.25s per beat; `pedal` adds a sustained low note under the
// whole riff, `chords` stacks several notes on each step.
// ─────────────────────────────────────────────────────────────────────────────

const BEAT_SEC = 0.25

type Step = [midi: number | number[], beats: number, velocity?: number]

function riff(steps: Step[], options: { pedal?: number } = {}): TranscribedNote[] {
  const notes: TranscribedNote[] = []
  let t = 0
  for (const [midi, beats, velocity = 0.7] of steps) {
    const dur = beats * BEAT_SEC
    for (const m of Array.isArray(midi) ? midi : [midi]) {
      notes.push({ midi: m, startSec: t, endSec: t + dur * 0.9, velocity })
    }
    t += dur
  }
  if (options.pedal !== undefined) {
    notes.unshift({ midi: options.pedal, startSec: 0, endSec: t, velocity: 0.6 })
  }
  return notes
}

/** Shorthand: equal-length eighth notes (2 beats each), last note held 6 beats */
const line = (midis: number[], lastBeats = 6): Step[] =>
  midis.map((m, i) => [m, i === midis.length - 1 ? lastBeats : 2] as Step)

interface RegressionCase {
  name: string
  notes: TranscribedNote[]
  /** Expected key id, or null when no key should be reported */
  expected: string | null
  /**
   * 'top': expected key must rank first.
   * 'ambiguousTop2': genuinely ambiguous riff; must be flagged ambiguous with
   * the expected key in the top two.
   * 'none': no candidates at all.
   */
  check: 'top' | 'ambiguousTop2' | 'none'
}

// MIDI reference: E2=40 G2=43 A2=45 C3=48 D3=50 E3=52 G3=55 A3=57 C4=60 E4=64
const REGRESSION_CASES: RegressionCase[] = [
  {
    name: 'A minor pentatonic ending on A',
    notes: riff(line([57, 60, 62, 64, 67, 64, 62, 60, 57])),
    expected: 'A-minor',
    check: 'top',
  },
  {
    name: 'A minor pentatonic ending on E',
    notes: riff(line([57, 60, 62, 64, 67, 64, 62, 60, 57, 60, 64])),
    expected: 'A-minor',
    check: 'top',
  },
  {
    name: 'A minor pentatonic ending on C, sustained low A2 pedal',
    notes: riff(line([57, 60, 62, 64, 67, 64, 62, 60]), { pedal: 45 }),
    expected: 'A-minor',
    check: 'top',
  },
  {
    name: 'A minor pentatonic ending on C, low A2 pickup',
    notes: riff(line([45, 57, 60, 62, 64, 67, 64, 62, 60])),
    expected: 'A-minor',
    check: 'top',
  },
  {
    name: 'A minor pentatonic over repeated low A',
    notes: riff(line([45, 60, 45, 62, 45, 64, 45, 67, 45, 64, 45, 60])),
    expected: 'A-minor',
    check: 'top',
  },
  {
    name: 'A minor pentatonic ending on C, no bass evidence',
    // A C D E G starting on A, ending on a long C: relative major and minor both plausible
    notes: riff(line([69, 72, 74, 76, 79, 76, 74, 72, 69, 72])),
    expected: 'A-minor',
    check: 'ambiguousTop2',
  },
  {
    name: 'G major pentatonic ending on D',
    notes: riff(line([55, 57, 59, 62, 64, 62, 59, 57, 55, 59, 62])),
    expected: 'G-major',
    check: 'top',
  },
  {
    name: 'G major pentatonic ending on B, no bass evidence',
    notes: riff(line([55, 57, 59, 62, 64, 62, 59, 57, 55, 59])),
    expected: 'G-major',
    check: 'ambiguousTop2',
  },
  {
    name: 'C major pentatonic ending on G',
    notes: riff(line([60, 62, 64, 67, 69, 67, 64, 62, 60, 64, 67])),
    expected: 'C-major',
    check: 'top',
  },
  {
    name: 'E blues with Bb',
    notes: riff(line([40, 43, 45, 46, 47, 50, 52, 50, 47, 46, 45, 43, 40])),
    expected: 'E-minor',
    check: 'top',
  },
  {
    name: 'E minor riff',
    notes: riff(line([40, 52, 50, 47, 43, 45, 47, 40, 43, 47, 52, 40])),
    expected: 'E-minor',
    check: 'top',
  },
  {
    name: 'G major scale',
    notes: riff(line([55, 57, 59, 60, 62, 64, 66, 67])),
    expected: 'G-major',
    check: 'top',
  },
  {
    name: 'G major riff ending on D',
    notes: riff(line([55, 59, 62, 67, 66, 64, 62, 60, 59, 57, 62])),
    expected: 'G-major',
    check: 'top',
  },
  {
    name: 'A harmonic minor with G#',
    notes: riff(line([57, 59, 60, 62, 64, 65, 68, 69, 68, 64, 57])),
    expected: 'A-minor',
    check: 'top',
  },
  {
    name: 'A melodic minor with F# and G#',
    notes: riff(line([57, 59, 60, 62, 64, 66, 68, 69, 64, 60, 57])),
    expected: 'A-minor',
    check: 'top',
  },
  {
    name: 'C major with chromatic passing notes',
    notes: riff([
      [60, 2],
      [62, 2],
      [63, 1, 0.5],
      [64, 2],
      [65, 2],
      [66, 1, 0.5],
      [67, 2],
      [69, 2],
      [70, 1, 0.5],
      [71, 2],
      [72, 2],
      [67, 2],
      [64, 2],
      [60, 6],
    ]),
    expected: 'C-major',
    check: 'top',
  },
  {
    name: 'F major',
    notes: riff(line([53, 55, 57, 58, 60, 62, 64, 65, 60, 57, 53])),
    expected: 'F-major',
    check: 'top',
  },
  {
    name: 'Bb major arpeggio riff',
    notes: riff(line([46, 50, 53, 58, 53, 50, 51, 55, 58, 53, 46])),
    expected: 'Bb-major',
    check: 'top',
  },
  {
    name: 'C# minor pentatonic',
    notes: riff(line([49, 52, 54, 56, 59, 56, 54, 52, 49])),
    expected: 'C#-minor',
    check: 'top',
  },
  {
    name: 'D major over low D pedal, ending on A',
    notes: riff(line([62, 66, 69, 74, 69, 66, 64, 66, 69]), { pedal: 38 }),
    expected: 'D-major',
    check: 'top',
  },
  {
    name: 'E5 power-chord riff (E and B only)',
    notes: riff([
      [[40, 47], 2],
      [[40, 47], 2],
      [[40, 47], 2],
      [[40, 47], 4],
      [[40, 47], 2],
      [[40, 47], 6],
    ]),
    expected: 'E-minor',
    check: 'ambiguousTop2',
  },
  {
    name: 'single note',
    notes: riff([[57, 8]]),
    expected: null,
    check: 'none',
  },
  {
    name: 'empty',
    notes: [],
    expected: null,
    check: 'none',
  },
]

function describeResult(notes: TranscribedNote[]) {
  const result = analyzeHarmony(extractFeatures(notes))
  const [first, second] = result.candidates
  const fmt = (c: (typeof result.candidates)[number] | undefined) =>
    c ? `${c.id} ${(c.confidence ?? c.fitScore).toFixed(2)}` : '-'
  return {
    result,
    summary: `${fmt(first)} | ${fmt(second)}${result.ambiguous ? ' (ambiguous)' : ''}`,
  }
}

describe('key detection regression set', () => {
  it.each(REGRESSION_CASES)('$name', ({ notes, expected, check }) => {
    const { result } = describeResult(notes)
    const ids = result.candidates.map((c) => c.id)

    if (check === 'none') {
      expect(result.candidates).toEqual([])
      expect(result.selectedCandidateId).toBe('')
      return
    }
    if (check === 'top') {
      expect(ids[0]).toBe(expected)
      return
    }
    expect(result.ambiguous).toBe(true)
    expect(ids.slice(0, 2)).toContain(expected)
  })

  it.skipIf(!process.env.KEY_TABLE)('prints the results table', () => {
    const rows = REGRESSION_CASES.map(
      (c) => `| ${c.name} | ${c.expected ?? 'none'} | ${describeResult(c.notes).summary} |`
    )
    console.log(['| riff | expected | result |', '|---|---|---|', ...rows].join('\n'))
  })
})
