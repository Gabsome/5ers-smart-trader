import { motion } from "motion/react";

interface Props { size?: number; animated?: boolean; withText?: boolean }

export function Logo({ size = 40, animated = true, withText = false }: Props) {
  const Mark = animated ? motion.svg : "svg";
  const animProps = animated
    ? {
        initial: { rotate: -8, opacity: 0 },
        animate: { rotate: 0, opacity: 1 },
        transition: { duration: 0.6, ease: "easeOut" as const },
      }
    : {};

  return (
    <div className="inline-flex items-center gap-2">
      <Mark
        {...(animProps as any)}
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-[0_0_12px_color-mix(in_oklab,var(--primary)_45%,transparent)]"
      >
        <defs>
          <linearGradient id="logoGrad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--gold)" />
            <stop offset="100%" stopColor="oklch(0.62 0.22 27)" />
          </linearGradient>
        </defs>
        {/* Hex frame */}
        <motion.path
          d="M24 2 L44 13 V35 L24 46 L4 35 V13 Z"
          stroke="url(#logoGrad)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          initial={animated ? { pathLength: 0 } : false}
          animate={animated ? { pathLength: 1 } : undefined}
          transition={{ duration: 1.1, ease: "easeInOut" }}
        />
        {/* Stylized 5 */}
        <motion.path
          d="M18 14 H32 M18 14 V23 C24 21 30 22 30 28 C30 34 24 36 18 33"
          stroke="var(--gold)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          initial={animated ? { pathLength: 0, opacity: 0 } : false}
          animate={animated ? { pathLength: 1, opacity: 1 } : undefined}
          transition={{ duration: 0.9, delay: 0.3, ease: "easeOut" }}
        />
        {/* Pulse dot */}
        {animated && (
          <motion.circle
            cx="36" cy="36" r="3" fill="var(--bull)"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </Mark>
      {withText && (
        <div className="leading-tight">
          <div className="font-bold tracking-tight">5ers Challenge</div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">by Gabsome-X</div>
        </div>
      )}
    </div>
  );
}
