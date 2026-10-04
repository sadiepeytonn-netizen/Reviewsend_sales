"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";
import type { PaymentSetup } from "@/lib/payment-setup";
import { PaymentFlow } from "./payment-flow";
import { ManualSaleForm } from "./manual-sale";

export function NewPayment({ setup }: { setup: PaymentSetup }) {
  const router = useRouter();
  const [open, setOpen] = useState<"none" | "stripe" | "manual">("none");
  const [key, setKey] = useState(0);

  if (open === "none") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setOpen("stripe")}><Plus className="h-4 w-4" /> New payment</Button>
        {setup.isAdmin && <Button variant="secondary" onClick={() => setOpen("manual")}>Record a sale paid outside the CRM</Button>}
      </div>
    );
  }
  const close = () => {
    setOpen("none");
    setKey((k) => k + 1);
    router.refresh();
  };
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-medium text-gray-900">{open === "stripe" ? "New payment" : "Record a sale paid outside the CRM"}</h2>
        <button className="text-sm text-gray-500 hover:underline" onClick={close}>Close</button>
      </div>
      {open === "stripe" ? (
        <>
          {!setup.ready && <div className="mb-4"><Alert tone="amber">Stripe isn&apos;t connected yet (missing {setup.missing.join(", ")}). See the setup guide, step 6.</Alert></div>}
          <PaymentFlow key={key} {...setup} onDone={close} />
        </>
      ) : (
        <ManualSaleForm reps={setup.reps} onDone={close} />
      )}
    </Card>
  );
}
