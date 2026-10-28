import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';

/**
 * Scroll-triggered entrance animation. Uses IntersectionObserver and falls
 * back to visible content when the API is unavailable, so nothing is ever
 * hidden from users who cannot run it.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'header' | 'article';
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    // Content that is already on screen when the page is first painted — or
    // that sits above the viewport after a deep link or a fast scroll — must
    // never stay hidden waiting for an intersection that cannot happen.
    const rect = node.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // `top < 0` means the element scrolled past the viewport (for example
          // after jumping to an anchor further down the page).
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0, rootMargin: '0px 0px -24px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={clsx('reveal', visible && 'reveal-in', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}
