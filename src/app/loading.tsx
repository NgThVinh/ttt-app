export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Đang tải nội dung">
      <p role="status">Đang tải…</p>
      <div
        className="loading-line"
        style={{ width: "45%", height: 30 }}
        aria-hidden="true"
      />
      <section className="panel" aria-hidden="true">
        <div className="loading-line" />
        <div className="loading-line" style={{ width: "72%" }} />
        <div className="loading-line" style={{ width: "85%" }} />
      </section>
    </main>
  );
}
