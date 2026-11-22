"use client";
import Link from "next/link";
export default function ErrorPage({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main>
      <section className="panel" role="alert">
        <h1>Chưa tải được nội dung</h1>
        <p>
          Kiểm tra kết nối rồi thử lại. Nếu vừa gửi một thao tác, hãy kiểm tra
          trạng thái trong app trước khi gửi lại.
        </p>
        <div className="actions">
          <button type="button" className="primary" onClick={retry}>
            Thử lại
          </button>
          <Link href="/" className="secondary">
            Về trang chủ
          </Link>
        </div>
      </section>
    </main>
  );
}
