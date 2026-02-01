MVP implementation plan (React + Tailwind, 100% client-side)

Core premise: record a short guitar riff → transcribe to note events (Basic Pitch) → infer likely harmonic fields (keys/modes) → generate + rank chord options (including secondary dominants + borrowed chords) → suggest short progressions.

This plan assumes you use Spotify’s Basic Pitch TypeScript package (tfjs-based) and Tonal for theory primitives. Basic Pitch’s README shows the intended flow: BasicPitch.evaluateModel(...) → outputToNotesPoly(...) → noteFramesToTime(...) producing note events.
Tonal is a JS/TS music theory library (scales/chords/keys/modes), and Tonal’s Progression helpers convert roman numerals ↔ chord symbols.
Modal mixture (“borrowed chords”) is explicitly “chords belonging to a parallel key” (e.g., F major borrowing from F minor).
Tonicization and secondary dominants/leading-tone chords are standard “applied” harmony tools.
Browser recording will use MediaRecorder / getUserMedia.