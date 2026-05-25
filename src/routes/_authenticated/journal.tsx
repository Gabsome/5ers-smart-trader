import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Plus, Trash2, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { listTrades, logTrade, updateTrade, deleteTrade } from "@/lib/trades.functions";

export const Route = createFileRoute("/_authenticated/journal")({
  component: Journal,
  head: () => ({ meta: [{ title: "Trade journal — 5ers Challenge" }] }),
});

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "XAU/USD"];

function Journal() {
  const lFn = useServerFn(listTrades);
  const cFn = useServerFn(logTrade);
  const uFn = useServerFn(updateTrade);
  const dFn = useServerFn(deleteTrade);
  const qc = useQueryClient();
  const trades = useQuery({ queryKey: ["trades"], queryFn: () => lFn(), refetchInterval: 30_000 });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    pair: "EUR/USD", direction: "buy" as "buy" | "sell", entry: "", stop_loss: "", take_profit: "",
    lot_size: "0.01", pnl_usd: "0", status: "open" as const, notes: "",
  });

  const create = useMutation({
    mutationFn: () =>
      cFn({
        data: {
          pair: form.pair, direction: form.direction, entry: Number(form.entry),
          stop_loss: form.stop_loss ? Number(form.stop_loss) : null,
          take_profit: form.take_profit ? Number(form.take_profit) : null,
          lot_size: Number(form.lot_size) || 0.01, pnl_usd: Number(form.pnl_usd) || 0,
          status: form.status, notes: form.notes || null,
        },
      }),
    onSuccess: () => {
      toast.success("Trade logged"); setOpen(false);
      qc.invalidateQueries({ queryKey: ["trades"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: any) => toast.error("Log failed", { description: e?.message }),
  });

  const closeTrade = useMutation({
    mutationFn: ({ id, pnl, status }: { id: string; pnl: number; status: "win" | "loss" | "breakeven" }) =>
      uFn({ data: { id, pnl_usd: pnl, status } }),
    onSuccess: () => { toast.success("Trade closed"); qc.invalidateQueries(); },
    onError: (e: any) => toast.error("Update failed", { description: e?.message }),
  });

  const del = useMutation({
    mutationFn: (id: string) => dFn({ data: { id } }),
    onSuccess: () => { toast.success("Trade deleted"); qc.invalidateQueries({ queryKey: ["trades"] }); },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Trade journal</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="size-4 mr-2" /> Log trade</Button></DialogTrigger>
          <DialogContent className="bg-card">
            <DialogHeader><DialogTitle>Log a trade</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pair">
                <Select value={form.pair} onValueChange={(v) => setForm({ ...form, pair: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PAIRS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Direction">
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem><SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Entry"><Input type="number" step="0.00001" value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })} /></Field>
              <Field label="Lot size"><Input type="number" step="0.01" value={form.lot_size} onChange={(e) => setForm({ ...form, lot_size: e.target.value })} /></Field>
              <Field label="Stop loss"><Input type="number" step="0.00001" value={form.stop_loss} onChange={(e) => setForm({ ...form, stop_loss: e.target.value })} /></Field>
              <Field label="Take profit"><Input type="number" step="0.00001" value={form.take_profit} onChange={(e) => setForm({ ...form, take_profit: e.target.value })} /></Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="win">Win</SelectItem>
                    <SelectItem value="loss">Loss</SelectItem>
                    <SelectItem value="breakeven">Breakeven</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="P&L ($)"><Input type="number" step="0.01" value={form.pnl_usd} onChange={(e) => setForm({ ...form, pnl_usd: e.target.value })} /></Field>
              <div className="col-span-2">
                <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></Field>
              </div>
            </div>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !form.entry}>Save trade</Button>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Pair</th>
                <th className="text-left p-3">Dir</th>
                <th className="text-right p-3">Entry</th>
                <th className="text-right p-3">Lot</th>
                <th className="text-right p-3">P&L</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(trades.data ?? []).length === 0 && (
                <tr><td colSpan={8} className="text-center p-8 text-muted-foreground">No trades yet. Log your first one.</td></tr>
              )}
              {(trades.data ?? []).map((t: any) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="p-3 text-xs text-muted-foreground">{new Date(t.opened_at).toLocaleString()}</td>
                  <td className="p-3 font-medium">{t.pair}</td>
                  <td className="p-3"><span className={`text-xs font-bold ${t.direction === "buy" ? "text-bull" : "text-bear"}`}>{String(t.direction).toUpperCase()}</span></td>
                  <td className="p-3 text-right tabular-nums">{Number(t.entry).toFixed(5)}</td>
                  <td className="p-3 text-right tabular-nums">{Number(t.lot_size).toFixed(2)}</td>
                  <td className={`p-3 text-right tabular-nums font-semibold ${Number(t.pnl_usd) > 0 ? "text-bull" : Number(t.pnl_usd) < 0 ? "text-bear" : ""}`}>
                    {Number(t.pnl_usd) >= 0 ? "+" : ""}${Number(t.pnl_usd).toFixed(2)}
                  </td>
                  <td className="p-3"><span className="text-xs px-2 py-0.5 rounded bg-muted">{t.status}</span></td>
                  <td className="p-3 text-right">
                    {t.status === "open" && (
                      <CloseInline onSave={(pnl, status) => closeTrade.mutate({ id: t.id, pnl, status })} />
                    )}
                    <Button size="icon" variant="ghost" className="ml-1" onClick={() => del.mutate(t.id)}><Trash2 className="size-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs mb-1 block">{label}</Label>{children}</div>;
}

function CloseInline({ onSave }: { onSave: (pnl: number, status: "win" | "loss" | "breakeven") => void }) {
  const [pnl, setPnl] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <Input className="h-7 w-20 inline-block" placeholder="P&L $" value={pnl} onChange={(e) => setPnl(e.target.value)} />
      <Button size="icon" variant="ghost" className="text-bull" onClick={() => onSave(Number(pnl) || 0, Number(pnl) > 0 ? "win" : Number(pnl) < 0 ? "loss" : "breakeven")}><Check className="size-4" /></Button>
    </span>
  );
}
