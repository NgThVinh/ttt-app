# Supabase riêng cho localhost

Mở Docker Desktop, rồi chạy `npm run dev:local`. Lệnh này kiểm tra Supabase Docker của workspace, áp dụng migration **chỉ trên local**, tạo dữ liệu thử khi chưa có và mở app tại **http://localhost:3000**. Không reset database.

Cấu hình được ghi vào `.env.development.local`, đã nằm ngoài Git. `next dev` ưu tiên file này; `next build`/`next start` và Vercel không đọc file dành cho development. `.env` và cấu hình hosted hiện có giữ nguyên. Supabase API local ở **http://127.0.0.1:54321**; PostgreSQL ở port 54322. `npm run local:setup` chỉ chuẩn bị backend/env mà không khởi động Next.

Tại `/login`, chọn **An · Admin nhóm**, **Bình · Thành viên** hoặc **Chi · Thành viên**. Nhóm **Nhóm chơi thử · Local** và một buổi chưa chốt được tạo sẵn; mỗi người tự nhận lời tham gia. Chọn **Khách · Vai thử** để thử vai người mới. Ban đầu vai này chưa có nhóm; nếu đã nhận lời mời thì quyền đi theo membership hiện tại. Đây là email giả local, không phải tên khách được thêm hộ; để dùng email riêng hãy đăng ký tài khoản mới. Tài khoản dùng Supabase Auth thật và JWT/RLS thật, chỉ khác nguồn dữ liệu. Thông tin ngân hàng có nhãn thử và số tài khoản giả.

Chọn **Local · Đổi vai** trên thanh đầu trang để đổi tài khoản thử. Tạo buổi ở `/sessions/new`, mở `/sessions` để xem lịch, tải lại trang để kiểm tra dữ liệu đã lưu. Có thể nhập email và xem magic link ở hộp thư **http://127.0.0.1:54324**; Google OAuth không được cấu hình trên stack local này. AI và push tắt trong cấu hình dev.

Đăng nhập nhanh cần đồng thời môi trường `development`, cờ local, endpoint API/app loopback và Host/Origin local đúng port. Production luôn từ chối hành động này. Mật khẩu chỉ ở server trong file env bị bỏ qua, không được gửi trong form hay bundle client. Script tạo dữ liệu xác minh cả API lẫn database là loopback trước mọi mutation.

`npm run test:local-dev` chạy trên app đang mở tại port 3000: đăng nhập An, tạo lịch và kiểm tra hiển thị sau reload, chuyển Bình để tự RSVP, rồi kiểm tra Khách bị chặn ngoài nhóm. Runner chỉ thao tác trên database local và tự dọn đúng buổi **Lịch kiểm tra local** vừa tạo khi kết thúc. Đặt `THREE_T_KEEP_TEST_DATA=1` nếu muốn giữ lại để xem lỗi. Cần Playwright Chromium, tự dùng `.tools/browsers` nếu có.

## Dọn dữ liệu kiểm thử

Chạy `npm run local:clean` để xem số bản ghi sẽ dọn; `npm run local:clean -- --apply` để thực hiện. Lệnh chỉ nhận cấu hình development trùng với Supabase CLI local, kiểm tra cả API và PostgreSQL là loopback. Nhóm fixture phải khớp cả tên lẫn tài khoản tự động đã biết; lịch kiểm tra trong nhóm An chỉ được chọn khi khớp định dạng của runner, còn planned và chưa có chi phí/thanh toán. Nhóm mẫu và các buổi nhập tay được giữ lại.

Trước khi xóa, script sao lưu toàn bộ bản ghi được chọn tại `.tools/local-cleanup/<thời điểm>/rows.json`, nằm ngoài Git. Các bản ghi phụ thuộc được dọn trong cùng transaction, kiểm tra ranh giới nhóm và đối chiếu buổi được giữ trước/sau. FK luôn bật; các trigger chặn xóa lịch sử/tiền đã xác nhận chỉ được tạm ngưng cho thao tác bảo trì fixture local và được bật lại trước commit. Khi lỗi, transaction rollback cả dữ liệu và trạng thái trigger. Script không phải Server Action và không được dùng trên hosted.

Phạm vi dọn là dữ liệu nghiệp vụ của fixture; tài khoản Auth và file Storage giữ nguyên. Việc dọn không reset database, không thay mật khẩu các tài khoản local, không cập nhật `.env` hoặc migration.

Database Docker giữ dữ liệu qua các lần khởi động app/Docker. Chạy lại setup giữ các buổi đã tạo; không dùng `supabase db reset` nếu muốn giữ dữ liệu thử. Muốn quay lại cấu hình hosted cho dev thì dừng Next, bỏ/đổi tên `.env.development.local`, rồi khởi động lại `npm run dev`; việc này không tự áp dụng migration hosted.
