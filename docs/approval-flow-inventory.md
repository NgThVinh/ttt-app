# Các luồng cần xác nhận/duyệt hiện có — chờ chủ sản phẩm chốt

Ngày rà soát: 24/11/2026. Đây là tổng hợp từ mã nguồn hiện tại, không phải số lượng yêu cầu trong một tài khoản cụ thể. Lượt này chưa thay quy tắc hoặc giao diện Chờ tôi duyệt.

## Những luồng đang còn sử dụng

| Loại | Khi nào xuất hiện | Ai xử lý | Đang nằm ở đâu |
| --- | --- | --- | --- |
| Nhận người tính tiền | Một thành viên được đề cử | Chính người được đề cử; phải có ngân hàng | Chi phí buổi chơi và Chờ tôi duyệt |
| Chuyển người tính tiền | Buổi chưa chốt, đã có người tính tiền | Nếu người khác đề nghị: người đang tính tiền đồng ý trước, rồi người mới nhận. Nếu chính người đang tính tiền đề cử: người mới nhận | Chi phí buổi chơi và Chờ tôi duyệt |
| Nhận lại tên khách | Tài khoản email thật yêu cầu liên kết với tên được thêm hộ | Admin nhóm xác minh đúng người và email; giữ mã thành viên/lịch sử cũ | Trang nhóm và Chờ tôi duyệt |
| Xác nhận nhận tiền | Người chuyển đã báo chuyển tiền | Đúng người nhận kiểm tra sao kê rồi xác nhận; admin không mặc nhiên được xác nhận hộ | Thanh toán trong chi tiết buổi, chưa tổng hợp ở Chờ tôi duyệt |
| Thay đổi hệ số | Thành viên đã nhận lời xin đổi hệ số trước khi chốt chi phí | Người tính tiền hiện tại; preview/hash/revision phải còn đúng | Backend vẫn hỗ trợ, AI có thể tạo bản nháp; form đề nghị riêng đã bỏ khỏi chi tiết buổi |
| Bản nháp AI | AI đề xuất thao tác có ghi dữ liệu | Người dùng xác nhận bản nháp T1/T2; thao tác T3 xác nhận trong app theo đúng thẩm quyền, ví dụ xác nhận nhận tiền hoặc người tính tiền sửa hóa đơn đã có khoản thu | Trợ lý 3T và trang bản nháp riêng, chưa đưa vào Chờ tôi duyệt |
| Yêu cầu bật AI cho nhóm | Nhóm xin sử dụng AI, cấu hình provider/key/hạn mức | Super admin | Cài đặt AI, chưa đưa vào Chờ tôi duyệt |

Lưu ý bản nháp AI: gửi đề cử qua AI có thể gồm hai bước khác nhau: xác nhận **gửi đề cử**, sau đó người có quyền **nhận/chuyển vai trò**. Duyệt bản nháp gửi đề nghị không tự thay thế sự đồng ý của người được đề cử.

## Những loại còn trong mã nhưng không nên coi là luồng chính

| Loại | Trạng thái hiện tại |
| --- | --- |
| Xin vào / xin rút khỏi buổi (`join`, `leave`) | Không còn tạo được qua RPC hiện tại; thành viên tự nhận/rút trước khi chốt. Buổi đã chốt khóa danh sách. Nhãn trong ApprovalCard chủ yếu còn để đọc dữ liệu cũ. |
| Đề xuất phụ phí (`expense_proposal`) | Luồng cũ cho người tham gia đề nghị khoản chi. Quyền mới chỉ cho người tính tiền ghi hóa đơn; thành viên thường không còn tạo đề xuất mới bằng đường ghi này. Có thể còn yêu cầu cũ cần xử lý riêng. |
| Admin dự phòng (`admin_fallback`) | Backend còn mã điều kiện/xem trước, nhưng không nằm trong hộp duyệt hiện tại; panel admin của buổi hiện chỉ có mở khóa hóa đơn 24 giờ sau khóa 30 ngày. Các wrapper quyền mới vẫn chặn việc admin tự nhận quyền ghi hóa đơn/thay nominee xác nhận. Không nên thêm quyền dự phòng chung chỉ bằng thay UI. |

Không cần duyệt: tự nhận/rút trước chốt, vote thăm dò, tạo buổi, mời thành viên, người tính tiền nhập/chốt hóa đơn. Chúng vẫn có validation/quyền/xem trước khi cần, nhưng không cần một yêu cầu pending riêng. Đăng ký tài khoản xác minh email cũng không đồng nghĩa đã tham gia nhóm.

## Điểm làm trang Chờ tôi duyệt khó hiểu

1. Hiện trộn yêu cầu **tôi phải duyệt** với **tôi đã gửi đang chờ người khác**; tiêu đề chưa cho biết ngay việc cần làm.
2. Các loại xác nhận thực tế bị chia ở bốn nơi: buổi, nhóm, trang AI và Chờ tôi duyệt. Hộp hiện tại không bao quát hết.
3. Card mang nhiều thông tin kỹ thuật/preview tiền ngay cả khi chỉ nhận vai trò; link buổi chưa ghi tên buổi/nhóm.
4. Nhãn xin vào/rút/đề xuất phụ phí còn tồn tại từ quyền cũ khiến danh sách loại có vẻ nhiều hơn những gì người dùng còn dùng.
5. Thời hạn pending mặc định 72 giờ với yêu cầu buổi/nhận thành viên; bản nháp AI T1/T2 15 phút, T3 72 giờ. Dữ liệu/hash/revision đổi phải xem lại, không thể duyệt cũ.
6. Nút xem trước/từ chối/hủy và thông tin nguồn có thể lấn át câu hỏi chính: ai đang yêu cầu tôi làm gì?

## Đề xuất để chủ sản phẩm chốt

Đề xuất một hộp xử lý có hai mục:

- **Cần tôi xử lý**: nhận/chuyển người tính tiền, xác minh tên khách, và lối mở xác nhận nhận tiền. Bản nháp AI T3 hiện đúng người có quyền; bật AI chỉ xuất hiện với super admin.
- **Tôi đã gửi**: ai đang giữ bước tiếp theo, tên nhóm/buổi và trạng thái chờ/hết hạn/đã xử lý. Không hiển thị nút Duyệt khi chính tôi không có thẩm quyền.

Mỗi dòng nên có: **việc cần làm → người gửi → buổi/nhóm → người đang cần phản hồi → hành động**. Mở dòng mới xem chi tiết/preview và lịch sử, không tải toàn bộ biểu mẫu lên trang đầu.

Các điểm cần bạn quyết định trước khi đổi luồng:

1. Có tiếp tục hỗ trợ đề nghị **hệ số** không, hay chỉ người tính tiền tự điều chỉnh khi soạn phí?
2. Có muốn gom **xác nhận nhận tiền** vào Cần tôi xử lý dưới dạng lối mở thanh toán, hay vẫn chỉ để trong buổi?
3. Có gom **bản nháp AI T3** và **yêu cầu bật AI** vào cùng hộp theo quyền, hay giữ trong mục AI?
4. Có loại bỏ hoàn toàn xin vào/rút và đề xuất phụ phí cũ khỏi hộp, chỉ giữ chúng trong lịch sử?

Phần phân quyền không thay đổi theo đề xuất giao diện: admin không thay người được đề cử nhận vai trò; chỉ người nhận xác nhận nhận tiền; chỉ người tính tiền ghi hóa đơn.

## Nguồn mã đã đối chiếu

- [Trang duyệt](../src/app/approvals/page.tsx), [card duyệt](../src/components/approval-card.tsx), [actions duyệt](../src/app/approvals/actions.ts).
- [Điều khiển người tính tiền](../src/components/session-collector.tsx), [quyền thành viên và đề cử](../supabase/migrations/202611240039_member_scheduling.sql).
- [Nhận tên khách](../supabase/migrations/202611240041_account_onboarding.sql), [review admin](../src/components/member-claim-review.tsx).
- [Thanh toán tại buổi](../src/app/sessions/[id]/page.tsx), [payment service](../src/app/sessions/actions.ts).
- [Bản nháp AI](../src/app/ai/drafts/[id]/page.tsx), [harness tools](../src/lib/ai/harness/draft-tools.ts), [SQL bản nháp](../supabase/migrations/202611220035_ai_drafts.sql).
- [Bật AI](../src/app/ai/settings/page.tsx), [actions cấu hình](../src/app/ai/settings/actions.ts), [panel admin](../src/components/admin-session-panel.tsx).
