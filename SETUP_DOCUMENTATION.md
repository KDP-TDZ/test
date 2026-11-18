# StudyCheck AI — Tài liệu Thiết lập & Vận hành Hệ thống (Zero-Billing / Spark Tier)

## 1. Tổng quan kiến trúc

- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 (giao diện Liquid Glass).
- **Backend (`server.ts`)**: Express + Vite middleware (chạy trên cổng `3000`). Mọi tác vụ AI (OCR, đối chiếu kiến thức, sinh câu hỏi trắc nghiệm) và quản trị đều đi qua backend xác thực bằng Firebase ID Token.
- **Không yêu cầu Billing Account (100% tương thích Spark / Starter Tier)**:
  - **Không dùng Google Cloud Secret Manager** hay Firebase Cloud Storage Blaze.
  - **Firebase Authentication**: Google Sign-In & Email/Password (yêu cầu xác minh email).
  - **Cloud Firestore** (Database ID trong `firebase-applet-config.json`): Lưu hồ sơ học sinh, lịch sử phân tích (bao gồm toàn bộ trang trích xuất, bounding box, claims, annotations), bộ câu hỏi, Ngân hàng luyện tập câu sai, Thống kê kiến thức đã học, Thư viện sách giáo khoa (chunks), cấu hình AI, khóa API đã mã hóa (`adminSecrets/primary`) và nhật ký kiểm toán.
  - **Google Gemini API (`@google/genai`)**: Sử dụng **1 API Key duy nhất** cho mọi tác vụ (OCR, nhận diện môn học, kiểm định + Google Search Grounding, tạo câu hỏi trắc nghiệm) với model `gemini-4-hydrogen`.

---

## 2. Cấu hình Firebase

Thông số dự án Firebase đã được kết nối trong `/firebase-applet-config.json` và triển khai quy tắc bảo mật từ `/firestore.rules`.

Kiểm tra lại trong Firebase Console nếu cần:
1. Bật các phương thức đăng nhập mong muốn (**Google**, **Email/Password**) trong **Authentication → Sign-in method**.
2. Không cần kích hoạt Blaze Plan hay Firebase Storage bucket.

---

## 3. Cấu hình 1 Gemini API Key duy nhất (do Quản trị viên tự thêm)

Hệ thống chỉ sử dụng **1 Gemini API key duy nhất** cho toàn bộ tác vụ AI:

### Cách 1 — Quản trị viên tự thêm trực tiếp trong Admin UI (Khuyên dùng)
1. Đăng nhập bằng tài khoản Super Admin (`tuankhang2011pm@gmail.com`).
2. Vào **Quản trị hệ thống → API Key duy nhất**.
3. Dán API key bất kỳ bạn muốn sử dụng, bấm **Thử nghiệm key đang nhập** (nếu muốn kiểm tra trước) rồi bấm **Lưu & Áp dụng cho toàn hệ thống**.
4. Key được mã hóa bằng **AES-256-GCM** trên backend và lưu bản sao mã hóa vào `adminSecrets/primary` (chỉ Super Admin được quyền đọc/ghi trong `firestore.rules`), không bao giờ trả khóa thô về trình duyệt.

### Cách 2 — Biến môi trường máy chủ (Tùy chọn fallback)
- Có thể đặt biến `GEMINI_API_KEY` trong Secrets của AI Studio / Cloud Run (xem `.env.example`).
- Nếu Admin đã thêm key trong Admin UI, hệ thống ưu tiên sử dụng key của Admin; khi Admin gỡ key sẽ tự quay về `GEMINI_API_KEY` nếu có.

---

## 4. Phân quyền Super Admin

- Tài khoản Super Admin được ủy quyền: `tuankhang2011pm@gmail.com` (đã xác minh email).
- Không cần cấp quyền IAM Firebase Auth Admin; backend xác thực ID token đã ký qua `verifyIdToken` và `firestore.rules` kiểm tra `request.auth.token.email_verified == true && request.auth.token.email == 'tuankhang2011pm@gmail.com'`.

---

## 5. Quản lý Công tắc AI & Thư viện sách tham chiếu

### Công tắc dịch vụ AI toàn hệ thống
- Trong tab **Công tắc AI** của Super Admin, quản trị viên có thể chuyển trạng thái `ACTIVE` ↔ `DISABLED` và tùy chỉnh thông báo bảo trì tiếng Việt.
- Trạng thái được lưu tại `systemConfig/aiService` và kiểm tra trực tiếp trên server trước mọi request `/api/ai/*` (trả về HTTP `503` khi tắt).
- Khi tắt AI, học sinh vẫn mở được Bảng điều khiển, Lịch sử phân tích, Trình đối chiếu hai cột, Bộ câu hỏi đã lưu, Ngân hàng luyện tập và Thống kê kiến thức đã học.

### Thư viện sách giáo khoa tham chiếu
- Quản trị viên có thể thêm sách chuẩn bằng **tải PDF có lớp văn bản** hoặc **nhập URL HTTPS công khai** (tích hợp bộ lọc chống SSRF chặn localhost/private IP/redirect nguy hiểm).
- Tài liệu được tách thành các đoạn kiến thức có chỉ mục (`referenceChunks`) kèm số trang, chương và bài học để AI đối chiếu chính xác trước khi dùng Web Grounding.

---

## 6. Kiểm thử & Triển khai Production

```bash
# Chạy kiểm thử đơn vị
npm test

# Kiểm tra lint Firestore security rules
npx eslint firestore.rules && npx tsx --test firestore.rules.test.ts

# Kiểm tra TypeScript & Build Production
npm run lint
npm run build

# Khởi động máy chủ Production trên cổng 3000
npm start
```
