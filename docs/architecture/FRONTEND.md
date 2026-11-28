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
- Vị trí: dialog/form → footer căn phải (Hủy bỏ trước, hành động chính cuối). Trang chi tiết → theo [COMMON-DETAIL-PAGE-001](#common-detail-page-001): Back là mũi tên cạnh tiêu đề; **mọi thao tác lưu/thay đổi đối tượng nằm ở footer cố định** (`DetailPageLayout.footer`), không ở góc trên bên phải. Danh sách → thao tác chung ở header (`ListPageLayout.actions`); thao tác theo dòng ở cột cuối bảng (hoặc bấm dòng để mở).
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
| Chi tiết chứng từ | Tiêu đề là mã chứng từ, chip trạng thái ngay cạnh, phụ đề là loại chứng từ. Header không chứa nút thao tác. Mọi thao tác (Hủy: outlined đỏ, có xác nhận; Sửa thông tin: outlined; Chốt: contained, ngoài cùng phải) nằm ở `DetailPageLayout.footer`, căn phải (COMMON-DETAIL-PAGE-001). Không có thao tác nào thì không hiện footer. |
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

**Thanh bộ lọc** (mọi màn danh sách có bộ lọc; dùng `FilterToolbar` trong `shared/components`, feature chỉ đưa các ô tìm kiếm/lọc vào) — quyết định BA OA1.3 thay "Xóa bộ lọc" bằng **"Làm mới"**:
- Nút **"Làm mới"** (outlined primary, icon Refresh + chữ, cao 36px) nằm **ngay sau ô lọc cuối cùng**, đúng vị trí cũ của "Xóa bộ lọc", cùng `gap` với các ô lọc; **không** dùng spacer hay `margin-left: auto`. Thiếu chiều ngang thì nút xuống dòng như một ô lọc. Mỗi thanh chỉ có **một** nút Làm mới, không có Xóa bộ lọc.
- Luôn khả dụng, kể cả khi chưa áp dụng bộ lọc; chỉ disabled khi đang làm mới (hoặc lần tải đầu đang chạy).
- Bấm: đặt lại từ khóa, mọi bộ lọc và sort về mặc định, quay về trang đầu, **giữ số hàng mỗi trang**, rồi truy vấn lại server. Bảng dùng loading chuẩn ở trên, không giật.

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

**COMMON-DOC-TABS-001.** Tạo chỉ hiện ba tab đầu. Hồ sơ dùng DocumentEmptyState với icon và nhãn Chưa có hồ sơ khi danh sách trống. ScrollTable giữ header khi cuộn dọc, hỗ trợ cuộn ngang, giới hạn chiều cao theo viewport và giữ toolbar cùng tổng số dòng ngoài vùng cuộn. Chế độ Tạo/Sửa luôn hiển thị nút Thêm hàng hóa và nêu lý do khi nút bị khóa. Popup thêm, sửa, xóa cập nhật state cục bộ.

**COMMON-WORKFLOW-CARD-001.** Stepper dùng vòng 38px, đường nối 2px, nhãn 14px. Tạo mới và Nháp đều hiển thị ba chấm trắng trên nền #1F5FC4 ở bước Khởi tạo. Gửi duyệt thành công chuyển bước Khởi tạo sang dấu check trên nền #2E7D32. Bước tương lai có viền xám và bước từ chối dùng dấu X trên nền #D32F2F. Card chia đều chiều rộng, xếp label semibold trên value và đặt dropdown vào đúng card khi có quyền sửa. Vai trò lấy từ ứng viên hoặc snapshot của bước xử lý. Chuỗi dài hiển thị một dòng với tooltip chỉ khi bị cắt. Action footer căn phải, nút 32px và chỉ chiếm chỗ khi hàng card có thao tác.

**Common Status Badge.** Header PR dùng StatusChip nổi bật cao 30px, chữ 14px semibold. Card workflow và bảng dùng biến thể compact với màu trạng thái từ theme.

**Notification Scroll.** Menu có header ghim phía trên, chiều cao tối đa 66% viewport và cuộn nội bộ. Nhãn phân biệt tác vụ cần xử lý với tác vụ đã kết thúc.

**COMMON-DOC-NAV-001, DOC-LINE-001, FE-VALIDATION-001.** Giữ tham số danh sách khi đi và quay lại. Cảnh báo khi rời trang có thay đổi. State sống ở editor nên chuyển tab và lỗi API giữ nội dung nhập. Lưu nháp và Gửi duyệt đều cần ít nhất một dòng hợp lệ. Gửi duyệt cần thêm ứng viên hợp lệ. Hiển thị validation cạnh trường và đánh dấu tab lỗi.

**HĐ bán · Phase 5.2.3.** Áp dụng COMMON-DOC-PAGE-001 cho Full Page Create/Edit/View, với ngoại lệ DOC-LINE-001 cho Lưu nháp HĐ trống theo Business Rules §9.1. Common Document Form 12 cột và grid inline dùng state cấp editor. Lỗi ở tab khác thì mở tab và focus trường đầu tiên. Chỉ bypass Dirty Guard sau khi máy chủ xác nhận lưu và form đã được đánh dấu sạch. Dùng Action Result và COMMON-BUTTON-001 cho các thao tác nghiệp vụ.

Common Product Picker dùng chung API server-side cho hai tab mã chính/mã tạm. PR giữ multi-select; HĐ dùng single-select để điền snapshot. Inline grid giữ chỗ adornment cuối ô mã cho kính lúp và cảnh báo trùng, tooltip hỗ trợ bàn phím. Dùng Common Document Form để cân bằng padding multiline và chiều cao mặc định của diễn giải với Common File Attachment Cell. File HĐ là một ô trong Thông tin chung; trạng thái upload tạm và chính thức theo [roadmap File Attachment](DOCUMENT-DOSSIER-ORGANIZATION-ROADMAP.md).

**UI-15, UI-EVIDENCE-001.** Popup kết quả dùng chung chiều rộng 460px, chiều cao tối thiểu 260px và icon 64px nền tròn có dấu check hoặc X trắng. Áp dụng cho thao tác nghiệp vụ trên chứng từ và Master Data. Tiêu đề nêu thao tác và kết quả; nội dung nêu chứng từ hoặc danh mục tương ứng. Snackbar dành cho thông báo nhẹ. Thành công nêu trạng thái mới nếu thay đổi và tự đóng sau khoảng 3 giây. Thất bại hiển thị nguyên nhân dạng chữ và nút Đã hiểu. Kiểm tra trực tiếp Before/After trên Chromium với API và PostgreSQL test ở 1920×1080 và 1366×768.


## COMMON-DOC-GRID-001 — Bảng chứng từ và danh mục

- DataTable và ScrollTable dùng độ rộng cột theo loại dữ liệu và chiều cao dòng nhất quán. Mã, tên, mô tả và văn bản dài hiển thị một dòng với ellipsis. GridText mở tooltip đầy đủ khi rê chuột hoặc dùng bàn phím nếu nội dung thực sự bị cắt. Giữ nguyên giá trị gốc.
- Số lượng và giá trị tiền căn phải. Header giữ vị trí khi cuộn dọc. Cột thao tác giữ vị trí bên phải khi cuộn ngang; bảng phải cuộn được tới cột và dòng cuối. Toolbar và tổng số dòng nằm ngoài vùng bảng cuộn.
- Giữ biểu tượng cảnh báo trùng cạnh mã, kể cả khi phần chữ của mã bị cắt.
- Grid PR ở Create/Edit dùng cùng checkbox cho Sửa và Xóa nhiều dòng. Nút Xóa (N) luôn có vị trí cố định và dùng kiểu destructive. Confirm Dialog giữ danh sách ID dòng đã chọn. Xác nhận cập nhật form cục bộ, giữ thứ tự các dòng còn lại và xóa selection. Hủy giữ dữ liệu và selection. View chỉ hiển thị grid.

## COMMON-MASTER-DATA-001 — Danh mục

- Mỗi danh mục có mục điều hướng riêng. List dùng ListPageLayout, FilterToolbar, SearchInput và DataTable. Mã mở View; cột Thao tác sticky cuối bảng dùng Pencil mở Edit và Copy mở Create theo quyền. URL giữ từ khóa, bộ lọc, sort, trang và cỡ trang qua các mode. Làm mới theo Thanh bộ lọc ở trên: ngay sau bộ lọc cuối, luôn khả dụng ngoài lúc đang làm mới, đặt lại trạng thái danh sách (giữ số hàng mỗi trang) rồi tải lại. Picker giữ quy tắc refresh và selection riêng.
- Dùng cùng form cho Create, View và Edit. Create chưa có ID, View/Edit dùng cùng ID. Mở Edit, Create hoặc Copy từ List thì Hủy bỏ, Đóng, Quay lại hoặc lưu thành công trở về đúng List. Mở Edit từ View thì Hủy bỏ, Đóng, Quay lại hoặc lưu thành công trở về View tại chỗ, với dữ liệu mới sau lưu. Lưu thất bại giữ mode và dữ liệu nhập. Đóng View trở về List. View chỉ đọc, hiện Chỉnh sửa theo quyền. Create/Edit dùng cùng validation, chỉ rõ lỗi tại trường tương ứng và xác nhận bỏ thay đổi chưa lưu.
- Mã chính và Hãng dùng DetailPageLayout với footer dùng chung. Mã tạm, ĐVT, Kho, Khách hàng, NCC, Tiền tệ, Thuế suất và Loại hồ sơ dùng FormDialog. Mỗi danh mục dùng chung form, lưới 12 cột ưu tiên mã/tên 4:8. Mô tả tùy chọn mặc định 2 dòng, cột đứng sau Tên. View chuyển Edit tại chỗ. Trạng thái dùng StatusChip và chỉnh ở danh sách. Nút chính ở bên phải.
- Hiển thị tỷ giá, thuế suất theo locale và bỏ số 0 cuối phần thập phân. Kết quả tạo và sửa dùng Action Result Dialog theo UI-15; lỗi trường tiếp tục hiển thị inline. Hãng hiển thị grid NCC trong cả ba mode. Picker giữ lựa chọn qua lọc, phân trang và refresh, chỉ cập nhật form cục bộ khi xác nhận.

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

**COMMON-LIST-002.** Nút Làm mới dùng kiểu outlined primary, có icon và nhãn, đặt ngay sau bộ lọc cuối (Thanh bộ lọc). Đặt lại từ khóa, bộ lọc, chế độ chờ xử lý, sort và pagination về mặc định rồi tải lại kể cả khi ở trạng thái mặc định. Với Product Picker, áp dụng đặt lại cho tab hiện hành và giữ các mục đã chọn. Search, dropdown và Làm mới trong FilterToolbar cao 36px, căn đáy và cách nhau 12px. Search của Master Data đơn giản có chiều rộng mục tiêu 420px và co giãn theo viewport. Picker dùng cùng lề ngang ở header, nội dung và footer. Checkbox đầu bảng áp dụng cho trang hiện tại sau lọc/sort, có trạng thái chọn một phần. Duy trì lựa chọn qua tìm kiếm, lọc, sort, phân trang và refresh.

**Common Search Input.** Giữ label phía trên, icon tìm kiếm bên trái và vùng cố định cho nút X có tooltip và tên truy cập. Placeholder mô tả dữ liệu mà truy vấn hiện tại hỗ trợ, bắt đầu bằng “Nhập” trong giao diện tiếng Việt. X chỉ xóa từ khóa, giữ bộ lọc và sort. Màn hình điều khiển debounce, URL và đưa danh sách về trang đầu theo cách xử lý tìm kiếm hiện hữu.

**COMMON-EDITABLE-GRID-001.** Grid nhập liệu dùng một hàng cho mỗi dòng, cột có chiều rộng cố định phù hợp, sticky header, nhóm cột định danh bên trái và thao tác bên phải. Chỉ grid cuộn ngang và dọc. Toolbar, tổng tiền và footer nằm ngoài vùng cuộn. Dùng chung ScrollTable và GridText theo COMMON-DOC-GRID-001. Popup sửa dòng giữ bản sao cục bộ theo ID ổn định, áp dụng vào chứng từ khi Xác nhận.

**COMMON-EDITABLE-GRID-002.** Dành sẵn một hàng thông báo lỗi. Khi xác nhận, đánh dấu các ô lỗi và hiện nguyên nhân qua tooltip khi hover hoặc focus. Cuộn đến và focus ô lỗi đầu tiên theo thứ tự dòng/cột, chừa khoảng cho sticky header và các cột sticky. Sửa giá trị cập nhật số lỗi mà không tự cuộn lại. API có thể trả `fieldIssue` gồm chỉ số dòng và tên trường để mở editor tại ô tương ứng.

Giữa toolbar, vùng validation và grid header dùng khoảng cách 8px. Giữ nguyên chiều cao vùng validation khi nội dung xuất hiện hoặc biến mất.

**COMMON-DOC-TOTAL-001.** Một hàng dưới grid, bên trái là số dòng, bên phải là tổng trước thuế, tổng thuế và tổng thanh toán. Mã tiền tệ theo sau tổng thanh toán. Preview dùng số nguyên theo đơn vị tiền nhỏ nhất, làm tròn mỗi dòng theo DEC-19-07. Chứng từ đã lưu dùng số tiền do backend trả.

**Nhập ngày và số trên chứng từ.** DocumentDatePicker hiển thị ngày và placeholder theo locale, dùng `dd/mm/yyyy` cho tiếng Việt và trao đổi chuỗi `YYYY-MM-DD` với API. Nhập và kiểm tra ngày theo lịch trực tiếp trên chuỗi để giữ nguyên ngày qua các múi giờ. DocumentNumericInput hiển thị phân cách hàng nghìn theo locale, giữ chuỗi thập phân chính xác và để nguyên phần vượt precision cho validation DEC-19-07.

**Validation trên grid.** Dùng token `error.main` cho icon, chữ và đường viền ở input, message và tooltip lỗi. Message và tooltip nền trắng. Slot thông báo giữ chiều cao cố định và tooltip thường giữ style mặc định.

**Căn lề PR.** Form, toolbar, grid và tổng tiền dùng cùng lề ngang của card. Tiêu đề hàng hóa hiển thị cả khi View. Tổng tiền dùng cỡ chữ 16px, tổng thanh toán 18px màu chủ đạo, với divider nhẹ giữa ba nhóm.

## Quản trị Common Dossier

Danh mục Loại hồ sơ dùng Common Master Data với Search Input, filter trạng thái, Làm mới và popup Create/View/Edit. Hệ thống có trang Cấu hình hồ sơ chứng từ lấy loại chứng từ từ API. Mã loại chứng từ mở Detail Page với ScrollTable, các nút di chuyển và xóa, và picker nhiều lựa chọn dùng Search Input, DataTable và FormDialog. Picker giữ lựa chọn qua tìm kiếm và phân trang, hiển thị loại Active chưa áp dụng. Thay đổi chỉ áp dụng khi Lưu cấu hình. Dirty Guard bảo vệ dữ liệu chưa lưu. Action Result Dialog hiển thị kết quả và giữ danh sách đang sửa nếu API thất bại.

## COMMON-DETAIL-PAGE-001 — Full Page Detail (chứng từ và quản trị)

Áp dụng cho mọi Full Page Create/View/Edit: chứng từ (HĐ, PR, PO, kho), danh mục full page và màn quản trị (Vai trò, Người dùng…). Dùng `DetailPageLayout` + `DetailTabs`, không tạo layout/footer riêng.

- **Page Header:** nút Quay lại (`backTo`/`onBack`), tiêu đề, mã đối tượng và Status Badge (`StatusChip`/`ActiveChip`); phụ đề tùy chọn. **Không** đặt nút lưu hoặc thay đổi đối tượng ở góc trên bên phải.
- **Detail Tabs:** ngay dưới header; trên màn `fillMedia` header và tabs đứng yên.
- **Content:** panel của tab là vùng cuộn độc lập (`DetailTabs` cuộn panel trên trang fill), nội dung dài không đẩy mất header, tabs hay footer. Trang có lưới dòng riêng (PR) dùng `naturalFlow` theo COMMON-DOC-LAYOUT-001.
- **Fixed Footer** (`DetailPageLayout.footer`): luôn ở đáy vùng làm việc, nút căn phải, hành động chính ngoài cùng phải. Create/Copy/Edit: Hủy bỏ, Lưu. View (từ trái sang phải): Ngừng hoạt động (outlined đỏ) hoặc Kích hoạt (outlined), Sao chép (outlined primary, icon Copy, cùng luồng Copy của danh sách), Chỉnh sửa (contained primary). Đối tượng hệ thống chỉ có thao tác được phép. Không lặp nút Quay lại ở footer.
- **Trạng thái** hiển thị **một lần**, bằng Status Badge ở Page Header (View/Edit); không lặp lại thành trường trong tab. Create/Copy không hiện trường trạng thái (mặc định hoạt động). Đổi trạng thái bằng action riêng + Confirm Dialog, không dùng switch disabled.

## COMMON-CONFIRM-001 — Confirm Dialog

`FormDialog` làm xác nhận: tiêu đề nêu thao tác, `description` nêu mã · tên đối tượng, nội dung nêu hệ quả (số người dùng bị ảnh hưởng, phần được giữ nguyên). Thao tác phá hủy (Ngừng hoạt động, Hủy) dùng `submitAction="void"` (outlined đỏ); khôi phục/xác nhận dùng primary. Thay đổi quyền cần xác nhận trước khi lưu. Nội dung tính từ dữ liệu ban đầu và dữ liệu sắp lưu, nêu đúng đối tượng: người dùng được thêm (nhận quyền nếu đối tượng đang hoạt động), bị gỡ, giữ nguyên (chỉ chịu tác động khi quyền đổi), số quyền thêm/gỡ, tổng sau khi lưu; đối tượng ngừng hoạt động thì nói rõ chưa tạo quyền hiệu lực; không đếm trùng; không khẳng định người dùng mất hẳn một quyền vì có thể còn từ vai trò khác. Chỉ đổi tên/mô tả thì không hiện cảnh báo quyền. Khi chưa tính hợp quyền từ nhiều Role, dùng số người dùng được gán vai trò sau khi lưu. Bảng thay đổi Role trình bày Quyền chức năng, Trước thay đổi và Sau thay đổi trong vùng cuộn của FormDialog.

## COMMON-LIST-TOOLBAR-001 — Toolbar của danh sách

- Toolbar dùng `FilterToolbar` (căn đáy, cao 36px). Control không phải ô nhập (switch + nhãn, số đếm, nút chữ như Mở tất cả/Đóng tất cả) bọc trong `FilterToolbarItem`: cao bằng ô nhập và căn giữa theo chiều dọc, nên tâm của chúng thẳng hàng với **tâm ô nhập**, không với cả khối gồm label. Không dùng margin, transform hay pixel offset để bù lệch. Thiếu chiều ngang thì wrap theo hàng, không chồng lấn.
- Toolbar điều khiển một danh sách dài nằm **ngoài phần cuộn của danh sách**: trên trang fill, toolbar sticky ở đầu vùng cuộn duy nhất của panel (không tạo thanh cuộn lồng nhau), danh sách bên dưới cuộn; tìm kiếm, lọc, tổng số đã chọn và mở/đóng nhóm luôn tiếp cận được.

## COMMON-PICKER-001 — Picker chọn nhiều

Theo Product Picker: `FormDialog` + `FilterToolbar` (Search, Làm mới) + `DataTable` phân trang/sort **phía server** + `pickerSelectionColumn`. Điều kiện **loại trừ** (ví dụ chính người thao tác) áp dụng ở server **trước COUNT và phân trang**, frontend không lọc bớt dòng của trang đã nhận; mục **hiển thị nhưng không chọn được** (đã gán) dùng `isLocked`, checkbox chọn trang chỉ áp dụng cho dòng chọn được. Lựa chọn giữ qua trang, tìm kiếm, sort và Làm mới; footer trái hiện "Đã chọn N"; mục đã gán hiển thị khóa (`isLocked`); Hủy bỏ không đổi dữ liệu; liên kết chỉ được lưu khi lưu đối tượng cha. Không có giới hạn cứng số kết quả.

## COMMON-ACTIVITY-001 — Lịch sử đối tượng quản trị

`ActivityHistoryTable` (shared) cho Vai trò và các đối tượng quản trị sau (Người dùng OA2, Cấu hình quy trình OA4): cột Thời gian, Người thực hiện, Hành động, Nội dung thay đổi; mới nhất trước; đọc metadata theo quy ước `before`/`after` (giá trị trước → sau), mảng mục được thêm/gỡ, `copiedFrom`; giá trị dạng đối tượng hiện mã (tên); mục lồng (membership) qua `formatItem`. Không hiển thị JSON thô. Chứng từ có vòng duyệt tiếp tục dùng `DocumentHistoryTable`.

## FE-VALIDATION-001 — Validation form và nút Lưu

- Không hiện lỗi khi vừa mở form Create. Lỗi hiện sau khi rời trường (blur) hoặc bấm Lưu; dấu * chỉ là bắt buộc, không phải lỗi.
- Label, viền và thông báo lỗi dùng cùng một trạng thái; giá trị hợp lệ thì xóa lỗi ngay.
- Nút Lưu **không** bị disable vì validation ẩn; chỉ disable khi đang gửi hoặc không có quyền. Bấm Lưu khi chưa hợp lệ: mở tab chứa lỗi, focus trường lỗi đầu tiên.
- Lỗi backend gắn đúng trường khi xác định được (ví dụ trùng mã); lưu thất bại giữ nguyên dữ liệu đang nhập; xung đột version nêu cách xử lý.

## COMMON-UI-CHECKLIST-001

Checklist bắt buộc trước khi tạo màn hình mới và khi nghiệm thu:

1. List: `ListPageLayout` + `FilterToolbar` (Làm mới sau bộ lọc cuối, không có Xóa bộ lọc) + `DataTable`; trạng thái list trên URL; quay lại giữ trạng thái; `sortModel`/`paginationModel` ổn định tham chiếu; server áp điều kiện lọc/loại trừ trước COUNT.
1a. Toolbar theo COMMON-LIST-TOOLBAR-001 (căn theo ô nhập; toolbar danh sách dài không cuộn theo danh sách).
2. Full page: COMMON-DETAIL-PAGE-001 (header không có nút lưu/thay đổi, trạng thái chỉ ở header, footer cố định đủ thao tác, panel cuộn).
3. Readonly theo COMMON-READONLY-001, không dùng disabled cho dữ liệu chỉ đọc.
4. Validation theo FE-VALIDATION-001; Dirty Guard khi rời trang có thay đổi.
5. Nút theo COMMON-BUTTON-001; xác nhận theo COMMON-CONFIRM-001; kết quả bằng `ActionResultDialog` (UI-15).
6. Picker theo COMMON-PICKER-001; lịch sử theo COMMON-ACTIVITY-001 hoặc `DocumentHistoryTable` với chứng từ.
7. Kiểm tra trình duyệt thật ở 1920×1080 và 1366×768 theo UI-EVIDENCE-001, gồm các màn hình dùng chung component vừa sửa.

## COMMON-BUTTON-001

Nút thao tác nghiệp vụ dùng `ActionButton` và mapping icon theo ngữ nghĩa, bên trái chữ và giữ icon khi disabled. Thêm dùng Add, Lưu dùng Save, Hủy bỏ dùng Close, Chỉnh sửa dùng Edit, Xác nhận dùng Check, Làm mới và Thay thế dùng Refresh, Xóa dùng Delete, Gửi duyệt dùng Send, Tải lên/xuống dùng Upload/Download, Hủy chứng từ dùng Block và Từ chối dùng CancelOutlined. Nút chính nền xanh. Nút phụ nền trắng viền xanh. Nút phá hủy nền trắng viền đỏ. `FormDialog` nhận `submitAction` và dùng mapping chung với footer thao tác và xác nhận workflow. Nút chỉ có icon dùng cho phần tử compact trong grid, file và điều khiển giao diện, kèm tooltip và tên truy cập. Tab, link điều hướng và control giao diện theo quy chuẩn riêng.

### Header grid, trường View và dialog

- DataTable và ScrollTable dùng header #E8EEF5, chữ #334155, weight 600, viền dưới #CBD5E1 và phân cách cột nhẹ #E2E8F0. Dòng lẻ #FFFFFF, dòng chẵn #F5F7FA, hover #EDF2F7 và selected #EFF5FF. Selected ưu tiên hơn hover và nền xen kẽ. Phân cách dòng #E2E8F0. Ô sticky giữ cùng nền với dòng; ô nhập và lỗi validation vẫn dùng style hiện tại. Header và nội dung văn bản dài nằm một dòng.
- **COMMON-READONLY-001.** `ReadOnlyField` dùng nền #F8FAFC, chữ #334155, viền #E2E8F0 (kể cả khi hover/focus). Readonly **khác** disabled: không dùng `disabled` cho dữ liệu chỉ đọc (View Mode và trường bất biến trong Edit, ví dụ mã). Dữ liệu chọn và sao chép được; giá trị trống dùng dấu —. View hiển thị nhãn lựa chọn dạng văn bản và bỏ required, mũi tên dropdown, clear. Disabled chỉ dành cho control tạm thời không thao tác được (đang gửi, thiếu quyền).
- Header dialog nền trắng cao tối thiểu 56px, padding ngang 24px và flex căn giữa title 18px weight 600 cùng icon Đóng. Content cuộn riêng, padding 24px hoặc 12px ở biến thể compact. Footer có divider, thông tin selection ở trái khi có và nhóm nút ở phải. Dialog bo 12px. ActionResultDialog giữ trình bày riêng.

## COMMON-FILE-CELL-001

`FileAttachmentCell` hiển thị nút Tải lên có icon khi trống và có quyền quản lý. Khi có file, icon file, tên tải xuống, icon thay thế và icon xóa nằm cạnh nhau trong một dòng. `GridText` bổ sung ellipsis và tooltip truy cập bàn phím khi tên bị cắt. Cell chỉ đọc hiện tên tải xuống hoặc dấu —. Xác nhận dùng Common FormDialog. Lỗi dùng Action Result Dialog. Loading giới hạn tại cell đang xử lý.

Tab Hồ sơ PR dùng `ScrollTable` với một tầng header sticky, 7 cột và footer đếm hồ sơ. Có bản giấy mặc định bỏ tích và độc lập với file. Người có quyền quản lý có thể nhập ngày phát hành, người phát hành và ghi chú bất kể Có bản giấy. Bỏ tích giữ cả ba giá trị. Document Grid hàng hóa tiếp tục nằm dưới tab. Create/Edit lưu cùng PR. View có nút Lưu hồ sơ dạng phụ khi có quyền quản lý và có dòng hồ sơ. Dirty Guard giữ dữ liệu qua các lần chuyển tab và bảo vệ khi rời trang. Xem [vòng đời và lưu trữ](DOCUMENT-DOSSIER-ORGANIZATION-ROADMAP.md#phase-42).

Grid Hồ sơ dành đủ chỗ cho tên loại thông dụng và cho cột Ghi chú, File đính kèm co giãn. Hộp thoại thay thế tách file hiện tại và file thay thế thành hai khối, dùng chung FormDialog. Kết quả lưu dùng Action Result Dialog theo UI-15, nêu mã PR khi thành công và nguyên nhân kèm hướng xử lý khi thất bại.

`DocumentTotals` hiển thị số 0 theo precision tiền tệ. Gắn mã tiền tệ với tổng thanh toán có giá trị, ví dụ **0 VND**. Giá trị thiếu dùng **—**.

## COMMON-TREE-VIEW-001 — Tree View

Cây (ví dụ Cơ cấu tổ chức) dùng MUI List/Collapse, không thêm dependency. Thanh công cụ của cây gồm Search Input, nút mở rộng toàn bộ (`KeyboardDoubleArrowDown`) và thu gọn toàn bộ (`KeyboardDoubleArrowUp`) dạng `IconButton` 32×32px màu trung tính (`text.secondary`, không viền), có tooltip và `aria-label`, cùng Làm mới có chữ ở bên phải. Tìm kiếm giữ đường dẫn tổ tiên. Mỗi nút hiện mã · tên và dòng phụ (trạng thái, số con, số nhân sự). Thêm/sửa/kết thúc dữ liệu con hoặc Làm mới chỉ invalidate query: trạng thái mở/thu gọn, nút đang chọn và tab chi tiết được giữ nguyên.

Cột boolean "có/không" trong bảng quản trị (đơn vị chính, trưởng đơn vị) dùng dấu check `CheckCircle` màu success căn giữa, ô trống khi không; thống nhất giữa màn User và Organization. Selector chọn một mục từ danh mục có thể lớn dùng autocomplete tìm phía server (`q`, phân trang), không tải toàn bộ hoặc cắt cứng số mục.
