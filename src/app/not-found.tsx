import Link from "next/link";

export default function NotFound() {
  return (
    <main>
      <section className="panel not-found-panel">
        <h1>Không tìm thấy trang</h1>
        <p>Trang này không còn tồn tại hoặc bạn chưa có quyền xem.</p>
        <Link className="primary" href="/">
          Về trang chủ
        </Link>
      </section>
    </main>
  );
}
