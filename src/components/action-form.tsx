"use client";
import { useActionState, useEffect, useRef } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
export type FormResult = { message: string; ok?: boolean; link?: string };
export default function ActionForm({
  action,
  children,
  label = "Lưu",
  disabled = false,
}: {
  action: (state: FormResult, form: FormData) => Promise<FormResult>;
  children: React.ReactNode;
  label?: string;
  disabled?: boolean;
}) {
  const request = useRef<{ fingerprint: string; key: string } | null>(null);
  async function submitIntent(state: FormResult, form: FormData) {
    if (!form.has("request_key")) {
      const fingerprint = JSON.stringify([...form.entries()]);
      if (request.current?.fingerprint !== fingerprint) {
        request.current = { fingerprint, key: crypto.randomUUID() };
      }
      form.set("request_key", request.current!.key);
    }
    try {
      return await action(state, form);
    } catch (error) {
      unstable_rethrow(error);
      return {
        message:
          "Chưa nhận được kết quả. Kiểm tra kết nối và trạng thái trong app; gửi lại cùng nội dung sẽ dùng lại mã yêu cầu.",
      };
    }
  }
  const [state, submit, pending] = useActionState(submitIntent, {
    message: "",
  });
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={submit}>
      {children}
      <button
        disabled={pending || disabled}
        className="primary"
        style={{ marginTop: 16 }}
      >
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
