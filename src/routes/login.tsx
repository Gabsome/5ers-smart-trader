import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/hooks/use-auth";
import { Logo } from "@/components/logo";

export const Route = createFileRoute("/login")({
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in — 7star Challenge" }] }),
});

function LoginPage() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) nav({ to: "/dashboard" });
  }, [loading, user, nav]);

  const signIn = async () => {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
      if (result.error) {
        toast.error("Sign-in failed", { description: result.error.message });
        setBusy(false);
        return;
      }
      if (result.redirected) return;
      nav({ to: "/dashboard" });
    } catch (e) {
      toast.error("Sign-in failed", { description: String(e) });
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-6">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center">
        <div className="flex justify-center mb-4">
          <Logo size={64} />
        </div>
        <h1 className="text-2xl font-bold">7star Challenge</h1>
        <p className="text-sm text-muted-foreground mt-1">by Gabsome-X</p>
        <p className="mt-6 text-sm text-muted-foreground">
          Sign in to access your AI trading dashboard.
        </p>
        <Button onClick={signIn} disabled={busy} className="w-full mt-6" size="lg">
          {busy ? "Redirecting…" : "Continue with Google"}
        </Button>
        <p className="mt-6 text-xs text-muted-foreground">
          Your data stays private — scoped to your account only.
        </p>
      </div>
    </div>
  );
}
