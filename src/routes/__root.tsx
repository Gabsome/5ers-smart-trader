import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";
import { Footer } from "@/components/footer";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Off the chart</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          That route doesn't exist on this terminal.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Trade desk hit a snag</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Retry
          </button>
          <a href="/" className="rounded-md border border-border px-4 py-2 text-sm hover:bg-accent">
            Home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "7star Challenge — by X-epic Enterprise" },
      {
        name: "description",
        content:
          "Smart AI-assisted dashboard to pass the high-stakes 2-step challenge. Real-time entry signals on majors + XAUUSD, live TradingView charts, risk-aware journaling.",
      },
      { property: "og:title", content: "7star Challenge — by X-epic Enterprise" },
      { property: "og:description", content: "AI-assisted trading dashboard built for the high-stakes 2-step challenge. Real-time signals on majors + XAUUSD, live charts, smart risk." },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "7star Challenge — by X-epic Enterprise" },
      { name: "description", content: "AI-assisted trading dashboard built for the high-stakes 2-step challenge. Real-time signals on majors + XAUUSD, live charts, smart risk." },
      { name: "twitter:description", content: "AI-assisted trading dashboard built for the high-stakes 2-step challenge. Real-time signals on majors + XAUUSD, live charts, smart risk." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2456caec-4b1b-4d54-8ba0-3c8366f3bf12/id-preview-a451145e--48f1d836-c61a-4700-bcfc-9c70678bc964.lovable.app-1783239378132.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2456caec-4b1b-4d54-8ba0-3c8366f3bf12/id-preview-a451145e--48f1d836-c61a-4700-bcfc-9c70678bc964.lovable.app-1783239378132.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#070b16" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "7star" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&display=swap",
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/icon-192.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <div className="flex min-h-screen flex-col">
          <div className="flex-1"><Outlet /></div>
          <Footer />
        </div>
        <Toaster theme="dark" position="top-right" richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}
