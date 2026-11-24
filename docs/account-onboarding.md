# Đăng nhập, đăng ký và nhận lại thành viên khách

## Luồng cho người dùng

- **Đăng nhập**: `/login`. Google hoặc link email; nhập email chưa có tài khoản không tự đăng ký.
- **Đăng ký**: `/register`. Google hoặc email. Với email, mở link xác nhận trong cùng trình duyệt và cùng địa chỉ đã bắt đầu.
- Sau khi gửi email, màn hình **Kiểm tra email của bạn** có nút dùng email khác/gửi lại và liên kết chuyển giữa đăng nhập/đăng ký.
- Đăng nhập Google lần đầu có thể tạo tài khoản; màn đăng nhập giải thích điều này. Google dùng chung Supabase identity theo email đã xác minh, không tạo hệ thống mật khẩu riêng.
- Lời mời vào nhóm, kể cả `?session=...`, được giữ khi đổi trang đăng nhập/đăng ký, gửi email và xử lý callback lỗi. Không nhận URL chuyển hướng tùy ý.
- Tài khoản thường chưa có nhóm vẫn chỉ vào trang chờ lời mời. Đăng ký không tự cấp quyền tạo nhóm hoặc đọc nhóm khác.

Cách trình bày tham khảo lựa chọn Google/email của [Notion](https://www.notion.com/help/log-in-and-out) và luồng xác nhận email trước khi vào workspace từ [Slack](https://slack.com/help/articles/212675257-Join-a-Slack-workspace). Dùng nhãn rõ ràng và ít trường nhập; không thêm mật khẩu chỉ để tách hai trang.

## Thành viên khách liên kết email thật như thế nào?

“Thành viên khách” là tên được admin thêm hộ trong danh sách nhóm, có `group_members.user_id = null`. Tên này có thể đã có lịch chơi, phần chia hoặc công nợ. Đây chưa phải một tài khoản đăng nhập.

1. Một thành viên gửi link mời nhóm cho người đó.
2. Người nhận đăng ký hoặc đăng nhập bằng Google/email thật và xác nhận email.
3. Trên lời mời, chọn **Đã có, tôi muốn nhận lại tên cũ**, chọn tên được thêm hộ rồi gửi yêu cầu.
4. Trang nhóm hiển thị **Chờ admin liên kết tài khoản**; có thể hủy yêu cầu để chọn lại.
5. Admin mở nhóm hoặc **Chờ tôi duyệt**, kiểm tra email đã xác nhận và xác minh trực tiếp đúng người. Chọn **Đã xác minh — đồng ý liên kết**.
6. Tài khoản được liên kết với chính mã thành viên cũ. Lịch sử chơi, phần chia và khoản đã xác nhận giữ nguyên. Người đó kiểm tra và tự lưu ngân hàng trong **Tôi**.

Nếu đã lỡ tham gia nhóm như người mới: vào nhóm → **Bạn đã có tên trong nhóm?** hoặc **Tôi → Nhận lại tên đã được thêm hộ**. Yêu cầu cũng đi qua admin duyệt.

Không tự ghép theo tên hoặc chỉ dựa vào email người khác nhập. Nếu tài khoản mới đã có lịch sử buổi chơi/tiền, hệ thống từ chối gộp tự động để bảo toàn dữ liệu; cần admin phối hợp xử lý riêng. Trong lúc chờ nên tránh tham gia buổi bằng tên mới. Yêu cầu có hạn 72 giờ; hết hạn phải gửi yêu cầu mới.

Email đăng nhập được hiển thị tại **Tôi → Tài khoản đăng nhập**. Email người yêu cầu chỉ được lấy qua RPC dành cho admin; không đưa email vào payload yêu cầu mà cả nhóm đọc được.

## Tài khoản “Khách” trong local

Nút **Khách · Vai thử** là vai thử local có email giả, dùng để kiểm tra trang chờ và lời mời. Nếu bạn đã cho vai này vào nhóm, nó có quyền theo membership hiện tại như tài khoản thường. Không đổi email của tài khoản thử thành email cá nhân. Để thử đăng ký độc lập, đăng xuất, nhập email khác ở `/register`, mở hộp thư local tại `http://127.0.0.1:54324`, rồi mở link xác nhận.

Ở local mọi email gửi vào hộp thư này; không gửi tới hộp thư thật. Google bị ẩn khi dùng chế độ tài khoản thử local. Kiểm thử tự động không gọi LLM.

## Database, cấu hình và kiểm chứng

Migration `202611240041_account_onboarding.sql` bổ sung:

- `invite_details`: chỉ người có email đã xác nhận và link hợp lệ mới xem được tên nhóm/tên khách còn hoạt động.
- `accept_invite_with_claim`: dùng lượt mời và gửi yêu cầu trong cùng transaction; lỗi chọn tên/nhóm không để lại nửa chừng; gửi lại sau lượt cuối không tiêu thụ thêm lượt.
- `member_claim_reviews`: chỉ admin hiện tại của nhóm xem email người yêu cầu.
- Kiểm tra lại email đã xác nhận khi yêu cầu và khi duyệt; kiểm tra quyền sau khi khóa nhóm; giữ nguyên các rào chắn lịch sử của luồng nhận thành viên cũ.

Migration mới đã áp dụng trên Supabase local; chưa áp dụng hosted/deploy production. `supabase/config.toml` cho phép callback tại localhost:3000 và cổng kiểm thử 3224. Đổi cấu hình Auth local cần khởi động lại stack, không dùng tùy chọn xóa volume.

Với Supabase hosted, giữ Site URL đúng domain và allowlist `https://thichtinhtien.online/auth/callback?next=**` (hoặc callback wildcard phù hợp). Callback tiếp tục đặt `next` trước `mode` để tương thích cấu hình hiện có. Tham khảo [Supabase signInWithOtp](https://supabase.com/docs/reference/javascript/auth-signinwithotp) cho `shouldCreateUser`.

Kiểm tra:

- `npm test`: hành vi đăng nhập/đăng ký/OAuth và quyền/RPC, gồm email chưa xác nhận, IDOR, lượt mời cuối, gửi trùng, admin duyệt, hết hạn, lịch sử đã xác nhận và chặn gộp khi có lịch sử mới.
- `npm run test:account-onboarding`: Chromium + Auth + Mailpit thật trên local. Email chưa có tài khoản không được tạo từ login; đăng ký → mở link PKCE → lời mời → yêu cầu/hủy/gửi lại → admin duyệt từ Chờ tôi duyệt → đúng member ID → hiển thị email trong hồ sơ. Kiểm tra màn nhỏ/lớn và dark mode. Chỉ dữ liệu fixture riêng.
- `npm run test:invite-gate`, `npm run test:auth-ui`, `npm run test:local-dev`: quyền sau tham gia/gỡ, hồ sơ/ngân hàng và tài khoản thử localhost.
- Google consent và SMTP trên domain thật cần kiểm tra trên môi trường đã deploy; lượt này chỉ xác minh email Auth local và URL OAuth trong unit test.
