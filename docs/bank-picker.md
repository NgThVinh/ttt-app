# Chọn ngân hàng bằng tên

Hồ sơ cá nhân và form ngân hàng của thành viên khách dùng cùng bộ chọn có tìm kiếm. Người dùng chọn theo tên quen thuộc hoặc viết tắt (Vietcombank/VCB, MB/MBBank), hoặc gõ tên không dấu. BIN tương ứng được đưa vào trường ẩn `bank_bin`; schema, quyền ghi và dữ liệu database giữ nguyên.

Danh mục công khai lấy từ [VietQR Banks API](https://www.vietqr.io/api-bank), endpoint `https://api.vietqr.io/v2/banks`, lưu trong `src/data/banks.json`. Danh mục đi cùng app nên tìm kiếm không gọi API, không gửi số tài khoản/tên chủ tài khoản cho VietQR và vẫn dùng được khi API danh mục gián đoạn. `npm run banks:update` tải lại, kiểm tra dữ liệu rồi cập nhật snapshot để review trong Git. Không cần API key. Không dùng `transferSupported` để suy diễn khả năng nhận tiền: tài liệu định nghĩa trường này về app ngân hàng quét QR.

Tên hiển thị/alias được đối chiếu thêm với nguồn chính thức khi danh mục vẫn dùng tên cũ: [BVBank](https://bvbank.net.vn/), [VCBNeo](https://www.vcbneo.com.vn/Pages/About.aspx), [Vikki](https://vikkibank.vn/thong-bao-v-v-donga-bank-doi-ten-thanh-ngan-hang-so-vikki/). Các alias không đổi BIN; cả tên cũ lẫn tên mới đều tìm được. Kết quả ưu tiên mã/tên khớp chính xác, tránh tìm “MB” lại ưu tiên chữ “mb” nằm trong “Vietcombank”.

Mã đã lưu chưa có trong danh mục vẫn được hiển thị thành “Ngân hàng đã lưu (…)” và có thể lưu lại nguyên trạng. Gõ tự do mà chưa chọn không được coi là lựa chọn hợp lệ. Escape hủy lượt tìm và trả về ngân hàng vừa chọn; phím lên/xuống và Enter chọn từ danh sách. Tên ngân hàng cũng được hiển thị trên phần thông tin nhận thanh toán, thay cho nhãn BIN.

Dropdown được đưa ra portal, giới hạn trong vùng nội dung và viewport, có vùng cuộn riêng cho danh sách ngân hàng. Hỗ trợ bàn phím, cảm ứng và reduced motion; dùng recipe menu dropdown của skill `transitions-dev`.

`npm run test:auth-ui` kiểm tra mã cũ chưa nhận diện, không lưu tên gõ dở, tìm không dấu/viết tắt, MB không bị chọn nhầm, lưu và tải lại, ngân hàng thành viên khách, cảm ứng, dark mode và 320/390/1440px. Browser chặn API danh mục nhưng bộ chọn vẫn hoạt động. Chỉ dùng tài khoản/dữ liệu Supabase local. `npm run local:clean -- --apply` dọn các fixture sau kiểm thử.
