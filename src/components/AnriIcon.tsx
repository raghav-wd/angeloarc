interface AnriIconProps {
  size?: number
  strokeWidth?: number
  className?: string
}

// Anri as a few pencil lines: cloud of hair, floppy ears, two dot eyes.
export function AnriIcon({ size = 18, strokeWidth = 1.4, className }: AnriIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.1 19.3C4 19.5 2.7 17.6 3.4 15.8 2.3 14.4 2.8 12.1 4.5 11.6 4 9.1 5.6 6.8 8 6.7 8.9 4.6 11.6 3.7 13.6 4.7 15.6 3.9 18.1 5 18.6 7.3 20.6 7.9 21.4 10.1 20.5 11.9 21.6 13.4 21.2 15.6 20.3 16.3 21 18.2 19.6 19.7 17.9 19.3" />
      <path d="M6.1 19.3C6.7 17.6 6.9 15.6 6.7 13.7M17.9 19.3C17.3 17.6 17.1 15.6 17.3 13.7" />
      <path d="M7.7 16.7C8.5 19 10.1 20.3 12 20.3 13.9 20.3 15.5 19 16.3 16.7" />
      <path d="M6.7 13.7C9.6 13.5 12.7 11.5 14.2 8.7 15 10.9 16 12.7 17.3 13.7" />
      <path d="M10.1 15.7v.4M13.9 15.7v.4" strokeWidth={strokeWidth * 1.6} />
    </svg>
  )
}
