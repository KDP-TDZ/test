# StudyCheck AI — Security Audit Summary (`vibe-check`)

**Audit Date:** 2026-11-23  
**Target Audited (Local):** `http://localhost:3000` (Express + Vite 8 SPA)  
**Target Deployment Configs Reviewed:** `vercel.json`, `render.yaml`, `firestore.rules`

> **Local Scan Caveat:** Live HTTP checks were run against the local development server (`http://localhost:3000`). Local scans cannot verify production TLS/HSTS enforcement, production CDN/Vercel edge headers (`vercel.json`), or deployed live Firestore rules until deployed.

---

## 1. Live Scan Summary (Before vs. After)

| Check Category | Before Fixes | After Fixes | Notes |
| --- | --- | --- | --- |
| **Exposed Secrets / Dotfiles** (`/.env`, `/.git/config`) | PASS (SPA fallback, no `.env`/`.git` on disk) | PASS | Verified no `.env`, `.env.local`, or `.git` files exist on disk. |
| **Public Sensitive Files** (`/public/...`) | FAIL (2 issues) | PASS | Redacted personal admin email in `/public/TONG_KET_HE_THONG_STUDYCHECK_AI.txt`; deleted 2 stray raw prompt files in `/public/assets/aistudio/Paste_November_*`. |
| **CORS Policy** (`GET`/`OPTIONS /api/health` with `Origin: https://evil.example.com`) | FAIL (reflected arbitrary `Origin`) | PASS | Untrusted origins receive no `Access-Control-Allow-Origin`; same-origin (`http://localhost:3000`) and explicit allowlist entries pass. |
| **Security Headers** (`X-Powered-By`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `CSP-Report-Only`) | FAIL (5 missing / 1 fingerprint) | PASS (local) / UNVERIFIED (prod HSTS & Vercel edge) | Removed `X-Powered-By`; added `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy-Report-Only`, and HTTPS-conditional `Strict-Transport-Security` in Express + `vercel.json`. `X-Frame-Options` intentionally omitted for AI Studio iframe preview compatibility. |
| **Auth Error Handling** (`GET /api/admin/overview`, `POST /api/ai/*` without token or invalid token) | WARN (`detail` exposed raw SDK error) | PASS | Returns HTTP 401 with generic message and no internal details. |
| **Debug / API Docs Endpoints** (`/swagger.json`, `/api-docs`, `/graphql`, `/api/admin/debug/snapshot`) | PASS | PASS | No public docs endpoints; admin debug snapshot requires verified Super Admin token (HTTP 401 unauthenticated). |

**Live Scan Totals (Local):**
- **Before:** 3 FAIL, 1 WARN, 2 PASS
- **After:** 0 FAIL, 0 WARN, 6 PASS *(production HTTPS/HSTS and `vercel.json` edge headers remain unverified until deployed)*

---

## 2. External Tool Results

| Tool | Status | Result / Action |
| --- | --- | --- |
| `bun audit` | Executed (`bun.lock`) | Found **2 transitive vulnerabilities** in `@grpc/grpc-js@1.9.16` (pulled by `firebase > @firebase/firestore-compat > @firebase/firestore > @grpc/grpc-js`): 1 High (`GHSA-m9gg-hp2v-232j`, `<1.13.6`) and 1 Low (`GHSA-f596-whhp-79r4`, `<1.13.6`). Note: the app uses modular `firebase/firestore` in the browser (HTTPS/WebChannel) and `firebase-admin` already resolves `@grpc/grpc-js@1.14.7`. Upgrade `firebase` SDK when ready and re-run `bun audit`. |
| `npx eslint firestore.rules` | Executed | **PASS** (exit code 0, 0 errors/warnings after hardening `firestore.rules`). |
| `npx --yes tsx --test src/core/*.test.ts src/server/*.test.ts firestore.rules.test.ts` | Executed | **PASS** (57/57 tests passed, including new `src/core/urlSecurity.test.ts` and expanded `firestore.rules.test.ts`). |
| `gitleaks` | Not installed | Not installed in this environment. Install with `brew install gitleaks` (macOS) or download from GitHub releases, then run `gitleaks detect --source . --verbose`. |
| `semgrep` | Not installed | Not installed in this environment. Install with `pip install semgrep` or `brew install semgrep`, then run `semgrep --config auto`. |

---

## 3. 17-Category Codebase Audit Matrix

| # | Category | Status | Findings & Remediation |
| --- | --- | --- | --- |
| 1 | **Secrets & Key Management** | FIXED (Action required before prod) | **Fixed:** Replaced predictable AES-256-GCM fallback key in `src/server/singleKeyService.ts` (previously derived from public `firebaseConfig.projectId` + `firebaseConfig.apiKey`) with an ephemeral per-process `crypto.randomBytes(32)` key when `KEY_ENCRYPTION_SECRET` is unset. **Action Required:** Set a strong 32+ char `KEY_ENCRYPTION_SECRET` in production environment variables before deploying. Public `firebase-applet-config.json` `apiKey` is a standard Firebase client identifier. |
| 2 | **Firestore Rules / RLS** | FIXED (Local verified; deploy required) | **Fixed in `firestore.rules`:** (a) Restricted `adminSecrets/{secretId}` `get` from `isVerifiedUser()` to `isSuperAdmin()`; (b) Blocked self-assigned `isSuperAdmin: true` on `users/{uid}` create; (c) Added `isValidUsageDaily(data, uid)` and `isValidId(date)` on `users/{uid}/usageDaily/{date}`; (d) Capped single-write score/examCount jumps on `leaderboard/{uid}`; (e) Added field validation on `feedback/{feedbackId}` update; (f) Added `isValidId(date)` on `apiUsageDaily/{date}`. **Note:** Automated rule deployment returned a permission error for this environment; deploy `firestore.rules` via Firebase Console or `firebase deploy --only firestore:rules`. |
| 3 | **Auth Middleware** | FIXED | All `/api/ai/*`, `/api/feedback/*`, and `/api/admin/*` routes require Firebase ID token verification via `requireAuth` / `requireSuperAdmin`. **Fixed:** Restricted `hydrateSingleKeyForSuperAdmin` to `authUser.isSuperAdmin` only, and removed raw internal error `detail` from 401 responses. |
| 4 | **IDOR / Access Control** | FIXED | Firestore collections scope user-owned records (`users/{uid}`, `documents/{docId}`, `analyses/{id}`, `quizAttempts/{id}`, `examAttempts/{id}`) to `request.auth.uid == resource.data.uid` or Super Admin. **Fixed:** Added `isValidFirestoreDocId(targetUid)` on `/api/admin/roles` and `/api/admin/roles/:uid` to prevent REST path traversal. |
| 5 | **Frontend & Exposed Files** | FIXED | **Fixed:** Redacted personal Super Admin email from `/public/TONG_KET_HE_THONG_STUDYCHECK_AI.txt` and deleted two stray raw prompt files from `/public/assets/aistudio/`. Verified no auth tokens are stored in `localStorage`/`sessionStorage` (only UI preferences and local draft state). |
| 6 | **SSRF & Outbound Requests** | FIXED | **Fixed:** Hardened `src/core/urlSecurity.ts` to block IPv4-mapped IPv6 addresses (both dotted `::ffff:127.0.0.1` and hex `::ffff:7f00:1`, `::ffff:a9fe:a9fe`), unspecified `::`, and full `fe80`–`febf` link-local ranges. Updated `assertResolvedHostSafe` in `src/server/referenceIngestService.ts` to fail closed on DNS lookup failures or empty answers. |
| 7 | **CSRF** | PASS | API authentication relies exclusively on explicit `Authorization: Bearer <Firebase ID token>` headers rather than ambient session cookies; combined with strict CORS origin validation, cross-site request forgery is mitigated. |
| 8 | **Security Headers & CSP** | FIXED (Local verified; prod unverified) | **Fixed:** Disabled `X-Powered-By`, added `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, `Content-Security-Policy-Report-Only`, and HTTPS-conditional `Strict-Transport-Security` in `src/server/app.ts` and `vercel.json`. Monitor CSP reports before switching to enforcing `Content-Security-Policy`. |
| 9 | **CORS Configuration** | FIXED | **Fixed:** Replaced permissive origin reflection in `src/server/app.ts` with `isAllowedCorsOrigin()` in `src/core/urlSecurity.ts` — allows same-origin and explicit `ALLOWED_ORIGIN` / `systemConfig.allowedOrigins` entries while rejecting `*` and untrusted third-party origins. Set `ALLOWED_ORIGIN` in production if frontend and API use distinct origins. |
| 10 | **Cookies & Sessions** | PASS | Application does not issue custom session cookies; Firebase Auth manages client session tokens natively. |
| 11 | **Rate Limiting & Abuse Protection** | FIXED | **Fixed:** Applied `checkAiRequestGuard` to previously unthrottled `POST /api/ai/suggest-from-filename` and `POST /api/feedback/classify`, plus strict enum/length bounds on feedback payloads. |
| 12 | **SQL / NoSQL / Command Injection** | PASS / FIXED | No SQL database or shell command execution in app code. Firestore access uses typed SDK/REST calls. **Fixed:** Enforced document ID format checks (`isValidFirestoreDocId`) on admin role REST paths. |
| 13 | **XSS & Output Sanitization** | FIXED | No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` usage found. **Fixed:** Wrapped external AI/reference links in `src/components/SplitDocumentViewer.tsx` and `src/components/AnalysisReportView.tsx` with `sanitizeExternalHttpUrl()` so `javascript:` / `data:` URLs cannot execute. |
| 14 | **Webhooks & Payments** | N/A | No payment processor, Stripe webhook, or third-party webhook ingestion routes exist in the application. |
| 15 | **Error Handling & Information Disclosure** | FIXED | **Fixed:** Updated `mapGeminiErrorResponse(err, includeDebug = false)` so `technicalDetail` and server-wide `recentExecutions` are only returned to Super Admins. Sanitized Express catch-all 500 handler (`src/server/app.ts`) and Vercel 500 handler (`src/server/vercelHandler.ts`). |
| 16 | **File Uploads** | FIXED | Size limits (5 MB images / 4 MB PDF & DOCX) and magic-byte validation were already enforced on student upload endpoints. **Fixed:** Added strict MIME allowlist (`image/jpeg`, `image/png`, `image/webp`) and `hasValidMagicSignature` checks to `POST /api/admin/references/ocr-pages`. |
| 17 | **Password Hashing & Dependencies** | PASS (Auth) / WARN (Deps) | Authentication & password handling are delegated entirely to Firebase Auth. See `bun audit` section above for the 2 transitive `@grpc/grpc-js` advisories under `firebase`. |

---

## 4. Remaining Actions Before Production Deployment

1. **Deploy `firestore.rules`:** Publish the updated `/firestore.rules` to Firebase project `gen-lang-client-0000361568` via Firebase Console or `firebase deploy --only firestore:rules` (automated deployment in this sandbox returned a caller permission error).
2. **Set Server Environment Variables:** Configure `KEY_ENCRYPTION_SECRET` (random 32+ byte secret) and `ALLOWED_ORIGIN` (comma-separated production origins) in Vercel/Render environment settings.
3. **Verify Production Headers:** Re-run header/CORS checks against the deployed HTTPS URL to verify `Strict-Transport-Security` and `vercel.json` edge headers, then promote `Content-Security-Policy-Report-Only` to enforcing `Content-Security-Policy` once verified clean.
4. **Upgrade Transitive Dependency:** Upgrade `firebase` in `package.json` when convenient to pick up `@grpc/grpc-js >= 1.13.6` and re-run `bun audit`.
