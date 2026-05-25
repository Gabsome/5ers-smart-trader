import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProfile, updateProfile } from "@/lib/trades.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const MODES = [
  { value: "challenge", label: "Challenge (Step 1)" },
  { value: "verification", label: "Verification (Step 2)" },
  { value: "funded", label: "Funded (Live)" },
  { value: "demo", label: "Demo / Test" },
];

export function ModeSwitcher() {
  const getP = useServerFn(getProfile);
  const updP = useServerFn(updateProfile);
  const qc = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => getP() });
  const m = useMutation({
    mutationFn: (mode: string) => updP({ data: { current_mode: mode as any } }),
    onSuccess: (_d, mode) => {
      qc.invalidateQueries();
      const label = MODES.find((x) => x.value === mode)?.label ?? mode;
      toast.success(`Mode: ${label}`, { description: "AI will adapt risk and aggression." });
    },
    onError: (e: any) => toast.error("Could not switch mode", { description: e?.message }),
  });

  return (
    <Select value={profile?.current_mode ?? "challenge"} onValueChange={(v) => m.mutate(v)}>
      <SelectTrigger className="w-[180px] h-9 bg-card">
        <SelectValue placeholder="Mode" />
      </SelectTrigger>
      <SelectContent>
        {MODES.map((mo) => (
          <SelectItem key={mo.value} value={mo.value}>{mo.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
