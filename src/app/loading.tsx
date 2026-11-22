import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Đang tải nội dung">
      <p role="status">Đang tải…</p>
      <Skeleton
        className="my-5"
        style={{ width: "45%", height: 30 }}
        aria-hidden="true"
      />
      <section className="panel" aria-hidden="true">
        <Skeleton className="my-5 h-5" />
        <Skeleton className="my-5 h-5 w-[72%]" />
        <Skeleton className="my-5 h-5 w-[85%]" />
      </section>
    </main>
  );
}
