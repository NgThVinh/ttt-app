# Sandbox độc lập

Chạy `npm run simulate`, rồi mở **http://127.0.0.1:3226** trong trình duyệt bất kỳ. Cần Node 24 và dependencies đã cài (`npm ci` khi thiết lập lần đầu). Không cần `.env`, Supabase, Docker, tài khoản Google hoặc đăng nhập. Không cần cài Chromium để dùng bằng tay.

Dùng ô **Đóng vai** để chuyển giữa An (admin/người tính tiền), Bình, Chi và người chưa vào nhóm. Tạo buổi, nhập tiền và hệ số, chọn người tham gia, xem bảng chia rồi lưu. Chuyển sang người trả để báo chuyển, quay lại người nhận để xác nhận. Sau thu có thể điều chỉnh tiền/người tham gia để kiểm tra khoản hoàn; lịch sử đã xác nhận được giữ lại. Người chưa có nhóm thấy trang chờ mời.

Dữ liệu nằm trong RAM của server riêng, dùng chung giữa các tab đang mở; reload trang vẫn còn. Dừng bằng Ctrl+C và chạy lại để bắt đầu sạch. Không ghi database, không đọc khóa API và không gọi LLM hay dịch vụ ngoài. Đây là màn thử nghiệp vụ riêng, không phải bản sao toàn bộ giao diện production. Server chỉ lắng nghe loopback.

`npm run simulate:check` tự chạy Chromium headless: tạo buổi 100.000đ cho hai người → chia 50.000đ → báo chuyển → nhận tiền → giảm tổng còn 50.000đ → kiểm tra hoàn 25.000đ và giữ khoản đã xác nhận → chuyển vai người ngoài nhóm. Cần Chromium Playwright; runner tự dùng `.tools/browsers` nếu có, hoặc cài bằng `npx playwright install chromium`.

Sandbox dùng trực tiếp hàm TypeScript `allocate`, `splitExpense`, `balances`, `reconcile` và schema nhập số của app, biên dịch trong bộ nhớ. Mô hình trạng thái riêng có revision và chống lặp mã yêu cầu để thử thao tác cũ/gửi trùng. Quyền được đơn giản hóa: chỉ admin tạo buổi, chỉ người tính tiền điều chỉnh; người tính tiền phải cùng tham gia. Nó không chứng minh toàn bộ policy production, SQL transaction, RLS, khóa đồng thời hoặc persistence. Chưa mô phỏng lịch/RSVP/thăm dò, link mời, ảnh biên lai, đổi người tính tiền, AI hoặc push. Các thao tác chuyển/nhận ở đây chỉ đổi dữ liệu giả.

## Kiểm thử với backend local

Bản trước giữ ở `npm run simulate:backend` (http://127.0.0.1:3225): cần Docker + Supabase local và Chromium, mở ba cửa sổ với phiên Auth local tách biệt. Dữ liệu lưu database local; kiểm quyền qua Server Actions/RPC/RLS thật. Không dùng Google/email. Đây là luồng tích hợp bổ sung. Không có route bỏ qua đăng nhập trong app production.
