"use client";
import { useState } from "react";
import { loadExpenseEditor } from "@/app/sessions/actions";
import ExpenseForm from "./expense-form";
export default function ExpenseEditButton({
  id,
  administrative,
}: {
  id: string;
  administrative?: { sourceId: string | null };
}) {
  const [data, setData] = useState<Awaited<
    ReturnType<typeof loadExpenseEditor>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        className="secondary"
        type="button"
        disabled={busy}
        onClick={async () => {
          if (open) {
            setOpen(false);
            return;
          }
          setBusy(true);
          try {
            setData(await loadExpenseEditor(id, !!administrative));
            setOpen(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Đang tải…" : open ? "Đóng phần sửa" : "Sửa khoản chi"}
      </button>
      {open &&
        data &&
        ("session" in data && data.session ? (
          <ExpenseForm
            key={data.expense!.id + data.session.revision}
            session={data.session}
            edit={data.expense}
            tools={data.tools}
            administrative={administrative}
          />
        ) : (
          <p role="alert">{data.message}</p>
        ))}
    </div>
  );
}
