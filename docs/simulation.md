# Giả lập nhóm trên local

Chạy `npm run simulate`. Một bản dev riêng mở tại http://127.0.0.1:3225 cùng ba cửa sổ Chromium đã có phiên tài khoản giả: admin nhóm, thành viên, người chưa vào nhóm. Không cần Google hoặc email. Các cửa sổ có cookie tách biệt; mở địa chỉ bằng Chrome cá nhân sẽ vẫn cần đăng nhập.

Cần Docker Desktop và Supabase local đang chạy, đã áp dụng migration hiện có. Nếu stack đã thiết lập nhưng dừng, chạy `node .tools/supabase/node_modules/supabase/dist/supabase.js start`. Chromium dùng thư mục `.tools/browsers` khi có; có thể cài bằng `npx playwright install chromium`. Dùng Node 24 trong PATH.

Mỗi lần chạy tạo nhóm mới mang nhãn GIẢ LẬP với ngân hàng giả, không xóa hoặc reset dữ liệu cũ. Admin và thành viên có thể tự tạo buổi, điều chỉnh, báo chuyển, xác nhận, mời người và thăm dò theo quyền trong app. Người chưa có nhóm vẫn bị chặn ở trang chờ. Ctrl+C đóng các trình duyệt và server giả lập, giữ dữ liệu local để kiểm tra.

`npm run simulate:check` chạy không hiện cửa sổ, tự tạo buổi 100.000đ cho hai người, kiểm tra chia 50.000đ, báo chuyển, xác nhận và chặn người ngoài nhóm. Kết quả được đối chiếu với database. Log server nằm trong `.tools/simulation/server.log`; không chia sẻ log hoặc phiên trình duyệt này công khai.

Đây là runner kiểm thử bên ngoài app, dùng tài khoản Auth local với JWT thật để đi qua cùng Server Actions, RPC và RLS. Không có route bỏ qua đăng nhập trên production. Runner kiểm tra cả API và database là loopback trước khi tạo tài khoản/dữ liệu, dùng cấu hình local riêng và tắt AI. Không mô phỏng Google consent, email SMTP, chuyển tiền ngân hàng, chất lượng LLM hoặc push trên thiết bị thật.
