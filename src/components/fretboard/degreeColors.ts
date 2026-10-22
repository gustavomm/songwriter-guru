// Colours keyed by interval number (1-7), so the root, 3rd and 5th read the same
// on every scale, mode and chord.

interface DegreeColor {
  fill: string
  text: string
  name: string
}

const DEGREE_COLORS: Record<number, DegreeColor> = {
  1: { fill: '#f43f5e', text: '#fff1f2', name: 'Root' },
  2: { fill: '#a8a29e', text: '#1c1917', name: '2nd / 9th' },
  3: { fill: '#10b981', text: '#ecfdf5', name: '3rd' },
  4: { fill: '#fbbf24', text: '#1c1917', name: '4th / 11th' },
  5: { fill: '#0ea5e9', text: '#f0f9ff', name: '5th' },
  6: { fill: '#fdba74', text: '#1c1917', name: '6th / 13th' },
  7: { fill: '#8b5cf6', text: '#f5f3ff', name: '7th' },
}

const FALLBACK: DegreeColor = { fill: '#57534e', text: '#e7e5e4', name: 'Other' }

/** Interval number from a label like "b3", "#4" or "R" */
export function intervalNumber(label: string | undefined): number | undefined {
  if (!label) return undefined
  if (label === 'R') return 1
  const digit = Number(label.replace(/[^0-9]/g, ''))
  return digit >= 1 && digit <= 7 ? digit : undefined
}

export function degreeColor(label: string | undefined): DegreeColor {
  const num = intervalNumber(label)
  return (num && DEGREE_COLORS[num]) || FALLBACK
}
