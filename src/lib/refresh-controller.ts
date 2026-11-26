// Per-view scheduling only. Authentication and row permissions remain server-side.
const EVENT_DELAY = 750;
const EVENT_GAP = 5_000;
const RESUME_GAP = 30_000;
const FALLBACK_GAP = 120_000;

export function createRefreshController(refresh: () => void) {
  let enabled = true;
  let healthy = false;
  let disposed = false;
  let last = Date.now();
  let due = Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;

  function schedule(delay: number, gap: number) {
    if (!enabled || disposed) return;
    const next = Math.max(Date.now() + delay, last + gap);
    if (next >= due) return;
    clearTimeout(timer);
    due = next;
    timer = setTimeout(
      () => {
        due = Infinity;
        if (!enabled || disposed) return;
        last = Date.now();
        refresh();
      },
      Math.max(0, next - Date.now()),
    );
  }
  function armFallback() {
    clearTimeout(fallback);
    if (!enabled || healthy || disposed) return;
    fallback = setTimeout(() => {
      schedule(0, EVENT_GAP);
      armFallback();
    }, FALLBACK_GAP);
  }
  armFallback();
  return {
    event: () => schedule(EVENT_DELAY, EVENT_GAP),
    resume: () => schedule(EVENT_DELAY, RESUME_GAP),
    connection(connected: boolean) {
      if (healthy === connected) return;
      healthy = connected;
      armFallback();
    },
    active(value: boolean) {
      if (enabled === value || disposed) return;
      enabled = value;
      clearTimeout(timer);
      due = Infinity;
      if (enabled) schedule(EVENT_DELAY, RESUME_GAP);
      armFallback();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(fallback);
    },
  };
}
