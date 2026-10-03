"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

// Shown once, right after a user is added or a password is reset.
export function TempPasswordNotice({ email, password }: { email?: string; password: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg bg-green-50 p-4 text-sm text-green-900 ring-1 ring-green-200">
      <p className="font-medium">Give these sign-in details to the person (in person or by text):</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {email && (
          <>
            <dt className="text-green-700">Email</dt>
            <dd>{email}</dd>
          </>
        )}
        <dt className="text-green-700">Temporary password</dt>
        <dd className="flex items-center gap-2">
          <code className="rounded bg-white px-2 py-0.5 font-mono text-base ring-1 ring-green-200">{password}</code>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-green-800 hover:underline"
            onClick={async () => {
              await navigator.clipboard.writeText(password);
              setCopied(true);
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </dd>
      </dl>
      <p className="mt-2 text-green-700">
        This is shown only once. They&apos;ll be asked to choose their own password when they first sign in.
      </p>
    </div>
  );
}
