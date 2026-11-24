# Thăm dò lịch chơi và tạo buổi thủ công

Thăm dò dùng để hỏi lúc rảnh. Không có điều kiện số người tối thiểu ở giao diện; không tự tạo buổi khi hết hạn hay khi có đủ phiếu.

## Luồng người dùng

1. **Hẹn lịch** mở danh sách thăm dò đang nhận phiếu. Thăm dò đã đóng/hết hạn/đã tạo buổi nằm trong **Đã kết thúc**.
2. **Tạo thăm dò** ở trang riêng. Chọn nhóm, tên gợi ý và các khung giờ. Địa điểm/hạn trả lời nằm trong tùy chọn; mặc định hạn là trước khung đầu tiên.
3. Mỗi khung có ba nút **Đi được / Có thể / Không đi**, số phiếu và thanh kết quả. Mở **Ai đã chọn?** để xem tên. Phiếu cập nhật realtime và mỗi người chỉ thay phiếu của mình.
4. Mọi thành viên hoạt động trong nhóm có thể chọn **Tạo buổi với khung giờ này**. Thao tác chỉ GET form tạo buổi, chưa lưu dữ liệu.
5. Form điền sẵn nhóm, tên, địa điểm, giờ bắt đầu/kết thúc và danh sách mời từ người chọn Đi được. Người tạo kiểm tra, sửa giờ/địa điểm/tên/người mời và bấm **Tạo lịch**.
6. Lưu thành công tạo một buổi planned, chưa chốt tham gia hộ, đồng thời đóng thăm dò và gắn link **Xem buổi chơi**. Hai form gửi đồng thời chỉ một form tạo được; form còn lại nhận thông báo thăm dò đã có buổi.
7. Người tạo thăm dò/admin có thể **Đóng thăm dò** riêng. Thao tác chỉ ngừng nhận phiếu, giữ kết quả, không tạo buổi. Vẫn có thể dùng khung giờ còn ở tương lai để mở form tạo buổi.

Ngưỡng min_attendees cũ giữ trong schema để tương thích dữ liệu/AI cũ, nhưng không chặn tạo buổi thủ công. Phiếu thay đổi sau khi mở form không tự sửa lựa chọn mời đã hiển thị trong form; người tạo xem lại trước khi lưu.

## Quyền, tính nguyên tử và tương thích

Migration `202611240043_manual_poll_scheduling.sql` đã áp dụng Supabase local; chưa áp dụng hosted hoặc deploy.

- `finish_poll`: người tạo/admin nhóm; lặp lại an toàn; không tạo session.
- `schedule_poll_meeting`: thành viên đang hoạt động; kiểm tra poll/option cùng nhóm, khung giờ tương lai, membership và form. Dùng lại schedule_meeting hiện có để kiểm quyền dữ liệu buổi.
- Khóa thăm dò và lưu session/attendees/thông báo/nguồn poll trong cùng transaction. Lỗi ở bất kỳ bước nào rollback; request key và fingerprint bảo vệ retry.
- Người vote Đi được chỉ được điền vào danh sách mời. Attendance vẫn none và committed_at null, người dùng tự nhận lời trong buổi.
- `close_poll` cũ không còn tạo session trực tiếp: nếu đã có kết quả thì trả ID cũ, nếu chưa thì yêu cầu mở form. Server Action closePoll trực tiếp đã bỏ.
- Link nguồn và dữ liệu điền sẵn được đọc bằng JWT/RLS hiện tại, không dùng service key. ID nguồn không hợp lệ/khác poll/không còn quyền không cấp quyền xem dữ liệu. Nhóm bị khóa trong form điền sẵn; muốn đổi nhóm thì tạo buổi riêng.
- Không thay đổi phân quyền hoặc luồng Chờ tôi duyệt trong lượt này; xem [bản tổng hợp cần quyết định](approval-flow-inventory.md).

## Kiểm tra

- Vitest: quyền tự vote, người tạo/admin đóng, thành viên thường tạo buổi thủ công, bỏ ngưỡng cũ, field chỉnh sửa, retry/hash, sai nhóm/option, rollback, revoked membership và phiếu không thành cam kết.
- `npm run test:poll-ui`: tạo thăm dò qua UI, danh sách không chứa form dài, ba nút vote, websocket thật, form điền sẵn không ghi dữ liệu khi mở, sửa và lưu buổi, vote chỉ mời, đóng không tạo, hai phiên tạo đồng thời sinh một buổi, retry đúng ID. Kiểm tra 320/390/1440px và dark mode.
- Cập nhật bài kiểm tra scheduling/concurrency/hosted theo luồng manual. Lượt này không chạy verify-hosted, không ghi hosted và không gọi LLM.
- Dữ liệu browser nằm trong Poll browser fixture, được dọn qua local:clean cùng backup.
