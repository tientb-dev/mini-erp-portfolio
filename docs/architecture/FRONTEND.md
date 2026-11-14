# Kiến trúc Frontend (`apps/web`)

React 19 + TypeScript + Vite + MUI 9 + MUI X Data Grid + TanStack Query + `react-i18next`. Một SPA, điều hướng bằng state trong `AppShell` (chưa có React Router — xem `shortcut:` trong [AppShell.tsx](../../apps/web/src/app/layouts/AppShell.tsx)).

## 1. Cấu trúc thư mục

```text
apps/web/src/
├── main.tsx                  # entry duy nhất ở root: QueryClient + i18n + <App/>
├── app/                      # ghép ứng dụng; không chứa nghiệp vụ
│   ├── App.tsx               # theme theo ngôn ngữ, Login ↔ AppShell
│   ├── routes.ts             # PAGES (trang + quyền VIEW) và NAV (nhóm sidebar)
│   └── layouts/AppShell.tsx  # AppBar, sidebar theo quyền, NavContext
├── config/                   # i18n.ts (vi/en), theme.ts (tokens, statusTones)
├── services/api-client.ts    # HTTP client duy nhất: base URL, token, ApiError (RFC 9457 code)
├── shared/                   # không biết nghiệp vụ
│   ├── components/           # PageHeader, StatusChip, ErrorAlert, DataTable, FormDialog, Field,
│   │                         # ListPageLayout, DetailPageLayout, DetailTabs (+ index.ts)
│   ├── navigation.ts         # NavContext: mở trang khác trên một chứng từ
│   └── utils/format.ts       # fmtDate, num
├── features/<feature>/       # một thư mục cho mỗi module nghiệp vụ backend
│   ├── index.ts              # public API của feature — nơi DUY NHẤT feature khác/app được import
│   ├── *Page.tsx, *DetailView.tsx, Create*Dialog.tsx
│   ├── types.ts, api.ts      # khi có nhiều file cùng dùng
│   └── *.test.tsx            # test đặt cạnh code
└── test/
    ├── setup.ts              # nạp i18n, cleanup + restoreAllMocks sau mỗi test
    ├── helpers/api.tsx       # wrap (QueryClient), mockApi (fetch giả theo path), me(permissions)
    └── architecture.test.ts  # kiểm tra quy tắc phụ thuộc (§3)
```

Features hiện có (khớp module backend, ARCHITECTURE §2):

| Feature | Nội dung | Public API (`index.ts`) |
|---|---|---|
| `identity` | Login, `useMe` | `Login`, `useMe`, `Me` |
| `workflow` | Hộp thoại Gửi duyệt/Duyệt/Từ chối/Thu hồi/Hủy/Hoàn thành, lịch sử | `DocActionDialog`, `HistoryList`, `DocAction`, `HistoryEntry`, `Person` |
| `master-data` | Product, Warehouse, Khách hàng, NCC | các `*Page`, `Product`, `Uom`, `Warehouse` |
| `sales-contracts` | HĐ + đề xuất/xác nhận Product | `SalesContractsPage` |
| `procurement` | PR, PO, GRR (dùng chung `DocListPage`/`DocDetailView` + cấu hình) | 3 `*Page` |
| `inbound` | GR | `GoodsReceiptsPage` |
| `outbound` | GIR, GI | `GoodsIssueRequestsPage`, `GoodsIssuesPage` |
| `inventory` | Tồn kho, truy vết lô | `InventoryPage`, `InventoryLotsPage` |

**Khác định hướng ban đầu và lý do:** không tạo `shared/hooks`, `shared/types`, `shared/constants`, `services/auth.ts` (chưa có nội dung dùng chung thật; token nằm trong `api-client.ts` cùng chỗ đọc nó); GRR nằm trong `procurement` vì đang dùng chung list/detail với PR/PO (backend: GRR thuộc Inbound) — tách khi màn hình GRR khác biệt; `useMe` thuộc `identity` thay vì `shared/hooks` vì nó gọi API `/auth/me`.

## 2. Quy tắc tổ chức

- Component chỉ một feature dùng → để trong feature đó (vd. `outbound/ExecutionChip.tsx`, `procurement/SourceLines.tsx`).
- `shared/` chỉ nhận thứ **không phụ thuộc nghiệp vụ** và có ≥ 2 nơi dùng. Không đưa trạng thái/workflow cụ thể (vd. `ApprovalStatusChip` chỉ map `approval_status` chung → tone; chip trạng thái riêng như `ScStatusChip` ở lại feature).
- Gọi API: luôn qua `api()` của `services/api-client.ts`; endpoint nghiệp vụ nằm trong feature. Mutation/lỗi hiển thị bằng `ErrorAlert` (map `errors.<code>` của i18n).
- Quy tắc nghiệp vụ (hạn mức, quyền) do server quyết định; UI chỉ ẩn/disable thao tác theo `useMe().permissions` và trạng thái.
- Không tạo file tổng hợp lớn; một file ~≤ 250 dòng, một component chính.

## 3. Quy tắc phụ thuộc (được kiểm tra bởi `src/test/architecture.test.ts`, chạy trong `pnpm test`)

1. `shared/`, `services/`, `config/` **không** import `features/` hoặc `app/`.
2. Chỉ `main.tsx` import `app/`.
3. Feature khác (và `app/`) chỉ import một feature qua `features/<x>` (tức `index.ts`), không import file nội bộ.
4. Không có import vòng (kể cả trong một feature).
5. Root `src/` chỉ có `main.tsx`.

Hướng cho phép: `app → features → (features khác qua index) → shared/services/config`. `tsconfig` bật `noUnusedLocals` để không còn import/biến chết.

## 4. Đặt tên file

- Component: `PascalCase.tsx` theo tên export chính (`DocDetailView.tsx`, `CreateGrrDialog.tsx`); trang danh sách `XxxPage.tsx`.
- Không phải component: `kebab-case.ts`/`camelCase` ngắn (`types.ts`, `api.ts`, `format.ts`, `api-client.ts`).
- Test: `<feature>.test.tsx` cạnh code; test shared: `shared/components/components.test.tsx`.

## 5. Thêm một feature mới

1. Tạo `src/features/<ten-feature>/` với `XxxPage.tsx` và `index.ts` export trang.
2. Khai báo trang + quyền VIEW trong `app/routes.ts` (`PAGES`) và nhóm sidebar (`NAV`); thêm `nav.<key>` vào `config/i18n.ts` (vi + en).
3. Dùng `ListPageLayout` cho danh sách, `DetailPageLayout` + `DetailTabs` cho chi tiết, `FormDialog` cho form.
4. Cần thứ của feature khác → export nó trong `index.ts` của feature đó, import từ `../<feature>`.
5. Viết `<feature>.test.tsx` với `wrap`/`mockApi`/`me` từ `test/helpers/api`.

## 6. Shared UI

| Component | Dùng khi | Ví dụ thật |
|---|---|---|
| `ListPageLayout` | Trang danh sách: `title`, `actions` (header), `toolbar` (tìm kiếm/lọc do feature tự làm), `error`, `children` (bảng) | `procurement/DocListPage.tsx`, `master-data/ProductsPage.tsx` |
| `DataTable` | Bảng: DataGrid compact, sort/phân trang/empty/loading sẵn; `emptyHint` | mọi trang |
| `DetailPageLayout` | Chi tiết chứng từ: `title` + `documentNumber`, `status`, `actions`, `notice`; `loading` → thanh tiến trình, `error` khi tải lỗi | `procurement/DocDetailView.tsx` |
| `DetailTabs` | Tab do feature cấp `{ key, label, content, hidden? }`; tự quản lý hoặc `value`/`onChange` theo key | `procurement/DocDetailView.tsx` |
| `FormDialog` | Mọi form/xác nhận: tiêu đề, nội dung, lỗi, footer **Hủy bỏ + hành động chính căn phải**; Enter submit; nút chính disabled khi `!canSubmit` hoặc `pending` (chống submit trùng) | các `Create*Dialog`, `workflow/DocActionDialog` |
| `Field` | Dòng nhãn/giá trị ở phần thông tin chung | `DocDetailView`, `GirDetailView` |
| `StatusChip`, `ApprovalStatusChip`, `ActiveChip` | Nhãn trạng thái theo tone của theme | danh sách/chi tiết |
| `ErrorAlert` | Hiển thị Problem Details (`errors.<code>` hoặc `detail`) | mọi nơi |

Không làm (chưa có nhu cầu thực): `ConfirmDialog` riêng (xác nhận = `FormDialog`/`DocActionDialog` không có trường), `ActionButton`, `EmptyState`/`LoadingState` riêng (đã có trong `DataTable`/`DetailPageLayout`), generic DataTable bọc thêm.

## 7. Quy ước Button / Link / vị trí thao tác

- **Button** = hành động (gọi API, mở dialog). **Link** (`@mui/material/Link`) = điều hướng sang chứng từ/trang khác (vd. số GR/HĐ trong truy vết lô, qua `NavContext`). Không dùng Link thay Button.
- Biến thể: hành động chính `variant="contained"` (một nút chính mỗi vùng); phụ `text` (mặc định) hoặc `outlined`; phá hủy/từ chối `color="error"`; điều kiện chưa đủ → `disabled`, không ẩn khi người dùng có quyền.
- Đang chạy: nút chính disabled bởi `pending` của mutation.
- Vị trí: dialog/form → footer căn phải (Hủy bỏ trước, hành động chính cuối). Trang chi tiết → nhóm thao tác ở bên phải header (`DetailPageLayout.actions`), thứ tự: Quay lại, thao tác phụ, rồi hành động chính cuối cùng. Danh sách → thao tác chung ở header (`ListPageLayout.actions`); thao tác theo dòng ở cột cuối bảng (hoặc bấm dòng để mở).
- Hiển thị thao tác theo quyền + trạng thái + vai trò (người tạo/người duyệt) — do feature quyết định; server kiểm tra lại.

## 8. Test

- Test hành vi người dùng qua Testing Library, tìm theo role/label tiếng Việt (ngôn ngữ mặc định).
- Gọi API giả bằng `mockApi({ '/path': json })`; kiểm tra body POST/PATCH trả về từ `mockApi`.
- Test feature đặt cạnh feature; helper chung trong `src/test/helpers`; không lặp setup i18n/cleanup (đã có `test/setup.ts`).
- Unit test không thay thế smoke test trên trình duyệt cho luồng chứng từ.
