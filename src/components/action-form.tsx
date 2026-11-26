"use client";
import { useActionState, useEffect, useId, useRef } from "react";
import { useRouter, unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
export type FormResult = { message: string; ok?: boolean; link?: string };
export default function ActionForm({
  action,
  children,
  label = "Lưu",
  disabled = false,
  disabledReason,
  hideSubmit = false,
  onInvalidCapture,
  className,
  onSuccess,
  preserveValues = false,
}: {
  action: (state: FormResult, form: FormData) => Promise<FormResult>;
  children: React.ReactNode;
  label?: string;
  disabled?: boolean;
  disabledReason?: string;
  hideSubmit?: boolean;
  onInvalidCapture?: React.FormEventHandler<HTMLFormElement>;
  className?: string;
  onSuccess?: () => void;
  preserveValues?: boolean;
}) {
  const reasonId = useId();
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
        message: "Chưa nhận được kết quả. Kiểm tra trạng thái rồi thử lại.",
      };
    }
  }
  const [state, submit, pending] = useActionState(submitIntent, {
    message: "",
  });
  const router = useRouter();
  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onSuccess?.();
    }
  }, [state, router, onSuccess]);
  return (
    <form
      action={submit}
      // A handled action error also triggers React's reset; creation forms must retain retry inputs.
      onReset={preserveValues ? (event) => event.preventDefault() : undefined}
      onInvalidCapture={onInvalidCapture}
      className={className}
    >
      {children}
      {!hideSubmit && (
        <Button
          disabled={pending || disabled}
          aria-describedby={disabled && disabledReason ? reasonId : undefined}
          className="rounded-lg form-submit"
        >
          {pending ? "Đang xử lý…" : label}
        </Button>
      )}
      {!hideSubmit && disabled && disabledReason && (
        <p id={reasonId} className="field-hint">
          {disabledReason}
        </p>
      )}
      {state.message && (
        <p role={state.ok ? "status" : "alert"}>{state.message}</p>
      )}
      {state.link && (
        <p>
          <a href={state.link} style={{ overflowWrap: "anywhere" }}>
            {state.link}
          </a>
        </p>
      )}
    </form>
  );
}
