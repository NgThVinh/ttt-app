# Điều khiển sản phẩm và nhật ký

Cập nhật 26/11/2026. Migration 045–046 đã áp dụng trên Supabase local; chưa áp dụng hosted hoặc deploy trong lượt này.

## Xóa buổi chưa chốt

- Mọi thành viên đang hoạt động trong nhóm có quyền xóa buổi chưa chốt, phù hợp quyền đặt lịch ngang nhau.
- Nút thùng rác ở đầu chi tiết buổi mở hộp xác nhận rõ tên buổi. Phải đánh dấu xác nhận trước khi xóa.
- Database khóa bản ghi và kiểm tra revision. Chặn xóa khi đã chốt chi phí, có khoản phí khác không hoặc đã có thanh toán. Nếu dữ liệu vừa thay đổi, phải xem lại.
- Buổi bị ẩn khỏi lịch và không thể sửa, RSVP hay mở lại. Giữ bản ghi liên quan và audit; không xóa cứng. Retry không tạo thêm sự kiện xóa.
- Xóa một buổi không dừng lịch lặp và không xóa buổi khác; quản lý lịch lặp vẫn là thao tác riêng.

## Audit log `/audit`

- Admin nhóm xem hoạt động của các nhóm mình quản lý. Super admin xem toàn bộ; thành viên thường không thấy menu và không được đọc qua trang, RPC hoặc bảng trực tiếp.
- Bộ lọc nhóm và cursor `(created_at, id)` phân trang 30 mục, gồm trường hợp nhiều sự kiện trùng thời gian.
- Giữ các sự kiện nghiệp vụ đã có và tự ghi thay đổi dữ liệu thành công của người dùng: nhóm, thành viên, lời mời, hồ sơ, buổi chơi, người tham gia, chi phí/phân bổ, thanh toán, yêu cầu, thông báo, cấu hình/lượt dùng/bản nháp AI, mẫu phí, lịch lặp, hóa đơn và bằng chứng.
- Mỗi mục ghi người thực hiện, thời điểm, nhóm/buổi, loại thao tác, ID bản ghi và tên các trường thay đổi. Không sao chép giá trị API key, thông tin ngân hàng hoặc nội dung chat vào log tự động. Trigger chặn sửa/xóa log; client không được tự thêm log.
- Đây là nhật ký thay đổi dữ liệu, không phải theo dõi lượt mở trang. Thao tác thất bại bị rollback không tạo sự kiện thành công; dữ liệu cũ trước migration không được dựng lại thành lịch sử giả.

## Menu và tính năng được giữ

- “Chờ tôi duyệt” đổi thành **Yêu cầu**, vẫn dùng `/approvals` để giữ liên kết cũ.
- Bỏ nhóm menu **Thêm**. Yêu cầu, Trợ lý 3T và Nhật ký (theo quyền) nằm ngang hàng các mục chính trên desktop/mobile.
- Gỡ Hẹn lịch, giao diện thăm dò, dữ liệu thăm dò trên lịch và tool thăm dò của AI. RPC cũ bị chặn, thăm dò mở được đóng và bản nháp AI thăm dò cũ hết hạn. Giữ dữ liệu lịch sử; liên kết thông báo cũ chuyển về Buổi chơi.
- Lịch lặp hàng tuần trong form tạo buổi được giữ.

## AI do admin bật/tắt

- Admin nhóm cấu hình provider/model, key mã hóa, hạn mức và bật/tắt trực tiếp. Không còn gửi yêu cầu chờ super admin duyệt để sử dụng AI.
- Có thể lưu cấu hình khi tắt; muốn bật phải có provider/model và key hợp lệ đã mã hóa. Mọi thay đổi kiểm tra quyền và revision tại database, ghi audit. Thành viên thường chỉ xem trạng thái.
- Tắt AI chặn lượt dùng mới ngay ở quota gate. Kill switch, hạn mức và circuit breaker vẫn áp dụng.
- Chỉ bỏ phê duyệt **kích hoạt tính năng AI**. Xác nhận bản nháp/thao tác tiền, quyền của người tính tiền, xác nhận người được đề cử và xác nhận đã nhận tiền vẫn giữ.

## Kiểm chứng

- `npm test`: quyền trực tiếp/RPC, dữ liệu tiền, tombstone, revision, retry, log bất biến/không lộ bí mật, cursor trùng thời gian, cách ly nhóm, RPC thăm dò cũ và bật/tắt AI.
- `npm run test:product-controls`: ba danh tính Auth local, xóa qua UI, audit admin/filter/phân trang, cấu hình key giả và bật/tắt AI, menu mobile và trang thăm dò không còn tồn tại. Không gọi provider.
- Các bộ browser lịch, chi tiết buổi và thanh toán kiểm tra hồi quy riêng.
