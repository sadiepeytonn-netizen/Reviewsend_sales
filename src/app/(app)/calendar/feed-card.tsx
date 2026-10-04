"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Card, Input } from "@/components/ui";
import { resetCalendarLink } from "./actions";

/** "Add to Google Calendar / iPhone" with the rep's private calendar link. */
export function FeedCard({ token: initial, isAdmin, origin }: { token: string | null; isAdmin: boolean; origin: string }) {
  const [token, setToken] = useState(initial);
  const [copied, setCopied] = useState(false);
  if (!token) return null;

  const url = `${origin}/api/calendar/${token}.ics`;
  const webcal = url.replace(/^https?:/, "webcal:");

  return (
    <Card>
      <h2 className="font-medium text-gray-900">See {isAdmin ? "all demos" : "your demos"} in Google Calendar or on your phone</h2>
      <p className="mt-1 text-sm text-gray-600">
        This is your private link. Anyone who has it can see these appointments, so don&apos;t share it.
        Changes show up there within a few hours (in the CRM they&apos;re instant).
      </p>
      <div className="mt-3 flex gap-2">
        <Input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Calendar link" />
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="mt-4 grid gap-4 text-sm text-gray-700 md:grid-cols-2">
        <div>
          <p className="font-medium text-gray-900">Google Calendar (computer)</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Copy the link above.</li>
            <li>Open Google Calendar. Next to <b>Other calendars</b> click <b>+</b> → <b>From URL</b>.</li>
            <li>Paste the link and click <b>Add calendar</b>.</li>
          </ol>
        </div>
        <div>
          <p className="font-medium text-gray-900">iPhone</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Open this page on your iPhone.</li>
            <li>Tap <a href={webcal} className="font-medium text-brand-600 underline">Subscribe on this phone</a>, then <b>Subscribe</b>.</li>
          </ol>
        </div>
      </div>
      <button
        className="mt-4 text-xs text-gray-500 underline-offset-2 hover:underline"
        onClick={async () => {
          if (!window.confirm("Make a new link? The old one will stop working everywhere you added it.")) return;
          const res = await resetCalendarLink();
          if (res.token) {
            setToken(res.token);
            setCopied(false);
          }
        }}
      >
        Shared it by mistake? Make a new link
      </button>
    </Card>
  );
}
