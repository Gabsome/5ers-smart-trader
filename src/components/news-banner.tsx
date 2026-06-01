import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, AlertOctagon } from "lucide-react";
import { getNews } from "@/lib/engine.functions";

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "XAU/USD"];

export function NewsBanner({ pairs = PAIRS }: { pairs?: string[] }) {
  const fn = useServerFn(getNews);
  const { data } = useQuery({
    queryKey: ["news", pairs],
    queryFn: () => fn({ data: { pairs, windowMin: 30 } }),
    refetchInterval: 60_000,
  });

  if (!data) return null;
  const halted = data.halted ?? [];
  const upcoming = (data.upcoming ?? []).filter((e: any) => e.minutesAway >= -5).slice(0, 4);

  if (!halted.length && !upcoming.length) return null;

  return (
    <div className={`rounded-xl border p-4 ${halted.length ? "border-bear/50 bg-bear/10" : "border-primary/30 bg-primary/5"}`}>
      <div className="flex items-center gap-2 mb-2">
        {halted.length ? <AlertOctagon className="size-4 text-bear" /> : <CalendarClock className="size-4 text-primary" />}
        <h3 className="text-sm font-semibold">
          {halted.length ? "News halt active" : "Upcoming high-impact news"}
        </h3>
      </div>
      {halted.length > 0 && (
        <p className="text-xs text-foreground/85 mb-2">
          Engine is holding <strong>{halted.map((h: any) => h.pair).join(", ")}</strong> —
          {" "}{halted[0].event.title} ({halted[0].event.currency}){" "}
          {halted[0].event.minutesAway >= 0 ? `in ${halted[0].event.minutesAway} min` : `${Math.abs(halted[0].event.minutesAway)} min ago`}.
        </p>
      )}
      <ul className="space-y-1">
        {upcoming.map((e: any, i: number) => (
          <li key={i} className="text-xs flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-bear/20 text-bear font-bold text-[10px]">{e.currency}</span>
            <span className="text-foreground/85">{e.title}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">
              {e.minutesAway <= 0 ? "now" : e.minutesAway < 60 ? `${e.minutesAway}m` : `${Math.round(e.minutesAway / 60)}h`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
