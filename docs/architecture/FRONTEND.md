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
| `ListPageLayout` | Trang danh sách: `title`, `actions` (header), `toolbar` (tìm kiếm/lọc do feature tự làm), `error`, `breadcrumbs`, `children` (bảng) | `procurement/DocListPage.tsx`, `master-data/CatalogPage.tsx` |
| `DataTable` | Bảng: DataGrid compact, sort/phân trang/empty/loading sẵn; `emptyHint` | mọi trang |
| `DetailPageLayout` | Chi tiết chứng từ: `title` + `documentNumber`, `status`, `actions`, `notice`, `breadcrumbs`, `backTo` (mũi tên Back về route cố định, không dựa browser history); `loading` → thanh tiến trình, `error` khi tải lỗi | `procurement/DocDetailView.tsx` |
| `DetailTabs` | Tab do feature cấp `{ key, label, content, hidden? }`; tự quản lý hoặc `value`/`onChange` theo key | `procurement/DocDetailView.tsx` |
| `FormDialog` | Mọi form/xác nhận: tiêu đề + nút X, nội dung, lỗi, footer **Hủy bỏ + hành động chính căn phải**; Enter submit; nút chính disabled khi `!canSubmit` hoặc `pending` (chống submit trùng); không đóng khi đang lưu; `dirty` → hỏi trước khi bỏ thay đổi (X/Hủy bỏ/Escape/backdrop); `submitColor="error"` cho thao tác phá hủy. Chỉ đóng trong `onSuccess` | các `Create*Dialog`, `workflow/DocActionDialog` |
| `Field` | Dòng nhãn/giá trị ở phần thông tin chung | `DocDetailView`, `GirDetailView` |
| `StatusChip`, `ApprovalStatusChip`, `ActiveChip` | Nhãn trạng thái theo tone của theme | danh sách/chi tiết |
| `ErrorAlert` | Hiển thị Problem Details (`errors.<code>` hoặc `detail`) | mọi nơi |
| `PageBreadcrumbs` | `Trang chủ / Nhóm / Trang / [Mã]`: mục có `to` là link, mục cuối là trang hiện tại; feature chỉ truyền route người dùng có quyền | `sales-contracts` |

Xác nhận dùng `FormDialog` hoặc `DocActionDialog`. `DataTable` và `DetailPageLayout` xử lý trạng thái tải. `DocumentEmptyState` phục vụ vùng chứng từ trống dạng gọn, như tab Hồ sơ của PR.

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

**Danh sách phân trang phía server** (mẫu: `SalesContractsPage`):
- Trạng thái (trang, cỡ trang, sort, lọc) nằm trên URL. Đổi trang, sort hoặc lọc tạo mục lịch sử (`push`), nên Back/Forward đi qua từng trang; gõ ô tìm kiếm chỉ `replace`. Đổi lọc, sort hoặc cỡ trang thì quay về trang 1.
- `sortModel`/`paginationModel` truyền cho DataGrid phải **ổn định tham chiếu** (`useMemo` theo giá trị URL). Một object mới mỗi lần render bị grid coi là sort vừa đổi, và grid tự quay về trang 1 (đây là lỗi pagination đã sửa ở PR #17).
- Query key chứa toàn bộ tham số; `placeholderData: keepPreviousData`. Phản hồi về trễ của tham số cũ chỉ ghi vào cache của key cũ, không đè dữ liệu đang hiển thị.
- `DataTable`: `loading = isFetching || isPlaceholderData` → lớp mờ + spinner phủ vùng dòng, dữ liệu cũ vẫn ở dưới, không hiện empty state; phân trang bị khóa và vẫn mô tả dữ liệu đang hiển thị cho tới khi trang mới về. `error` → xóa dòng, thông báo không tải được, giữ trang và tổng số (không tự nhảy về trang 1); trang hiển thị chi tiết lỗi qua `ErrorAlert`.

**Thanh bộ lọc** (mọi màn danh sách có bộ lọc; dùng `FilterToolbar` trong `shared/components`, feature chỉ đưa các ô tìm kiếm/lọc vào):
- Nút **"Xóa bộ lọc"** (nút text màu phụ, icon xoay ngược) **luôn hiển thị** ở cuối thanh bộ lọc, không ẩn/hiện làm xô lệch bố cục. Nút nằm **ngay sau ô lọc cuối cùng**, cùng nhóm và cùng khoảng cách (`gap`) với các ô lọc; **không** dùng `margin-left: auto` hay bố cục đẩy nút ra mép container (trên màn rộng như 2K nút sẽ bị tách xa bộ lọc). Thiếu chiều ngang thì nút tự xuống dòng như một ô lọc, không tràn ngang; chiều rộng các ô lọc không đổi.
- Disabled khi không có điều kiện lọc nào, enabled khi có. Trạng thái tính từ **bộ lọc đang áp dụng trên URL** (kèm từ khóa đang gõ), nên Back/Forward cũng cập nhật đúng; ô tìm kiếm đồng bộ theo `q` trên URL.
- Bấm: xóa từ khóa và mọi điều kiện lọc trong một lần đổi URL (`push`), quay về trang 1, **giữ nguyên sort và cỡ trang**. Bảng dùng loading chuẩn ở trên, không giật.

**Trạng thái áp dụng:** Hợp đồng bán (danh sách + chi tiết, kể cả `FilterToolbar`) đã áp dụng và kiểm chứng ở 1440×900, 1366×768, 768×1024, 390×844. Các màn PR, PO, GRR, PNK, PXK, kho, danh mục chuyển sang `fill`/`ScrollTable` ở PR sau, theo đúng quy chuẩn này.

## Chuẩn UAT cho Đề nghị mua hàng

- Header có mũi tên về danh sách, loại chứng từ, mã, tên và trạng thái. Footer sticky chỉ chứa action nghiệp vụ. Primary solid theo theme xanh, icon + text và ngoài cùng phải; secondary outlined; destructive outlined đỏ. Action theo dòng có thể icon-only kèm tooltip. Giữ Be Vietnam Pro và primary #1F5FC4.
- Dialog dùng tiêu đề Xác nhận [hành động], nêu loại/mã chứng từ, hậu quả và lý do theo action. Nút Hủy bỏ outlined, nút xác nhận gọi tên hành động. Chặn gửi lặp khi đang xử lý. Duyệt PR chuyển sang Chờ tiếp nhận. Popup kết quả dùng check xanh tự đóng khoảng 3 giây hoặc X đỏ và nút Đã hiểu. Lỗi validation nằm inline và focus field lỗi đầu tiên.
- Stepper dưới header. Check xanh cho bước hoàn tất, ba chấm xanh cho bước đang chờ, vòng xám rỗng cho bước tương lai và X đỏ đúng bước từ chối. Giữ check ở bước hoàn tất trước đó. Hiển thị vòng hiện tại, xem lý do trong card hoặc lịch sử.
- Tabs theo thứ tự Thông tin chung, Hồ sơ, Người phê duyệt, Ghi chú, Lịch sử. Bảng hàng hóa nằm phía dưới nội dung tab. Xem lý do bằng dialog readonly. Nút Phân công lại nằm tại card đang chờ nếu đủ quyền.
- Notes mới nhất trước và có tải thêm, composer phía trên trong chuẩn UI mục tiêu. Hiển thị tác giả, thời gian, wrap nội dung. History mới nhất trước, có thời gian, vòng, hành động, người thực hiện, trạng thái sau và chi tiết read-only.
- Chuông phân biệt yêu cầu phê duyệt/tiếp nhận với sự kiện đã phê duyệt, từ chối, tiếp nhận, thu hồi hoặc phân công lại.
- Cảnh báo dữ liệu chưa lưu khi rời trang, ưu tiên giữ search, filter và paging khi trở về danh sách. Mở rộng nghiệp vụ dòng hàng thuộc PR #19. Import/Export/In theo mẫu thuộc backlog.

**COMMON-DOC-PAGE-001, COMMON-DOC-LAYOUT-001.** PR dùng chung DetailPageLayout cho Tạo, Sửa và Xem. Nháp hoặc Bị từ chối của người tạo có quyền sửa mở thẳng chế độ Sửa. Header có lối quay về danh sách. Footer dành cho thao tác nghiệp vụ, primary nằm cuối bên phải và footer vẫn chiếm diện tích trong luồng bố cục.

**COMMON-DOC-FORM-001.** DocumentFormGrid có 12 cột, khoảng cách ngang 16px và dọc 12px. Trường ngắn dùng 2–3 cột, trung bình 4–6 cột, dài 6–12 cột. Màn hình hẹp xếp một trường mỗi hàng. Label semibold nằm trên input cao khoảng 36–40px. Textarea mặc định hai dòng và tự giãn. Đặt trường bắt buộc lên trước và dùng cùng bố cục cho Tạo, Sửa, Xem.

**COMMON-DOC-TABS-001.** Tạo chỉ hiện ba tab đầu. Hồ sơ dùng DocumentEmptyState với icon và nhãn Chưa có hồ sơ. ScrollTable giữ header khi cuộn dọc, hỗ trợ cuộn ngang, giới hạn chiều cao theo viewport và giữ toolbar cùng tổng số dòng ngoài vùng cuộn. Chế độ Tạo/Sửa luôn hiển thị nút Thêm hàng hóa và nêu lý do khi nút bị khóa. Popup thêm, sửa, xóa cập nhật state cục bộ. Dòng hàng lấy tên và ĐVT từ hàng hóa; PR #18 chưa có đơn giá hoặc tiền tệ để tính tổng.

**COMMON-WORKFLOW-CARD-001.** Stepper dùng vòng 38px, đường nối 2px, nhãn 14px. Tạo mới và Nháp đều hiển thị ba chấm trắng trên nền #1F5FC4 ở bước Khởi tạo. Gửi duyệt thành công chuyển bước Khởi tạo sang dấu check trên nền #2E7D32. Bước tương lai có viền xám và bước từ chối dùng dấu X trên nền #D32F2F. Card chia đều chiều rộng, xếp label semibold trên value và đặt dropdown vào đúng card khi có quyền sửa. Vai trò lấy từ ứng viên hoặc snapshot của bước xử lý. Chuỗi dài hiển thị một dòng với tooltip chỉ khi bị cắt. Action footer căn phải, nút 32px và chỉ chiếm chỗ khi hàng card có thao tác.

**Common Status Badge.** Header PR dùng StatusChip nổi bật cao 30px, chữ 14px semibold. Card workflow và bảng dùng biến thể compact với màu trạng thái từ theme.

**Notification Scroll.** Menu có header ghim phía trên, chiều cao tối đa 66% viewport và cuộn nội bộ. Nhãn phân biệt tác vụ cần xử lý với tác vụ đã kết thúc.

**COMMON-DOC-NAV-001, DOC-LINE-001, FE-VALIDATION-001.** Giữ tham số danh sách khi đi và quay lại. Cảnh báo khi rời trang có thay đổi. State sống ở editor nên chuyển tab và lỗi API giữ nội dung nhập. Lưu nháp và Gửi duyệt đều cần ít nhất một dòng hợp lệ. Gửi duyệt cần thêm ứng viên hợp lệ. Hiển thị validation cạnh trường và đánh dấu tab lỗi.

**UI-15, UI-EVIDENCE-001.** Popup kết quả dùng chung chiều rộng 460px, chiều cao tối thiểu 260px và icon 64px nền tròn có dấu check hoặc X trắng. Áp dụng cho thao tác nghiệp vụ trên chứng từ và Master Data. Tiêu đề nêu thao tác và kết quả; nội dung nêu chứng từ hoặc danh mục tương ứng. Snackbar dành cho thông báo nhẹ. Thành công nêu trạng thái mới nếu thay đổi và tự đóng sau khoảng 3 giây. Thất bại hiển thị nguyên nhân dạng chữ và nút Đã hiểu. Kiểm tra trực tiếp Before/After trên Chromium với API và PostgreSQL test ở 1920×1080 và 1366×768.


## COMMON-DOC-GRID-001 — Bảng chứng từ và danh mục

- DataTable và ScrollTable dùng độ rộng cột theo loại dữ liệu và chiều cao dòng nhất quán. Mã, tên, mô tả và văn bản dài hiển thị một dòng với ellipsis. GridText mở tooltip đầy đủ khi rê chuột hoặc dùng bàn phím nếu nội dung thực sự bị cắt. Giữ nguyên giá trị gốc.
- Số lượng và giá trị tiền căn phải. Header giữ vị trí khi cuộn dọc. Cột thao tác giữ vị trí bên phải khi cuộn ngang; bảng phải cuộn được tới cột và dòng cuối. Toolbar và tổng số dòng nằm ngoài vùng bảng cuộn.
- Giữ biểu tượng cảnh báo trùng cạnh mã, kể cả khi phần chữ của mã bị cắt.
- Grid PR ở Create/Edit dùng cùng checkbox cho Sửa và Xóa nhiều dòng. Nút Xóa (N) luôn có vị trí cố định và dùng kiểu destructive. Confirm Dialog giữ danh sách ID dòng đã chọn. Xác nhận cập nhật form cục bộ, giữ thứ tự các dòng còn lại và xóa selection. Hủy giữ dữ liệu và selection. View chỉ hiển thị grid.

## COMMON-MASTER-DATA-001 — Danh mục

- Mỗi danh mục có mục điều hướng riêng. List dùng ListPageLayout, FilterToolbar và DataTable với tìm kiếm theo mã/tên không phân biệt hoa thường, bộ lọc phù hợp, phân trang và các trạng thái tải/rỗng/lỗi. Giữ bộ lọc và phân trang trong URL. Mã là liên kết tới View, thao tác xóa nếu có đặt tại chi tiết.
- Dùng cùng form cho Create, View và Edit. Create chưa có ID, View/Edit dùng cùng ID. Lưu Create về List, lưu hoặc hủy Edit về View, đóng View hoặc hủy Create về List. View chỉ đọc, hiện Chỉnh sửa theo quyền. Create/Edit dùng cùng validation, chỉ rõ lỗi tại trường tương ứng và xác nhận bỏ thay đổi chưa lưu.
- Mã chính, Hãng, Khách hàng, NCC dùng full page với DetailPageLayout, lưới 12 cột và card chiều cao tự nhiên. Mã tạm, ĐVT, Kho, Tiền tệ và Thuế suất dùng FormDialog. View chuyển sang Edit trong cùng popup. Nút chính nằm bên phải nút phụ.
- Hiển thị tỷ giá, thuế suất theo locale và bỏ số 0 cuối phần thập phân. Giá trị lưu giữ nguyên precision. Áp dụng COMMON-DOC-GRID-001. Kết quả tạo, sửa, xóa dùng Action Result Dialog theo UI-15. Lỗi của trường tiếp tục hiển thị cạnh trường.

## COMMON-MASTER-DATA-STATUS-001 — Trạng thái danh mục

- Mọi Master Data dùng MUI Switch trên List và có bộ lọc mặc định Tất cả, kể cả danh mục bổ sung sau này. Active dùng primary, Inactive dùng màu trung tính; hiển thị nhãn và khóa thao tác nếu thiếu quyền. Create mặc định Active. View đọc trạng thái, Edit tập trung vào thông tin danh mục.
- Xác nhận trước khi chuyển Inactive, kích hoạt lại trực tiếp. Gửi trạng thái đích tới API, khóa Switch của bản ghi trong khi xử lý, cập nhật khi thành công và giữ giá trị hiện tại nếu lỗi. Dùng Action Result Dialog cho kết quả nghiệp vụ sau khi API phản hồi. Đóng dialog xác nhận trước khi hiển thị kết quả.
- Dropdown gọi API lựa chọn Active. Khi sửa hiển thị thêm giá trị Inactive đã lưu; danh sách quản trị và dữ liệu lịch sử giữ đủ hai trạng thái. Backend kiểm tra theo quy tắc tại 03 §1d. Trạng thái không cascade.

## UI-EVIDENCE-001 — Kiểm chứng bằng trình duyệt

- PR thay đổi UI/UX phải kiểm chứng trên trình duyệt thật kết nối với backend và database test đã xác minh. Unit test và build là các bước kiểm chứng bổ sung.
- Dùng Playwright MCP nếu có hoặc Playwright Test trực tiếp. Chụp trước và sau ở 1920×1080 và 1366×768, kiểm tra luồng E2E, quyền thao tác, console và lỗi API ngoài dự kiến.
- Mở lại ảnh để kiểm tra căn chỉnh, tràn nội dung, màu và chữ. Sửa lỗi rồi chụp lại màn bị ảnh hưởng. Lưu ảnh, report và trace trong `artifacts/evidence/`. Báo các kịch bản đã kiểm chứng và đánh dấu BLOCKED nếu trình duyệt không chạy được.
## Danh sách và grid chứng từ PR

**COMMON-LIST-001.** Với danh sách phân trang phía server, gửi tìm kiếm sau khoảng 300 ms, lọc và sắp xếp một cột trên toàn bộ tập dữ liệu. API áp dụng phạm vi dữ liệu trước khi tính tổng và dùng danh sách trường sort cho phép. Danh sách PR lưu truy vấn và trang trên URL, mặc định 25 dòng theo ngày tạo mới nhất với ID giảm dần làm tiêu chí phụ. Cột tiền thanh toán tắt sắp xếp vì danh sách có nhiều tiền tệ. Query key riêng theo tham số và tín hiệu hủy giữ phản hồi cũ khỏi lượt tìm mới.

**COMMON-LIST-002.** Nút Làm mới dùng kiểu secondary, có icon và nhãn. Đặt lại từ khóa, bộ lọc, chế độ chờ xử lý, sort và pagination về mặc định rồi tải lại kể cả khi ở trạng thái mặc định. Với Product Picker, áp dụng đặt lại cho tab hiện hành và giữ các mục đã chọn. Checkbox đầu bảng của picker áp dụng cho trang hiện tại.

**Common Search Input.** Giữ label phía trên, icon tìm kiếm bên trái và vùng cố định cho nút X có tooltip và tên truy cập. Placeholder mô tả dữ liệu mà truy vấn hiện tại hỗ trợ, bắt đầu bằng “Nhập” trong giao diện tiếng Việt. X chỉ xóa từ khóa, giữ bộ lọc và sort. Màn hình điều khiển debounce, URL và đưa danh sách về trang đầu theo cách xử lý tìm kiếm hiện hữu.

**COMMON-EDITABLE-GRID-001.** Grid nhập liệu dùng một hàng cho mỗi dòng, cột có chiều rộng cố định phù hợp, sticky header, nhóm cột định danh bên trái và thao tác bên phải. Chỉ grid cuộn ngang và dọc. Toolbar, tổng tiền và footer nằm ngoài vùng cuộn. Dùng chung ScrollTable và GridText theo COMMON-DOC-GRID-001. Popup sửa dòng giữ bản sao cục bộ theo ID ổn định, áp dụng vào chứng từ khi Xác nhận.

**COMMON-EDITABLE-GRID-002.** Dành sẵn một hàng thông báo lỗi. Khi xác nhận, đánh dấu các ô lỗi và hiện nguyên nhân qua tooltip khi hover hoặc focus. Cuộn đến và focus ô lỗi đầu tiên theo thứ tự dòng/cột, chừa khoảng cho sticky header và các cột sticky. Sửa giá trị cập nhật số lỗi mà không tự cuộn lại. API có thể trả `fieldIssue` gồm chỉ số dòng và tên trường để mở editor tại ô tương ứng.

Giữa toolbar, vùng validation và grid header dùng khoảng cách 8px. Giữ nguyên chiều cao vùng validation khi nội dung xuất hiện hoặc biến mất.

**COMMON-DOC-TOTAL-001.** Một hàng dưới grid, bên trái là số dòng, bên phải là tổng trước thuế, tổng thuế và tổng thanh toán. Mã tiền tệ theo sau tổng thanh toán. Preview dùng số nguyên theo đơn vị tiền nhỏ nhất, làm tròn mỗi dòng theo DEC-19-07. Chứng từ đã lưu dùng số tiền do backend trả.

**Nhập ngày và số trên chứng từ.** DocumentDatePicker hiển thị ngày và placeholder theo locale, dùng `dd/mm/yyyy` cho tiếng Việt và trao đổi chuỗi `YYYY-MM-DD` với API. Nhập và kiểm tra ngày theo lịch trực tiếp trên chuỗi để giữ nguyên ngày qua các múi giờ. DocumentNumericInput hiển thị phân cách hàng nghìn theo locale, giữ chuỗi thập phân chính xác và để nguyên phần vượt precision cho validation DEC-19-07.

**Validation trên grid.** Dùng token `error.main` cho icon, chữ và đường viền ở input, message và tooltip lỗi. Message và tooltip nền trắng. Slot thông báo giữ chiều cao cố định và tooltip thường giữ style mặc định.

**Căn lề PR.** Form, toolbar, grid và tổng tiền dùng cùng lề ngang của card. Tiêu đề hàng hóa hiển thị cả khi View. Tổng tiền dùng cỡ chữ 16px, tổng thanh toán 18px màu chủ đạo, với divider nhẹ giữa ba nhóm.
