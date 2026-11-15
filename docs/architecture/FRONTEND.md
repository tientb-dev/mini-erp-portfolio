# Kiến trúc Frontend (`apps/web`)

React 19 + TypeScript + Vite + MUI 9 + MUI X Data Grid + TanStack Query + `react-i18next`. Một SPA, điều hướng bằng **React Router** (`BrowserRouter` trong `main.tsx`): mỗi trang có URL `/<kebab-key>` và `/<kebab-key>/<id>` (`pagePath` trong `shared/navigation.ts`); trang nhận id qua `initialId`. URL không có quyền → "không tìm thấy"; server vẫn kiểm tra quyền.

## 1. Cấu trúc thư mục

```text
apps/web/src/
├── main.tsx                  # entry duy nhất ở root: QueryClient + i18n + <App/>
├── app/                      # ghép ứng dụng; không chứa nghiệp vụ
│   ├── App.tsx               # theme theo ngôn ngữ, Login ↔ AppShell
│   ├── routes.ts             # PAGES (trang + quyền VIEW + icon) và NAV (nhóm sidebar + icon)
│   └── layouts/              # AppShell (AppBar, Routes, NavContext), SideNav (nhóm cha/con, thu gọn được)
├── config/                   # i18n.ts (vi/en), theme.ts (tokens, statusTones)
├── services/api-client.ts    # HTTP client duy nhất: base URL, token, ApiError (RFC 9457 code)
├── shared/                   # không biết nghiệp vụ
│   ├── components/           # PageHeader, StatusChip, ErrorAlert, DataTable, FormDialog, Field,
│   │                         # ListPageLayout, DetailPageLayout, DetailTabs, PageBreadcrumbs (+ index.ts)
│   ├── navigation.ts         # NavContext (mở chứng từ ở trang khác), pagePath (URL theo page key)
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
| `sales-contracts` | HĐ: danh sách (tìm/lọc/sắp xếp/phân trang phía server, trạng thái trên URL), chi tiết (tab Hàng hóa, Đề nghị mua), lưu từng dòng qua dialog, đề xuất/xác nhận Product | `SalesContractsPage` |
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
| `ListPageLayout` | Trang danh sách: `title`, `actions` (header), `toolbar` (tìm kiếm/lọc do feature tự làm), `error`, `breadcrumbs`, `children` (bảng) | `procurement/DocListPage.tsx`, `master-data/ProductsPage.tsx` |
| `DataTable` | Bảng: DataGrid compact, sort/phân trang/empty/loading sẵn; `emptyHint` | mọi trang |
| `DetailPageLayout` | Chi tiết chứng từ: `title` + `documentNumber`, `status`, `actions`, `notice`, `breadcrumbs`, `backTo` (mũi tên Back về route cố định, không dựa browser history); `loading` → thanh tiến trình, `error` khi tải lỗi | `procurement/DocDetailView.tsx` |
| `DetailTabs` | Tab do feature cấp `{ key, label, content, hidden? }`; tự quản lý hoặc `value`/`onChange` theo key | `procurement/DocDetailView.tsx` |
| `FormDialog` | Mọi form/xác nhận: tiêu đề + nút X, nội dung, lỗi, footer **Hủy bỏ + hành động chính căn phải**; Enter submit; nút chính disabled khi `!canSubmit` hoặc `pending` (chống submit trùng); không đóng khi đang lưu; `dirty` → hỏi trước khi bỏ thay đổi (X/Hủy bỏ/Escape/backdrop); `submitColor="error"` cho thao tác phá hủy. Chỉ đóng trong `onSuccess` | các `Create*Dialog`, `workflow/DocActionDialog` |
| `Field` | Dòng nhãn/giá trị ở phần thông tin chung | `DocDetailView`, `GirDetailView` |
| `StatusChip`, `ApprovalStatusChip`, `ActiveChip` | Nhãn trạng thái theo tone của theme | danh sách/chi tiết |
| `ErrorAlert` | Hiển thị Problem Details (`errors.<code>` hoặc `detail`) | mọi nơi |
| `PageBreadcrumbs` | `Trang chủ / Nhóm / Trang / [Mã]`: mục có `to` là link, mục cuối là trang hiện tại; feature chỉ truyền route người dùng có quyền | `sales-contracts` |

Không làm (chưa có nhu cầu thực): `ConfirmDialog` riêng (xác nhận = `FormDialog`/`DocActionDialog` không có trường), `ActionButton`, `EmptyState`/`LoadingState` riêng (đã có trong `DataTable`/`DetailPageLayout`), generic DataTable bọc thêm.

## 7. Quy ước Button / Link / vị trí thao tác

- **Button** = hành động (gọi API, mở dialog). **Link** (`@mui/material/Link`) = điều hướng sang chứng từ/trang khác (vd. số GR/HĐ trong truy vết lô, qua `NavContext`). Không dùng Link thay Button.
- Biến thể: hành động chính `variant="contained"` (một nút chính mỗi vùng); phụ `text` (mặc định) hoặc `outlined`; phá hủy/từ chối `color="error"`; điều kiện chưa đủ → `disabled`, không ẩn khi người dùng có quyền.
- Đang chạy: nút chính disabled bởi `pending` của mutation.
- Thao tác theo dòng trong bảng: `IconButton` + `Tooltip` + `aria-label` (kèm mã chứng từ); thao tác ít dùng vào menu ba chấm; click thao tác không mở dòng. Mã chứng từ là Link thật (mở tab mới/copy URL được); click vùng còn lại của dòng hoặc Enter cũng mở chi tiết.
- Vị trí: dialog/form → footer căn phải (Hủy bỏ trước, hành động chính cuối). Trang chi tiết → Back là mũi tên cạnh tiêu đề (`backTo`); nhóm thao tác ở bên phải header (`DetailPageLayout.actions`), thứ tự: thao tác phá hủy/phụ, rồi hành động chính cuối cùng. Danh sách → thao tác chung ở header (`ListPageLayout.actions`); thao tác theo dòng ở cột cuối bảng (hoặc bấm dòng để mở).
- Hiển thị thao tác theo quyền + trạng thái + vai trò (người tạo/người duyệt) — do feature quyết định; server kiểm tra lại.

## 8. Test

- Test hành vi người dùng qua Testing Library, tìm theo role/label tiếng Việt (ngôn ngữ mặc định).
- Gọi API giả bằng `mockApi({ '/path': json })`; kiểm tra body POST/PATCH trả về từ `mockApi`.
- Test feature đặt cạnh feature; helper chung trong `src/test/helpers`; không lặp setup i18n/cleanup (đã có `test/setup.ts`).
- Unit test không thay thế smoke test trên trình duyệt cho luồng chứng từ.

## 9. Sidebar

- Nhóm cha (icon nghiệp vụ) → trang con (icon nhỏ) theo `NAV`; chỉ hiện con có quyền VIEW, nhóm không còn con thì ẩn.
- Mặc định mọi nhóm mở; người dùng thu gọn từng nhóm, lựa chọn lưu ở `localStorage` (`mini-erp.nav.collapsed`, lỗi storage → mặc định mở). Vào trang thuộc nhóm đang thu gọn → nhóm tự mở. Nhóm chứa trang hiện tại có màu nhấn.

## 10. Design system ("Hồ sơ chứng từ", PR #17)

Toàn bộ token và quy tắc component nằm trong `config/theme.ts` (MUI theme); feature không đặt cứng màu hay kích thước.

| Nhóm | Quy tắc |
|---|---|
| Màu | Primary `#1F5FC4` (hover `#184DA3`, nền nhạt `#EAF1FC`); nền trang `#F5F7FA`; bề mặt trắng; chữ `#18222F` / `#5A6878`; viền `#DCE2E9`. Trạng thái giữ nghĩa qua `statusTones` (Nháp xám, Chờ vàng, Đã chốt/duyệt xanh lá, Từ chối đỏ, Đã hủy xám nhạt). |
| Chữ | Be Vietnam Pro tự host (`@fontsource`, không gọi CDN). Tiêu đề trang 22/600, tiêu đề vùng 16/600, nội dung và bảng 14px, nhãn 13px màu phụ. |
| Nút | Contained: một nút chính mỗi vùng. Outlined: phụ. Text: hủy, điều hướng. Màu đỏ: thao tác phá hủy, luôn có xác nhận. Cao 36px (pointer thô: 44px), bo 6px. |
| Form | Nhãn luôn nằm trên ô (không nổi trong viền), ô cao 40px, khoảng cách bội số 8. Thanh lọc không có nhãn trên: giá trị rỗng ghi "Tất cả …", tên trường là `aria-label`. |
| Bảng | DataGrid dòng 44px, header 40px, chữ 14px; số căn phải; ngày trong danh sách `dd/MM/yyyy`, giờ đầy đủ ở tooltip; phân trang tiếng Việt ("1–3 trên 3"). |
| Thao tác theo dòng | Mỗi dòng đúng một menu `⋯` (`MoreHoriz`) trong ô cố định, căn phải. Menu **chỉ liệt kê thao tác chạy được ngay**: không có quyền, hoặc trạng thái/điều kiện chưa cho phép (cùng điều kiện server) → ẩn, không hiện mờ. Lý do chưa đủ điều kiện (vd. chưa thể Chốt) do trang chi tiết giải thích. DataGrid tắt menu cột (`disableColumnMenu`). |
| Chi tiết chứng từ | Tiêu đề là mã chứng từ, chip trạng thái ngay cạnh, phụ đề là loại chứng từ. Header chỉ có thao tác sửa. Quyết định (Hủy: outlined đỏ, có xác nhận; Chốt: contained) cùng nằm ở `DetailPageLayout.footer`, căn phải. Không có thao tác nào thì không hiện footer. |
| Layout và cuộn | `AppShell` cao đúng `100dvh` nên document không bao giờ cuộn. Topbar cố định; sidebar cuộn riêng; `[data-main-scroll]` là vùng cuộn dọc duy nhất của nội dung. `DetailPageLayout` lấp đầy vùng đó, footer `sticky` ở đáy (nằm trong luồng trang nên không che dòng cuối). Bảng rộng cuộn ngang trong khung bảng; bảng ít dòng không có vùng cuộn riêng (DataGrid `autoHeight`). Menu, select, dialog render qua portal nên không bị overflow cắt. |
| Dialog | Tiêu đề + X, một dòng `description`, footer có đường kẻ, Hủy bỏ + nút chính căn phải. Trường văn bản chiếm cả hàng; cặp giá trị đọc cùng nhau (Số lượng + ĐVT) chung một hàng. |

## 11. Quy chuẩn bố cục và cuộn (mọi chứng từ: HĐ, PR, PO, PNK, PXK, chứng từ sau này)

**Hai chế độ**, chuyển bằng một media query duy nhất `fillMedia` (`config/theme.ts`: rộng ≥ 600px và cao ≥ 700px):

| | Màn đủ lớn (fill) | Màn thấp hoặc điện thoại |
|---|---|---|
| Trang đánh dấu `data-fill-page` | Cao đúng vùng main; tiêu đề, bộ lọc, thông tin chung, tabs, footer đứng yên | Cao theo nội dung; vùng main cuộn cả trang |
| Vùng dữ liệu `data-fill-grow` | Chiều cao tự nhiên khi ít dòng; co lại và **cuộn bên trong** khi nhiều dòng; header cột dính | Cao theo nội dung, không cuộn lồng nhau |
| Cuộn ngang | Luôn bên trong khung bảng | Như bên trái |

**Dùng thế nào** (không viết CSS cuộn trong feature):
- **List page:** `<ListPageLayout fill>` + `<DataTable fill>`. DataGrid cuộn dòng bên trong, thanh phân trang luôn nhìn thấy. Bảng ít dòng không có vùng cuộn thừa.
- **Detail page:** `DetailPageLayout` luôn là fill page. Tab dạng bảng (hàng hóa, vật tư, serial…) đặt bảng trong `<ScrollTable label minWidth>` (MUI Table, `stickyHeader`) ngay trong nội dung tab của `DetailTabs`; các phần khác của tab (thanh công cụ, ghi chú) tự đứng yên.
- **Chuỗi flex:** `AppShell` (`:has([data-fill-page])`) → trang (`data-fill-page`) → `DetailTabs`/`DataTable` (`data-fill-grow`) → `ScrollTable` (`data-fill-grow`). Mỗi cấp chỉ cho phần tử `data-fill-grow` co lại; phần còn lại `flexShrink: 0`. Không đặt cứng chiều cao bảng.
- **Footer quyết định** (`DetailPageLayout.footer`): ở đáy vùng main, nằm trong luồng trang nên không che dòng cuối.
- Menu, select, dialog render qua portal nên không bị `overflow` cắt.

**Trạng thái áp dụng:** Hợp đồng bán (danh sách + chi tiết) đã áp dụng và kiểm chứng ở 1440×900, 1366×768, 768×1024, 390×844. Các màn PR, PO, GRR, PNK, PXK, kho, danh mục chuyển sang `fill`/`ScrollTable` ở PR sau, theo đúng quy chuẩn này.
