// Motion layer (ADR-D22). Everything here is decoration: content is always present in the DOM and readable, and
// every animation is switched off when the person asks for reduced motion (MotionConfig reducedMotion="user" turns
// off movement; the CSS rule in index.css turns off CSS animation).
//   MotionRoot     wraps the app once
//   Reveal         fade + rise on entry
//   Stagger/Item   children enter one after another
//   CountUp        number that counts up to its value
//   PageTransition fades the page in when the route changes (enter only: no exit delay, so navigation stays instant)
import { animate, MotionConfig, motion, useReducedMotion, type Variants } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

export function Reveal({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'header';
}) {
  const Tag = motion[as];
  return (
    <Tag
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE_OUT }}
    >
      {children}
    </Tag>
  );
}

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.45, ease: EASE_OUT } },
};

export function Stagger({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'ul' | 'section';
}) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={listVariants} initial="hidden" animate="show">
      {children}
    </Tag>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'article';
}) {
  const Tag = motion[as];
  return (
    <Tag className={className} variants={itemVariants}>
      {children}
    </Tag>
  );
}

/** A number that counts up. The final value is the text from the first render, so tests, print and reduced motion all see it. */
export function CountUp({ value, locale }: { value: number; locale?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const format = (n: number) => new Intl.NumberFormat(locale).format(Math.round(n));
  useEffect(() => {
    const node = ref.current;
    if (!node || reduced) return;
    const controls = animate(0, value, {
      duration: 0.9,
      ease: EASE_OUT,
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
      onComplete: () => {
        node.textContent = format(value);
      },
    });
    return () => controls.stop();
  }, [value, reduced, locale]);
  return <span ref={ref}>{format(value)}</span>;
}

/** Fades the routed page in when the path changes. Keyed by path, enter only. */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT }}
    >
      {children}
    </motion.div>
  );
}
