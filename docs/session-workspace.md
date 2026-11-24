# Chi tiết buổi chơi và chốt chi phí

## Giao diện

- Bố cục hiện tại đã review lại ở [session-detail-review.md](session-detail-review.md). Tổng quan trước buổi hiển thị người tham gia và chi phí cho mọi vai trò; form chốt mở bằng nút Nhập phí và chốt buổi trong khu vực chi phí. Sau buổi, khoản thanh toán cá nhân hiện trước trên điện thoại và ở cột bên trên desktop; QR/ngân hàng/báo chuyển mở bằng nút Thanh toán.
- Đầu trang ưu tiên tên buổi, ngày/giờ, địa điểm, ghi chú và thời gian còn lại. Giờ kết thúc khác ngày có nhãn ngày kết thúc. Bỏ ba ô thống kê Tham gia / Phần của tôi / Người tính tiền ở đầu trang.
- Nút biểu tượng bút (nhãn truy cập/tooltip: Sửa thông tin buổi) mở các trường ngay trong khu vực thông tin. Lưu thành công đóng phần sửa; lỗi giữ nguyên dữ liệu nhập. Hủy sửa không gửi thay đổi. Vẫn kiểm tra revision, khóa lịch, điều kiện hủy/mở lại và lý do ở server/database.
- **Người tham gia** có lựa chọn của bạn và đầy đủ tên theo nhóm đã nhận lời/đang chờ/không đi, không cắt sau tám tên. **Mời thêm** (nhãn truy cập: Mời thêm người tham gia) mở dropdown có thành viên còn lại và link mời bạn mới; Escape/click ngoài đóng dropdown.
- Chỉ một khu vực **Chi phí buổi chơi** chứa người tính tiền, phụ phí, bảng chia và chi tiết hóa đơn. Bỏ khối Gửi đề nghị thay đổi tách rời. Người tính tiền có thể thêm/sửa các khoản sau khi chốt trong chính khu vực này, theo quyền và hạn khóa hiện có.
- **Gán cho tôi** nhận vai trò khi chưa có người tính tiền; nếu đã có người khác thì gửi đề cử chuyển vai trò. **Chọn người khác** gửi đề cử, không tự gán. Sự đồng ý cần thiết hiển thị ngay trong khu vực chi phí. Người tính tiền cần hồ sơ ngân hàng.
- Trước khi chốt có tiền sân, nhiều phụ phí/giảm giá, mẫu khoản phí, người ứng, người chịu, tổng hoặc mỗi người, chia đều/hệ số/số tiền cụ thể/phần trăm, danh mục và ghi chú. Bảng xem trước nhóm các tên có cùng phần tiền, dùng phép tính bigint/hữu tỉ hiện có; đổi dữ liệu làm bản xác nhận cũ mất hiệu lực.
- **Lịch sử** mở native dialog, khóa tương tác nền, hỗ trợ Escape/trả focus. Chỉ nội dung popup cuộn. Tải 20 mục/trang bằng cursor thời gian + ID, tự tải khi gần cuối và có nút tải thêm/thử lại. Không tải toàn bộ lịch sử trong session_details.

## Database và giao dịch

Migration `202611240042_session_workspace.sql` đã áp dụng local, chưa deploy hosted:

- Lệnh `finish_session_bundle` đi qua execute_financial_command nên dùng chung khóa buổi, idempotency key, hash nội dung và receipt.
- Kiểm tra đúng người tính tiền, revision và người đã nhận lời. Tiền sân và các phụ phí được lưu trong cùng transaction, dùng construction context riêng để tính lại đúng một lần ở cuối. Lỗi bất kỳ khoản nào rollback toàn bộ, kể cả RSVP tự đóng và khóa buổi.
- Giữ nguyên lệnh finish_session cũ để các đường gọi hiện có tiếp tục hoạt động. Không thay quyền ghi trực tiếp vào bảng tiền.
- Khi chốt, đề cử người tính tiền đang chờ bị hủy; lịch/danh sách tham gia khóa theo quy tắc hiện có.
- session_history_page kiểm tra membership của buổi, chỉ đọc audit và attendance events, bỏ allocation snapshot kỹ thuật; giới hạn tối đa 50 mục/trang. Core và wrapper cũ không aggregate lịch sử nữa. Có index theo session/thời gian/ID cho hai nguồn log.

## Kiểm chứng

- `npm test`: 241 test qua, 1 test provider thật bỏ qua. Thêm kiểm tra chốt nhiều khoản, giảm giá mỗi người, exact/percent, một lần tính lại, retry không trùng, rollback toàn bộ, quyền, revision và history cursor khi nhiều mục cùng thời điểm.
- `npm run test:session-workspace`: sửa tại chỗ/lưu/reload, dropdown mời, RSVP, người được đề cử xác nhận, chỉ người tính tiền nhập phí, tiền định dạng 200.000, phụ phí và giảm giá trước chốt, tổng preview khớp SQL, khóa sau chốt, popup/lazy pagination/infinite scroll/Escape/focus, 320/390/1440px và dark mode.
- `npm run test:meeting-ui`: tạo lịch và link mời, tự nhận/rút, optimistic rollback khi lỗi mạng, lịch danh sách, nhận vai trò và khóa buổi.
- `npm run test:payment-ui`: upload ảnh riêng tư, retry sau phản hồi thất lạc, xác nhận chờ server, hoàn tiền sau thu, bằng chứng lịch sử và thành viên bị gỡ.
- Typecheck, lint và production build qua. Không gọi LLM trong các lượt kiểm thử này. Fixture có tên/owner riêng, được dọn có backup qua local:clean; dữ liệu người dùng trong nhóm mẫu giữ nguyên.

Motion popup lấy CSS nguyên bản từ skill transitions-dev/06-modal.md, có prefers-reduced-motion. Dropdown dùng recipe đã có trong motion.css.
