# Tạo nhóm và thêm thành viên

## Super admin tạo nhóm

1. Đăng nhập Google bằng email trong `SUPER_ADMIN_EMAILS`; email phải được xác minh và có trong allowlist database.
2. Mở `http://localhost:3000/groups` khi chạy local.
3. Trong **Tạo nhóm mới**, nhập **Tên nhóm** và **Môn thể thao**, bấm **Tạo nhóm**.
4. App mở nhóm vừa tạo. Người tạo tự động là admin của nhóm.

Super admin chưa có nhóm được mở riêng trang này để tạo nhóm đầu tiên; tài khoản thường vẫn cần link mời. Không có quyền truy cập chung vào các nhóm của người khác.

Nếu vừa thay cấu hình email: khởi động lại dev server, chạy `npm run db:admins` để xem trạng thái, rồi `npm run db:admins:sync` khi cần đồng bộ thay đổi. Không dán key hay email credentials vào chat.

## Mời người có tài khoản

Mọi thành viên đang hoạt động đều tạo được link mời, không cần quyền admin. Người tạo link hoặc admin có thể thu hồi link đó.

1. Mở nhóm → **Mời bạn** → **Tạo link mời**.
2. Sao chép link và gửi cho bạn bè. Có thể mở **Tùy chỉnh link mời** để đổi hạn/lượt dùng.
3. Người nhận mở link, đăng nhập Google, nhập tên trong nhóm và bấm **Tham gia nhóm**.

Để mời vào một buổi cụ thể: mở buổi → **Mời thêm người tham gia** → **Tạo link mời bạn mới vào buổi**. Sau khi vào nhóm, người nhận được đưa về đúng buổi để tự nhận lời; tham gia nhóm chưa tạo nghĩa vụ tiền. Với thành viên đã ở nhóm, chọn tên và gửi lời mời trực tiếp. Mọi người được rút đến khi người tính tiền chốt chi phí.

## Thêm người chưa dùng app

Mở nhóm → **Thêm người chưa có tài khoản** → nhập tên → **Thêm thành viên**. Đây là thành viên khách để tính phần tiền; thao tác không tạo tài khoản hoặc gửi email.

Khi người đó dùng app, gửi link mời. Họ đăng ký/đăng nhập bằng email thật, chọn **Đã có, tôi muốn nhận lại tên cũ** rồi gửi yêu cầu. Admin mở nhóm hoặc **Chờ tôi duyệt**, xác minh email và đúng người trước khi đồng ý liên kết. Lịch sử và mã thành viên cũ được giữ nguyên. Nếu đã vào nhóm bằng tên mới, dùng **Bạn đã có tên trong nhóm?** ở đầu trang nhóm. Xem [luồng tài khoản và liên kết thành viên khách](account-onboarding.md).
