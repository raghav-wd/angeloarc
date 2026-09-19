import { useEffect, useRef, useState } from 'react'

export function Brand({ onHome }: { onHome: () => void }) {
  const [expanded, setExpanded] = useState(true)
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    timeout.current = setTimeout(() => setExpanded(false), 1800)
    return () => clearTimeout(timeout.current)
  }, [])

  function expand() {
    clearTimeout(timeout.current)
    setExpanded(true)
  }

  function collapseLater() {
    clearTimeout(timeout.current)
    timeout.current = setTimeout(() => setExpanded(false), 2400)
  }

  return (
    <button
      className={`brand ${expanded ? 'is-expanded' : ''}`}
      aria-label="ANGELO, return to this month"
      onPointerEnter={expand}
      onPointerLeave={collapseLater}
      onFocus={expand}
      onBlur={collapseLater}
      onClick={() => {
        expand()
        onHome()
      }}
    >
      <span className="brand-prefix" aria-hidden="true">AN</span>
      <svg className="brand-mark" viewBox="0 0 36 36" aria-hidden="true">
        <path d="M18 3.7A14.3 14.3 0 1 1 3.7 18H17" />
      </svg>
      <span className="brand-suffix" aria-hidden="true">ELO</span>
    </button>
  )
}
