import type { CSSProperties } from 'react'
import { PAPER_NOTE_KIND_PLURALS, PAPER_NOTE_KINDS } from '../lib/paperNotes'
import type { PaperNoteFilter } from '../lib/paperNotes'

const FILTERS: readonly PaperNoteFilter[] = ['all', ...PAPER_NOTE_KINDS]

interface PaperCategoriesProps {
  filter: PaperNoteFilter
  counts: Readonly<Record<PaperNoteFilter, number>>
  onChange: (filter: PaperNoteFilter) => void
}

export function PaperCategories({ filter, counts, onChange }: PaperCategoriesProps) {
  const selected = Math.max(0, FILTERS.indexOf(filter))
  return (
    <nav
      className="paper-categories"
      aria-label="Show notes by kind"
      style={{ '--selected': selected } as CSSProperties}
    >
      <p className="paper-categories-title" aria-hidden="true">Kinds</p>
      <ul>
        {FILTERS.map((option) => {
          const name = option === 'all' ? 'All' : PAPER_NOTE_KIND_PLURALS[option]
          return (
            <li key={option}>
              <button
                type="button"
                className={option === filter ? 'is-selected' : ''}
                aria-pressed={option === filter}
                aria-label={`${option === 'all' ? 'All notes' : name}, ${counts[option]}`}
                onClick={() => onChange(option)}
              >
                <span className="paper-category-name">{name}</span>
                <span className="paper-category-count">{String(counts[option]).padStart(2, '0')}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <span className="paper-categories-marker" aria-hidden="true" />
    </nav>
  )
}
