type TabId = 'all' | 'diatonic' | 'secondary' | 'borrowed'

const tabs: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'diatonic', label: 'Diatonic' },
  { id: 'secondary', label: 'Secondary' },
  { id: 'borrowed', label: 'Borrowed' },
]

interface ChordTabsProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

export function ChordTabs({ activeTab, onTabChange }: ChordTabsProps) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-stone-950/50 p-1 scrollbar-hide">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all min-w-fit ${
            activeTab === tab.id
              ? 'bg-stone-800 text-stone-100'
              : 'text-stone-500 hover:text-stone-300'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export type { TabId }
