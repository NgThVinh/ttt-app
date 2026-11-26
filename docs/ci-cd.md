# CI/CD production

Push lên `main` chạy `.github/workflows/check.yml`. Pull request chỉ chạy kiểm thử, không có credential production. Có thể chạy lại qua GitHub → Actions → **CI and production** → Run workflow trên `main`.

Luồng tự động:

1. Typecheck, lint, unit/database tests, concurrency, production build, secret scan và PWA.
2. Bỏ qua commit nếu đã có commit `main` mới hơn.
3. Build Vercel ở môi trường production với `--skip-domain`. Dùng lại cấu hình runtime hiện có trên Vercel.
4. Áp dụng migration còn thiếu trong một transaction có advisory lock; kiểm tra đúng Supabase project, TLS, checksum và RLS. Kiểm tra lại schema/RPC cần cho giao diện.
5. Promote đúng deployment vừa build, đối chiếu domain với deployment ID và kiểm tra HTTP.

Vercel Git auto-deploy được tắt bằng `vercel.json`; GitHub Actions là nơi phát hành. Các lần chạy `main` được tuần tự hóa và không tự hủy khi có push mới. Build hoặc migration lỗi sẽ dừng trước bước chuyển domain. Nếu lỗi sau khi migration đã commit, giữ schema đã cập nhật; không tự chạy down-migration. Viết migration tương thích với bản đang phục vụ theo cách thêm trước, bỏ sau.

## Cấu hình một lần

GitHub repository `NgThVinh/ttt-app` cần Environment **production**, chỉ cho nhánh `main`, không yêu cầu duyệt thủ công để chạy hoàn toàn tự động.

Environment secrets:

| Tên | Giá trị |
| --- | --- |
| `SUPABASE_DB_URL` | URI **Session pooler**, port **5432**, của project production. Không dùng direct IPv6 hoặc transaction pooler port 6543. |
| `VERCEL_TOKEN` | Token CI riêng, giới hạn project/team phù hợp; theo dõi ngày hết hạn và thay secret khi gia hạn. |

Repository variables (không phải secret):

| Tên | Giá trị |
| --- | --- |
| `VERCEL_ORG_ID` | `team_IROfIIhBInDgzEyuZshIBolX` |
| `VERCEL_PROJECT_ID` | `prj_SHWPKZTF6Sdb0q3yG4d7OT1uathG` |
| `PRODUCTION_APP_URL` | `https://thichtinhtien.online` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://ubkfdlxrtsnuxjezopht.supabase.co` |

Lấy URI pooler từ Supabase → Connect → **Session pooler**, điền mật khẩu database. Nếu nhập qua máy này, đặt `SUPABASE_CI_DB_URL` và `VERCEL_TOKEN` trong `.env` (không dán vào chat); công cụ thiết lập có thể gửi qua stdin tới GitHub encrypted secrets. Không đưa chúng vào Git hoặc Vercel runtime. Credential database chỉ được cấp cho bước migration/schema check; token Vercel chỉ cấp cho các bước deploy. Build/test PR không nhận các secret này.

CLI Vercel cố định `66.6.0`, GitHub Actions cố định commit SHA, Node 24. Không tải toàn bộ env runtime về CI. Smoke check chỉ đọc metadata schema và hai URL công khai; không tạo tài khoản, dữ liệu nghiệp vụ hay gọi AI.

## Viết migration

Thêm file SQL mới trong `supabase/migrations` với version lớn hơn version đã phát hành; không sửa hoặc đổi tên file đã áp dụng. Công cụ từ chối version trùng, thiếu lịch sử, chèn version cũ và thay đổi nội dung SQL. Checksum bỏ khác biệt BOM/CRLF/LF giữa Windows và Linux. Với file lịch sử có xuống dòng trộn, chỉ chuẩn hóa checksum sau khi chứng minh SQL đã lưu và SQL trong Git tương đương; không bỏ qua kiểm tra nội dung.

SQL migration được kiểm tra trong database riêng qua `npm test` và `npm run test:concurrency`. Không chạy test ghi dữ liệu vào Supabase production cho mỗi push. Tiến trình không sao lưu hoặc xuất dữ liệu production về máy/CI.

## Nguồn

- [Vercel Git deploymentEnabled](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled).
- [Vercel với GitHub Actions](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel).
- [GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments).
- [Supabase về IPv4 trên GitHub-hosted runner và Session pooler](https://supabase.com/docs/guides/deployment/ci/backups). Chỉ áp dụng hướng dẫn kết nối; pipeline này không thực hiện backup.
