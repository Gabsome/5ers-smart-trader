import { motion } from "motion/react";
import { Logo } from "./logo";

export function LoadingScreen({ label = "Scanning markets…" }: { label?: string }) {
  return (
    <div className="min-h-[60vh] grid place-items-center">
      <div className="flex flex-col items-center gap-5">
        <motion.div
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Logo size={72} />
        </motion.div>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-2 rounded-full bg-primary"
              animate={{ opacity: [0.2, 1, 0.2], y: [0, -4, 0] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
