# Review UI/UX trang chi tiết buổi chơi

## Đánh giá

Trang trước đây chưa có thứ tự ưu tiên rõ ràng: thông tin lịch, công cụ quản lý, danh sách người và thanh toán đều chiếm nhiều diện tích. Thành viên phải cuộn qua phần không liên quan để tìm việc của mình. Giảm khoảng cách đơn thuần không giải quyết được vấn đề này; bố cục cần thay đổi theo vai trò và trạng thái buổi.

Mục tiêu của lần chỉnh sửa này là để người dùng trả lời ngay: **buổi nào, khi nào, ở đâu, ai tham gia và tôi có việc gì cần làm?** Thao tác sửa, lịch sử và dữ liệu thanh toán đã hoàn tất vẫn có chỗ truy cập riêng.

## Các thay đổi đã triển khai

| Khu vực                    | Vấn đề trước đây                                       | Cách xử lý                                                                                                                                    |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Đầu trang                  | Khung lớn, hàng nút chiếm chỗ, đẩy nội dung xuống      | Bỏ khung lớn; ngày giờ rõ; trạng thái và đếm ngược ngắn; công cụ sửa/lịch sử/chia sẻ ở hàng quay lại, có tên truy cập và tooltip              |
| Người tham gia             | Nhiều chip lặp, lựa chọn cá nhân và danh sách khó quét | Một hàng lựa chọn của bạn; tên theo nhóm đã nhận lời/đang chờ/không đi; mời thêm trong dropdown                                               |
| Chi phí trước buổi         | Form và hướng dẫn dài dù chưa cần dùng                 | Thành viên thấy người tính tiền và trạng thái hóa đơn; người tính tiền thấy ngay form phí; đổi/đề cử nằm trong phần mở rộng                   |
| Bảng chia                  | Mỗi người một hàng dù số tiền bằng nhau                | Nhóm các tên có cùng phần tiền, hiển thị số tiền mỗi người; vẫn giữ đủ tên và các mức chia khác nhau                                          |
| Thanh toán                 | Mọi khoản ngang hàng, khoản của mình có thể nằm cuối   | Số tiền cần chuyển/nhận và khoản của bạn lên đầu; người nhận thấy khoản đã báo chuyển trước; không bù trừ khoản phải chuyển với khoản sẽ nhận |
| Khoản chưa báo/đã hoàn tất | Chiếm chiều dài mặc định                               | Hiện tổng quan và tên người đang chờ; chi tiết từng khoản và lịch sử đã nhận mở khi cần                                                       |
| QR                         | Ảnh lớn đẩy nút xuống dưới                             | QR gọn cạnh nút sao chép; nút báo chuyển hiện trước QR; giữ thông tin ngân hàng và cách sao chép khi ảnh lỗi                                  |
| Desktop                    | Nội dung xếp dọc dù còn nhiều chiều ngang              | Hai cột; trước buổi là người tham gia/chi phí, sau buổi là thanh toán/chi phí và người tham gia                                               |

Trên điện thoại, thứ tự cũng theo vai trò: thành viên xem người tham gia trước, người tính tiền xem form chi phí trước. Buổi đang diễn ra/chờ chốt chi phí không còn mang nhãn “Sắp tới”.

## Số đo trước/sau

Fixture 12 người, điện thoại 390 × 844, trình duyệt Chromium, cùng khung điều hướng. Các số dưới đây là tọa độ đáy khối tính từ mép trên màn hình, không phải chiều cao riêng của khối. Vùng nội dung khả dụng kết thúc ở khoảng 775px do thanh điều hướng dưới.

| Tình huống                             |   Trước |   Sau | Ý nghĩa                                                                                         |
| -------------------------------------- | ------: | ----: | ----------------------------------------------------------------------------------------------- |
| Đáy phần thông tin trước buổi          |   459px | 278px | Lịch, địa điểm và nội dung chính xuất hiện sớm hơn                                              |
| Đáy danh sách người, thành viên thường |   977px | 487px | Cả lựa chọn cá nhân và hai nhóm tên đều trong màn hình đầu                                      |
| Đáy phần chi phí, thành viên thường    | 1.364px | 636px | Xem trọn tổng quan trước buổi, không cần cuộn                                                   |
| Đáy form chốt phí, người tính tiền     | 1.646px | 740px | Với một khoản tiền sân và 6 người đã nhận lời, nút xem bảng chia và chốt nằm trong màn hình đầu |
| Điểm bắt đầu phần thanh toán           |   490px | 254px | Khoản của mình và thao tác báo chuyển được ưu tiên                                              |

Ở desktop 1.440 × 960, cả bốn tình huống chính — thành viên/người tính tiền trước buổi và người chuyển/người nhận sau buổi — vừa trong vùng nội dung của màn hình đầu ở fixture này.

Không áp dụng mục tiêu “không cuộn” một cách tuyệt đối: nhiều phụ phí, tên dài, nhóm đông hoặc nhiều khoản chờ xác nhận vẫn cần cuộn. Từ người thứ 9 trong một nhóm trạng thái có nút mở rộng tên. Sửa buổi, xem lịch sử và gửi bằng chứng là thao tác có chủ đích, không tự mở mặc định. Nội dung chính cuộn trong vùng ứng dụng; chỉ dropdown và popup lịch sử có vùng cuộn riêng khi cần.

## Kiểm chứng

- `npm run test:session-focus`: tài khoản Supabase local thực, hai vai trò và 12 người; ảnh trước/sau, thanh toán cá nhân, khoản chờ người nhận xác nhận, trạng thái đã trả, độ rộng 320/390/768/1440px, dark mode, reduced motion và bàn phím.
- `npm run test:session-workspace`: sửa/lưu trực tiếp, dropdown mời, đồng ý đề cử người tính tiền, phụ phí/giảm giá và bảng chia khớp dữ liệu đã lưu, khóa sau chốt, lịch sử phân trang và trả focus.
- `npm run test:meeting-ui`: tạo lịch, mời thành viên, nhận lời/rút, rollback khi lỗi mạng, nhận vai trò tính tiền và khóa sau chốt.
- `npm run test:payment-ui`: báo chuyển lại sau phản hồi thất lạc không tạo trùng, xác nhận đợi server, upload ảnh riêng tư, hoàn tiền và quyền xem bằng chứng lịch sử.
- 245 test tự động qua, một test provider thật bỏ qua; typecheck, lint và production build qua. Các lượt kiểm tra này không gọi LLM.

Ảnh và số đo nằm trong `.tools/session-focus/`; chạy lại bằng `npm run test:session-focus`. Test bố cục QR chặn request ảnh và thay bằng icon local để đo diện tích, **không phải kiểm thử mã QR ngân hàng thật**. Luồng sao chép khi ảnh lỗi được kiểm tra riêng trong bộ thanh toán. Chưa nghiệm thu bằng thiết bị vật lý hay người dùng thật trong đợt này.

Các thay đổi là giao diện và bộ kiểm thử local; không thêm migration, không thay quyền hoặc quy tắc tính tiền, chưa deploy production. Dữ liệu fixture được dọn qua `local:clean` với backup, giữ dữ liệu người dùng trong nhóm mẫu.
