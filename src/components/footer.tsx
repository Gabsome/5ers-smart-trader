import { ShieldCheck } from "lucide-react";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border bg-card/40 text-xs text-muted-foreground">
      <div className="container mx-auto px-4 lg:px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-3.5 text-primary" />
          <span>
            © {year} <span className="text-foreground font-semibold">Gabriel Maina Mwangi</span>, Nakuru, Kenya. All rights reserved.
            <span className="hidden sm:inline"> · 5ers Challenge by Gabsome-X.</span>
          </span>
        </div>
        <div className="text-center md:text-right max-w-xl">
          <span className="uppercase tracking-widest text-[10px] text-primary">For educational purposes only</span> · Not financial advice.
          Trading FX/CFDs carries substantial risk. Signals are technical analysis assistance — you are responsible for every order placed on your live or challenge account.
        </div>
      </div>
    </footer>
  );
}
