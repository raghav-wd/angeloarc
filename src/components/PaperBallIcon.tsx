import type { SVGProps } from 'react'

interface PaperBallIconProps extends SVGProps<SVGSVGElement> {
  size?: number
  strokeWidth?: number
}

/** A crumpled paper ball, drawn to sit alongside the lucide line icons. */
export function PaperBallIcon({ size = 20, strokeWidth = 1.35, ...props }: PaperBallIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6.4 5.4 10.6 3.3l4.8.5 3.7 3.1 1.6 4.6-1.2 4.9-3.6 3.4-5 .7-4.5-2.1-2.6-4.1.1-5z" />
      <path d="m10.6 3.3.5 5-7.2 1" />
      <path d="m11.1 8.3 4.8 1.9 3.2-3.3" />
      <path d="m15.9 10.2-2.6 5 2.6 4.6" />
      <path d="m13.3 15.2-5.8-1.8 3.6-5.1" />
      <path d="m7.5 13.4-1.1 5" />
    </svg>
  )
}
