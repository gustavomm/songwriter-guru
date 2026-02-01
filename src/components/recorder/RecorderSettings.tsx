import { Toggle } from '../ui/Toggle'
import type { TranscriptionPreset } from '../../domain/types'

interface RecorderSettingsProps {
  musicMode: boolean
  onMusicModeChange: () => void
  preset: TranscriptionPreset
  onPresetChange: () => void
}

export function RecorderSettings({
  musicMode,
  onMusicModeChange,
  preset,
  onPresetChange,
}: RecorderSettingsProps) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:mb-6 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-4">
      {/* Music Mode Toggle */}
      <Toggle
        isOn={musicMode}
        onToggle={onMusicModeChange}
        onLabel="Music"
        offLabel="Noisy"
        onIcon="🎸"
        offIcon="🎙️"
        onColor="amber"
        offColor="blue"
        hint={musicMode ? 'Clean audio' : 'Noise filtering'}
      />

      {/* Preset Toggle */}
      <Toggle
        isOn={preset === 'lead'}
        onToggle={onPresetChange}
        onLabel="Lead"
        offLabel="Chord"
        onIcon="🎵"
        offIcon="🎶"
        onColor="purple"
        offColor="teal"
        hint={preset === 'lead' ? 'Single notes & riffs' : 'Strumming & chords'}
      />
    </div>
  )
}
