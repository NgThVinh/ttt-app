# Đặt lịch trong trang Buổi chơi

Trang `/sessions` giữ lịch và danh sách làm nền chung. Tạo buổi và chi tiết mở trong modal; đường dẫn vẫn đổi để chia sẻ, tải lại hoặc dùng Back/Forward. Link trực tiếp cũng mở cùng modal trên nền lịch.

## Cách sử dụng

- **Tạo buổi chơi** mở form. Nếu đang lọc một ngày trên lịch, form điền sẵn ngày đó.
- Chọn ngày để xem các buổi/thăm dò của ngày đó. Cuối danh sách có hàng **＋ Tạo buổi ngày…**, kể cả ngày trống.
- Mở tên buổi để xem chi tiết. Đóng bằng X, Escape hoặc vùng nền; giữ ngày, chế độ xem và vị trí danh sách khi mở từ lịch.
- Lưu thành công chuyển form sang chi tiết trong cùng modal. Đóng trở về lịch đã cập nhật, không trở lại form đã gửi.
- Chế độ Danh sách dùng ngày mặc định khi tạo; ngày lọc trước đó chỉ dùng lại khi trở về Lịch. Ngày quá khứ mở luồng Nhập buổi đã chơi.
- Modal khóa nền và hỗ trợ bàn phím/reduced motion. Khi mở lịch sử, nhập phí hoặc thanh toán bên trong, Escape đóng cửa sổ con trước. Chỉ nội dung dài cuộn trong modal.

Chuyển động dùng lại recipe modal từ skill `transitions-dev` trong `motion.css`; không thêm thư viện.

## Lịch lặp hàng tuần

Form đặt lịch có **Lặp lại → Hàng tuần**, lặp thêm 1–12 tuần, mặc định 4. Giữ thứ, giờ bắt đầu/kết thúc, địa điểm, ghi chú và danh sách mời. Tên tự gợi ý cho lịch lặp không gắn ngày buổi đầu.

Hệ thống sinh trước các buổi trong 28 ngày tới, sau đó cron sinh phần còn lại. Buổi mới chưa có người tính tiền hoặc hóa đơn; mỗi người tự nhận lời, từng buổi tự chốt phí. Thành viên đã rời nhóm không được mời vào buổi mới.

Chi tiết hiển thị trạng thái và hạn kết thúc lịch lặp. Người tạo/admin có thể **Dừng tạo buổi lặp mới** khi còn hoạt động; các buổi đã tạo giữ nguyên. Khi đã sinh đủ, hiện **Đã tạo đủ buổi**. Buổi không thuộc lịch lặp không có form bật lặp ở chi tiết nữa.

## Database và gửi lại sau lỗi mạng

Migration `202611250044_calendar_workspace.sql` đã áp dụng **Supabase local**, chưa hosted:

- Bổ sung duration, note và invited_member_ids cho weekly_series; backfill mẫu hiện có, không sửa/xóa buổi và tiền đã lưu.
- `schedule_calendar_meeting` lưu buổi, nguồn thăm dò nếu có, lịch lặp, lời mời, thông báo, audit và receipt trong cùng transaction. Dùng lại các RPC kiểm quyền hiện có, bằng JWT người dùng.
- Khóa/fingerprint bao gồm nội dung, số tuần và nguồn. Gửi lại cùng nội dung trả cùng buổi; đổi nội dung với cùng key bị từ chối. Lỗi bật lặp rollback cả buổi và việc đóng thăm dò.
- RPC riêng khiến deployment thiếu migration báo chưa cập nhật, thay vì bỏ qua lựa chọn lặp.
- Form tạo giữ giá trị khi action lỗi, gồm select và checkbox. Tránh reset form làm đổi nhóm/lặp khi phản hồi bị thất lạc; nội dung không đổi giữ cùng idempotency key.

Đối chiếu trước/sau migration local: số dòng và hash của sessions, session_attendees, expenses, settlements giữ nguyên. Chưa áp dụng hosted hoặc deploy production.

## Kiểm chứng

- `test:calendar-workspace`: tạo theo ngày, giữ vị trí/focus, Back/Forward, link trực tiếp/reload, lịch lặp, mất phản hồi sau commit rồi retry không trùng, dừng lặp giữ buổi cũ, Escape cửa sổ con, 320/390/768/1440px và reduced motion. Ảnh ở `.tools/calendar-workspace/`.
- Database kiểm tra giữ giờ/lời mời, không tự RSVP, retry/fingerprint, cách ly nhóm, validation và rollback cả thăm dò khi bật lặp lỗi.
- Bộ meeting, poll, session-workspace, payment, calendar-ux và session-focus kiểm tra luồng hiện có trong modal, gồm phụ phí, chốt tiền, phân trang lịch sử, ảnh riêng tư, hoàn tiền và cuộn đúng vùng.
- 248 test qua, 1 test provider thật bỏ qua; typecheck, lint và production build qua. Không gọi LLM.
- Đã mở form từ ngày chọn và chi tiết buổi hiện có trên localhost:3000. Kiểm tra đọc không đổi ID/tên/revision/giờ của các buổi trong nhóm mẫu; app local được để chạy để tiếp tục dùng thử.

Đã kiểm tra Chromium local; chưa nghiệm thu thiết bị vật lý. Nhóm đông hoặc nhiều phụ phí vẫn cần cuộn trong modal. Fixture được dọn có backup bằng `local:clean`, giữ nhóm mẫu và dữ liệu nhập tay.
