export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden focusable="false">
      <path
        d="M16 3.2 26.4 9v11.2L16 28.8 5.6 20.2V9L16 3.2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M10.4 12.6h11.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.4 18.4h6.4l3.4 3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
