"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, X } from "lucide-react";
import { Input } from "./ui/input";
import {
  banks,
  bankForBin,
  bankLabel,
  bankName,
  searchBanks,
  type Bank,
} from "@/lib/banks";

export default function BankPicker({
  defaultValue = "",
  required = false,
  id: suppliedId,
}: {
  defaultValue?: string;
  required?: boolean;
  id?: string;
}) {
  const generated = useId();
  const id = suppliedId || `${generated}-bank`,
    listId = `${id}-list`;
  const [bin, setBin] = useState(defaultValue);
  const [query, setQuery] = useState(bankLabel(defaultValue));
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const lastSelection = useRef(defaultValue);
  const openRef = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const unknown: Bank[] =
    defaultValue && !bankForBin(defaultValue)
      ? [
          {
            bin: defaultValue,
            code: "",
            shortName: bankLabel(defaultValue),
            name: "Thông tin đã lưu trước đây",
          },
        ]
      : [];
  const options = searchBanks(bin ? "" : query, [...unknown, ...banks]);

  const position = useCallback(() => {
    if (!input.current || !menu.current) return;
    const r = input.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const workspace = document
      .getElementById("main-content")
      ?.getBoundingClientRect();
    const bottom = Math.min(
      (viewport?.height || innerHeight) + (viewport?.offsetTop || 0),
      workspace?.bottom ?? innerHeight,
    );
    const topEdge = Math.max(viewport?.offsetTop || 0, workspace?.top ?? 0);
    const below = bottom - r.bottom - 12,
      above = r.top - topEdge - 12;
    const upward = below < 180 && above > below;
    const height = Math.max(1, Math.min(320, upward ? above : below));
    const width = Math.min(r.width, innerWidth - 24);
    menu.current.style.width = `${width}px`;
    menu.current.style.left = `${Math.max(12, Math.min(r.left, innerWidth - width - 12))}px`;
    menu.current.style.maxHeight = `${height}px`;
    menu.current.dataset.origin = upward ? "bottom-left" : "top-left";
    menu.current.style.top = `${upward ? Math.max(topEdge + 8, r.top - Math.min(menu.current.scrollHeight, height) - 6) : r.bottom + 6}px`;
  }, []);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      menu.current = node;
      if (!node) return;
      position();
      requestAnimationFrame(() => {
        if (openRef.current) node.classList.add("is-open");
      });
    },
    [position],
  );
  function show() {
    clearTimeout(closeTimer.current);
    openRef.current = true;
    setClosing(false);
    setOpen(true);
    requestAnimationFrame(() => {
      if (openRef.current && menu.current) {
        menu.current.classList.remove("is-closing");
        menu.current.classList.add("is-open");
        position();
      }
    });
  }
  const close = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    if (!menu.current) return;
    menu.current.classList.remove("is-open");
    setClosing(true);
    const cs = getComputedStyle(menu.current);
    const duration = cs.getPropertyValue("--dropdown-close-dur").trim();
    const milliseconds =
      cs.transitionDuration === "0s"
        ? 0
        : parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(
      () => setClosing(false),
      Number.isFinite(milliseconds) ? milliseconds : 0,
    );
  }, []);
  function choose(bank: Bank) {
    setBin(bank.bin);
    setQuery(bankName(bank));
    lastSelection.current = bank.bin;
    input.current?.setCustomValidity("");
    setInvalid(false);
    close();
  }
  useLayoutEffect(() => {
    if (open) position();
  }, [open, options.length, position]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !input.current?.parentElement?.contains(event.target as Node) &&
        !menu.current?.contains(event.target as Node)
      )
        close();
    };
    const scroll = (event: Event) => {
      if (!menu.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
    };
  }, [open, close, position]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  function move(index: number) {
    setActive(index);
    requestAnimationFrame(() =>
      document
        .getElementById(`${listId}-${index}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  return (
    <div className="bank-field">
      <label htmlFor={id}>Ngân hàng</label>
      <div className="bank-picker">
        <Input
          id={id}
          ref={input}
          role="combobox"
          value={query}
          autoComplete="off"
          required={required}
          placeholder="Tìm tên ngân hàng, ví dụ: Vietcombank, MB…"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={
            open && options[active] ? `${listId}-${active}` : undefined
          }
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onFocus={(event) => {
            show();
            setActive(
              Math.max(
                0,
                options.findIndex((b) => b.bin === bin),
              ),
            );
            if (window.matchMedia("(pointer: fine)").matches)
              event.currentTarget.select();
          }}
          onClick={() => {
            if (!openRef.current)
              setActive(
                Math.max(
                  0,
                  options.findIndex((b) => b.bin === bin),
                ),
              );
            show();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setBin("");
            setActive(0);
            setInvalid(false);
            event.currentTarget.setCustomValidity(
              event.target.value.trim()
                ? "Chọn một ngân hàng trong danh sách gợi ý."
                : "",
            );
            show();
          }}
          onInvalid={() => setInvalid(true)}
          onBlur={(event) => {
            if (!menu.current?.contains(event.relatedTarget)) close();
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) {
                show();
                move(
                  Math.max(
                    0,
                    options.findIndex((b) => b.bin === bin),
                  ),
                );
              } else if (options.length)
                move(
                  (active +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    options.length) %
                    options.length,
                );
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              if (options[active]) choose(options[active]);
            } else if (event.key === "Escape" && open) {
              event.preventDefault();
              event.stopPropagation();
              setBin(lastSelection.current);
              setQuery(bankLabel(lastSelection.current));
              input.current?.setCustomValidity("");
              setInvalid(false);
              close();
            } else if (event.key === "Tab") close();
          }}
        />
        {query && (
          <button
            className="bank-clear"
            type="button"
            aria-label="Bỏ chọn ngân hàng"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setBin("");
              setQuery("");
              lastSelection.current = "";
              setActive(0);
              setInvalid(false);
              input.current?.setCustomValidity("");
              input.current?.focus();
              setActive(0);
              show();
            }}
          >
            <X size={16} aria-hidden />
          </button>
        )}
        <ChevronDown className="bank-chevron" size={17} aria-hidden />
        <input type="hidden" name="bank_bin" value={bin} />
      </div>
      {invalid && (
        <p id={`${id}-error`} className="field-error" role="alert">
          Chọn một ngân hàng trong danh sách gợi ý.
        </p>
      )}
      {(open || closing) &&
        createPortal(
          <div
            ref={attach}
            className={`t-dropdown bank-menu${closing ? " is-closing" : ""}`}
            aria-hidden={!open}
            inert={!open}
          >
            <div
              role="listbox"
              id={listId}
              aria-label="Danh sách ngân hàng"
              className="bank-options"
              data-scroll="banks"
            >
              {options.map((bank, index) => (
                <div
                  key={bank.bin}
                  role="option"
                  aria-label={bankName(bank)}
                  aria-describedby={`${listId}-${index}-name`}
                  id={`${listId}-${index}`}
                  aria-selected={bank.bin === bin}
                  className={`bank-option${index === active ? " is-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(bank)}
                  onPointerMove={() => setActive(index)}
                >
                  <span className="bank-monogram" aria-hidden>
                    {bank.code.slice(0, 3) || "NH"}
                  </span>
                  <span className="bank-option-name">
                    <strong>{bankName(bank)}</strong>
                    <small id={`${listId}-${index}-name`}>{bank.name}</small>
                  </span>
                  {bank.bin === bin && <Check size={17} aria-hidden />}
                </div>
              ))}
              {!options.length && (
                <p className="bank-empty" role="status">
                  Không tìm thấy ngân hàng. Thử tên viết tắt hoặc tên không dấu.
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
