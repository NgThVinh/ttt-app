# Lịch, danh sách thành viên và vùng cuộn

## Trạng thái trên lịch

Lịch tháng và lịch tuần dùng chung dữ liệu và ký hiệu:

| Ký hiệu     | Ý nghĩa      | Nguồn dữ liệu                                                          |
| ----------- | ------------ | ---------------------------------------------------------------------- |
| ✓ Xanh ngọc | Bạn tham gia | Chính người dùng đã nhận lời, có `committed_at`, chưa bị rút khỏi buổi |
| ■ Xanh lam  | Lịch đã chốt | Thăm dò đã chốt thành buổi, hoặc buổi đã chốt chi phí/thu đủ           |
| ◆ Hổ phách  | Đang vote    | Thăm dò còn mở và chưa đến hạn trả lời theo thời gian server           |
| • Xám       | Lịch dự kiến | Buổi đã tạo và chưa có trạng thái chốt ở trên                          |

Một ngày có thể mang nhiều ký hiệu. Viền chọn ngày độc lập với màu trạng thái. Buổi hủy không tạo dấu trạng thái. Các khung giờ cùng ngày trong một thăm dò chỉ tính một dấu vote; danh sách vẫn hiện từng khung giờ để chọn. Ngày được tính theo giờ Việt Nam.

Lịch đã chốt từ thăm dò vẫn cần từng người tự nhận lời. Quy tắc khóa lịch/tham gia sau khi người tính tiền chốt chi phí giữ nguyên.

Tên người đi và người chờ lấy bằng JWT hiện tại qua RLS, cùng tập bản ghi dùng để tính số lượng. Người đã rút không vào hai danh sách; người chưa tự chốt không được tính là đã nhận lời. Nhóm đã rời không xuất hiện trong kết quả đọc.

## Quyền sở hữu vùng cuộn

| Vùng                                                         | Cách cuộn                                                                                                                                          |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document và khung ứng dụng đã đăng nhập                      | Không cuộn dọc; khung cao bằng viewport, thanh điều hướng và header giữ vị trí                                                                     |
| Trang chủ, công nợ, chi tiết, form tạo buổi và các trang dài | Một vùng cuộn dọc tại `#main-content` / `data-scroll="workspace"`                                                                                  |
| Trang Buổi chơi, cả lịch và danh sách                        | Chỉ danh sách `.agenda-items` / `data-scroll="agenda"` cuộn; tiêu đề, bộ đổi chế độ, lịch và chú giải giữ vị trí                                   |
| Lịch tháng trên desktop thấp                                 | Chỉ cuộn khung lịch nếu chiều cao thực tế không chứa đủ; không kéo document theo                                                                   |
| Lịch tháng mở trên điện thoại                                | Lớp nổi phía trên danh sách, không đẩy cả trang dài ra; chỉ cuộn nếu viewport quá thấp. Chọn ngày/Escape/chạm ra ngoài đóng lớp nổi                |
| Danh sách chọn thành viên, `.participant-list`               | Cuộn khi vượt giới hạn chiều cao, giữ các trường form ở ngoài danh sách                                                                            |
| Danh sách buổi cùng ngày ở cạnh form                         | Cuộn riêng khi dài, không kéo vùng form theo ở cuối danh sách                                                                                      |
| Bảng công nợ và các bảng dữ liệu                             | Cuộn ngang khi cần. Không có giới hạn 420px/cuộn dọc riêng; chiều dọc dùng workspace                                                               |
| Bảng xem trước chia tiền                                     | Hiện toàn bộ theo chiều dọc của workspace, không có lớp cuộn 230px bên trong                                                                       |
| Tên người đi/chờ                                             | Hover hoặc focus để xem, chạm để mở trên điện thoại; đưa ra portal để không bị cắt bởi danh sách. Chỉ bảng tên dài hơn viewport mới cuộn bên trong |
| Sidebar trên màn hình thấp                                   | Cuộn phần điều hướng khi cần, không cuộn cùng nội dung trang                                                                                       |
| Trang ngoài khung ứng dụng (đăng nhập/chờ lời mời)           | Document là vùng cuộn nếu nội dung vượt màn hình; trang chờ vẫn yêu cầu đăng nhập                                                                  |

Các vùng độc lập dùng `overscroll-behavior` để không kéo vùng cha khi chạm cuối. Điều hướng sang trang khác đưa workspace về đầu; cập nhật dữ liệu tại cùng URL không đặt lại vị trí. Danh sách và bảng có tên vùng và hỗ trợ focus bằng bàn phím. Bảng tên đóng bằng Escape, chạm ra ngoài hoặc cuộn vùng chứa; vẫn mở khi di chuyển chuột từ số lượng sang bảng tên.

## Kiểm chứng

Bộ chọn ngân hàng ở hồ sơ/ngân hàng khách có dropdown nổi giới hạn trong workspace và viewport. Chỉ danh sách ngân hàng cuộn bên trong, không kéo vùng hồ sơ hoặc document theo; xem [bộ chọn ngân hàng](bank-picker.md).

`npm run test:calendar-ux` dùng Auth và database Supabase local, không gọi LLM. Kiểm tra dấu cá nhân/chốt/vote, loại thăm dò hết hạn và nhóm đã rời, lọc theo ngày, tên người đi/chờ, hover/focus/chạm, Escape, danh sách 30 người, reduced motion, vùng cuộn độc lập và lịch tháng điện thoại. Có ảnh tại `.tools/calendar-ux/`.

Browser Chromium đã kiểm tra desktop 1440×900, điện thoại 390×844 và viewport thấp 360×600. Cần kiểm tra thêm trên thiết bị iOS/Android thật.
