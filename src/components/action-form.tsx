"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
export type FormResult = { message: string; ok?: boolean; link?: string };
export default function ActionForm({
  action,
  children,
  label = "Lưu",
}: {
  action: (state: FormResult, form: FormData) => Promise<FormResult>;
  children: React.ReactNode;
  label?: string;
}) {
  const [state, submit, pending] = useActionState(action, { message: "" });
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={submit}>
      {children}
      <button disabled={pending} className="primary" style={{ marginTop: 16 }}>
        {pending ? "Đang xử lý…" : label}
      </button>
      {state.message && (
        <p role={state.ok ? "status" : "alert"}>{state.message}</p>
      )}
      {state.link && (
        <p>
          <a href={state.link} style={{ overflowWrap: "anywhere" }}>
            {state.link}
          </a>
          <br />
          <small>
            Sao chép link này để mời bạn. Link chỉ hiển thị sau khi tạo.
          </small>
        </p>
      )}
    </form>
  );
}
