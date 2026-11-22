# Trải nghiệm người dùng trên production — 22/11/2026

Đã thao tác qua Chromium tại https://thichtinhtien.online, hai tài khoản test độc lập, viewport điện thoại 390px và desktop 1440px. Không dùng localhost, không gọi LLM, không gửi email hay chuyển tiền thật.

## Kết quả chức năng

10 bước kiểm tra đạt, không ghi nhận JavaScript runtime error:

1. Tài khoản mới chỉ thấy trang chờ lời mời, không có menu tính năng.
2. Admin tạo link mời bằng UI, giới hạn một lượt.
3. Người chơi mở link và tham gia nhóm bằng UI.
4. Người thu lưu hồ sơ/ngân hàng giả có nhãn TEST.
5. Tạo buổi đã chơi 100.000đ, hai người, xem bảng chia và lưu thành công. Thao tác tự động khoảng 5,9 giây sau tải form; không phải thời gian nhập tay của người thật.
6. Người chơi thấy công nợ 50.000đ.
7. Người chơi báo đã chuyển; trạng thái chờ người nhận xác nhận.
8. Người thu xác nhận thủ công khoản giả lập.
9. Công nợ người chơi về 0đ.
10. Sáu màn home/nhóm/buổi/hồ sơ/thông báo/AI hiển thị ở 390px và 1440px không tràn ngang.

## Những điểm gây bối rối

| Ưu tiên | Quan sát trực tiếp | Hướng chỉnh |
| --- | --- | --- |
| Cao | Ở màn thanh toán, form ảnh/mã giao dịch/giờ chuyển nằm trước thông tin ngân hàng và nút “Tôi đã chuyển”; cần cuộn nhiều dù chỉ muốn thanh toán | Đưa số tiền, người nhận, nội dung chuyển và một CTA lên đầu; bằng chứng đặt trong mục tùy chọn đóng mặc định |
| Cao | Ở màn nhóm, admin thấy dropdown đổi quyền/Cập nhật ngay bên dưới thành viên; link mời lại ở gần cuối trang | Đưa “Mời bạn” lên đầu; quản lý vai trò và thành viên khách vào mục quản trị mở khi cần |
| Cao | Thành viên được ghi “Admin nhóm” nhưng dropdown thao tác mặc định hiển thị “Thành viên” | Tránh trông như trạng thái hiện tại; chọn mặc định đúng vai trò hoặc dùng placeholder “Chọn thao tác” |
| Vừa | Tạo buổi đơn giản vẫn hiện hệ số cho từng người, phụ phí, mẫu nhanh và đoạn giải thích làm tròn | Mặc định chia đều; gom hệ số/phụ phí vào “Tùy chỉnh”; chỉ hiện giải thích khi người dùng mở |

Trang chủ và trang chờ mời hiện dễ hiểu hơn các màn nghiệp vụ chi tiết. Luồng chức năng chạy được, nhưng chưa thể coi thiết kế đã đạt mục tiêu tối giản chỉ vì kiểm thử tự động qua.

## Phạm vi và dữ liệu test

- Phiên đăng nhập test được cấp qua Supabase Auth Admin, không gửi email. Không tự đăng nhập tài khoản Google của người dùng, nên lượt này **không nghiệm thu consent Google thật hay SMTP**.
- Nhóm/admin ban đầu được tạo riêng để chuẩn bị thử; không coi đây là nghiệm thu UI tạo nhóm của super admin.
- Nhóm `[TEST] Trải nghiệm domain a55e882b`, ID `f5d3bbcf-09d8-46b9-802d-307b30fcc599`; buổi `28c64848-f564-46fb-bbb7-25999378faf3` chỉ chứa dữ liệu giả, khoản thu đã được xác nhận giả lập. Giữ lại lịch sử test, không sửa/xóa log tiền.
- Link mời test đã dùng hết một lượt. Các tài khoản test chỉ có quyền trong nhóm test; không chạm công nợ nhóm thật.
- Chưa nghiệm thu thiết bị vật lý, push, QR/chuyển khoản thật hoặc AI production.

## Bằng chứng

Report gốc và ảnh nằm trong `.tools/production-journey/` (không đưa vào Git). Report không lưu credential hay link mời:

- `report.json`: các bước và phạm vi.
- `01-waiting.png`, `03-member-home.png`: luồng vào app.
- `02-group-admin.png`, `04-create-preview.png`: màn còn nhiều điều khiển.
- `06-debts.png`, `07-reported-payment.png`, `08-confirmed.png`: công nợ và xác nhận.

Runner: `node --env-file=.env scripts/try-production.mjs --write-test-fixtures`. Chỉ chạy khi chủ ứng dụng cho phép tạo thêm dữ liệu test production; mỗi lượt tạo hai tài khoản và một nhóm mới, không xóa lịch sử cũ.
