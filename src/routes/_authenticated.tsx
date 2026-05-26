import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { LayoutDashboard, Radio, BookOpen, Settings, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ModeSwitcher } from "@/components/mode-switcher";
import { Logo } from "@/components/logo";
import { LoadingScreen } from "@/components/loading-screen";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const { user, loading, signOut } = useAuth();
  const nav = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (!loading && !user) nav({ to: "/login" });
  }, [loading, user, nav]);

  if (loading || !user) {
    return <LoadingScreen label="Loading your trade desk…" />;
  }

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/signals", label: "Signals", icon: Radio },
    { to: "/journal", label: "Journal", icon: BookOpen },
    { to: "/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-card/60 backdrop-blur sticky top-0 z-30">
        <div className="container mx-auto px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
          <Link to="/dashboard" className="flex items-center gap-2 font-bold shrink-0">
            <Logo size={32} />
            <span className="hidden sm:inline">5ers Challenge <span className="text-muted-foreground font-medium text-sm">· Gabsome-X</span></span>
          </Link>
          <nav className="flex items-center gap-1 overflow-x-auto">
            {navItems.map((it) => {
              const active = path.startsWith(it.to);
              return (
                <Link key={it.to} to={it.to}
                  className={`px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground"}`}>
                  <it.icon className="size-4" />
                  <span className="hidden md:inline">{it.label}</span>
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            <ModeSwitcher />
            <Button variant="ghost" size="icon" onClick={() => signOut().then(() => nav({ to: "/" }))} title="Sign out">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 lg:px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
