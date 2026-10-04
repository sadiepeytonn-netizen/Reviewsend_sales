"use client";

import Link from "next/link";
import { Alert, Button, Card } from "@/components/ui";

// Shown inside the app (menu still visible) if a page fails to load.
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <h1 className="text-lg font-semibold text-gray-900">This page couldn&apos;t load</h1>
      <div className="mt-3">
        <Alert tone="amber">
          {error.message && !error.message.startsWith("An error occurred in the Server Components render")
            ? error.message
            : "Something went wrong on the server."}
          {error.digest && <span className="mt-1 block text-xs opacity-70">Error code: {error.digest}</span>}
        </Alert>
      </div>
      <div className="mt-4 flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Link href="/dialer"><Button variant="secondary">Go to the dialer</Button></Link>
      </div>
    </Card>
  );
}
