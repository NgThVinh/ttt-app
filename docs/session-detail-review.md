# Review UI/UX chi tiết buổi chơi — 25/11/2026

## Kết luận thiết kế

Trang cần phục vụ hai nhu cầu: xem nhanh tình hình buổi chơi và thực hiện một thao tác cụ thể. Bản rút gọn trước đã giảm chiều dài, nhưng vẫn để form nhập tiền và QR chiếm phần lớn màn hình. Người dùng vào xem lịch phải đi qua các công cụ làm việc.

Thiết kế hiện tại ưu tiên **thông tin đủ để hiểu buổi chơi ngay khi mở trang**: ngày giờ, địa điểm, lựa chọn cá nhân, ai tham gia, các khoản phí và trạng thái thanh toán. Nhập/chốt phí và thực hiện thanh toán mở trong cửa sổ riêng tại đúng khu vực.

## Những vấn đề quan trọng đã xử lý

| Ưu tiên | Vấn đề quan sát được                                                   | Tác động                                                                   | Thay đổi                                                                                           |
| ------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P1      | Người tính tiền thấy ngay cả form nhập phí trước danh sách người       | Chỉ vào xem lịch cũng phải cuộn qua công cụ nhập liệu                      | Tổng quan người tham gia hiện trước; nút “Nhập phí và chốt buổi” mở form trong cửa sổ              |
| P1      | QR lớn nằm giữa luồng đọc                                              | Người chuyển tiền không thấy tình hình buổi và bảng phí trong màn hình đầu | Thẻ cá nhân hiện người nhận, số tiền và trạng thái; “Thanh toán” mở QR/ngân hàng/copy/báo chuyển   |
| P1      | Nút “Tôi đã chuyển” xuất hiện trước thông tin chuyển khoản             | Thứ tự trình bày khuyến khích xác nhận quá sớm                             | Trong cửa sổ thanh toán, ngân hàng, QR và nội dung chuyển xuất hiện trước nút báo chuyển           |
| P2      | Nhiều khối chữ lặp khi chỉ có một khoản phí                            | Khó đối chiếu tiền của mình với tổng hóa đơn                               | Bảng Khoản phí / Tổng / Phần bạn; chỉ thêm dòng tổng khi có nhiều khoản                            |
| P2      | Cắt danh sách sau tám tên, kể cả ở desktop còn chỗ                     | Phải bấm chỉ để biết đủ ai tham gia                                        | Hiện đầy đủ tên theo nhóm trạng thái; tên dài xuống dòng, không có khung cuộn riêng                |
| P2      | Tiến độ thanh toán toàn nhóm nằm trong thẻ cá nhân của mọi người       | Dễ nhầm việc của mình với tình hình thu tiền chung                         | Tiến độ chung dành cho người tính tiền; thành viên thấy nghĩa vụ và trạng thái của mình            |
| P2      | Toolbar phụ dùng vị trí tuyệt đối, thông tin ngày thiếu điểm nhận diện | Bố cục dễ lệch và khó quét nhanh                                           | Hàng quay lại/công cụ dùng flex; ô ngày nhỏ làm điểm nhận diện, lịch và địa điểm vẫn hiện bằng chữ |
| P2      | Danh sách khoản của người khác nằm ngay trong thẻ cá nhân              | Chiếm chỗ của nội dung chính                                               | Đưa xuống cuối tổng quan, mở khi cần tra cứu                                                       |

## Cấu trúc màn hình hiện tại

- **Đầu trang:** quay lại và công cụ phụ; ngày, tên buổi, trạng thái, đếm ngược, giờ/địa điểm và ghi chú ngắn. Sửa vẫn ngay trong khu vực thông tin.
- **Trước buổi:** lựa chọn cá nhân và đủ tên người đã nhận lời/đang chờ/không đi; người tính tiền và trạng thái chi phí. Form chốt mở có chủ đích.
- **Sau buổi trên điện thoại:** trạng thái và số tiền cá nhân trước, rồi người tham gia và bảng phí. Nếu chỉ có một khoản phải chuyển, số tiền và người nhận chỉ xuất hiện một lần trong thẻ.
- **Desktop:** người tham gia và bảng phí ở cột chính, thanh toán cá nhân ở cột bên. Các khoản của người khác nằm cuối.
- **Cửa sổ thao tác:** có tiêu đề, nút đóng, focus nằm trong dialog, Escape và trả focus. Form giữ dữ liệu khi đóng/mở lại. Nội dung dài cuộn trong cửa sổ, nền bị khóa cuộn. Dùng recipe modal hiện có của transitions-dev và hỗ trợ reduced motion.
- **Người nhận tiền:** các khoản đã báo chuyển cần xác nhận vẫn hiện trực tiếp. Khoản chưa báo và khoản đã hoàn tất có tổng quan rồi mới mở chi tiết.

Các thao tác chuyển tiền/chốt hóa đơn vẫn cần hành động chủ động. Không tự báo đã chuyển, tự xác nhận nhận tiền hoặc bỏ bước xem bảng chia để giảm lượt bấm.

## Đối chiếu với bản vừa review trước đó

Fixture 12 người, điện thoại 390 × 844. Vùng nội dung khả dụng kết thúc ở khoảng 775px. Số đo là tọa độ đáy khối từ mép trên màn hình.

| Tình huống                                              |            Bản trước |               Hiện tại |
| ------------------------------------------------------- | -------------------: | ---------------------: |
| Đáy danh sách người khi người tính tiền xem trước buổi  |                949px |                  486px |
| Đáy tổng quan chi phí trước buổi của người tính tiền    |   740px, kèm form mở | 652px, form mở khi cần |
| Đáy danh sách đủ 12 người khi thành viên cần thanh toán | 1.182px, còn cắt tên |          543px, đủ tên |
| Đáy khu vực chi phí khi thành viên cần thanh toán       |              1.001px |                  755px |

Thành viên trước buổi, người tính tiền trước buổi, thành viên cần chuyển tiền và thành viên đã trả đều thấy các thông tin chính trong màn hình đầu ở fixture này. Desktop 1440 × 960 hiển thị tổng quan của cả người chuyển và người nhận trong một màn hình.

**Giới hạn còn lại:** trên điện thoại, người thu nhiều khoản vẫn có thể cần cuộn để xem trọn khu vực chi phí và thao tác điều chỉnh. Hóa đơn nhiều khoản, tên dài, nhóm đông và nhiều khoản chờ xác nhận cũng cần cuộn. Không dùng chữ nhỏ hơn hoặc giấu tên để cố đạt một màn hình ở mọi tình huống. Chưa có số liệu sử dụng thực tế để khẳng định tỷ lệ người dùng không cần cuộn.

## Kiểm chứng

- `test:session-focus`: hai vai trò, 12 người, các trạng thái trước buổi/đang thu/đã trả; kiểm tra thông tin trong viewport, đủ tên, số tiền có độ nổi bật, dialog căn giữa, Escape/trả focus, giữ bản nháp khi đóng/mở, khóa cuộn nền, reduced motion, dark mode và độ rộng 320/390/768/1440px.
- `test:session-workspace`: sửa/lưu buổi, dropdown mời, đồng ý đề cử người tính tiền, phụ phí/giảm giá và bảng chia khớp dữ liệu lưu, khóa sau chốt, lịch sử phân trang và bàn phím.
- `test:meeting-ui`: tạo lịch, mời, nhận lời/rút, rollback khi lỗi mạng, nhận vai trò tính tiền, chốt và khóa.
- `test:payment-ui`: upload ảnh riêng tư, sao chép khi QR lỗi, gửi lại sau phản hồi thất lạc không trùng, xác nhận đợi server, hoàn tiền và quyền xem bằng chứng lịch sử.
- 245 test qua, một test provider thật bỏ qua; typecheck, lint và production build qua. Không gọi LLM.
- Đã mở buổi hiện có trên localhost:3000 ở 390/1440px bằng vai An. So sánh trước/sau khởi động xác nhận ID, tên, địa điểm và revision của buổi nhập tay giữ nguyên, không sinh buổi mẫu trùng.

Trong lúc kiểm tra đã sửa lỗi khởi động local: setup tìm buổi theo tên cố định nên buổi đã đổi tên bị coi là chưa khởi tạo. Setup hiện giữ nguyên nhóm đã có buổi, khóa đồng thời bước seed và dùng request key mới khi thực sự cần tạo buổi mẫu trong nhóm trống.

Ảnh và số đo ở `.tools/session-focus/`: `v1-after-payer-390.png` lưu bản trước; `after-payer-390.png`, `after-planned-collector-390.png`, `after-payment-task-390.png` và `after-metrics.json` là bản mới. Đây là artifact local, không commit ảnh. Chạy lại bằng `npm run test:session-focus`.

Test bố cục thay ảnh QR bằng icon local để tránh phụ thuộc mạng; ảnh đó **không phải QR ngân hàng thật**. Chưa kiểm tra trên thiết bị vật lý/người dùng thật trong đợt này.

Thay đổi thuộc giao diện và bộ kiểm thử; không thêm migration hay thay quy tắc tiền/quyền. Dữ liệu fixture được dọn có backup, giữ dữ liệu nhập tay của nhóm mẫu. Chưa deploy production.
