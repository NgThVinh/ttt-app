# Supabase riêng cho localhost

Mở Docker Desktop, rồi chạy `npm run dev:local`. Lệnh này kiểm tra Supabase Docker của workspace, áp dụng migration **chỉ trên local**, tạo dữ liệu thử khi chưa có và mở app tại **http://localhost:3000**. Không reset database.

Cấu hình được ghi vào `.env.development.local`, đã nằm ngoài Git. `next dev` ưu tiên file này; `next build`/`next start` và Vercel không đọc file dành cho development. `.env` và cấu hình hosted hiện có giữ nguyên. Supabase API local ở **http://127.0.0.1:54321**; PostgreSQL ở port 54322. `npm run local:setup` chỉ chuẩn bị backend/env mà không khởi động Next.

Tại `/login`, chọn **An · Admin nhóm**, **Bình · Thành viên** hoặc **Chi · Thành viên**. Nhóm **Nhóm chơi thử · Local** và một buổi chưa chốt được tạo sẵn; mỗi người tự nhận lời tham gia. Chọn **Khách · Chưa có nhóm** để kiểm tra trang chờ link mời. Tài khoản dùng Supabase Auth thật và JWT/RLS thật, chỉ khác nguồn dữ liệu. Thông tin ngân hàng có nhãn thử và số tài khoản giả.

Chọn **Local · Đổi vai** trên thanh đầu trang để đổi tài khoản thử. Tạo buổi ở `/sessions/new`, mở `/sessions` để xem lịch, tải lại trang để kiểm tra dữ liệu đã lưu. Có thể nhập email và xem magic link ở hộp thư **http://127.0.0.1:54324**; Google OAuth không được cấu hình trên stack local này. AI và push tắt trong cấu hình dev.

Đăng nhập nhanh cần đồng thời môi trường `development`, cờ local, endpoint API/app loopback và Host/Origin local đúng port. Production luôn từ chối hành động này. Mật khẩu chỉ ở server trong file env bị bỏ qua, không được gửi trong form hay bundle client. Script tạo dữ liệu xác minh cả API lẫn database là loopback trước mọi mutation.

`npm run test:local-dev` chạy trên app đang mở tại port 3000: đăng nhập An, tạo lịch và kiểm tra hiển thị sau reload, chuyển Bình để tự RSVP, rồi kiểm tra Khách bị chặn ngoài nhóm. Runner chỉ thao tác trên database local, để lại các buổi có tên **Lịch kiểm tra local** cho việc xem lại. Cần Playwright Chromium, tự dùng `.tools/browsers` nếu có.

Database Docker giữ dữ liệu qua các lần khởi động app/Docker. Chạy lại setup giữ các buổi đã tạo; không dùng `supabase db reset` nếu muốn giữ dữ liệu thử. Muốn quay lại cấu hình hosted cho dev thì dừng Next, bỏ/đổi tên `.env.development.local`, rồi khởi động lại `npm run dev`; việc này không tự áp dụng migration hosted.
