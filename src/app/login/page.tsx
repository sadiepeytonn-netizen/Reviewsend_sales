import { redirect } from "next/navigation";
import { getCurrentProfile, homePathFor } from "@/lib/auth";
import { Card } from "@/components/ui";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const profile = await getCurrentProfile();
  if (profile?.active) redirect(homePathFor(profile));

  const notice =
    error === "disabled" || (profile && !profile.active)
      ? "Your account is turned off. Ask your admin to turn it back on."
      : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            R
          </div>
          <h1 className="text-xl font-semibold text-gray-900">ReviewSend Sales</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to the sales floor</p>
        </div>
        <Card>
          <LoginForm notice={notice} />
        </Card>
      </div>
    </main>
  );
}
