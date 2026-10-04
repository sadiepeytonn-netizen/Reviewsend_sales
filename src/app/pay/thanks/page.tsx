import { CheckCircle2, XCircle } from "lucide-react";

// Where clients land after paying through an emailed payment link.
export default async function ThanksPage({ searchParams }: PageProps<"/pay/thanks">) {
  const { canceled } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
        {canceled ? (
          <>
            <XCircle className="mx-auto h-10 w-10 text-gray-400" />
            <h1 className="mt-3 text-xl font-semibold text-gray-900">Payment not completed</h1>
            <p className="mt-2 text-sm text-gray-600">No charge was made. Your ReviewSend rep can send you a new link.</p>
          </>
        ) : (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
            <h1 className="mt-3 text-xl font-semibold text-gray-900">You&apos;re all set!</h1>
            <p className="mt-2 text-sm text-gray-600">Thanks for joining ReviewSend. Your receipt is on its way to your email. Stay on the line with your rep to book your onboarding call.</p>
          </>
        )}
      </div>
    </main>
  );
}
