import { useEffect, useRef } from "react";

const SYMBOL_MAP: Record<string, string> = {
  "EUR/USD": "FX:EURUSD",
  "GBP/USD": "FX:GBPUSD",
  "USD/JPY": "FX:USDJPY",
  "AUD/USD": "FX:AUDUSD",
  "USD/CAD": "FX:USDCAD",
  "XAU/USD": "OANDA:XAUUSD",
};

export function TradingViewChart({ pair, interval = "15" }: { pair: string; interval?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: SYMBOL_MAP[pair] ?? "FX:EURUSD",
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      enable_publishing: false,
      hide_top_toolbar: false,
      hide_legend: false,
      withdateranges: true,
      backgroundColor: "rgba(20,28,40,1)",
      allow_symbol_change: true,
      studies: ["STD;EMA", "STD;RSI"],
      support_host: "https://www.tradingview.com",
    });
    ref.current.appendChild(script);
  }, [pair, interval]);

  return (
    <div className="tradingview-widget-container h-full w-full" ref={ref}>
      <div className="tradingview-widget-container__widget h-full w-full" />
    </div>
  );
}
