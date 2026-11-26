# Băng thông Supabase Free

Cập nhật 27/11/2026. Đã phát hành trên thichtinhtien.online; migration 048 và các migration trước đó đã áp dụng production.

## Các giới hạn trong ứng dụng

- Trang chủ chỉ đọc ba buổi sắp tới và RSVP của chính người xem. `my_debt_summary` tính tổng tiền và số khoản trong PostgreSQL; không tải lịch sử thanh toán để cộng ở Next.js. Giữ tiền dưới dạng chuỗi số nguyên.
- Link nội bộ không tự prefetch trang riêng tư. Chỉ thực hiện truy vấn trang khi người dùng mở link; điều hướng vẫn dùng App Router và modal lịch.
- Một kênh Realtime dùng chung trong mỗi tab. Tab ẩn hoặc offline gỡ kênh và dừng lịch làm mới; trở lại sẽ đọc bù. Không làm mới định kỳ khi kết nối khỏe. Khi Realtime lỗi, kiểm tra dự phòng mỗi 120 giây. Gộp sự kiện trong 750 ms, tối đa một lần làm mới mỗi 5 giây; gộp focus trong 30 giây.
- Migration 048 đưa sessions, session_attendees và settlements vào publication hiện có, không đổi RLS/quyền đọc. Thông báo mới giúp cập nhật cả trường hợp xóa mềm: hàng buổi đã xóa không còn được SELECT RLS cho phép. Đánh dấu thông báo đã đọc không tải lại lịch/trang chủ.
- Chuông đóng chỉ lấy số chưa đọc bằng HEAD/count. Tải sáu mục khi mở; dùng lại dữ liệu trong 60 giây, vô hiệu hóa khi có thay đổi. Không tạo lại chuông hay tải quyền menu mỗi lần đổi trang. Thông tin quyền menu kiểm tra lại khi quay lại app, cách ít nhất 60 giây; quyền thao tác vẫn do server/database kiểm tra mỗi yêu cầu.
- Cache danh tính/client Supabase bằng React `cache` chỉ trong một lượt server render. Dữ liệu cá nhân không dùng cache chung, localStorage hay service worker. API thông báo vẫn `private, no-store`.
- Ảnh biên lai tiếp tục nén ở client (cạnh dài tối đa 1.600 px, JPEG 0,8, tối đa 2 MiB). Chỉ tải ảnh khi người dùng mở liên kết ký 60 giây; không tự tải ảnh trong danh sách. File thanh toán được dọn sau 30 ngày kể từ xác nhận.
- Test dữ liệu và browser dùng Supabase local; không gọi AI hay tạo dữ liệu test ở hosted.

## Số đo và kiểm thử

`npm run test:overview-ui` tạo nhóm/danh tính riêng ở local và ghi `.tools/overview-ui/bandwidth.json`. Fixture có 36 buổi lịch sử và ba buổi tương lai:

| Kiểm tra | Kết quả |
| --- | --- |
| JSON lịch cho trang chủ trước/sau | 16.274 / khoảng 1.184 byte, giảm khoảng 93% |
| Để trang yên 35 giây, Realtime khỏe | 0 request làm mới RSC/API thông báo/menu |
| Cập nhật tên buổi từ database | Giao diện cập nhật qua một lượt RSC |
| Mở lại chuông trong 60 giây | Không tải lại danh sách |
| Kênh đang hoạt động | Một kênh dùng chung |

Đây là kích thước JSON của fixture, không phải tổng egress thực của Supabase (còn Auth, header, WebSocket và Storage). Unit test kiểm tra một giờ idle, tab ẩn/offline, reconnect, bão sự kiện, cleanup và fallback lỗi liên tục. Database test đối chiếu tổng tiền lớn hơn giới hạn số nguyên an toàn của JavaScript, hơn 1.000 khoản lịch sử, người bị gỡ và quyền anonymous.

## Theo dõi trên Free

Supabase hiện tách hạn mức Free thành **5 GB uncached và 5 GB cached mỗi chu kỳ**; chúng độc lập, không coi là 10 GB tùy ý cho database. Egress gồm Database, Auth, Storage, Realtime và các dịch vụ khác. Xem [hướng dẫn egress chính thức](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

Sau khi phát hành, kiểm tra Dashboard → Organization Usage → Egress theo từng dịch vụ. Mốc vận hành đề xuất: rà lại khi đạt 50%, hạn chế các lượt tải ảnh lặp lại và điều tra request khi đạt 80%; đây là mốc theo dõi, chưa phải cảnh báo tự động hay hard cap trong ứng dụng. Không gọi Management API liên tục chỉ để kiểm tra quota. Cron SQL nội bộ tiếp tục chạy theo lịch; không tăng heartbeat HTTP hoặc polling để giữ project hoạt động.

Chưa thể cam kết không vượt quota với mọi mức sử dụng. Lịch đầy đủ vẫn tăng theo số buổi/nhóm, và ảnh là phần cần theo dõi riêng. Nếu lịch sử lớn, bước tiếp theo là phân trang theo tháng và chỉ tải danh sách tên khi xem; không âm thầm cắt lịch sử khiến người dùng tưởng mất buổi.
