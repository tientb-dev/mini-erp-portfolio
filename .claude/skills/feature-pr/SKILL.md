---
name: feature-pr
description: Quy trình phát triển một tính năng/sửa lỗi Mini ERP theo Pull Request - preflight Git và secrets, feature branch, implement theo tài liệu nghiệp vụ, test (API/UI/PostgreSQL), build, self-review, commit Conventional Commits, soạn PR description và báo cáo. Dùng khi người dùng gọi /feature-pr hoặc yêu cầu implement một thay đổi code.
argument-hint: "<mô tả tính năng hoặc lỗi>"
---

# /feature-pr

Yêu cầu: `$ARGUMENTS`. Trao đổi bằng tiếng Việt. Tuân thủ CLAUDE.md.

**Cổng đồng ý:** commit, push, tạo PR online (`gh pr create`), merge — mỗi việc cần người dùng đồng ý rõ ràng trong phiên này. Không bao giờ `--force`, `--no-verify`, `reset --hard`, `checkout -- .`, `clean`.

## 1. Preflight
- `git status --short`, `git branch --show-current`, `git log --oneline -5`.
- Có thay đổi chưa commit không thuộc task → dừng, báo người dùng (stash/commit/bỏ qua?). Không ghi đè.
- Repo chưa có baseline commit chứa code → báo rõ, đề xuất commit baseline riêng (sau khi người dùng đồng ý), không tự làm.
- Secrets: `git check-ignore .env` phải khớp; quét diff/file mới tìm `password=`, `secret`, `token`, `BEGIN .*PRIVATE KEY`, connection string có mật khẩu. Chỉ `.env.example` (giá trị giả) được commit.

## 2. Feature branch
- Từ `main` mới nhất: `git switch -c <type>/<mo-ta-ngan>` (`feat|fix|refactor|docs|test|chore`).

## 3. Implement
- Đọc trước phần liên quan: `docs/01-MVP-SCOPE.md`, `02-BUSINESS-FLOWS.md`, `03-BUSINESS-RULES.md`, `04-PERMISSIONS.md`, `05-ACCEPTANCE-TESTS.md`, ADR trong `docs/architecture/decisions/`, `OPEN-QUESTIONS.md`.
- Mục "Cần làm rõ"/"Chưa chốt" → hỏi, hoặc ghi giả định vào `OPEN-QUESTIONS.md` §3. Không mở rộng phạm vi MVP.
- Tôn trọng quy tắc kiến trúc trong CLAUDE.md (facade, transaction, khóa, migration, RFC 9457, i18n).

## 4. Test & build
- Unit test domain; API test cả quyền (loại chứng từ + phạm vi kho); integration test PostgreSQL thật (`pnpm db:up`, `pnpm migrate`) cho hạn mức/tồn kho/SN/đồng thời; UI test vitest; tham chiếu acceptance ID docs/05.
- Chạy `pnpm test` và `pnpm build`. Fail → sửa, không bỏ qua. Báo output thật.

## 5. Self-review
- `git diff main...HEAD` + `git status`: không file thừa, không debug code, không secrets, không `any` thiếu giải thích.
- Regression: grep caller của mọi hàm/endpoint đã đổi; chạy lại test module lân cận.

## 6. Commit (sau khi được đồng ý)
- Conventional Commits tiếng Anh: `feat(inventory): ...`, `fix(gir): ...`. Mỗi commit một ý; `git add` theo đường dẫn cụ thể, không `git add -A` mù.

## 7. PR description
- Điền `.github/pull_request_template.md` → lưu nháp ra scratchpad hoặc in ra cho người dùng. Chỉ `git push -u` / `gh pr create --body-file` khi được đồng ý.

## 8. Báo cáo
- Branch, commit(s), file chính đã đổi, kết quả test/build (số pass/fail), giả định đã ghi, rủi ro, bước tiếp theo cần người dùng quyết định (commit/push/PR).
