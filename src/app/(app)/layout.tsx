import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { Heartbeat } from "@/components/heartbeat";
import { CallBar } from "@/components/call/call-bar";
import { DialerProvider } from "@/components/call/dialer-provider";
import { Nav } from "@/components/nav";
import { LiveSection } from "@/components/live/live-section";
import { allowedModes } from "@/lib/twilio";
import { signOut } from "@/app/login/actions";

// The logged-in app: sidebar + page. Every page inside (app) requires an
// active user who has already replaced their temporary password.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await requireUser();
  if (profile.must_change_password) redirect("/change-password");
  const modes = allowedModes(profile);

  return (
    <DialerProvider>
    <div className="flex min-h-screen flex-col md:flex-row">
      <Heartbeat />
      <aside className="flex shrink-0 flex-col border-b border-gray-200 bg-white px-4 py-4 md:w-60 md:border-r md:border-b-0 md:py-6">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            R
          </div>
          <span className="font-semibold text-gray-900">ReviewSend Sales</span>
        </div>

        <Nav role={profile.role} />
        {modes.length > 0 && <LiveSection />}

        <div className="mt-6 border-t border-gray-100 pt-4 md:mt-auto">
          <div className="px-2">
            <p className="truncate text-sm font-medium text-gray-900">{profile.full_name || profile.email}</p>
            <p className="text-xs capitalize text-gray-500">{profile.role}</p>
          </div>
          <div className="mt-3 space-y-1">
            <Link
              href="/change-password"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
            >
              <KeyRound className="h-4 w-4" /> Change password
            </Link>
            <form action={signOut}>
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pb-6 md:px-10 md:pb-8">
        <CallBar modes={modes} />
        <div className="pt-6 md:pt-8">{children}</div>
      </main>
    </div>
    </DialerProvider>
  );
}
