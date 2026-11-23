# Đối chiếu feedback Claude — 23/11/2026

Nguồn: “Feedback đánh giá 3T – Thích Tính Tiền.md” do người dùng gửi. Nhận xét trong tài liệu được đối chiếu với mã nguồn và yêu cầu đã thống nhất; các đề xuất không tự trở thành yêu cầu sản phẩm.

Report hữu ích nhất ở luồng nhập liệu và lần đăng nhập đầu. Lượt đánh giá chỉ dùng nhóm một người, không lưu buổi và chưa thử thanh toán/link mời/push. Điểm số không thay thế kiểm thử tính tiền, quyền hoặc nghiệm thu production. Hiện tượng tải khi cửa sổ bị ẩn chưa đủ để kết luận có lỗi mạng/server.

## Đã cải thiện trong mã nguồn

| Mục trong report | Thay đổi và giới hạn |
| --- | --- |
| 1, 5: nhập số và lỗi chung | Form tạo buổi nhận `400000`, `400.000`, `400,000`, cắt khoảng trắng ở hai đầu; hệ số nhận `0,5`. Phụ phí/giảm giá cũng nhận dấu nghìn. Dùng cùng bộ chuẩn hóa ở UI và Server Action, chỉ gửi chuỗi số chuẩn tới gateway tiền. Không xóa dấu tùy tiện: `400000.5`, nhóm nghìn sai hoặc dấu trộn bị từ chối. Lỗi đặt cạnh ô và giải thích lý do chưa lưu được. Phạm vi là form tạo buổi, chưa áp dụng cho mọi form tiền trong app. |
| 3: lỗi đăng nhập | Callback và trang gốc nhận cả mã thành công lẫn lỗi OAuth. Link đã dùng/hết hạn/sai phiên trình duyệt/hủy Google có thông báo riêng; chỉ dùng thông điệp được định nghĩa sẵn, không hiển thị mô tả lỗi tùy ý. Giữ link mời hợp lệ khi thử lại. Nếu callback lặp và Auth xác minh được phiên hiện tại, tiếp tục vào app. Nút đăng nhập có trạng thái chờ. Chưa chứng minh được nguyên nhân redirect localhost bằng một phiên Google thật. |
| 4: giá sân điền sẵn | Để trống tiền sân, yêu cầu nhập giá thực tế. Giữ hỗ trợ 0đ và giới hạn 1.000.000.000.000đ đang có; không đổi hợp đồng tính tiền theo suy đoán của report. |
| 6, 8: 404 và tiêu đề | Trang không tìm thấy bằng tiếng Việt, theo màu giao diện, có đường về trang chủ. Mỗi màn có tiêu đề tab riêng; không đưa tên nhóm, buổi hoặc công nợ riêng tư vào metadata. |
| 7: header | Thêm X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy và CSP cho frame-ancestors/object-src/base-uri. Đây là CSP cơ bản; chưa có chính sách script-src/connect-src đầy đủ với nonce. Không mô tả như đã ngăn toàn bộ XSS. |
| 9, 18: vùng bấm và bố cục | Dòng chọn người tham gia cao tối thiểu 44px, bấm cả dòng, có trạng thái đã chọn. Nhãn form và mục tùy chỉnh 14px; select nhóm/loại buổi nằm dưới nhãn. Tăng vùng bấm của liên kết hành động và quay lại chính. Chưa kiểm toàn bộ accessibility trên thiết bị thật. |
| 10: tên | Ô hồ sơ trống lấy tên Google làm gợi ý; Trang chủ ưu tiên tên hồ sơ đã lưu rồi tới tên Google. Không ghi đè biệt danh thành viên từng nhóm hoặc tự nhận lại thành viên khách theo tên. |
| 11: ngân hàng | Ô số tài khoản gợi bàn phím số, vẫn giữ tài khoản dạng chuỗi để bảo toàn số 0 đầu. Bộ chọn ngân hàng chưa triển khai. |
| 13: thuật ngữ | Thay lời giải thích T3 trên màn chat bằng “người có quyền duyệt”, dẫn tới “Chờ tôi duyệt”; rút nhãn cài đặt AI. Có ví dụ hệ số 1/cả buổi, 0,5/nửa buổi. Loại buổi đã có lịch ghi rõ khác với thăm dò chọn lịch. |
| 16: tìm kiếm | Thêm robots.txt công khai với Disallow và metadata noindex/nofollow. Các lớp xác thực, RLS và quyền ghi vẫn là biện pháp bảo vệ dữ liệu. |

Định dạng số tiền khi rời ô để không làm nhảy con trỏ trong lúc gõ. Bản xem trước dùng số đã chuẩn hóa; thay đổi định dạng nhưng giữ nguyên số tiền không làm mất xác nhận. Thay đổi tiền/hệ số/người chịu vẫn phải xem lại trước khi lưu. Hệ số mặc định là 1; chủ động xóa ô hệ số sẽ báo lỗi, không âm thầm đổi lại thành 1.

## Những gợi ý cần điều chỉnh

- **T3 không phải lỗi gõ của 3T.** Đây là mức phê duyệt trong harness. Chỉ đổi lời giải thích với người dùng, giữ nguyên policy và thẩm quyền.
- **Không chặn buổi 0đ một cách mặc định.** Kế hoạch có trường hợp tổng bằng 0, miễn phí hoặc giảm giá. Có thể thêm cảnh báo giá bất thường sau khi có dữ liệu thật, chưa đặt thêm một trần tùy ý.
- **Giữ việc xem lại số tiền hiện tại.** Có thể thiết kế một màn xem lại rồi nút lưu, nhưng không bỏ kiểm tra revision/hash hoặc cho bản xem trước cũ được dùng lại sau thay đổi.
- **Thăm dò và buổi đã có lịch là hai luồng khác nhau.** Đặt nhãn rõ, không gộp logic bỏ phiếu/ngưỡng chốt vào RSVP.
- **Không thêm thẻ AI/nút nổi chỉ để dễ khám phá.** Người dùng đã yêu cầu tối giản và tài khoản chưa có nhóm chỉ thấy trang chờ; AI production còn tạm tắt. Hướng dẫn nên xuất hiện đúng ngữ cảnh.
- Chọn riêng người chịu từng khoản, nhắc thanh toán và chia sẻ đã có nền tảng. Cần kiểm tra khả năng tìm thấy và luồng dùng trước khi xây lại. Nội dung chia sẻ hiện tránh thông tin ngân hàng; không tự đưa ngân hàng vào Messenger khi thêm chia sẻ QR.

## Việc nên làm tiếp

1. **Hoàn thiện lần đăng nhập đầu.** Kiểm tra trực tiếp allowlist localhost trong Supabase và một lượt Google OAuth mới. Site URL giữ production; redirect local phải được cho phép riêng. Hoàn thiện trang giới thiệu/chính sách công khai với thông tin chủ ứng dụng đã xác nhận, rồi cấu hình và gửi xác minh thương hiệu Google. Không tự viết cam kết pháp lý hay địa chỉ hỗ trợ chưa được cung cấp.
2. **Giảm nhập liệu lặp lại.** Thêm “Dùng lại buổi trước” để sao chép bản nháp gồm sân, giá và người tham gia; người tạo xem lại trước khi lưu. Không tự chốt RSVP hoặc tự gửi nghĩa vụ tiền. Cho chọn ngân hàng từ nguồn BIN chính thức, giữ cách nhập tay dự phòng.
3. **Hướng dẫn theo trạng thái.** Khi nhóm chưa có buổi, chỉ nêu hành động tạo buổi đầu tiên; nhắc ngân hàng khi người đó nhận tính tiền. Tài khoản thường chưa thuộc nhóm tiếp tục chỉ có trang chờ link mời. Không thêm checklist dài vào trang chủ.
4. **Kiểm tra mạng và thiết bị.** Đo request bị chậm khi tab ẩn/hiện, ghi nhận lỗi đã lọc bí mật; thông báo tải lâu kèm tải lại cho thao tác đọc. Không tự gửi lại lệnh tài chính. Kiểm tra khởi động PWA, push, ngày giờ và dark mode trên máy thật trước khi sửa theo giả thuyết chớp trắng.
5. **Sau luồng cốt lõi:** ảnh chia sẻ Open Graph dùng nội dung công khai chung, thống kê tháng và các chi tiết cộng đồng. Ưu tiên sau nhập tiền/đăng nhập/ngân hàng; tránh đưa dữ liệu nhóm vào ảnh preview công khai.

Nguồn cấu hình: [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [Supabase Auth error codes](https://supabase.com/docs/guides/auth/debugging/error-codes), [Google OAuth App Branding](https://support.google.com/cloud/answer/15549049?hl=en). Google yêu cầu xác minh thương hiệu để tên/logo hiện cho tất cả người dùng External production; sửa tên trong mã Next.js không thay được màn consent.

## Kiểm chứng và phát hành

193 test thường đạt, 1 test provider thật bỏ qua; typecheck/lint/production build đạt. Browser `test:minimal-ux` trên Supabase local xác nhận nhập tiền có dấu nghìn/khoảng trắng, từ chối số thập phân, hệ số dấu phẩy, preview và khoản thực lưu 40.000đ cho người còn lại sau phụ phí. Có kiểm tra lỗi OAuth/giữ link mời/phiên Auth hợp lệ, 404, tiêu đề, header, robots và độ rộng 360/390/1440px. Browser first-group cũng đã qua tạo nhóm → tạo link mời → thêm khách.

Harness local chạy Next dev với thư mục build riêng từng bài test, tránh khóa phiên dev của người dùng và tránh dùng cấu hình public Supabase bị đóng băng trong bản build production. PWA regression trên production build đạt manifest/icon/offline/online recovery, không cache trang riêng tư và responsive login 320/390/768/1440px. Secret scan qua 254 file tracked, 26 client bundle, 7 giá trị bí mật thực tế mà không in giá trị ra log.

Không gọi LLM, không ghi nghiệp vụ hosted và không có migration mới. Các thay đổi của đợt này đang ở local, chưa deploy production. Google consent thật, thiết bị/push và bộ eval provider đầy đủ vẫn chưa được nghiệm thu bằng đợt này.
