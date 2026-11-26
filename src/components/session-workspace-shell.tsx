"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

const Workspace = createContext<{
  day: string | undefined;
  setDay: Dispatch<SetStateAction<string | undefined>>;
  remember: (element: HTMLElement) => void;
} | null>(null);
export const useSessionWorkspace = () => useContext(Workspace);

export function SessionWorkspaceLink({
  href,
  create = false,
  className,
  children,
}: {
  href?: string;
  create?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const workspace = useSessionWorkspace();
  const selectedDay = workspace?.day;
  const target = create
    ? "/sessions/new" + (selectedDay ? "?date=" + selectedDay : "")
    : href!;
  return (
    <Link
      href={target}
      scroll={false}
      className={className}
      onClick={(e) => {
        if (
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          !e.altKey &&
          e.button === 0
        )
          workspace?.remember(e.currentTarget);
      }}
    >
      {children}
    </Link>
  );
}

export default function SessionWorkspaceShell({
  calendar,
  children,
}: {
  calendar: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const titleId = useId();
  const [day, setDay] = useState<string>();
  const [motion, setMotion] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closing = useRef(false);
  const opened = pathname !== "/sessions";
  useEffect(() => {
    clearTimeout(timer.current);
    closing.current = false;
    let frame: number;
    if (opened) {
      if (!dialog.current?.open) dialog.current?.showModal();
      frame = requestAnimationFrame(() => {
        setMotion("is-open");
        if (body.current) body.current.scrollTop = 0;
        closeButton.current?.focus({ preventScroll: true });
      });
    } else {
      dialog.current?.close();
      opener.current?.focus({ preventScroll: true });
      frame = requestAnimationFrame(() => setMotion(""));
    }
    return () => cancelAnimationFrame(frame);
  }, [opened, pathname]);
  useEffect(() => () => clearTimeout(timer.current), []);
  function close() {
    if (closing.current) return;
    closing.current = true;
    setMotion("is-closing");
    const ms = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--modal-close-dur",
          ),
        ) || 150;
    timer.current = setTimeout(() => {
      dialog.current?.close();
      if (opener.current) router.back();
      else router.replace("/sessions", { scroll: false });
    }, ms);
  }
  return (
    <Workspace.Provider
      value={{
        day,
        setDay,
        remember: (element) => {
          opener.current = element;
        },
      }}
    >
      <div
        className="session-calendar-surface"
        inert={opened}
        aria-hidden={opened || undefined}
      >
        {calendar}
      </div>
      <dialog
        ref={dialog}
        className="session-workspace-dialog"
        aria-labelledby={titleId}
        onCancel={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          close();
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className={"t-modal session-workspace-frame " + motion}>
          <span id={titleId} className="sr-only">
            {pathname === "/sessions/new"
              ? "Tạo buổi chơi"
              : "Chi tiết buổi chơi"}
          </span>
          <button
            ref={closeButton}
            type="button"
            className="secondary session-workspace-close"
            aria-label="Đóng buổi chơi"
            onClick={close}
          >
            <X size={19} aria-hidden="true" />
          </button>
          <div ref={body} className="session-workspace-body">
            {children}
          </div>
        </div>
      </dialog>
    </Workspace.Provider>
  );
}
