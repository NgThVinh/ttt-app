# Tiến độ theo tám mốc

Nguồn yêu cầu: [handoff_prompt.md](handoff_prompt.md) và kế hoạch tám mốc đã thống nhất với người dùng. Cập nhật ngày 22/11/2026. Chưa mốc nào được coi là nghiệm thu toàn bộ chỉ dựa trên số migration hoặc số test.

| Mốc | Đã triển khai/kiểm chứng | Còn thiếu để khép mốc |
| --- | --- | --- |
| 1. Nền tảng/database | Next.js, TypeScript strict, tiền bigint, RPC/RLS, log bất biến, kiểm thử SQL/TypeScript, allowlist super admin trong DB, pin phiên bản, chống trùng tạo nhóm và các lệnh tiền, chuỗi đợt tính lại | Toàn bộ ma trận quyền, các tình huống đồng thời và nghiệm thu gửi lại yêu cầu trên trình duyệt |
| 2. Đăng nhập/nhóm | Google/email callback, link mời hash/hạn/lượt, quản lý nhóm, nhận lại thành viên có admin duyệt; ngân hàng khách và bàn giao; tạo nhóm bằng JWT người dùng | Nghiệm thu OAuth/SMTP và luồng trình duyệt |
| 3. Buổi chơi/tiền | Hai luồng tạo buổi, hệ số/phụ phí ban đầu trong một transaction, RSVP/hạn chốt, nhận/đề cử/đổi người tính tiền, xem trước, phê duyệt, điều chỉnh và lịch sử; admin dự phòng, mở khóa, sửa khoản chi, danh mục/mẫu | Nghiệm thu luồng trình duyệt, thời gian tạo buổi và ma trận quyền đầy đủ |
| 4. Thanh toán | Công nợ, chi tiết phần chia, QR/fallback, báo chuyển/xác nhận thủ công, bằng chứng riêng tư, cleanup đã kiểm tra qua Storage API, interface PaymentVerifier | Nghiệm thu trình duyệt, QR với cấu hình production và truy xuất bằng chứng sau đổi người thu |
| 5. Hẹn lịch/thông báo | Thăm dò, ngưỡng chốt, lịch tuần, cron, in-app và chia sẻ Messenger | Web Push, nhắc thủ công, kiểm tra Realtime/delivery trên trình duyệt và thiết bị |
| 6. AI | Chưa triển khai | Cấu hình/duyệt theo nhóm, mã hóa key, provider, streaming, tools, drafts/HITL, quota, policy/eval, adapter Messenger khi đủ cấu hình |
| 7. PWA/giao diện | Giao diện chức năng ban đầu, manifest, dark mode ở dashboard | **Redesign UI/layout theo yêu cầu mới**, shadcn/ui, Be Vietnam Pro, giao diện thống nhất, service worker/cài đặt, accessibility và kiểm tra thiết bị |
| 8. Triển khai | Database hosted đã migrate; có workflow CI gồm typecheck/lint/test/build và tài liệu vận hành | Deploy website, cấu hình Auth/SMTP/Vercel, kiểm tra secrets, kiểm tra production và các cổng nghiệm thu còn lại |

## Các phần đã kiểm chứng ở mốc 1–2

- Migration `202611220020_super_admin_allowlist.sql` đã áp dụng, bổ sung hai bảng riêng tư cho allowlist và kết quả yêu cầu tạo nhóm.
- Allowlist được đồng bộ từ `SUPER_ADMIN_EMAILS`; server và database đều kiểm tra danh tính đã xác minh. Client không đọc/sửa được allowlist. Khóa service không được gọi helper cấp nhóm cũ.
- Tạo nhóm dùng JWT và mã yêu cầu riêng cho từng người. Gửi lại cùng nội dung trả về nhóm cũ; dùng lại mã với nội dung khác bị từ chối. Mã không cấp quyền truy cập nhóm của người khác.
- Dependencies được pin đúng các phiên bản đã có trong lockfile, không nâng cấp ở lượt này. CI đã thêm production build; chưa xác nhận một lượt chạy CI từ xa.
- Kiểm thử hosted rollback đã qua. Thử hai kết nối PostgreSQL xác nhận yêu cầu trùng chờ giao dịch trước, tiếp tục đúng sau rollback và tái sử dụng kết quả trong giao dịch còn lại; không lưu dữ liệu nghiệp vụ thử. Đây chưa phải toàn bộ bộ kiểm thử đồng thời của kế hoạch.
- Migration 021–022 đã áp dụng; tổng **23 migration, 22 bảng public có RLS** và ba bảng riêng tư. Bảy lệnh được bảo vệ bằng mã yêu cầu: tạo buổi, nhận vai trò, chốt tiền sân, thêm khoản chi/đề xuất, sửa người/xóa khoản chi, báo chuyển/xác nhận và quyết định yêu cầu duyệt. Gửi lại cùng mã/nội dung trả kết quả đã lưu; mã mới với revision cũ vẫn bị chặn. Đề xuất giống nhau có chủ đích dùng các mã riêng.
- Mỗi lần tính lại lưu snapshot trước/sau bất biến, liên kết đợt trước và revision. Khoản mới/bị thay thế tham chiếu đợt phát hành/hủy tương ứng. Bản xem trước rollback cả batch và liên kết; khoản đã xác nhận được giữ nguyên, kể cả dữ liệu cũ trước migration không có liên kết batch.
- Kiểm tra hosted đã xác nhận retry không tạo thêm đề xuất/duyệt, payload đổi bị từ chối, revision cũ không dùng cho lệnh mới và liên kết batch đúng. Toàn bộ fixture nghiệp vụ được rollback.
- **108 test** tự động, typecheck, lint và production build đã qua ở máy làm việc. Chưa nghiệm thu luồng trình duyệt hoặc production.
- `npm run test:concurrency` đã qua 9 kịch bản trên PostgreSQL 17 trong container riêng: tranh vai trò thu tiền, lượt mời cuối, chốt thăm dò, duyệt trùng cùng/khác mã, retry tiền sau commit/rollback và xác nhận tiền trước/sau tính lại. Runner đợi khóa thật để bảo đảm hai giao dịch chồng nhau, rồi xóa container của mình; không đụng Supabase hosted. CI đã thêm bước này. Migration 023 sửa retry của người vừa dùng lượt mời cuối, vẫn chặn token bị thu hồi/hết hạn và người mới khi hết lượt.
- Mốc 2, migration 024: admin nhập ngân hàng thành viên khách kèm lý do, có audit và thông báo. RLS chỉ cho thành viên cùng nhóm xem khi người nhận còn là khách hoạt động. Sau claim, không dùng ngân hàng khách làm fallback; tài khoản đã liên kết tự quản lý hồ sơ. Embedded/hosted checks đã qua; bank fixture hosted được rollback.
- Mốc 3, migrations 025–027: admin dự phòng qua bản xem trước 15 phút, kiểm tra lại điều kiện/revision/hash khi lưu, lý do công khai và thông báo. Yêu cầu quá 72 giờ được tạo lại theo dữ liệu hiện tại; không duyệt lại yêu cầu hết hạn. Đề cử mới vẫn cần người được đề cử nhận riêng và có hạn 72 giờ. Mở khóa buổi đã settled quá 30 ngày có hạn 24 giờ, không cấp thêm quyền tiền cho admin. Hai race dự phòng/ngân hàng và rút yêu cầu đã qua; tổng 11 kịch bản đồng thời.
- Điều kiện mốc 6/8 đã bổ sung: người dùng cho phép dùng `GEMINI_API_KEY` hiện có riêng cho nhóm test AI; Vercel CLI đã đăng nhập. Chưa cấu hình AI runtime dùng chung, chưa deploy website.
- Mốc 3, migrations 028–029: danh mục/mẫu mặc định cho nhóm, quản trị tạo/sửa/ngừng dùng; sửa khoản đang hoạt động và đề xuất của chính mình qua writer chung, giữ ID/tác giả/ảnh và điều chỉnh phần chênh lệch đã thu. Hash đề xuất bao gồm revision nền khi sửa để bản xem trước cũ không được duyệt sau rebase. UI hiển thị danh mục/ghi chú/người ứng và buộc xem lại khi revision đổi. 108 test, 11 race, hosted checks và production build đã qua.

## Thứ tự tiếp theo

Khép các khoảng thiếu nền tảng ở mốc 1, rồi ngân hàng thành viên chưa có tài khoản ở mốc 2 và các quyền/luồng còn thiếu của mốc 3. Sau đó hoàn tất mốc 4–5, triển khai AI ở mốc 6, redesign/PWA ở mốc 7 và nghiệm thu triển khai ở mốc 8. Chỉ chỉnh UI trong các mốc trước khi cần để thao tác nghiệp vụ mới sử dụng được.

Mỗi đợt thay đổi cần ghi rõ mốc, kiểm tra đã chạy, migration đã áp dụng, điều kiện còn thiếu và commit. Số test qua không thay thế nghiệm thu trình duyệt, thiết bị hoặc production.

- Mốc 3, migration 030: tạo buổi đã chơi cùng hệ số và phụ phí qua một giao dịch, chỉ tính lại công nợ một lần. Hẹn trước có ba lựa chọn người tính tiền, đề cử cần nhận riêng. Bản xem trước dùng cùng thuật toán tiền TypeScript, thay đổi phần chia buộc xem lại. Tổng 31 migration, 25 bảng public có RLS; 112 test và 11 race đã qua, typecheck/lint/build đã qua.