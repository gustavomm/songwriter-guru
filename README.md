# Riff Harmonics

**Discover chords for your melodies**

Riff Harmonics is a browser-based music theory assistant that helps songwriters and musicians find the perfect chords for their musical ideas. Record a short guitar riff or melody, and the app will transcribe it, detect the most likely keys and modes, and suggest harmonically appropriate chords and progressions.

100% client-side — no server required, your audio never leaves your browser.

---

## Features

### Audio Recording & Transcription
- **Browser-based recording** using the Web Audio API with high-quality PCM capture
- **AI-powered pitch detection** using Spotify's Basic Pitch model (TensorFlow.js)
- Support for **lead lines** (single notes/riffs) and **chord strumming** modes
- Visual waveform display and notes timeline with MIDI playback

### Harmonic Analysis
- **Key detection** that evaluates all 24 major/minor keys against your riff
- Weighted scoring based on note duration, endings on tonic, and bass notes
- Displays top 8 candidate keys ranked by fit score
- Shows out-of-scale notes to help identify chromatic passages

### Chord Suggestions
Generates three categories of chord suggestions, all scored against your riff:

- **Diatonic chords** — triads and 7th chords native to the detected key
- **Secondary dominants & tritone substitutes** — V/x, vii°/x, and subV/x chords for tonicization
- **Borrowed chords** — modal mixture from parallel modes (major/minor/dorian/mixolydian)

Each chord shows:
- Roman numeral analysis
- Harmonic function (T/SD/D)
- Support score (how well the riff fits the chord)
- Color score (how "interesting" the chord sounds)

### Progression Generation
- Generates 4-5 chord progressions from skeleton templates
- Applies harmonic transformations: applied dominants, Neapolitan substitutes, modal borrowing
- Scores progressions on fit, spice, voice leading, and cadence strength
- **Weirdness knob** to dial between safe/conventional and adventurous/colorful suggestions
- Alternative chords for each slot to customize progressions

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| [React 19](https://react.dev/) | UI framework |
| [TypeScript](https://www.typescriptlang.org/) | Type safety |
| [Tailwind CSS 4](https://tailwindcss.com/) | Styling |
| [Vite](https://vitejs.dev/) | Build tool & dev server |
| [Basic Pitch](https://github.com/spotify/basic-pitch-ts) | Audio-to-MIDI transcription (TensorFlow.js) |
| [Tonal](https://github.com/tonaljs/tonal) | Music theory primitives (scales, chords, keys) |
| [Vitest](https://vitest.dev/) | Unit testing |

---

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/songwriter-guru.git
cd songwriter-guru

# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build
npm run preview
```

---

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Audio Input    │────▶│  Basic Pitch     │────▶│  Note Events      │
│  (getUserMedia) │     │  (TensorFlow.js) │     │  (MIDI + timing)  │
└─────────────────┘     └──────────────────┘     └─────────┬─────────┘
                                                           │
                                                           ▼
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Pitch Class    │◀────│  Feature         │◀────│  Transcribed      │
│  Weights        │     │  Extraction      │     │  Notes            │
└────────┬────────┘     └──────────────────┘     └───────────────────┘
         │
         ▼
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐
│  Harmony        │────▶│  Chord           │────▶│  Progression      │
│  Analysis       │     │  Suggestion      │     │  Generation       │
│  (rank keys)    │     │  (score chords)  │     │  (skeleton +      │
└─────────────────┘     └──────────────────┘     │   transforms)     │
                                                 └───────────────────┘
```

1. **Recording**: Captures audio using `getUserMedia` with optional high-fidelity PCM capture
2. **Transcription**: Basic Pitch's neural network converts audio to polyphonic note events
3. **Feature Extraction**: Converts notes to pitch class weights (how much time spent on each of the 12 notes)
4. **Harmony Analysis**: Scores all 24 major/minor keys against the pitch class distribution
5. **Chord Suggestion**: Generates diatonic, secondary dominant, and borrowed chords; scores each against the riff
6. **Progression Generation**: Decorates skeleton progressions with harmonic transformations, ranked by the weirdness setting

---

## Project Structure

```
src/
├── app/
│   └── App.tsx              # Main application component
├── components/
│   ├── chords/              # Chord suggestion UI
│   ├── harmony/             # Key detection panel
│   ├── progressions/        # Progression cards
│   ├── recorder/            # Audio recording components
│   └── ui/                  # Shared UI components
├── domain/
│   ├── state/               # React context & state management
│   └── types/               # TypeScript type definitions
└── services/
    ├── audioRecorder.ts     # Web Audio recording logic
    ├── transcriptionService.ts  # Basic Pitch integration
    ├── featureExtraction.ts # Pitch class analysis
    ├── harmonyAnalysis.ts   # Key detection algorithm
    ├── chordSuggestion.ts   # Chord generation & scoring
    ├── progressionService.ts # Progression templates & transforms
    └── midiPlayer.ts        # Web Audio MIDI playback
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run test` | Run tests |
| `npm run test:coverage` | Run tests with coverage |

---

## Music Theory Background

### Harmonic Functions

The app classifies chords by their harmonic function:
- **T (Tonic)** — I, iii, vi — stable, "home" chords
- **SD (Subdominant/Predominant)** — ii, IV — create tension, lead to dominant
- **D (Dominant)** — V, vii° — maximum tension, resolve to tonic

### Chord Sources

- **Diatonic**: Chords built from scale tones (e.g., I, ii, iii, IV, V, vi, vii° in major)
- **Secondary Dominant**: V/x chords that temporarily tonicize another scale degree
- **Tritone Substitute**: Dominant chords a tritone away that share the same tritone interval
- **Borrowed**: Chords from parallel modes (e.g., iv and bVII in major borrowed from minor)

### Weirdness Scale

The "weirdness" knob adjusts how the app ranks suggestions:
- **0 (Safe)**: Prefer diatonic chords, proper voice leading, penalize color chords
- **0.5 (Mild)**: Balanced approach
- **1 (Spicy)**: Prioritize colorful chords, reward borrowed/secondary chords

---

## License

ISC License — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [Spotify Basic Pitch](https://basicpitch.spotify.com/) for the incredible audio-to-MIDI model
- [Tonal.js](https://github.com/tonaljs/tonal) for comprehensive music theory utilities
- Inspired by tools like Hookpad, ChordAI, and the harmonic analysis techniques in *Tonal Harmony* by Kostka & Payne
