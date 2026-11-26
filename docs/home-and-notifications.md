# Trang chủ, thông báo và lịch

Cập nhật 27/11/2026. Migration 048 đã áp dụng local và hosted; đã phát hành trên thichtinhtien.online.

## Trang chủ

- Bốn ô bằng nhau: cần trả, cần thu, số buổi cá nhân đã tham gia và tần suất theo tuần. Hai cột bên dưới gồm Nhịp chơi và tối đa ba buổi sắp tới. Bỏ Buổi gần đây.
- Contribution Graph có chế độ Cá nhân/Nhóm, màu theo số buổi trong ngày; chỉ tính buổi `played`/`settled` đã bắt đầu. Cá nhân cần RSVP going, đã tự xác nhận và chưa bị gỡ khỏi buổi. Loại buổi hủy, đã xóa, chưa chốt và tương lai.
- Nhóm là tổng các nhóm tài khoản đang tham gia. Thu hồi quyền nhóm cũng thu hồi dữ liệu thống kê nhóm đó; super admin không tự có thống kê của nhóm mình chưa tham gia.
- Bốn ô tổng quan dùng 26 tuần. Biểu đồ hiển thị 26 tuần ở màn hình lớn, 13 tuần ở màn hình nhỏ, ghi rõ khoảng thời gian. Tần suất trong biểu đồ tính theo khoảng đang hiển thị; không làm tròn thành 0 khi vẫn có tham gia.
- Ngày theo Việt Nam, tuần bắt đầu thứ Hai. Ngày tương lai để trống; không dựng dữ liệu mẫu trong sản phẩm. Hover/chạm ô để xem số buổi, phím mũi tên và Home/End di chuyển giữa ngày; một điểm Tab cho cả biểu đồ.
- RPC `my_participation_activity` tổng hợp ở SQL trước giới hạn hàng của API; không tải tên, ngân hàng hoặc lịch sử tiền để tính biểu đồ. Kết quả tối đa 182 ngày, không ghi dữ liệu.

## Dropdown thông báo

- Chuông mở sáu thông báo gần nhất cùng tổng chưa đọc và liên kết **Xem tất cả** tới `/notifications`.
- Đọc bằng JWT người dùng, có RLS và lọc user ID ở server; số chưa đọc chỉ thuộc người đó trong nhóm đang có quyền. Admin không đọc hộ thông báo của thành viên khác. Endpoint trả `private, no-store`.
- Bấm một mục mở trang liên quan và đánh dấu đã đọc. Chuông đóng chỉ tải số chưa đọc; danh sách tải khi mở và dùng lại trong 60 giây. Cập nhật bằng Realtime, khi quay lại tab và fallback 120 giây khi kết nối lỗi; dừng khi tab ẩn/offline. Giao diện có trạng thái rỗng, lỗi/thử lại; badge không giả định bằng 0 khi tải thất bại.
- Escape trả focus về chuông; bấm ngoài hoặc Tab ra ngoài đóng. Giữ chuyển động dropdown của skill `transitions-dev`, hỗ trợ reduced motion. Chỉ danh sách dài trong dropdown mới cuộn; nút Xem tất cả luôn ở cuối panel.
- Chỉ nhận liên kết nội bộ được cho phép; liên kết thăm dò cũ chuyển về Buổi chơi.

## Buổi chơi

- Bỏ bộ chọn Lịch tháng/Danh sách và state chế độ. Giữ một workspace: lịch bên trái, danh sách bên phải; cột lịch rộng 280–360px theo màn hình.
- Màn hình nhỏ giữ lịch tuần gọn và nút mở tháng, danh sách bên dưới. Chỉ agenda cuộn trong khung lịch; giữ ngày được chọn khi mở/đóng modal, tạo nhanh theo ngày, hàng ＋, RSVP, tên người qua hover/chạm và lịch lặp.

## Kiểm chứng

- Unit/database: ranh giới tuần/năm, ngày Việt Nam, loại trạng thái không hợp lệ, tách cá nhân/nhóm, cách ly nhóm bị gỡ và hơn 1.000 buổi không bị cắt tổng.
- `npm run test:overview-ui`: danh tính Auth local độc lập, thống kê thật, dropdown riêng tư/chưa đọc/đánh dấu đọc, anonymous denial, đóng/mở bằng bàn phím, mạng lỗi/thử lại, reduced motion và 320/390/768/1440px.
- Browser calendar-ux/calendar-workspace/meeting-ui/minimal-ux kiểm tra hồi quy lịch, cuộn, modal, lời mời và RSVP. Không gọi LLM.
