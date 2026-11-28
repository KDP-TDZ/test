# StudyCheck AI — Security Specification & Dirty Dozen Payloads

## 1. Data Invariants
1. **Strict Ownership**: Every document in `analyses`, `quizSets`, `practiceItems`, and `users/{uid}/**` MUST have `ownerUid == request.auth.uid` (or `uid == request.auth.uid`), verified against the Firebase ID token, never trusted from arbitrary payload parameters.
2. **No Self-Privilege Escalation**: Ordinary users cannot create or update `admins/{uid}`, `systemConfig/{configId}`, `adminSecrets/{secretId}`, `auditLogs/{logId}`, `referenceBooks/{referenceId}`, or `referenceChunks/{chunkId}`, nor inject `isAdmin`/`superAdmin` fields into `users/{uid}`.
3. **Secret Hygiene**: `adminSecrets` stores only AES-256-GCM encrypted ciphertext + masked identifier (`AIzaSy••••xxxx`)—never plaintext API keys or `rawKey`/`apiKey` fields (explicitly denied by rules).
4. **Immutable Ownership & Timestamps**: `ownerUid` and `createdAt` cannot be mutated on `update`.
5. **Verified Email Gate**: All authenticated writes require `request.auth.token.email_verified == true`.
6. **Query Enforcement**: Every `allow list` rule evaluates `resource.data.ownerUid == request.auth.uid` (or `isSuperAdmin()`), never delegating filtering to client queries.
7. **Practice Item Preservation**: Only the owner student can delete a `practiceItems/{itemId}` document.
8. **Public Experience Ratings Hygiene**: `experienceRatings/{ratingId}` stores strictly non-PII public rating data (`visibility == 'public'`, integer scores 1..5, `authorName <= 60`, required trimmed written `comment` between 5 and 400 characters). Signed-in verified users write only to `ratingId == request.auth.uid` with `ownerUid == request.auth.uid`; guests may only create once under `guest_<id>` (`ownerUid == 'guest'`, `isVerifiedAccount == false`) and can never update or delete any document.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Shadow Admin Injection on User Signup**: `POST users/uid1` with `{ uid: "uid1", isSuperAdmin: true, role: "super_admin" }` -> MUST fail (`hasOnly` key whitelist rejects `role` / `isSuperAdmin`).
2. **Cross-Tenant Analysis Spoofing**: User A tries `create analyses/a1` with `{ ownerUid: "userB", ... }` -> MUST fail (`ownerUid == request.auth.uid`).
3. **Cross-Tenant Analysis Read/List**: User A tries `list analyses` without `where('ownerUid', '==', 'userA')` -> MUST fail (`resource.data.ownerUid == request.auth.uid`).
4. **Unverified Email Spoof**: User with `email: "tuankhang2011pm@gmail.com"` and `email_verified: false` tries `write systemConfig/aiService` -> MUST fail (`email_verified == true`).
5. **Global AI Switch Tampering**: Student tries `update systemConfig/aiService` with `{ enabled: false }` -> MUST fail (`isSuperAdmin()` required).
6. **Encrypted Secret Scraping**: Student tries `get adminSecrets/primary` or `list adminSecrets` -> MUST fail (`isSuperAdmin()` required).
7. **ID Poisoning (1.5KB Junk Document ID)**: User tries `create analyses/<1500 chars>` -> MUST fail (`isValidId` rejects `size > 128` or invalid chars).
8. **Resource Exhaustion (1MB String in `documentTitle`)**: User tries `create analyses/a1` with 1MB `documentTitle` -> MUST fail (`documentTitle.size() <= 200`).
9. **Owner Transfer on Update**: User A tries `update analyses/a1` changing `{ ownerUid: "userB" }` -> MUST fail (`incoming().ownerUid == existing().ownerUid`).
10. **Practice Bank Unauthorized Deletion**: User A tries `delete practiceItems/p_belonging_to_B` -> MUST fail (`existing().ownerUid == request.auth.uid`).
11. **Fake Textbook Injection**: Student tries `create referenceBooks/ref1` -> MUST fail (`isSuperAdmin()` required).
12. **Audit Log Forgery / Deletion**: Anyone tries `delete auditLogs/log1` -> MUST fail (audit logs are append-only by Super Admin, never deletable from client).
13. **Experience Rating Score Poisoning**: Guest or user tries `create experienceRatings/guest_12345678` with `{ stars: 999, comment: "<5000 chars>" }` -> MUST fail (`stars is int && stars >= 1 && stars <= 5`, `comment.size() <= 400`).
14. **Experience Rating Account Spoofing**: Guest tries `create experienceRatings/uid_victim` with `{ isVerifiedAccount: true, ownerUid: "uid_victim" }` -> MUST fail (guest branch requires `guest_` prefix, `ownerUid == 'guest'`, `isVerifiedAccount == false`).
15. **Experience Rating Shadow Field / PII Injection**: Payload adds `{ email: "a@b.com", featured: true }` -> MUST fail (`hasOnly` whitelist rejects extra keys).
16. **Guest Overwrite / Delete Tampering**: Guest tries `update` or `delete` on `experienceRatings/guest_12345678` -> MUST fail (updates/deletes require verified owner or Super Admin).
17. **Empty or Star-Only Experience Rating**: Guest or user tries `create experienceRatings/guest_12345678` with `{ stars: 5, comment: "   " }` -> MUST fail (`comment.trim().size() >= 5 && comment.size() <= 400`).
