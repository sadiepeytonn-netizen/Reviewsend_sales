import { requireUser } from "@/lib/auth";
import { Card } from "@/components/ui";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage() {
  const profile = await requireUser();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Choose your password</h1>
          <p className="mt-1 text-sm text-gray-500">
            {profile.must_change_password
              ? "You signed in with a temporary password. Pick your own to continue."
              : "Change the password you use to sign in."}
          </p>
        </div>
        <Card>
          <ChangePasswordForm />
        </Card>
      </div>
    </main>
  );
}
