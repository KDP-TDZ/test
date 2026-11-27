var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/retrieval.ts
function tokenizeVietnamese(text) {
  return text.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((token) => token.length >= 2);
}
function sanitizeReferenceChunkForFirestore(params) {
  const safeRefId = params.referenceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "ref_book";
  const idx = Math.max(1, Math.floor(params.fallbackIndex ?? 1));
  const rawChunkId = (params.chunkId || `${safeRefId}_c${idx}`).replace(/[^a-zA-Z0-9_-]/g, "_");
  const chunkId = rawChunkId.slice(0, 120) || `${safeRefId}_c${idx}`;
  const chapter = (params.chapter || "Ch\u01B0\u01A1ng 1: Ki\u1EBFn th\u1EE9c tr\u1ECDng t\xE2m").trim().slice(0, 190);
  const lesson = (params.lesson || "B\xE0i h\u1ECDc tr\u1ECDng t\xE2m").trim().slice(0, 180);
  const sectionTitle = (params.sectionTitle || lesson || "N\u1ED9i dung chu\u1EA9n SGK").trim().slice(0, 180);
  const parsedPage = Math.floor(Number(params.pageNumber));
  const pageNumber = Number.isFinite(parsedPage) && parsedPage >= 1 ? parsedPage : idx;
  const content = (params.content || "").trim().slice(0, 6e3) || chapter;
  const cleanList = (arr, maxItems, maxLen = 140) => Array.isArray(arr) ? arr.map((item) => typeof item === "string" ? item.trim().slice(0, maxLen) : "").filter(Boolean).slice(0, maxItems) : [];
  let keywords = cleanList(params.keywords, 10, 80);
  if (keywords.length === 0) {
    const tokens = tokenizeVietnamese(`${sectionTitle} ${content}`);
    const freq = /* @__PURE__ */ new Map();
    for (const t of tokens) {
      if (t.length >= 3) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    keywords = Array.from(freq.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  }
  const learningObjectives = cleanList(params.learningObjectives, 8, 220);
  const conceptTags = cleanList(params.conceptTags, 8, 80).length > 0 ? cleanList(params.conceptTags, 8, 80) : keywords.slice(0, 4);
  return {
    chunkId,
    referenceId: safeRefId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: (params.textbookSeries || "Chu\u1EA9n ch\u01B0\u01A1ng tr\xECnh GDPT 2018").trim().slice(0, 100),
    chapter,
    lesson,
    pageNumber,
    sectionTitle,
    content,
    keywords,
    learningObjectives,
    conceptTags
  };
}
function retrieveRelevantChunks(queryText, chunks, options = {}) {
  const { referenceId, selectedChapters, topK = 6 } = options;
  const queryTokens = Array.from(new Set(tokenizeVietnamese(queryText)));
  if (queryTokens.length === 0 || chunks.length === 0) {
    return [];
  }
  const filtered = chunks.filter((c) => {
    if (referenceId && c.referenceId !== referenceId) return false;
    if (selectedChapters && selectedChapters.length > 0) {
      return selectedChapters.some(
        (ch) => c.chapter.toLowerCase().includes(ch.toLowerCase()) || ch.toLowerCase().includes(c.chapter.toLowerCase())
      );
    }
    return true;
  });
  const pool = filtered.length > 0 ? filtered : chunks.filter((c) => !referenceId || c.referenceId === referenceId);
  const scored = pool.map((chunk) => {
    const contentTokens = new Set(tokenizeVietnamese(chunk.content));
    const titleTokens = new Set(tokenizeVietnamese(`${chunk.sectionTitle} ${chunk.lesson} ${chunk.chapter}`));
    const keywordSet = new Set(chunk.keywords.map((k) => k.toLowerCase()));
    const conceptSet = new Set(chunk.conceptTags.map((k) => k.toLowerCase()));
    let score = 0;
    const matchedKeywords = [];
    for (const qt of queryTokens) {
      if (titleTokens.has(qt)) {
        score += 3;
        matchedKeywords.push(qt);
      } else if (keywordSet.has(qt) || conceptSet.has(qt)) {
        score += 2.5;
        matchedKeywords.push(qt);
      } else if (contentTokens.has(qt)) {
        score += 1;
        matchedKeywords.push(qt);
      }
    }
    const normalized = score / Math.max(1, Math.sqrt(queryTokens.length));
    return {
      chunk,
      lexicalScore: Math.round(normalized * 100) / 100,
      matchedKeywords: Array.from(new Set(matchedKeywords)).sort()
    };
  });
  return scored.filter((item) => item.lexicalScore > 0).sort(
    (a, b) => b.lexicalScore - a.lexicalScore || a.chunk.pageNumber - b.chunk.pageNumber || a.chunk.chunkId.localeCompare(b.chunk.chunkId)
  ).slice(0, topK);
}
function buildChunksFromPages(params) {
  const {
    referenceId,
    grade,
    subject,
    textbookSeries,
    pages,
    startingChunkIndex = 0,
    initialChapter = "Ch\u01B0\u01A1ng 1: Ki\u1EBFn th\u1EE9c n\u1EC1n t\u1EA3ng",
    initialLesson = "B\xE0i 1"
  } = params;
  const chunks = [];
  let currentChapter = initialChapter;
  let currentLesson = initialLesson;
  let chunkIndex = startingChunkIndex;
  for (const page of pages) {
    const lines = page.text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    let buffer = [];
    let currentSection = "N\u1ED9i dung ch\xEDnh";
    const flushBuffer = () => {
      const content = buffer.join(" ").trim();
      if (content.length < 30) {
        buffer = [];
        return;
      }
      chunkIndex += 1;
      chunks.push(
        sanitizeReferenceChunkForFirestore({
          chunkId: `${referenceId}_c${chunkIndex}`,
          referenceId,
          grade,
          subject,
          textbookSeries,
          chapter: currentChapter,
          lesson: currentLesson,
          pageNumber: page.pageNumber,
          sectionTitle: currentSection,
          content,
          fallbackIndex: chunkIndex
        })
      );
      buffer = [];
    };
    for (const line of lines) {
      if (/^(chương|chủ đề|chuyên đề)\s+[0-9ivxlcdm]+/i.test(line)) {
        flushBuffer();
        currentChapter = line.slice(0, 180);
      } else if (/^(bài|tiết)\s+[0-9]+/i.test(line)) {
        flushBuffer();
        currentLesson = line.slice(0, 180);
      } else if (/^([0-9]+\.|[ivx]+\.)\s+/i.test(line) && line.length < 90) {
        flushBuffer();
        currentSection = line;
      } else {
        buffer.push(line);
        if (buffer.join(" ").length >= 750) {
          flushBuffer();
        }
      }
    }
    flushBuffer();
  }
  return chunks;
}
var init_retrieval = __esm({
  "src/core/retrieval.ts"() {
  }
});

// src/core/urlSecurity.ts
function isPrivateIpv4(ip) {
  return PRIVATE_IPV4_RANGES.some((regex) => regex.test(ip));
}
function extractMappedIpv4FromIpv6(cleanIpv6) {
  const dottedMatch = cleanIpv6.match(/^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dottedMatch) {
    return dottedMatch[1];
  }
  const hexMatch = cleanIpv6.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
      return `${hi >> 8 & 255}.${hi & 255}.${lo >> 8 & 255}.${lo & 255}`;
    }
  }
  return null;
}
function isPrivateOrLoopbackHost(hostOrIp) {
  const hostname = hostOrIp.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) return true;
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return true;
  }
  if (isPrivateIpv4(hostname)) {
    return true;
  }
  if (hostname.includes(":")) {
    const mappedIpv4 = extractMappedIpv4FromIpv6(hostname);
    if (mappedIpv4 && isPrivateIpv4(mappedIpv4)) {
      return true;
    }
    if (hostname === "::1" || hostname === "::" || /^fe[89ab][0-9a-f]?:/i.test(hostname) || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.includes("127.0.0.1") || hostname.includes("169.254.")) {
      return true;
    }
  }
  return false;
}
function validateReferenceUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: "\u0110\u01B0\u1EDDng d\u1EABn URL kh\xF4ng \u0111\u01B0\u1EE3c \u0111\u1EC3 tr\u1ED1ng." };
  }
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: "\u0110\u1ECBnh d\u1EA1ng URL kh\xF4ng h\u1EE3p l\u1EC7." };
  }
  if (parsed.protocol !== "https:") {
    return { valid: false, reason: "Ch\u1EC9 ch\u1EA5p nh\u1EADn \u0111\u01B0\u1EDDng d\u1EABn HTTPS b\u1EA3o m\u1EADt." };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, reason: "URL kh\xF4ng \u0111\u01B0\u1EE3c ch\u1EE9a th\xF4ng tin \u0111\u0103ng nh\u1EADp nh\xFAng." };
  }
  const hostname = parsed.hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(hostname)) {
    return { valid: false, reason: "Kh\xF4ng \u0111\u01B0\u1EE3c ph\xE9p truy c\u1EADp \u0111\u1ECBa ch\u1EC9 n\u1ED9i b\u1ED9 ho\u1EB7c metadata endpoint." };
  }
  return { valid: true, normalizedUrl: parsed.toString() };
}
function isAllowedCorsOrigin(origin, requestHost, allowlist) {
  if (!origin) return false;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== "http:" && parsedOrigin.protocol !== "https:") {
    return false;
  }
  const normalizedOrigin = parsedOrigin.origin.toLowerCase();
  const normalizedHost = (requestHost || "").split(",")[0].trim().toLowerCase();
  if (normalizedHost && parsedOrigin.host.toLowerCase() === normalizedHost) {
    return true;
  }
  for (const rawAllowed of allowlist) {
    const entry = rawAllowed.trim();
    if (!entry || entry === "*") continue;
    try {
      const parsedAllowed = new URL(entry);
      if (parsedAllowed.origin.toLowerCase() === normalizedOrigin) {
        return true;
      }
    } catch {
      if (entry.toLowerCase().replace(/\/+$/, "") === normalizedOrigin) {
        return true;
      }
    }
  }
  return false;
}
function isValidFirestoreDocId(id) {
  return typeof id === "string" && id.length >= 1 && id.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(id);
}
var PRIVATE_IPV4_RANGES, BLOCKED_HOSTNAMES;
var init_urlSecurity = __esm({
  "src/core/urlSecurity.ts"() {
    PRIVATE_IPV4_RANGES = [
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^169\.254\./,
      /^0\./,
      /^172\.(1[6-9]|2\d|3[0-1])\./,
      /^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./
    ];
    BLOCKED_HOSTNAMES = /* @__PURE__ */ new Set([
      "localhost",
      "localhost.localdomain",
      "metadata.google.internal",
      "metadata",
      "169.254.169.254",
      "::1",
      "[::1]",
      "::",
      "[::]",
      "0:0:0:0:0:0:0:1",
      "0:0:0:0:0:0:0:0",
      "0.0.0.0"
    ]);
  }
});

// src/server/referenceIngestService.ts
var referenceIngestService_exports = {};
__export(referenceIngestService_exports, {
  extractPdfPagesFromBuffer: () => extractPdfPagesFromBuffer,
  ingestReferenceFromDocxBuffer: () => ingestReferenceFromDocxBuffer,
  ingestReferenceFromPdfBuffer: () => ingestReferenceFromPdfBuffer,
  ingestReferenceFromTextOrJson: () => ingestReferenceFromTextOrJson,
  ingestReferenceFromUrl: () => ingestReferenceFromUrl
});
import dns from "node:dns";
async function assertResolvedHostSafe(urlStr) {
  const parsed = new URL(urlStr);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateOrLoopbackHost(hostname)) {
    throw new Error("T\u1EEB ch\u1ED1i k\u1EBFt n\u1ED1i t\u1EDBi \u0111\u1ECBa ch\u1EC9 m\u1EA1ng n\u1ED9i b\u1ED9/loopback.");
  }
  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    if (!records || records.length === 0) {
      throw new Error("T\u1EEB ch\u1ED1i k\u1EBFt n\u1ED1i: Kh\xF4ng th\u1EC3 x\xE1c minh \u0111\u1ECBa ch\u1EC9 IP c\xF4ng khai c\u1EE7a t\xEAn mi\u1EC1n.");
    }
    for (const rec of records) {
      if (isPrivateOrLoopbackHost(rec.address)) {
        throw new Error("T\u1EEB ch\u1ED1i k\u1EBFt n\u1ED1i: T\xEAn mi\u1EC1n ph\xE2n gi\u1EA3i v\u1EC1 IP n\u1ED9i b\u1ED9 ho\u1EB7c loopback (DNS Rebinding guard).");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("T\u1EEB ch\u1ED1i k\u1EBFt n\u1ED1i")) {
      throw err;
    }
    throw new Error("T\u1EEB ch\u1ED1i k\u1EBFt n\u1ED1i: Kh\xF4ng th\u1EC3 ph\xE2n gi\u1EA3i DNS an to\xE0n cho t\xEAn mi\u1EC1n \u0111\xEDch.");
  }
}
async function extractPdfPagesFromBuffer(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const uint8 = new Uint8Array(buffer);
  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useSystemFonts: true,
    disableFontFace: true
  });
  const doc = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = [];
    let currentLine = "";
    let lastY = null;
    for (const item of content.items) {
      if ("str" in item) {
        const y = Array.isArray(item.transform) ? item.transform[5] : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
          if (currentLine.trim()) lines.push(currentLine.trim());
          currentLine = item.str;
        } else {
          currentLine += (currentLine && item.str ? " " : "") + item.str;
        }
        lastY = y;
      }
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    pages.push({ pageNumber: i, text: lines.join("\n") });
  }
  return pages;
}
async function ingestReferenceFromUrl(params) {
  const check = validateReferenceUrl(params.url);
  if (!check.valid || !check.normalizedUrl) {
    throw new Error(check.reason || "URL kh\xF4ng h\u1EE3p l\u1EC7.");
  }
  let currentUrl = check.normalizedUrl;
  let response = null;
  for (let hops = 0; hops < 4; hops++) {
    await assertResolvedHostSafe(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2e4);
    try {
      const res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "StudyCheckAI-ReferenceIngest/1.0",
          Accept: "application/pdf, text/html;q=0.9"
        }
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error("Redirect kh\xF4ng h\u1EE3p l\u1EC7.");
        const resolved = new URL(loc, currentUrl).toString();
        const redirectCheck = validateReferenceUrl(resolved);
        if (!redirectCheck.valid || !redirectCheck.normalizedUrl) {
          throw new Error(`Ch\u1EB7n redirect kh\xF4ng an to\xE0n: ${redirectCheck.reason}`);
        }
        currentUrl = redirectCheck.normalizedUrl;
        continue;
      }
      response = res;
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!response) {
    throw new Error("Qu\xE1 s\u1ED1 l\u1EA7n chuy\u1EC3n h\u01B0\u1EDBng URL cho ph\xE9p.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("T\xE0i li\u1EC7u y\xEAu c\u1EA7u \u0111\u0103ng nh\u1EADp ho\u1EB7c b\u1ECB gi\u1EDBi h\u1EA1n quy\u1EC1n truy c\u1EADp (HTTP 401/403). Vui l\xF2ng t\u1EA3i l\xEAn PDF c\xF3 quy\u1EC1n s\u1EED d\u1EE5ng.");
  }
  if (!response.ok) {
    throw new Error(`Kh\xF4ng th\u1EC3 t\u1EA3i t\xE0i li\u1EC7u t\u1EEB URL (HTTP ${response.status}).`);
  }
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_REMOTE_PDF_BYTES) {
    throw new Error("T\xE0i li\u1EC7u v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n dung l\u01B0\u1EE3ng 35MB.");
  }
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_REMOTE_PDF_BYTES) {
    throw new Error("T\xE0i li\u1EC7u v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n dung l\u01B0\u1EE3ng 35MB.");
  }
  const buffer = Buffer.from(arrayBuffer);
  let pages = [];
  if (contentType.includes("application/pdf") || currentUrl.toLowerCase().endsWith(".pdf")) {
    pages = await extractPdfPagesFromBuffer(buffer);
  } else if (contentType.includes("text/html") || contentType.includes("text/plain")) {
    const rawHtml = buffer.toString("utf8");
    const cleanText = rawHtml.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, "\n").replace(/\n{2,}/g, "\n").trim();
    if (cleanText.length < 100) {
      throw new Error("Trang web kh\xF4ng ch\u1EE9a n\u1ED9i dung v\u0103n b\u1EA3n \u0111\u1ECDc \u0111\u01B0\u1EE3c ho\u1EB7c y\xEAu c\u1EA7u JavaScript/\u0111\u0103ng nh\u1EADp.");
    }
    pages = [{ pageNumber: 1, text: cleanText.slice(0, 6e4) }];
  } else {
    throw new Error(`\u0110\u1ECBnh d\u1EA1ng n\u1ED9i dung kh\xF4ng \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3 (${contentType || "unknown"}). Ch\u1EC9 h\u1ED7 tr\u1EE3 PDF c\xF4ng khai ho\u1EB7c trang t\xE0i li\u1EC7u HTTPS.`);
  }
  const totalTextLen = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
  if (totalTextLen < 40) {
    throw new Error("Kh\xF4ng tr\xEDch xu\u1EA5t \u0111\u01B0\u1EE3c v\u0103n b\u1EA3n t\u1EEB PDF (file c\xF3 th\u1EC3 l\xE0 PDF scan \u1EA3nh ho\u1EB7c b\u1ECB m\xE3 h\xF3a DRM). Vui l\xF2ng t\u1EA3i l\xEAn file PDF c\xF3 l\u1EDBp v\u0103n b\u1EA3n.");
  }
  const chunks = buildChunksFromPages({
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries,
    pages
  });
  const chapters = Array.from(new Set(chunks.map((c) => c.chapter)));
  return {
    chunks,
    chapters,
    pageCount: pages.length,
    extractedSummary: `\u0110\xE3 l\u1EADp ch\u1EC9 m\u1EE5c ${pages.length} trang th\xE0nh ${chunks.length} \u0111o\u1EA1n tri th\u1EE9c.`
  };
}
async function ingestReferenceFromPdfBuffer(params) {
  const pages = await extractPdfPagesFromBuffer(params.buffer);
  const totalTextLen = pages.reduce((sum, p) => sum + p.text.trim().length, 0);
  if (totalTextLen < 30) {
    throw new Error("PDF kh\xF4ng c\xF3 l\u1EDBp v\u0103n b\u1EA3n ch\u1ECDn \u0111\u01B0\u1EE3c ho\u1EB7c b\u1ECB kh\xF3a m\u1EADt kh\u1EA9u.");
  }
  const chunks = buildChunksFromPages({
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries,
    pages
  });
  const chapters = Array.from(new Set(chunks.map((c) => c.chapter)));
  return {
    chunks,
    chapters,
    pageCount: pages.length,
    extractedSummary: `\u0110\xE3 l\u1EADp ch\u1EC9 m\u1EE5c ${pages.length} trang th\xE0nh ${chunks.length} \u0111o\u1EA1n tri th\u1EE9c.`
  };
}
async function ingestReferenceFromDocxBuffer(params) {
  const mammothMod = await import("mammoth");
  const mammothApi = mammothMod.default || mammothMod;
  const result = await mammothApi.extractRawText({ buffer: params.buffer });
  const raw = (result.value || "").trim();
  if (raw.length < 30) {
    throw new Error("File DOCX kh\xF4ng ch\u1EE9a v\u0103n b\u1EA3n h\u1ECDc thu\u1EADt \u0111\u1ECDc \u0111\u01B0\u1EE3c.");
  }
  return ingestReferenceFromTextOrJson({
    mode: "text",
    content: raw,
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries
  });
}
function ingestReferenceFromTextOrJson(params) {
  const raw = (params.content || "").trim();
  if (raw.length < 20) {
    throw new Error("N\u1ED9i dung t\xE0i li\u1EC7u tham chi\u1EBFu qu\xE1 ng\u1EAFn (t\u1ED1i thi\u1EC3u 20 k\xFD t\u1EF1).");
  }
  if (params.mode === "json") {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("JSON ph\u1EA3i l\xE0 m\u1EA3ng c\xE1c \u0111o\u1EA1n tri th\u1EE9c (v\xED d\u1EE5: [{ chapter, lesson, pageNumber, content }]).");
    }
    const chunks2 = parsed.filter((item) => item && typeof item.content === "string" && item.content.trim().length > 0).slice(0, 120).map((item, idx) => ({
      chunkId: `${params.referenceId}_j${idx + 1}`,
      referenceId: params.referenceId,
      grade: params.grade,
      subject: params.subject,
      textbookSeries: params.textbookSeries,
      chapter: (item.chapter || "Ch\u01B0\u01A1ng t\u1ED5ng h\u1EE3p").slice(0, 180),
      lesson: (item.lesson || `M\u1EE5c ${idx + 1}`).slice(0, 180),
      pageNumber: Number(item.pageNumber) || idx + 1,
      sectionTitle: (item.sectionTitle || item.lesson || `M\u1EE5c ${idx + 1}`).slice(0, 180),
      content: item.content.trim().slice(0, 6e3),
      keywords: Array.isArray(item.keywords) ? item.keywords.slice(0, 12) : [],
      learningObjectives: [],
      conceptTags: []
    }));
    if (chunks2.length === 0) {
      throw new Error('Kh\xF4ng t\xECm th\u1EA5y m\u1EE5c n\xE0o c\xF3 tr\u01B0\u1EDDng "content" h\u1EE3p l\u1EC7 trong JSON.');
    }
    const chapters2 = Array.from(new Set(chunks2.map((c) => c.chapter)));
    return {
      chunks: chunks2,
      chapters: chapters2,
      pageCount: chunks2.length,
      extractedSummary: `\u0110\xE3 nh\u1EADp ${chunks2.length} \u0111o\u1EA1n tri th\u1EE9c t\u1EEB JSON c\u1EA5u tr\xFAc.`
    };
  }
  const blocks = raw.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  const pages = [];
  let buf = "";
  let pageNum = 1;
  for (const b of blocks) {
    if (buf.length + b.length > 1800 && buf.length > 0) {
      pages.push({ pageNumber: pageNum, text: buf.trim() });
      pageNum += 1;
      buf = b;
    } else {
      buf += (buf ? "\n\n" : "") + b;
    }
  }
  if (buf.trim()) {
    pages.push({ pageNumber: pageNum, text: buf.trim() });
  }
  const chunks = buildChunksFromPages({
    referenceId: params.referenceId,
    grade: params.grade,
    subject: params.subject,
    textbookSeries: params.textbookSeries,
    pages
  });
  const chapters = Array.from(new Set(chunks.map((c) => c.chapter)));
  return {
    chunks,
    chapters,
    pageCount: pages.length,
    extractedSummary: `\u0110\xE3 l\u1EADp ch\u1EC9 m\u1EE5c ${pages.length} ph\u1EA7n v\u0103n b\u1EA3n th\xE0nh ${chunks.length} \u0111o\u1EA1n tri th\u1EE9c.`
  };
}
var MAX_REMOTE_PDF_BYTES;
var init_referenceIngestService = __esm({
  "src/server/referenceIngestService.ts"() {
    init_urlSecurity();
    init_retrieval();
    MAX_REMOTE_PDF_BYTES = 35 * 1024 * 1024;
  }
});

// src/server/app.ts
import crypto7 from "node:crypto";
import express from "express";
import multer from "multer";

// src/server/firebaseServer.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
var FALLBACK_FIREBASE_CONFIG = {
  projectId: "gen-lang-client-0000361568",
  appId: "1:872979635387:web:1666b7019ecb7065645d9e",
  apiKey: "AIzaSyDK6J4IvA0KFV7_28CpspJvOFrhR-BlIPE",
  authDomain: "gen-lang-client-0000361568.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-a93ebbc7-3820-4590-85b7-c81b44ed2e49",
  storageBucket: "gen-lang-client-0000361568.firebasestorage.app",
  messagingSenderId: "872979635387"
};
function loadFirebaseConfig() {
  const candidates = [path.resolve(process.cwd(), "firebase-applet-config.json")];
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(
      path.resolve(currentDir, "../../firebase-applet-config.json"),
      path.resolve(currentDir, "../firebase-applet-config.json"),
      path.resolve(currentDir, "firebase-applet-config.json")
    );
  } catch {
  }
  let parsed = {};
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
        break;
      }
    } catch {
    }
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() || parsed.projectId || FALLBACK_FIREBASE_CONFIG.projectId,
    appId: process.env.FIREBASE_APP_ID?.trim() || parsed.appId || FALLBACK_FIREBASE_CONFIG.appId,
    apiKey: process.env.FIREBASE_API_KEY?.trim() || parsed.apiKey || FALLBACK_FIREBASE_CONFIG.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN?.trim() || parsed.authDomain || FALLBACK_FIREBASE_CONFIG.authDomain,
    firestoreDatabaseId: process.env.FIREBASE_FIRESTORE_DATABASE_ID?.trim() || parsed.firestoreDatabaseId || FALLBACK_FIREBASE_CONFIG.firestoreDatabaseId,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim() || parsed.storageBucket || FALLBACK_FIREBASE_CONFIG.storageBucket,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID?.trim() || parsed.messagingSenderId || FALLBACK_FIREBASE_CONFIG.messagingSenderId
  };
}
var firebaseConfig = loadFirebaseConfig();
var DEFAULT_SUPER_ADMIN_EMAILS = [
  "tuankhang2011pm@gmail.com",
  "tuankhangnek@gmail.com",
  "honghainhi2k14@gmail.com"
];
var PROTECTED_SUPER_ADMIN_EMAILS = new Set(
  DEFAULT_SUPER_ADMIN_EMAILS.map((e) => e.trim().toLowerCase())
);
var SUPER_ADMIN_EMAILS = new Set(
  [
    ...DEFAULT_SUPER_ADMIN_EMAILS,
    ...(process.env.SUPER_ADMIN_EMAIL || "").split(","),
    ...(process.env.SUPER_ADMIN_EMAILS || "").split(",")
  ].map((e) => e.trim().toLowerCase()).filter(Boolean)
);
var SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "tuankhang2011pm@gmail.com").trim().toLowerCase();
var SUPER_ADMIN_UID = (process.env.SUPER_ADMIN_UID || "").trim();
var adminAuthInstance = null;
var adminAuthInitAttempted = false;
async function getAdminAuth() {
  if (adminAuthInitAttempted) {
    return adminAuthInstance;
  }
  adminAuthInitAttempted = true;
  if (process.env.VERCEL === "1" && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return null;
  }
  try {
    const [{ getApp, getApps, initializeApp }, { getAuth }] = await Promise.all([
      import("firebase-admin/app"),
      import("firebase-admin/auth")
    ]);
    const adminApp = getApps().length ? getApp() : initializeApp({
      projectId: firebaseConfig.projectId
    });
    adminAuthInstance = getAuth(adminApp);
  } catch (err) {
    console.warn("Warning: firebase-admin auth init skipped, using IdentityToolkit fallback:", err);
    adminAuthInstance = null;
  }
  return adminAuthInstance;
}
function isDecodedSuperAdmin(decoded) {
  if (decoded.superAdmin === true || decoded.role === "super_admin") {
    return true;
  }
  if (SUPER_ADMIN_UID && decoded.uid === SUPER_ADMIN_UID) {
    return true;
  }
  if (decoded.email_verified === true && decoded.email && SUPER_ADMIN_EMAILS.has(decoded.email.toLowerCase())) {
    return true;
  }
  return false;
}
var FIREBASE_REST_TIMEOUT_MS = 6e3;
function createRestTimeoutSignal(ms = FIREBASE_REST_TIMEOUT_MS) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  return void 0;
}
async function verifyTokenViaIdentityToolkit(idToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken }),
    signal: createRestTimeoutSignal(8e3)
  });
  if (!res.ok) {
    throw new Error(`AUTH_LOOKUP_FAILED (${res.status})`);
  }
  const data = await res.json();
  const fbUser = data.users?.[0];
  if (!fbUser?.localId) {
    throw new Error("AUTH_USER_NOT_FOUND");
  }
  return {
    uid: fbUser.localId,
    email: fbUser.email || "",
    emailVerified: Boolean(fbUser.emailVerified)
  };
}
var TOKEN_CACHE_TTL_MS = 9e4;
var verifiedTokenCache = /* @__PURE__ */ new Map();
function invalidateVerifiedTokenCacheForUid(uid) {
  if (!uid) {
    verifiedTokenCache.clear();
    return;
  }
  for (const [k, v] of verifiedTokenCache.entries()) {
    if (v.uid === uid) {
      verifiedTokenCache.delete(k);
    }
  }
}
function getJwtExpMs(idToken) {
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1e3 : null;
  } catch {
    return null;
  }
}
async function verifyFirebaseRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("AUTH_MISSING_TOKEN");
  }
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    throw new Error("AUTH_MISSING_TOKEN");
  }
  const tokenHash = crypto.createHash("sha256").update(idToken).digest("hex");
  const now = Date.now();
  const cached = verifiedTokenCache.get(tokenHash);
  if (cached && now < cached.expiresAt) {
    return {
      uid: cached.uid,
      email: cached.email,
      emailVerified: cached.emailVerified,
      isSuperAdmin: cached.isSuperAdmin,
      idToken,
      decoded: cached.decoded
    };
  }
  if (cached) {
    verifiedTokenCache.delete(tokenHash);
  }
  let uid = "";
  let email = "";
  let emailVerified = false;
  let decoded;
  let isSuperAdmin = false;
  try {
    const adminAuth = await getAdminAuth();
    if (!adminAuth) {
      throw new Error("ADMIN_AUTH_UNAVAILABLE");
    }
    decoded = await adminAuth.verifyIdToken(idToken);
    uid = decoded.uid;
    email = decoded.email || "";
    emailVerified = Boolean(decoded.email_verified);
    isSuperAdmin = isDecodedSuperAdmin(decoded);
  } catch {
    const verified = await verifyTokenViaIdentityToolkit(idToken);
    uid = verified.uid;
    email = verified.email;
    emailVerified = verified.emailVerified;
    isSuperAdmin = SUPER_ADMIN_UID && uid === SUPER_ADMIN_UID || emailVerified && email && SUPER_ADMIN_EMAILS.has(email.toLowerCase()) || false;
  }
  if (!isSuperAdmin && emailVerified) {
    try {
      const adminDoc = await firestoreRestGet(`admins/${uid}`, idToken);
      if (adminDoc?.role === "super_admin") {
        isSuperAdmin = true;
      }
    } catch {
    }
  }
  const finalDecoded = decoded || { uid, email, email_verified: emailVerified };
  const jwtExpMs = getJwtExpMs(idToken);
  const cacheExp = jwtExpMs ? Math.min(now + TOKEN_CACHE_TTL_MS, jwtExpMs - 5e3) : now + TOKEN_CACHE_TTL_MS;
  if (cacheExp > now + 1e3) {
    if (verifiedTokenCache.size >= 500) {
      const oldestKey = verifiedTokenCache.keys().next().value;
      if (oldestKey) verifiedTokenCache.delete(oldestKey);
    }
    verifiedTokenCache.set(tokenHash, {
      uid,
      email,
      emailVerified,
      isSuperAdmin,
      decoded: finalDecoded,
      expiresAt: cacheExp
    });
  }
  return {
    uid,
    email,
    emailVerified,
    isSuperAdmin,
    idToken,
    decoded: finalDecoded
  };
}
function encodeFirestoreValue(val) {
  if (val === null || val === void 0) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== void 0) {
        fields[k] = encodeFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}
function decodeFirestoreValue(val) {
  if ("nullValue" in val) return null;
  if ("booleanValue" in val) return Boolean(val.booleanValue);
  if ("integerValue" in val) return Number(val.integerValue);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("stringValue" in val) return String(val.stringValue);
  if ("timestampValue" in val) return String(val.timestampValue);
  if ("arrayValue" in val) {
    const arr = val.arrayValue?.values || [];
    return arr.map((item) => decodeFirestoreValue(item));
  }
  if ("mapValue" in val) {
    const fields = val.mapValue?.fields || {};
    const obj = {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = decodeFirestoreValue(v);
    }
    return obj;
  }
  return null;
}
function firestoreDocBaseUrl() {
  const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
  return `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${encodeURIComponent(dbId)}/documents`;
}
async function firestoreRestGet(docPath, idToken) {
  const url = `${firestoreDocBaseUrl()}/${docPath}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal: createRestTimeoutSignal()
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_GET_FAILED (${res.status}): ${txt}`);
  }
  const data = await res.json();
  if (!data.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(data.fields)) {
    out[k] = decodeFirestoreValue(v);
  }
  return out;
}
async function firestoreRestSet(docPath, payload, idToken) {
  const url = `${firestoreDocBaseUrl()}/${docPath}`;
  const fields = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v !== void 0) {
      fields[k] = encodeFirestoreValue(v);
    }
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields }),
    signal: createRestTimeoutSignal()
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_SET_FAILED (${res.status}): ${txt}`);
  }
}
async function firestoreRestList(collectionPath, idToken, pageSize = 100) {
  const url = `${firestoreDocBaseUrl()}/${collectionPath}?pageSize=${pageSize}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` },
    signal: createRestTimeoutSignal()
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_LIST_FAILED (${res.status}): ${txt}`);
  }
  const json = await res.json();
  const docs = json.documents || [];
  return docs.map((doc) => {
    const out = {};
    for (const [k, v] of Object.entries(doc.fields || {})) {
      out[k] = decodeFirestoreValue(v);
    }
    return out;
  });
}
async function firestoreRestDelete(docPath, idToken) {
  const url = `${firestoreDocBaseUrl()}/${docPath}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${idToken}` },
    signal: createRestTimeoutSignal()
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_DELETE_FAILED (${res.status}): ${txt}`);
  }
}

// src/server/aiGuardService.ts
import crypto5 from "node:crypto";

// src/server/modelDefaults.ts
var MODEL_CATALOG = [
  {
    modelId: "mistral:mistral-small-latest",
    displayName: "Mistral AI \xB7 Mistral Small Latest (\u01AFu ti\xEAn #1 \xB7 Ch\u1EA5m ch\xEDnh Free)",
    provider: "mistral",
    tier: "free",
    strengths: "\u01AFu ti\xEAn s\u1ED1 1 cho ch\u1EA5m \u0111i\u1EC3m, ki\u1EC3m \u0111\u1ECBnh ki\u1EBFn th\u1EE9c, sinh \u0111\u1EC1 & h\u1ED7 tr\u1EE3 Vision OCR d\u1EF1 ph\xF2ng tr\xEAn Mistral Free Tier.",
    supportsMultimodal: true,
    supportsGoogleSearch: false
  },
  {
    modelId: "mistral:ministral-8b-latest",
    displayName: "Mistral AI \xB7 Ministral 8B Fast (\u0110\u1ED1i so\xE1t & T\xE1c v\u1EE5 nhanh Free)",
    provider: "mistral",
    tier: "free",
    strengths: "T\u1ED1c \u0111\u1ED9 cao, chi ph\xED th\u1EA5p \u2014 t\u1ED1i \u01B0u cho ki\u1EC3m tra ch\xE9o (Verify), ph\xE2n lo\u1EA1i m\xF4n h\u1ECDc & t\u1EA1o flashcard.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  },
  {
    modelId: "groq:qwen/qwen3.8-27b",
    displayName: "Groq \xB7 Qwen 3.8 27B Vision (\u01AFu ti\xEAn #1 OCR & \u0110\u1ED1i so\xE1t Free)",
    provider: "groq",
    tier: "free",
    strengths: "\u0110a ph\u01B0\u01A1ng th\u1EE9c si\xEAu nhanh (~450 tok/s, mi\u1EC5n ph\xED) \u2014 qu\xE9t \u1EA3nh ch\u1EE5p v\u1EDF/b\xE0i l\xE0m B\u01B0\u1EDBc 1 v\xE0 ch\u1EA1y nh\xE1nh \u0111\u1ED1i so\xE1t \u0111\u1ED9c l\u1EADp.",
    supportsMultimodal: true,
    supportsGoogleSearch: false
  },
  {
    modelId: "groq:openai/gpt-oss-120b",
    displayName: "Groq \xB7 GPT-OSS 120B (D\u1EF1 ph\xF2ng suy lu\u1EADn si\xEAu nhanh Free)",
    provider: "groq",
    tier: "free",
    strengths: "T\u1ED1c \u0111\u1ED9 ~500 tok/s, mi\u1EC5n ph\xED \u2014 t\u1EA7ng d\u1EF1 ph\xF2ng m\u1EA1nh cho ch\u1EA5m \u0111i\u1EC3m, t\u1ED5ng h\u1EE3p SGK & t\u1EA1o \u0111\u1EC1 tr\u1EAFc nghi\u1EC7m.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  },
  {
    modelId: "groq:openai/gpt-oss-20b",
    displayName: "Groq \xB7 GPT-OSS 20B Fast (\u0110\u1ED1i so\xE1t ch\xE9o ~1.000 tok/s Free)",
    provider: "groq",
    tier: "free",
    strengths: "Si\xEAu nhanh (~1.000 tok/s), mi\u1EC5n ph\xED \u2014 \u01B0u ti\xEAn cho b\u01B0\u1EDBc \u0110\u1ED1i so\xE1t (Verify) ch\xE9o nh\xE0 cung c\u1EA5p & t\xE1c v\u1EE5 nh\u1EB9.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  },
  {
    modelId: "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    displayName: "Cloudflare \xB7 Llama 3.3 70B FP8 Fast (Ch\u1EA5m song song Ph\u1EA7n 2 Free)",
    provider: "cloudflare",
    tier: "free",
    strengths: "Mi\u1EC5n ph\xED (10.000 Neurons/ng\xE0y tr\xEAn Cloudflare Edge) \u2014 ch\u1EA1y song song Ph\u1EA7n 2 khi v\u0103n b\u1EA3n d\xE0i & l\xE0m t\u1EA7ng d\u1EF1 ph\xF2ng \u0111\u1ED9c l\u1EADp.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  },
  {
    modelId: "cf:@cf/qwen/qwen3.8-27b",
    displayName: "Cloudflare \xB7 Qwen 3.8 27B Vision (Qu\xE9t tinh ch\u1EC9nh B\u01B0\u1EDBc 2 Free)",
    provider: "cloudflare",
    tier: "free",
    strengths: "\u0110a ph\u01B0\u01A1ng th\u1EE9c tr\xEAn Cloudflare Edge \u2014 ch\u1EA1y Qu\xE9t tinh ch\u1EC9nh (Scan Pass 2) cho t\xE0i li\u1EC7u d\xE0i & d\u1EF1 ph\xF2ng Vision OCR.",
    supportsMultimodal: true,
    supportsGoogleSearch: false
  },
  {
    modelId: "cf:@cf/meta/llama-3.1-8b-instruct-fast",
    displayName: "Cloudflare \xB7 Llama 3.1 8B Fast (\u0110\u1ED1i so\xE1t d\u1EF1 ph\xF2ng ti\u1EBFt ki\u1EC7m Free)",
    provider: "cloudflare",
    tier: "free",
    strengths: "Mi\u1EC5n ph\xED, ti\xEAu t\u1ED1n c\u1EF1c \xEDt Neuron tr\xEAn Cloudflare Edge \u2014 \u0111\u1ED1i so\xE1t d\u1EF1 ph\xF2ng, ph\xE2n lo\u1EA1i m\xF4n & flashcard.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  }
];
var UNIFIED_PRIMARY_MODEL = "mistral:mistral-small-latest";
var UNIFIED_FALLBACK_MODEL = "groq:openai/gpt-oss-120b";
var DEFAULT_TASK_MODELS = {
  subject_classification: {
    defaultModel: "groq:openai/gpt-oss-20b",
    fallbackModel: "mistral:ministral-8b-latest",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  curriculum_extraction: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  knowledge_analysis: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  completeness_analysis: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  claim_validation: {
    defaultModel: "groq:openai/gpt-oss-20b",
    fallbackModel: "cf:@cf/meta/llama-3.1-8b-instruct-fast",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  quiz_blueprint: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  quiz_generation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  quiz_validation: {
    defaultModel: "groq:openai/gpt-oss-20b",
    fallbackModel: "mistral:ministral-8b-latest",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  answer_explanation: {
    defaultModel: UNIFIED_PRIMARY_MODEL,
    fallbackModel: UNIFIED_FALLBACK_MODEL,
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  flashcard_generation: {
    defaultModel: "mistral:ministral-8b-latest",
    fallbackModel: "groq:openai/gpt-oss-20b",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  },
  feedback_analysis: {
    defaultModel: "mistral:ministral-8b-latest",
    fallbackModel: "groq:openai/gpt-oss-20b",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v4.2_3provider"
  }
};

// src/server/modelRouter.ts
import crypto4 from "node:crypto";

// src/core/cache.ts
function canonicalizeValue(value) {
  if (value === null || value === void 0) return value;
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (typeof value === "object") {
    const obj = value;
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] !== void 0) {
        sorted[key] = canonicalizeValue(obj[key]);
      }
    }
    return sorted;
  }
  return value;
}
function computeStableTextDigest(input) {
  const normalized = (input || "").normalize("NFC");
  let h1 = 0xcbf29ce484222325n;
  let h2 = 0x84222325cbf29ce4n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < normalized.length; i += 1) {
    const code = BigInt(normalized.charCodeAt(i));
    h1 ^= code;
    h1 = h1 * prime & mask;
    h2 ^= code + BigInt(i % 251 + 1);
    h2 = h2 * prime & mask;
  }
  return `${h1.toString(16).padStart(16, "0")}${h2.toString(16).padStart(16, "0")}`;
}
function buildDeterministicCacheKey(parts) {
  const canonical = JSON.stringify(canonicalizeValue(parts));
  return computeStableTextDigest(canonical);
}
var BoundedTtlCache = class {
  constructor(maxEntries = 150, defaultTtlMs = 30 * 60 * 1e3) {
    this.store = /* @__PURE__ */ new Map();
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }
  get(key) {
    const entry = this.store.get(key);
    if (!entry) return void 0;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return void 0;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }
  set(key, value, ttlMs = this.defaultTtlMs) {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== void 0) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }
  clear() {
    this.store.clear();
  }
  size() {
    return this.store.size;
  }
};

// src/server/singleKeyService.ts
import crypto3 from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";

// src/core/adaptiveApiPlan.ts
var ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD = 1500;
var MIN_ADAPTIVE_THRESHOLD_CHARS = 300;
var MAX_ADAPTIVE_THRESHOLD_CHARS = 2e4;
var MISTRAL_GRADE_MODEL = "mistral:mistral-small-latest";
var MISTRAL_VERIFY_MODEL = "mistral:ministral-8b-latest";
var MISTRAL_VISION_MODEL = "mistral:mistral-small-latest";
var CF_GRADE_MODEL = "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast";
var CF_VERIFY_MODEL = "cf:@cf/meta/llama-3.1-8b-instruct-fast";
var CF_VISION_MODEL = "cf:@cf/qwen/qwen3.8-27b";
var GROQ_SCAN_VISION_MODEL = "groq:qwen/qwen3.8-27b";
var GROQ_VERIFY_SLOT1_MODEL = "groq:openai/gpt-oss-20b";
var GROQ_VERIFY_SLOT2_MODEL = "groq:qwen/qwen3.8-27b";
var GROQ_GRADE_FALLBACK_MODEL = "groq:openai/gpt-oss-120b";
var COVERAGE_STATUS_RANK = {
  COVERED: 4,
  PARTIALLY_COVERED: 3,
  MISSING: 2,
  OUT_OF_SCOPE: 1
};
function clampAdaptiveThresholdChars(value, fallback = ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD) {
  const safeFallback = typeof fallback === "number" && Number.isFinite(fallback) ? Math.min(MAX_ADAPTIVE_THRESHOLD_CHARS, Math.max(MIN_ADAPTIVE_THRESHOLD_CHARS, Math.round(fallback))) : ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(
      MAX_ADAPTIVE_THRESHOLD_CHARS,
      Math.max(MIN_ADAPTIVE_THRESHOLD_CHARS, Math.round(value))
    );
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.min(
        MAX_ADAPTIVE_THRESHOLD_CHARS,
        Math.max(MIN_ADAPTIVE_THRESHOLD_CHARS, Math.round(parsed))
      );
    }
  }
  return safeFallback;
}
function computeNormalizedTextLength(input, ocrConfirmed = false) {
  if (typeof input === "string") {
    return input.normalize("NFC").trim().length;
  }
  if (!Array.isArray(input) || input.length === 0) return 0;
  const combined = input.map((page) => {
    const preferred = ocrConfirmed && page.confirmedText && page.confirmedText.trim() ? page.confirmedText : page.rawText || page.confirmedText || "";
    if (preferred.trim()) return preferred.normalize("NFC").trim();
    if (Array.isArray(page.textBlocks) && page.textBlocks.length > 0) {
      return page.textBlocks.map((b) => String(b?.text || "").normalize("NFC").trim()).filter(Boolean).join("\n");
    }
    return "";
  }).filter(Boolean).join("\n");
  return combined.normalize("NFC").trim().length;
}
function computeAdaptiveApiPlan(textLength, thresholdChars) {
  const safeLen = Number.isFinite(textLength) && textLength > 0 ? Math.floor(textLength) : 0;
  const threshold = clampAdaptiveThresholdChars(thresholdChars);
  const isLongText = safeLen >= threshold;
  const count = isLongText ? 2 : 1;
  return {
    textLength: safeLen,
    thresholdChars: threshold,
    isLongText,
    scanApiCount: count,
    gradeApiCount: count,
    verifyApiCount: count
  };
}
function createAdaptiveAuditMetadata(plan, overrides) {
  return {
    textLength: plan.textLength,
    thresholdChars: plan.thresholdChars,
    isLongText: plan.isLongText,
    scanApiCount: plan.scanApiCount,
    gradeApiCount: plan.gradeApiCount,
    verifyApiCount: plan.verifyApiCount,
    verifyExecutedApiCount: overrides?.verifyExecutedApiCount ?? 0,
    verifyAdjustmentsCount: overrides?.verifyAdjustmentsCount ?? 0,
    ...overrides?.gradeModels ? { gradeModels: overrides.gradeModels } : {},
    ...overrides?.verifyModels ? { verifyModels: overrides.verifyModels } : {}
  };
}
function findCleanMidpointSplit(text) {
  const mid = Math.floor(text.length / 2);
  const windowRadius = Math.max(40, Math.floor(text.length * 0.2));
  const minIdx = Math.max(1, mid - windowRadius);
  const maxIdx = Math.min(text.length - 1, mid + windowRadius);
  let bestIdx = -1;
  let bestDist = Infinity;
  for (let i = minIdx; i <= maxIdx; i++) {
    if (text[i] === "\n") {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }
  }
  if (bestIdx > 0 && bestIdx < text.length) return bestIdx;
  for (let i = minIdx; i <= maxIdx; i++) {
    const ch = text[i];
    if ((ch === "." || ch === "!" || ch === "?" || ch === ";") && /\s/.test(text[i + 1] || "")) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }
  }
  if (bestIdx > 0 && bestIdx < text.length) return bestIdx;
  for (let i = minIdx; i <= maxIdx; i++) {
    if (/\s/.test(text[i])) {
      const dist = Math.abs(i - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i + 1;
      }
    }
  }
  if (bestIdx > 0 && bestIdx < text.length) return bestIdx;
  return mid;
}
function splitStudentBlocksIntoTwoHalves(blocks) {
  const clean = blocks.map((b) => ({
    ...b,
    text: String(b.text || "").normalize("NFC").trim()
  })).filter((b) => b.text.length > 0);
  if (clean.length === 0) return [[], []];
  if (clean.length === 1) {
    const only = clean[0];
    if (only.text.length < 40) {
      return [[only], []];
    }
    const splitAt = findCleanMidpointSplit(only.text);
    const leftText = only.text.slice(0, splitAt).trim();
    const rightText = only.text.slice(splitAt).trim();
    if (!leftText || !rightText) {
      return [[only], []];
    }
    return [
      [
        {
          pageNumber: only.pageNumber,
          blockId: only.blockId,
          sourceBlockId: only.sourceBlockId || only.blockId,
          text: leftText
        }
      ],
      [
        {
          pageNumber: only.pageNumber,
          blockId: `${only.blockId}_part2`,
          sourceBlockId: only.sourceBlockId || only.blockId,
          text: rightText
        }
      ]
    ];
  }
  const totalChars = clean.reduce((sum, b) => sum + b.text.length, 0);
  const target = totalChars / 2;
  let running = 0;
  let splitIndex = 1;
  let bestDiff = Infinity;
  for (let i = 0; i < clean.length - 1; i++) {
    running += clean[i].text.length;
    const diff = Math.abs(running - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      splitIndex = i + 1;
    }
  }
  return [clean.slice(0, splitIndex), clean.slice(splitIndex)];
}
function formatStudentBlocksForPrompt(blocks) {
  const byPage = /* @__PURE__ */ new Map();
  for (const block of blocks) {
    const arr = byPage.get(block.pageNumber) || [];
    arr.push(block);
    byPage.set(block.pageNumber, arr);
  }
  const pageNums = Array.from(byPage.keys()).sort((a, b) => a - b);
  return pageNums.map((pageNumber) => {
    const items = byPage.get(pageNumber) || [];
    const lines = items.map((b) => `[${b.blockId}] ${b.text}`).join("\n");
    return `=== TRANG ${pageNumber} ===
${lines}`;
  }).join("\n\n");
}
function splitClaimsIntoTwoHalves(claims) {
  if (!Array.isArray(claims) || claims.length === 0) return [[], []];
  if (claims.length === 1) return [[claims[0]], []];
  const mid = Math.ceil(claims.length / 2);
  return [claims.slice(0, mid), claims.slice(mid)];
}
function normalizeMergeKey(val) {
  return String(val || "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}
function deduplicateStringsPreserveOrder(listA, listB) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of [...listA, ...listB]) {
    const trimmed = String(raw || "").normalize("NFC").trim();
    if (!trimmed) continue;
    const key = normalizeMergeKey(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
function mergeGradedHalves(part1, part2) {
  const claims = [...part1.claims || [], ...part2.claims || []];
  const covMap = /* @__PURE__ */ new Map();
  const covOrder = [];
  for (const item of [...part1.coverageItems || [], ...part2.coverageItems || []]) {
    const key = item.criterionId?.trim() ? `cid:${item.criterionId.trim()}` : `concept:${normalizeMergeKey(item.concept)}`;
    const existing = covMap.get(key);
    if (!existing) {
      covMap.set(key, item);
      covOrder.push(key);
      continue;
    }
    const existingRank = COVERAGE_STATUS_RANK[existing.status] ?? 0;
    const incomingRank = COVERAGE_STATUS_RANK[item.status] ?? 0;
    if (incomingRank > existingRank) {
      covMap.set(key, {
        ...existing,
        ...item,
        suggestedAddition: item.status === "COVERED" ? item.suggestedAddition || "" : item.suggestedAddition || existing.suggestedAddition || "",
        referenceExcerpt: item.referenceExcerpt || existing.referenceExcerpt || "",
        matchedChunkId: item.matchedChunkId || existing.matchedChunkId
      });
    } else if (incomingRank === existingRank) {
      covMap.set(key, {
        ...existing,
        suggestedAddition: existing.suggestedAddition || item.suggestedAddition || "",
        referenceExcerpt: existing.referenceExcerpt || item.referenceExcerpt || "",
        matchedChunkId: existing.matchedChunkId || item.matchedChunkId
      });
    }
  }
  return {
    claims,
    coverageItems: covOrder.map((k) => covMap.get(k)),
    strengths: deduplicateStringsPreserveOrder(part1.strengths || [], part2.strengths || []),
    weaknesses: deduplicateStringsPreserveOrder(part1.weaknesses || [], part2.weaknesses || []),
    suggestions: deduplicateStringsPreserveOrder(part1.suggestions || [], part2.suggestions || [])
  };
}
function detectProviderIdFromModel(modelId) {
  const clean = String(modelId || "").trim().toLowerCase();
  if (clean.startsWith("groq:")) return "groq";
  if (clean.startsWith("cf:") || clean.startsWith("cloudflare:") || clean.startsWith("@cf/")) {
    return "cloudflare";
  }
  return "mistral";
}
function selectCrossProviderVerifierModel(params) {
  const { gradedByProvider, slot, configuredProviders, slot1VerifyModel } = params;
  const configuredList = ["mistral", "groq", "cloudflare"].filter(
    (p) => configuredProviders[p]
  );
  const slot1GroqModel = GROQ_VERIFY_SLOT1_MODEL;
  const slot2GroqModel = slot1VerifyModel === GROQ_VERIFY_SLOT1_MODEL ? GROQ_VERIFY_SLOT2_MODEL : GROQ_VERIFY_SLOT1_MODEL;
  const modelForProvider = (p) => {
    if (p === "groq") return slot === 1 ? slot1GroqModel : slot2GroqModel;
    if (p === "cloudflare") return CF_VERIFY_MODEL;
    return MISTRAL_VERIFY_MODEL;
  };
  const preferredOrder = slot === 1 ? ["groq", "cloudflare", "mistral"] : ["groq", "mistral", "cloudflare"];
  const crossConfigured = preferredOrder.filter(
    (p) => p !== gradedByProvider && configuredProviders[p]
  );
  if (crossConfigured.length >= 2) {
    return {
      primaryModel: modelForProvider(crossConfigured[0]),
      fallbackModel: modelForProvider(crossConfigured[1]),
      primaryProvider: crossConfigured[0]
    };
  }
  if (crossConfigured.length === 1) {
    const primary = crossConfigured[0];
    const fallbackProvider = configuredList.find((p) => p !== primary) || preferredOrder.find((p) => p !== primary) || primary;
    return {
      primaryModel: modelForProvider(primary),
      fallbackModel: modelForProvider(fallbackProvider),
      primaryProvider: primary
    };
  }
  const sole = configuredList[0] || preferredOrder.find((p) => p !== gradedByProvider) || "groq";
  const fallbackP = preferredOrder.find((p) => p !== sole) || "cloudflare";
  return {
    primaryModel: modelForProvider(sole),
    fallbackModel: modelForProvider(fallbackP),
    primaryProvider: sole
  };
}
function resolveScopedStageApiKey(params) {
  const { provider, stage, slot, defaultKey } = params;
  const env = params.env || (typeof process !== "undefined" ? process.env : {});
  const prefix = provider === "groq" ? "GROQ" : "MISTRAL";
  const pick = (name) => {
    const val = env[name]?.trim();
    return val ? val : null;
  };
  const exact = pick(`${prefix}_KEY_${stage}_${slot}`);
  if (exact) return exact;
  const shortAlias = pick(`KEY_${stage}_${slot}`);
  if (shortAlias) {
    const looksLikeGroqKey = shortAlias.startsWith("gsk_");
    if (!(provider === "mistral" && looksLikeGroqKey)) {
      return shortAlias;
    }
  }
  const numbered = pick(`${prefix}_API_KEY_${slot}`);
  if (numbered) return numbered;
  if (defaultKey && defaultKey.trim()) return defaultKey.trim();
  const baseEnv = pick(`${prefix}_API_KEY`);
  return baseEnv;
}

// src/server/groqProvider.ts
import crypto2 from "node:crypto";
var GROQ_API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
var GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
var GROQ_RESCUE_MODEL_STRONG = "groq:openai/gpt-oss-120b";
var GROQ_RESCUE_MODEL_FAST = "groq:openai/gpt-oss-20b";
var GROQ_VISION_MODEL = "groq:qwen/qwen3.8-27b";
var GROQ_PREFERRED_TEXT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "qwen/qwen3.8-27b",
  "qwen/qwen3-32b"
];
var GROQ_VISION_MODELS = [
  "qwen/qwen3.8-27b",
  "qwen/qwen3.6-27b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct"
];
function isGroqVisionModelId(modelId) {
  const raw = stripGroqPrefix(modelId).toLowerCase();
  return GROQ_VISION_MODELS.some((m) => m.toLowerCase() === raw) || raw.includes("qwen3.8") || raw.includes("qwen3.6") || raw.includes("qwen3.5") || raw.includes("-vl") || raw.includes("vl-") || raw.includes("llama-4-scout") || raw.includes("llama-4-maverick") || raw.includes("vision") || raw.includes("llava") || raw.includes("pixtral");
}
var LEGACY_GROQ_MODEL_ALIASES = {
  "llama3-70b-8192": "openai/gpt-oss-120b",
  "llama3-8b-8192": "openai/gpt-oss-20b",
  "mixtral-8x7b-32768": "openai/gpt-oss-120b",
  "gemma2-9b-it": "openai/gpt-oss-20b",
  "meta-llama/llama-4-scout-17b-16e-instruct": "qwen/qwen3.8-27b",
  "meta-llama/llama-4-maverick-17b-128e-instruct": "qwen/qwen3.8-27b"
};
var availableModelsCache = /* @__PURE__ */ new Map();
function isGroqModelId(modelId) {
  return modelId.trim().toLowerCase().startsWith("groq:");
}
function stripGroqPrefix(modelId) {
  const trimmed = modelId.trim();
  return trimmed.toLowerCase().startsWith("groq:") ? trimmed.slice(5).trim() : trimmed;
}
function normalizeGroqModelId(modelId) {
  const trimmed = (modelId || "").trim();
  if (!isGroqModelId(trimmed)) return trimmed;
  const rawName = stripGroqPrefix(trimmed);
  const mapped = LEGACY_GROQ_MODEL_ALIASES[rawName.toLowerCase()];
  return mapped ? `groq:${mapped}` : `groq:${rawName}`;
}
function getGroqApiKey() {
  return resolveActiveGroqApiKey();
}
function isGroqConfigured() {
  return getGroqApiKey().length > 0;
}
function isGroqChatModelId(id) {
  const lower = id.trim().toLowerCase();
  if (!lower) return false;
  const excludedTokens = [
    "whisper",
    "tts",
    "playai",
    "guard",
    "safeguard",
    "orpheus",
    "distil-whisper",
    "compound"
  ];
  return !excludedTokens.some((tok) => lower.includes(tok));
}
async function fetchAvailableGroqChatModels(apiKey, signal, forceRefresh = false) {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return [];
  const cacheKey = crypto2.createHash("sha256").update(cleanKey).digest("hex").slice(0, 16);
  const cached = availableModelsCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.models;
  }
  try {
    const res = await fetch(GROQ_MODELS_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cleanKey}`
      },
      signal
    });
    if (!res.ok) return cached?.models || [];
    const data = await res.json();
    const models = (data.data || []).filter((item) => item && typeof item.id === "string" && item.active !== false).map((item) => item.id.trim()).filter((id) => isGroqChatModelId(id));
    if (models.length > 0) {
      availableModelsCache.set(cacheKey, {
        expiresAt: Date.now() + 10 * 60 * 1e3,
        models
      });
    }
    return models;
  } catch {
    return cached?.models || [];
  }
}
function extractJsonStringFromModelOutput(raw) {
  const trimmed = (raw || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!trimmed) return "{}";
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    const inner = fenced[1].trim();
    const fb = inner.indexOf("{");
    const lb = inner.lastIndexOf("}");
    if (fb >= 0 && lb > fb) {
      return inner.slice(fb, lb + 1);
    }
    return inner;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
async function executeGroqRequest(params) {
  const sendOnce = async (useResponseFormatJson, includeSeed) => {
    const body = {
      model: params.groqModel,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens
    };
    if (includeSeed && typeof params.seed === "number" && Number.isFinite(params.seed)) {
      body.seed = Math.floor(params.seed);
    }
    if (useResponseFormatJson) {
      body.response_format = { type: "json_object" };
    }
    const res = await fetch(GROQ_API_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: params.signal
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, status: res.status, errText };
    }
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    const rawText = (msg?.content || msg?.reasoning || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
    const text = params.jsonMode ? extractJsonStringFromModelOutput(rawText) : rawText.trim();
    return {
      ok: true,
      result: {
        text,
        promptTokens: data.usage?.prompt_tokens || 0,
        candidateTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        resolvedModel: `groq:${params.groqModel}`,
        ...typeof data.system_fingerprint === "string" && data.system_fingerprint.trim() ? { systemFingerprint: data.system_fingerprint.trim() } : {}
      }
    };
  };
  const useStrictJsonHeaderFirst = Boolean(params.jsonMode) && !params.hasImages;
  const hasSeed = typeof params.seed === "number" && Number.isFinite(params.seed);
  let primary = await sendOnce(useStrictJsonHeaderFirst, hasSeed);
  if (!primary.ok && primary.status === 400) {
    const lowerErr = primary.errText.toLowerCase();
    const isDeadModel = lowerErr.includes("model_not_found") || lowerErr.includes("model_decommissioned") || lowerErr.includes("does not exist") || lowerErr.includes("not found");
    if (!isDeadModel && hasSeed && lowerErr.includes("seed")) {
      const withoutSeed = await sendOnce(useStrictJsonHeaderFirst, false);
      if (withoutSeed.ok) {
        return withoutSeed;
      }
      primary = withoutSeed;
    }
    if (!primary.ok && !isDeadModel && useStrictJsonHeaderFirst) {
      const withoutJsonFormat = await sendOnce(false, false);
      if (withoutJsonFormat.ok) {
        return withoutJsonFormat;
      }
    }
  }
  return primary;
}
async function callGroqChatCompletion(params) {
  const apiKey = (params.apiKeyOverride || "").trim() || getGroqApiKey();
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY_UNCONFIGURED: Ch\u01B0a c\u1EA5u h\xECnh Groq API Key. Qu\u1EA3n tr\u1ECB vi\xEAn c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp trong Qu\u1EA3n tr\u1ECB h\u1EC7 th\u1ED1ng \u2192 API Key & B\u1EA3o m\u1EADt ho\u1EB7c bi\u1EBFn m\xF4i tr\u01B0\u1EDDng GROQ_API_KEY."
    );
  }
  const hasImages = Array.isArray(params.images) && params.images.length > 0;
  const normalizedModelId = normalizeGroqModelId(params.modelId);
  const requestedGroqModel = stripGroqPrefix(normalizedModelId);
  const groqModel = hasImages && !isGroqVisionModelId(requestedGroqModel) ? stripGroqPrefix(GROQ_VISION_MODEL) : requestedGroqModel;
  const systemParts = [];
  if (params.systemInstruction) {
    systemParts.push(params.systemInstruction.trim());
  }
  if (params.jsonMode) {
    systemParts.push(
      "B\u1EAET BU\u1ED8C tr\u1EA3 v\u1EC1 duy nh\u1EA5t 1 JSON object h\u1EE3p l\u1EC7 (kh\xF4ng th\xEAm markdown, kh\xF4ng th\xEAm gi\u1EA3i th\xEDch ngo\xE0i JSON)."
    );
    if (params.jsonSchemaHint) {
      systemParts.push(`C\u1EA5u tr\xFAc JSON b\u1EAFt bu\u1ED9c:
${params.jsonSchemaHint}`);
    }
  }
  const messages = [];
  if (hasImages) {
    const combinedPrompt = systemParts.length > 0 ? `${systemParts.join("\n\n")}

${params.prompt}` : params.prompt;
    const userContent = [
      ...params.images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
      })),
      { type: "text", text: combinedPrompt }
    ];
    messages.push({ role: "user", content: userContent });
  } else {
    if (systemParts.length > 0) {
      messages.push({ role: "system", content: systemParts.join("\n\n") });
    }
    messages.push({ role: "user", content: params.prompt });
  }
  const maxTokens = Math.min(8192, Math.max(256, params.maxOutputTokens || 2048));
  const effectiveTemperature = typeof params.temperature === "number" && Number.isFinite(params.temperature) ? Math.max(0, Math.min(2, params.temperature)) : 0;
  const firstAttempt = await executeGroqRequest({
    apiKey,
    groqModel,
    messages,
    hasImages,
    jsonMode: params.jsonMode,
    maxTokens,
    temperature: effectiveTemperature,
    seed: params.seed,
    signal: params.signal
  });
  if (firstAttempt.ok) {
    return firstAttempt.result;
  }
  const isModelNotFoundResponse = (status2, errText2) => {
    const low = errText2.toLowerCase();
    return status2 === 404 || low.includes("model_not_found") || low.includes("model_decommissioned") || low.includes("does not exist");
  };
  let lastStatus = firstAttempt.status;
  let lastErrText = firstAttempt.errText;
  const triedModels = [groqModel];
  const allowAutoFallback = !params.disableModelAutoFallback && !params.strictModelLock;
  if ((firstAttempt.status === 404 || firstAttempt.status === 400 || firstAttempt.status === 503) && allowAutoFallback) {
    const availableModels = await fetchAvailableGroqChatModels(apiKey, params.signal, true);
    const tried = /* @__PURE__ */ new Set([groqModel.toLowerCase()]);
    const candidatePool = [];
    if (hasImages) {
      for (const m of availableModels) {
        if (isGroqVisionModelId(m)) candidatePool.push(m);
      }
      for (const v of GROQ_VISION_MODELS) {
        candidatePool.push(v);
      }
    } else {
      for (const pref of GROQ_PREFERRED_TEXT_MODELS) {
        const match = availableModels.find((m) => m.toLowerCase() === pref.toLowerCase());
        if (match) candidatePool.push(match);
      }
      for (const m of availableModels) {
        candidatePool.push(m);
      }
      for (const pref of GROQ_PREFERRED_TEXT_MODELS) {
        candidatePool.push(pref);
      }
    }
    let attempts = 0;
    for (const candidate of candidatePool) {
      const cleanCandidate = candidate.trim();
      const lower = cleanCandidate.toLowerCase();
      if (!lower || tried.has(lower)) continue;
      tried.add(lower);
      triedModels.push(cleanCandidate);
      attempts += 1;
      if (attempts > 5) break;
      const retryAttempt = await executeGroqRequest({
        apiKey,
        groqModel: cleanCandidate,
        messages,
        hasImages,
        jsonMode: params.jsonMode,
        maxTokens,
        temperature: effectiveTemperature,
        seed: params.seed,
        signal: params.signal
      });
      if (retryAttempt.ok) {
        return retryAttempt.result;
      }
      const prevWasNotFound = isModelNotFoundResponse(lastStatus, lastErrText);
      const currIsNotFound = isModelNotFoundResponse(retryAttempt.status, retryAttempt.errText);
      if (prevWasNotFound || !currIsNotFound) {
        lastStatus = retryAttempt.status;
        lastErrText = retryAttempt.errText;
      }
    }
  }
  const status = lastStatus;
  const errText = lastErrText;
  if (status === 429) {
    throw new Error(`429 RESOURCE_EXHAUSTED (Groq): ${errText.slice(0, 220)}`);
  }
  if (status === 401 || status === 403) {
    throw new Error(`PERMISSION_DENIED (Groq ${status}): Groq API Key kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 b\u1ECB thu h\u1ED3i.`);
  }
  if (isModelNotFoundResponse(status, errText)) {
    const availableModels = await fetchAvailableGroqChatModels(apiKey, params.signal);
    const sampleHint = availableModels.length > 0 ? ` C\xE1c model kh\u1EA3 d\u1EE5ng tr\xEAn t\xE0i kho\u1EA3n Groq c\u1EE7a b\u1EA1n: ${availableModels.slice(0, 6).join(", ")}.` : " Vui l\xF2ng ki\u1EC3m tra m\u1EE5c Model Access tr\xEAn Groq Console.";
    const visionNote = hasImages ? " L\u01B0u \xFD: t\xE1c v\u1EE5 \u0111\u1ECDc \u1EA3nh OCR tr\xEAn Groq y\xEAu c\u1EA7u model Vision \u0111ang ho\u1EA1t \u0111\u1ED9ng (v\xED d\u1EE5 qwen/qwen3.8-27b)." : "";
    throw new Error(
      `NOT_FOUND (Groq ${status}): \u0110\xE3 th\u1EED c\xE1c model [${triedModels.join(", ")}] nh\u01B0ng \u0111\u1EC1u kh\xF4ng kh\u1EA3 d\u1EE5ng tr\xEAn t\xE0i kho\u1EA3n Groq n\xE0y.${visionNote}${sampleHint} Chi ti\u1EBFt: ${errText.slice(0, 180)}`
    );
  }
  if (status === 503 || status === 502) {
    throw new Error(`503 UNAVAILABLE (Groq): ${errText.slice(0, 220)}`);
  }
  throw new Error(`Groq API error (HTTP ${status} tr\xEAn model ${triedModels.join(" -> ")}): ${errText.slice(0, 240)}`);
}

// src/server/singleKeyService.ts
var DATA_DIR = path2.resolve(process.cwd(), ".data");
var MISTRAL_ENCRYPTED_KEY_FILE = path2.join(DATA_DIR, "mistral-api-key.enc");
var TMP_MISTRAL_ENCRYPTED_KEY_FILE = path2.join(os.tmpdir(), "studycheck-mistral-api-key.enc");
var FIRESTORE_MISTRAL_DOC = "adminSecrets/mistral";
var GROQ_ENCRYPTED_KEY_FILE = path2.join(DATA_DIR, "groq-api-key.enc");
var TMP_GROQ_ENCRYPTED_KEY_FILE = path2.join(os.tmpdir(), "studycheck-groq-api-key.enc");
var FIRESTORE_GROQ_DOC = "adminSecrets/groq";
var CF_ENCRYPTED_KEY_FILE = path2.join(DATA_DIR, "cloudflare-ai-key.enc");
var TMP_CF_ENCRYPTED_KEY_FILE = path2.join(os.tmpdir(), "studycheck-cloudflare-ai-key.enc");
var FIRESTORE_CF_DOC = "adminSecrets/cloudflare";
var ephemeralProcessAesKey = null;
var warnedMissingEncryptionSecret = false;
function isPersistentEncryptionSecretConfigured() {
  return Boolean(
    process.env.KEY_ENCRYPTION_SECRET?.trim() || process.env.ADMIN_KEY_ENCRYPTION_SECRET?.trim()
  );
}
function deriveAesKey() {
  const configuredSeed = process.env.KEY_ENCRYPTION_SECRET?.trim() || process.env.ADMIN_KEY_ENCRYPTION_SECRET?.trim();
  if (configuredSeed) {
    return crypto3.createHash("sha256").update(`studycheck-aes-v2:${configuredSeed}`).digest();
  }
  if (!ephemeralProcessAesKey) {
    ephemeralProcessAesKey = crypto3.randomBytes(32);
    if (!warnedMissingEncryptionSecret) {
      warnedMissingEncryptionSecret = true;
      console.warn(
        "Security notice: KEY_ENCRYPTION_SECRET is not set. Using an ephemeral in-memory encryption key for this process; configure KEY_ENCRYPTION_SECRET in server environment variables before deploying."
      );
    }
  }
  return ephemeralProcessAesKey;
}
function encryptSecretPayload(rawValue) {
  const iv = crypto3.randomBytes(12);
  const cipher = crypto3.createCipheriv("aes-256-gcm", deriveAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(rawValue, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  };
}
function decryptSecretPayload(payload) {
  const decipher = crypto3.createDecipheriv(
    "aes-256-gcm",
    deriveAesKey(),
    Buffer.from(payload.iv, "base64")
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}
function maskApiKey(rawKey) {
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return "\u2022\u2022\u2022\u2022";
  return `${trimmed.slice(0, 6)}\u2022\u2022\u2022\u2022${trimmed.slice(-4)}`;
}
function maskCompactSecret(value) {
  const trimmed = value.trim();
  if (trimmed.length <= 8) return "\u2022\u2022\u2022\u2022";
  return `${trimmed.slice(0, 4)}\u2022\u2022${trimmed.slice(-4)}`;
}
function maskCloudflareIdentifier(accountId, apiToken) {
  return `${maskCompactSecret(accountId)} / ${maskCompactSecret(apiToken)}`.slice(0, 40);
}
function validateApiKeyInput(rawKey) {
  const trimmed = rawKey.trim();
  if (trimmed.length < 16) {
    return { valid: false, reason: "API key qu\xE1 ng\u1EAFn (c\u1EA7n t\u1ED1i thi\u1EC3u 16 k\xFD t\u1EF1)." };
  }
  if (trimmed.length > 512) {
    return { valid: false, reason: "API key qu\xE1 d\xE0i (t\u1ED1i \u0111a 512 k\xFD t\u1EF1)." };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: "API key kh\xF4ng \u0111\u01B0\u1EE3c ch\u1EE9a kho\u1EA3ng tr\u1EAFng ho\u1EB7c xu\u1ED1ng d\xF2ng." };
  }
  return { valid: true };
}
function validateCloudflareAccountId(accountId) {
  const trimmed = accountId.trim();
  if (trimmed.length < 16 || trimmed.length > 64) {
    return { valid: false, reason: "Cloudflare Account ID ph\u1EA3i d\xE0i t\u1EEB 16 \u0111\u1EBFn 64 k\xFD t\u1EF1." };
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: "Cloudflare Account ID ch\u1EC9 \u0111\u01B0\u1EE3c ch\u1EE9a ch\u1EEF c\xE1i, ch\u1EEF s\u1ED1, d\u1EA5u g\u1EA1ch ngang ho\u1EB7c g\u1EA1ch d\u01B0\u1EDBi."
    };
  }
  return { valid: true };
}
function validateCloudflareToken(apiToken) {
  const trimmed = apiToken.trim();
  if (trimmed.length < 16) {
    return { valid: false, reason: "Cloudflare API Token qu\xE1 ng\u1EAFn (c\u1EA7n t\u1ED1i thi\u1EC3u 16 k\xFD t\u1EF1)." };
  }
  if (trimmed.length > 512) {
    return { valid: false, reason: "Cloudflare API Token qu\xE1 d\xE0i (t\u1ED1i \u0111a 512 k\xFD t\u1EF1)." };
  }
  if (/\s/.test(trimmed)) {
    return { valid: false, reason: "Cloudflare API Token kh\xF4ng \u0111\u01B0\u1EE3c ch\u1EE9a kho\u1EA3ng tr\u1EAFng ho\u1EB7c xu\u1ED1ng d\xF2ng." };
  }
  return { valid: true };
}
var cachedMistralKey = null;
var cachedGroqKey = null;
var cachedCloudflareCreds = null;
function writeEncryptedSecretFiles(primaryFile, tmpFile, record) {
  const serialized = JSON.stringify(record, null, 2);
  if (process.env.VERCEL !== "1") {
    try {
      if (!fs2.existsSync(DATA_DIR)) {
        fs2.mkdirSync(DATA_DIR, { recursive: true, mode: 448 });
      }
      fs2.writeFileSync(primaryFile, serialized, { mode: 384 });
    } catch {
    }
  }
  try {
    fs2.writeFileSync(tmpFile, serialized, { mode: 384 });
  } catch {
  }
}
function removeEncryptedSecretFiles(primaryFile, tmpFile) {
  for (const filePath of [primaryFile, tmpFile]) {
    try {
      if (fs2.existsSync(filePath)) {
        fs2.unlinkSync(filePath);
      }
    } catch {
    }
  }
}
function readLocalEncryptedRecord(primaryFile, tmpFile) {
  for (const filePath of [primaryFile, tmpFile]) {
    try {
      if (!fs2.existsSync(filePath)) continue;
      const raw = fs2.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed.ciphertext || !parsed.iv || !parsed.authTag) continue;
      return parsed;
    } catch {
    }
  }
  return null;
}
function parseStoredCloudflareDoc(doc) {
  try {
    const rawJson = decryptSecretPayload(doc);
    const parsed = JSON.parse(rawJson);
    const accountId = (parsed.accountId || "").trim();
    const apiToken = (parsed.apiToken || "").trim();
    if (!accountId || !apiToken) return null;
    const maskedAccountId = maskCompactSecret(accountId);
    const maskedKey = maskApiKey(apiToken);
    return {
      accountId,
      apiToken,
      maskedAccountId,
      maskedKey,
      maskedIdentifier: doc.maskedIdentifier || maskCloudflareIdentifier(accountId, apiToken),
      label: doc.label || "Cloudflare Workers AI Free",
      updatedAt: doc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: doc.updatedBy || "admin",
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage
    };
  } catch {
    return null;
  }
}
function loadLocalEncryptedFiles() {
  const mistralDoc = readLocalEncryptedRecord(
    MISTRAL_ENCRYPTED_KEY_FILE,
    TMP_MISTRAL_ENCRYPTED_KEY_FILE
  );
  if (mistralDoc) {
    try {
      const rawKey = decryptSecretPayload(mistralDoc);
      if (rawKey) {
        cachedMistralKey = {
          rawKey,
          maskedKey: mistralDoc.maskedIdentifier || maskApiKey(rawKey),
          label: mistralDoc.label || "Mistral AI Free API Key",
          updatedAt: mistralDoc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          updatedBy: mistralDoc.updatedBy || "admin",
          lastTestStatus: mistralDoc.lastTestStatus,
          lastTestAt: mistralDoc.lastTestAt,
          lastTestMessage: mistralDoc.lastTestMessage
        };
      }
    } catch {
      cachedMistralKey = null;
    }
  }
  const groqDoc = readLocalEncryptedRecord(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE);
  if (groqDoc) {
    try {
      const rawKey = decryptSecretPayload(groqDoc);
      if (rawKey) {
        cachedGroqKey = {
          rawKey,
          maskedKey: groqDoc.maskedIdentifier || maskApiKey(rawKey),
          label: groqDoc.label || "Groq Cloud Free API Key",
          updatedAt: groqDoc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          updatedBy: groqDoc.updatedBy || "admin",
          lastTestStatus: groqDoc.lastTestStatus,
          lastTestAt: groqDoc.lastTestAt,
          lastTestMessage: groqDoc.lastTestMessage
        };
      }
    } catch {
      cachedGroqKey = null;
    }
  }
  const cfDoc = readLocalEncryptedRecord(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE);
  if (cfDoc) {
    cachedCloudflareCreds = parseStoredCloudflareDoc(cfDoc);
  }
}
loadLocalEncryptedFiles();
function getEnvFallbackMistralKey() {
  const candidates = [
    process.env.MISTRAL_API_KEY,
    process.env.MISTRAL_API_KEY_1,
    process.env.MISTRAL_KEY_CHAM_1,
    process.env.MISTRAL_KEY_QUET_1,
    process.env.MISTRAL_KEY_DO_1
  ];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (clean && clean !== "YOUR_MISTRAL_API_KEY") return clean;
  }
  return null;
}
function getEnvFallbackGroqKey() {
  const candidates = [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_1,
    process.env.GROQ_KEY_QUET_1,
    process.env.GROQ_KEY_DO_1,
    process.env.GROQ_KEY_CHAM_1
  ];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (clean) return clean;
  }
  return null;
}
function getEnvFallbackCloudflareCredentials() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}
async function hydrateMistralSecretFromFirestore(idToken) {
  if (cachedMistralKey) return;
  try {
    const doc = await firestoreRestGet(FIRESTORE_MISTRAL_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const rawKey = decryptSecretPayload(doc);
    if (!rawKey) return;
    cachedMistralKey = {
      rawKey,
      maskedKey: doc.maskedIdentifier || maskApiKey(rawKey),
      label: doc.label || "Mistral AI Free API Key",
      updatedAt: doc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: doc.updatedBy || "admin",
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage
    };
    writeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE, doc);
  } catch {
  }
}
async function hydrateGroqSecretFromFirestore(idToken) {
  if (cachedGroqKey) return;
  try {
    const doc = await firestoreRestGet(FIRESTORE_GROQ_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const rawKey = decryptSecretPayload(doc);
    if (!rawKey) return;
    cachedGroqKey = {
      rawKey,
      maskedKey: doc.maskedIdentifier || maskApiKey(rawKey),
      label: doc.label || "Groq Cloud Free API Key",
      updatedAt: doc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: doc.updatedBy || "admin",
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage
    };
    writeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE, doc);
  } catch {
  }
}
async function hydrateCloudflareSecretFromFirestore(idToken) {
  if (cachedCloudflareCreds) return;
  try {
    const doc = await firestoreRestGet(FIRESTORE_CF_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const parsed = parseStoredCloudflareDoc(doc);
    if (!parsed) return;
    cachedCloudflareCreds = parsed;
    writeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE, doc);
  } catch {
  }
}
async function hydrateAllProviderKeysFromFirestore(idToken) {
  if (!idToken) return;
  await Promise.allSettled([
    hydrateMistralSecretFromFirestore(idToken),
    hydrateGroqSecretFromFirestore(idToken),
    hydrateCloudflareSecretFromFirestore(idToken)
  ]);
}
async function hydrateSingleKeyForSuperAdmin(idToken) {
  await hydrateAllProviderKeysFromFirestore(idToken);
}
async function getMistralKeyStatus(idToken) {
  if (idToken && !cachedMistralKey) {
    await hydrateMistralSecretFromFirestore(idToken);
  }
  const hasEnvFallbackKey = Boolean(getEnvFallbackMistralKey());
  if (cachedMistralKey) {
    return {
      configured: true,
      source: "admin",
      maskedKey: cachedMistralKey.maskedKey,
      label: cachedMistralKey.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedMistralKey.lastTestStatus || "Untested",
      lastTestAt: cachedMistralKey.lastTestAt,
      lastTestMessage: cachedMistralKey.lastTestMessage,
      updatedAt: cachedMistralKey.updatedAt,
      updatedBy: cachedMistralKey.updatedBy
    };
  }
  const envKey = getEnvFallbackMistralKey();
  if (envKey) {
    return {
      configured: true,
      source: "server_env",
      maskedKey: maskApiKey(envKey),
      label: "Bi\u1EBFn m\xF4i tr\u01B0\u1EDDng m\xE1y ch\u1EE7 (MISTRAL_API_KEY)",
      hasEnvFallbackKey: true,
      lastTestStatus: "Untested"
    };
  }
  return {
    configured: false,
    source: "none",
    maskedKey: "",
    label: "",
    hasEnvFallbackKey: false,
    lastTestStatus: "Untested"
  };
}
async function getGroqKeyStatus(idToken) {
  if (idToken && !cachedGroqKey) {
    await hydrateGroqSecretFromFirestore(idToken);
  }
  const hasEnvFallbackKey = Boolean(getEnvFallbackGroqKey());
  if (cachedGroqKey) {
    return {
      configured: true,
      source: "admin",
      maskedKey: cachedGroqKey.maskedKey,
      label: cachedGroqKey.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedGroqKey.lastTestStatus || "Untested",
      lastTestAt: cachedGroqKey.lastTestAt,
      lastTestMessage: cachedGroqKey.lastTestMessage,
      updatedAt: cachedGroqKey.updatedAt,
      updatedBy: cachedGroqKey.updatedBy
    };
  }
  const envKey = getEnvFallbackGroqKey();
  if (envKey) {
    return {
      configured: true,
      source: "server_env",
      maskedKey: maskApiKey(envKey),
      label: "Bi\u1EBFn m\xF4i tr\u01B0\u1EDDng m\xE1y ch\u1EE7 (GROQ_API_KEY)",
      hasEnvFallbackKey: true,
      lastTestStatus: "Untested"
    };
  }
  return {
    configured: false,
    source: "none",
    maskedKey: "",
    label: "",
    hasEnvFallbackKey: false,
    lastTestStatus: "Untested"
  };
}
async function getCloudflareKeyStatus(idToken) {
  if (idToken && !cachedCloudflareCreds) {
    await hydrateCloudflareSecretFromFirestore(idToken);
  }
  const envCreds = getEnvFallbackCloudflareCredentials();
  const hasEnvFallbackKey = Boolean(envCreds);
  if (cachedCloudflareCreds) {
    return {
      configured: true,
      source: "admin",
      maskedAccountId: cachedCloudflareCreds.maskedAccountId,
      maskedKey: cachedCloudflareCreds.maskedKey,
      label: cachedCloudflareCreds.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedCloudflareCreds.lastTestStatus || "Untested",
      lastTestAt: cachedCloudflareCreds.lastTestAt,
      lastTestMessage: cachedCloudflareCreds.lastTestMessage,
      updatedAt: cachedCloudflareCreds.updatedAt,
      updatedBy: cachedCloudflareCreds.updatedBy
    };
  }
  if (envCreds) {
    return {
      configured: true,
      source: "server_env",
      maskedAccountId: maskCompactSecret(envCreds.accountId),
      maskedKey: maskApiKey(envCreds.apiToken),
      label: "Bi\u1EBFn m\xF4i tr\u01B0\u1EDDng m\xE1y ch\u1EE7 (CLOUDFLARE_ACCOUNT_ID / TOKEN)",
      hasEnvFallbackKey: true,
      lastTestStatus: "Untested"
    };
  }
  return {
    configured: false,
    source: "none",
    maskedAccountId: "",
    maskedKey: "",
    label: "",
    hasEnvFallbackKey: false,
    lastTestStatus: "Untested"
  };
}
async function getProviderKeysStatus(idToken) {
  const [mistral, groq, cloudflare] = await Promise.all([
    getMistralKeyStatus(idToken),
    getGroqKeyStatus(idToken),
    getCloudflareKeyStatus(idToken)
  ]);
  return { mistral, groq, cloudflare };
}
async function setMistralApiKey(params) {
  const { rawKey, label, actorUid, actorEmail, idToken } = params;
  const trimmed = rawKey.trim();
  const check = validateApiKeyInput(trimmed);
  if (!check.valid) {
    return { ok: false, error: check.reason || "Mistral API key kh\xF4ng h\u1EE3p l\u1EC7." };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const maskedIdentifier = maskApiKey(trimmed).slice(0, 40);
  const encrypted = encryptSecretPayload(trimmed);
  const finalLabel = ((label || "").trim() || "Mistral AI Free API Key").slice(0, 100);
  const storedDoc = {
    secretId: "mistral",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: (actorEmail || actorUid).slice(0, 128),
    lastTestStatus: "Untested",
    lastTestAt: "",
    lastTestMessage: ""
  };
  cachedMistralKey = {
    rawKey: trimmed,
    maskedKey: maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: storedDoc.updatedBy,
    lastTestStatus: "Untested"
  };
  writeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE, storedDoc);
  try {
    await firestoreRestSet(
      FIRESTORE_MISTRAL_DOC,
      storedDoc,
      idToken
    );
  } catch (err) {
    console.warn("Could not persist encrypted Mistral key to Firestore:", err);
    if (process.env.VERCEL === "1") {
      return {
        ok: false,
        error: "Kh\xF4ng th\u1EC3 l\u01B0u kh\xF3a Mistral m\xE3 h\xF3a l\xEAn Cloud Firestore (adminSecrets/mistral). Vui l\xF2ng ki\u1EC3m tra quy\u1EC1n Super Admin ho\u1EB7c k\u1EBFt n\u1ED1i Firestore."
      };
    }
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "MISTRAL_API_KEY_SAVED",
      resourceType: "adminSecrets",
      resourceId: "mistral",
      status: "success",
      metadata: {
        maskedIdentifier,
        label: finalLabel
      }
    },
    idToken
  );
  return { ok: true, status: await getMistralKeyStatus() };
}
async function clearMistralApiKey(params) {
  const { actorUid, actorEmail, idToken } = params;
  cachedMistralKey = null;
  removeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE);
  try {
    await firestoreRestDelete(FIRESTORE_MISTRAL_DOC, idToken);
  } catch {
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "MISTRAL_API_KEY_CLEARED",
      resourceType: "adminSecrets",
      resourceId: "mistral",
      status: "success",
      metadata: {}
    },
    idToken
  );
  return { ok: true, status: await getMistralKeyStatus() };
}
async function setGroqApiKey(params) {
  const { rawKey, label, actorUid, actorEmail, idToken } = params;
  const trimmed = rawKey.trim();
  const check = validateApiKeyInput(trimmed);
  if (!check.valid) {
    return { ok: false, error: check.reason || "Groq API key kh\xF4ng h\u1EE3p l\u1EC7." };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const maskedIdentifier = maskApiKey(trimmed).slice(0, 40);
  const encrypted = encryptSecretPayload(trimmed);
  const finalLabel = ((label || "").trim() || "Groq Cloud Free API Key").slice(0, 100);
  const storedDoc = {
    secretId: "groq",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: (actorEmail || actorUid).slice(0, 128),
    lastTestStatus: "Untested",
    lastTestAt: "",
    lastTestMessage: ""
  };
  cachedGroqKey = {
    rawKey: trimmed,
    maskedKey: maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: storedDoc.updatedBy,
    lastTestStatus: "Untested"
  };
  writeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE, storedDoc);
  try {
    await firestoreRestSet(
      FIRESTORE_GROQ_DOC,
      storedDoc,
      idToken
    );
  } catch (err) {
    console.warn("Could not persist encrypted Groq key to Firestore:", err);
    if (process.env.VERCEL === "1") {
      return {
        ok: false,
        error: "Kh\xF4ng th\u1EC3 l\u01B0u kh\xF3a Groq m\xE3 h\xF3a l\xEAn Cloud Firestore (adminSecrets/groq). Vui l\xF2ng ki\u1EC3m tra quy\u1EC1n Super Admin ho\u1EB7c k\u1EBFt n\u1ED1i Firestore."
      };
    }
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "GROQ_API_KEY_SAVED",
      resourceType: "adminSecrets",
      resourceId: "groq",
      status: "success",
      metadata: {
        maskedIdentifier,
        label: finalLabel
      }
    },
    idToken
  );
  return { ok: true, status: await getGroqKeyStatus() };
}
async function clearGroqApiKey(params) {
  const { actorUid, actorEmail, idToken } = params;
  cachedGroqKey = null;
  removeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE);
  try {
    await firestoreRestDelete(FIRESTORE_GROQ_DOC, idToken);
  } catch {
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "GROQ_API_KEY_CLEARED",
      resourceType: "adminSecrets",
      resourceId: "groq",
      status: "success",
      metadata: {}
    },
    idToken
  );
  return { ok: true, status: await getGroqKeyStatus() };
}
async function setCloudflareCredentials(params) {
  const { accountId, apiToken, label, actorUid, actorEmail, idToken } = params;
  const cleanAccountId = accountId.trim();
  const cleanToken = apiToken.trim();
  const accCheck = validateCloudflareAccountId(cleanAccountId);
  if (!accCheck.valid) {
    return { ok: false, error: accCheck.reason || "Cloudflare Account ID kh\xF4ng h\u1EE3p l\u1EC7." };
  }
  const tokCheck = validateCloudflareToken(cleanToken);
  if (!tokCheck.valid) {
    return { ok: false, error: tokCheck.reason || "Cloudflare API Token kh\xF4ng h\u1EE3p l\u1EC7." };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const maskedAccountId = maskCompactSecret(cleanAccountId);
  const maskedKey = maskApiKey(cleanToken);
  const maskedIdentifier = maskCloudflareIdentifier(cleanAccountId, cleanToken);
  const encrypted = encryptSecretPayload(
    JSON.stringify({ accountId: cleanAccountId, apiToken: cleanToken })
  );
  const finalLabel = ((label || "").trim() || "Cloudflare Workers AI Free").slice(0, 100);
  const storedDoc = {
    secretId: "cloudflare",
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: (actorEmail || actorUid).slice(0, 128),
    lastTestStatus: "Untested",
    lastTestAt: "",
    lastTestMessage: ""
  };
  cachedCloudflareCreds = {
    accountId: cleanAccountId,
    apiToken: cleanToken,
    maskedAccountId,
    maskedKey,
    maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: storedDoc.updatedBy,
    lastTestStatus: "Untested"
  };
  writeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE, storedDoc);
  try {
    await firestoreRestSet(
      FIRESTORE_CF_DOC,
      storedDoc,
      idToken
    );
  } catch (err) {
    console.warn("Could not persist encrypted Cloudflare credentials to Firestore:", err);
    if (process.env.VERCEL === "1") {
      return {
        ok: false,
        error: "Kh\xF4ng th\u1EC3 l\u01B0u th\xF4ng tin Cloudflare m\xE3 h\xF3a l\xEAn Cloud Firestore (adminSecrets/cloudflare). Vui l\xF2ng ki\u1EC3m tra quy\u1EC1n Super Admin ho\u1EB7c k\u1EBFt n\u1ED1i Firestore."
      };
    }
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "CLOUDFLARE_CREDENTIALS_SAVED",
      resourceType: "adminSecrets",
      resourceId: "cloudflare",
      status: "success",
      metadata: {
        maskedIdentifier,
        label: finalLabel
      }
    },
    idToken
  );
  return { ok: true, status: await getCloudflareKeyStatus() };
}
async function clearCloudflareCredentials(params) {
  const { actorUid, actorEmail, idToken } = params;
  cachedCloudflareCreds = null;
  removeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE);
  try {
    await firestoreRestDelete(FIRESTORE_CF_DOC, idToken);
  } catch {
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "CLOUDFLARE_CREDENTIALS_CLEARED",
      resourceType: "adminSecrets",
      resourceId: "cloudflare",
      status: "success",
      metadata: {}
    },
    idToken
  );
  return { ok: true, status: await getCloudflareKeyStatus() };
}
async function testMistralApiKey(params) {
  const { rawKeyOverride, actorUid, actorEmail, idToken } = params;
  const testedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (!cachedMistralKey) {
    await hydrateMistralSecretFromFirestore(idToken);
  }
  let keyToTest = "";
  let testedSource = "none";
  if (rawKeyOverride && rawKeyOverride.trim()) {
    keyToTest = rawKeyOverride.trim();
    testedSource = "preview_input";
  } else if (cachedMistralKey) {
    keyToTest = cachedMistralKey.rawKey;
    testedSource = "admin";
  } else {
    const envKey = getEnvFallbackMistralKey();
    if (envKey) {
      keyToTest = envKey;
      testedSource = "server_env";
    }
  }
  if (!keyToTest) {
    return {
      status: "Invalid key",
      message: "Ch\u01B0a c\u1EA5u h\xECnh Mistral AI API Key. H\xE3y d\xE1n key r\u1ED3i b\u1EA5m L\u01B0u ho\u1EB7c Th\u1EED nghi\u1EC7m.",
      testedSource: "none",
      testedAt,
      keyStatus: await getMistralKeyStatus()
    };
  }
  let resultStatus = "Connected";
  const testModel = "mistral-small-latest";
  let resultMessage = `K\u1EBFt n\u1ED1i Mistral AI th\xE0nh c\xF4ng (model ${testModel} ph\u1EA3n h\u1ED3i t\u1ED1t).`;
  try {
    const pingRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${keyToTest}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: "user", content: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK" }],
        temperature: 0,
        max_tokens: 32
      }),
      signal: AbortSignal.timeout(15e3)
    });
    if (!pingRes.ok) {
      const errText = await pingRes.text().catch(() => "");
      if (pingRes.status === 402) {
        resultStatus = "Quota exceeded";
        resultMessage = "Mistral b\xE1o HTTP 402 (C\u1EA7n k\xEDch ho\u1EA1t g\xF3i): Key mi\u1EC5n ph\xED c\u1EE7a Mistral v\u1EABn c\u1EA7n v\xE0o console.mistral.ai \u2192 Billing / Subscription \u0111\u1EC3 ch\u1ECDn g\xF3i Experiment (mi\u1EC5n ph\xED, x\xE1c minh S\u0110T) ho\u1EB7c n\u1EA1p credit. Trong l\xFAc ch\u1EDD, h\u1EC7 th\u1ED1ng s\u1EBD t\u1EF1 chuy\u1EC3n sang Groq / Cloudflare n\u1EBFu \u0111\xE3 c\u1EA5u h\xECnh.";
      } else if (pingRes.status === 401 || pingRes.status === 403) {
        resultStatus = "Invalid key";
        resultMessage = "Mistral AI API Key kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 b\u1ECB thu h\u1ED3i.";
      } else if (pingRes.status === 429) {
        resultStatus = "Quota exceeded";
        resultMessage = "Mistral AI API Key \u0111\xE3 ch\u1EA1m h\u1EA1n m\u1EE9c (429).";
      } else if (pingRes.status === 404) {
        resultStatus = "Model unavailable";
        resultMessage = `Model ${testModel} kh\xF4ng kh\u1EA3 d\u1EE5ng tr\xEAn t\xE0i kho\u1EA3n Mistral n\xE0y.`;
      } else {
        resultStatus = "Temporary provider error";
        resultMessage = `L\u1ED7i Mistral AI (HTTP ${pingRes.status}): ${errText.slice(0, 120)}`;
      }
    }
  } catch (err) {
    resultStatus = "Temporary provider error";
    resultMessage = `L\u1ED7i k\u1EBFt n\u1ED1i Mistral AI: ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`;
  }
  if (testedSource === "preview_input" && resultStatus === "Connected") {
    const check = validateApiKeyInput(keyToTest);
    if (check.valid) {
      await setMistralApiKey({
        rawKey: keyToTest,
        label: cachedMistralKey?.label || "Mistral AI Free API Key",
        actorUid,
        actorEmail,
        idToken
      });
      resultMessage = `${resultMessage} \u0110\xE3 t\u1EF1 \u0111\u1ED9ng l\u01B0u v\xE0 k\xEDch ho\u1EA1t kh\xF3a Mistral AI cho Ki\u1EC3m \u0111\u1ECBnh.`;
    }
  }
  if ((testedSource === "admin" || testedSource === "preview_input" && resultStatus === "Connected") && cachedMistralKey) {
    cachedMistralKey.lastTestStatus = resultStatus;
    cachedMistralKey.lastTestAt = testedAt;
    cachedMistralKey.lastTestMessage = resultMessage.slice(0, 280);
    const encrypted = encryptSecretPayload(cachedMistralKey.rawKey);
    const updatedDoc = {
      secretId: "mistral",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedMistralKey.maskedKey.slice(0, 40),
      label: cachedMistralKey.label.slice(0, 100),
      updatedAt: cachedMistralKey.updatedAt,
      updatedBy: cachedMistralKey.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: cachedMistralKey.lastTestMessage
    };
    writeEncryptedSecretFiles(MISTRAL_ENCRYPTED_KEY_FILE, TMP_MISTRAL_ENCRYPTED_KEY_FILE, updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_MISTRAL_DOC,
        updatedDoc,
        idToken
      );
    } catch {
    }
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "MISTRAL_API_KEY_TESTED",
      resourceType: "adminSecrets",
      resourceId: "mistral",
      status: resultStatus === "Connected" ? "success" : "failure",
      metadata: {
        resultStatus,
        testedSource
      }
    },
    idToken
  );
  return {
    status: resultStatus,
    message: resultMessage,
    testedSource,
    testedAt,
    keyStatus: await getMistralKeyStatus()
  };
}
async function testGroqApiKey(params) {
  const { rawKeyOverride, actorUid, actorEmail, idToken } = params;
  const testedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (!cachedGroqKey) {
    await hydrateGroqSecretFromFirestore(idToken);
  }
  let keyToTest = "";
  let testedSource = "none";
  if (rawKeyOverride && rawKeyOverride.trim()) {
    keyToTest = rawKeyOverride.trim();
    testedSource = "preview_input";
  } else if (cachedGroqKey) {
    keyToTest = cachedGroqKey.rawKey;
    testedSource = "admin";
  } else {
    const envKey = getEnvFallbackGroqKey();
    if (envKey) {
      keyToTest = envKey;
      testedSource = "server_env";
    }
  }
  if (!keyToTest) {
    return {
      status: "Invalid key",
      message: "Ch\u01B0a c\u1EA5u h\xECnh Groq API Key. H\xE3y d\xE1n key (gsk_...) r\u1ED3i b\u1EA5m L\u01B0u ho\u1EB7c Th\u1EED nghi\u1EC7m.",
      testedSource: "none",
      testedAt,
      keyStatus: await getGroqKeyStatus()
    };
  }
  let resultStatus = "Connected";
  let resultMessage = "";
  let availableModels = [];
  try {
    const modelsRes = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${keyToTest}` },
      signal: AbortSignal.timeout(15e3)
    });
    if (modelsRes.status === 401 || modelsRes.status === 403) {
      resultStatus = "Invalid key";
      resultMessage = "Groq API Key kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 b\u1ECB thu h\u1ED3i.";
    } else if (modelsRes.status === 429) {
      resultStatus = "Quota exceeded";
      resultMessage = "T\xE0i kho\u1EA3n Groq \u0111ang ch\u1EA1m h\u1EA1n m\u1EE9c (429).";
    } else if (!modelsRes.ok) {
      resultStatus = "Temporary provider error";
      resultMessage = `Groq API ph\u1EA3n h\u1ED3i HTTP ${modelsRes.status}.`;
    } else {
      const modelsData = await modelsRes.json();
      const excluded = ["whisper", "tts", "playai", "guard", "safeguard", "orpheus", "compound"];
      availableModels = (modelsData.data || []).filter((m) => m && typeof m.id === "string" && m.active !== false).map((m) => m.id.trim()).filter((id) => !excluded.some((tok) => id.toLowerCase().includes(tok)));
      const preferred = [
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "qwen/qwen3.8-27b",
        "qwen/qwen3-32b"
      ];
      const availableVisionModels = availableModels.filter((m) => isGroqVisionModelId(m));
      const chosenModel = preferred.find((p) => availableModels.some((m) => m.toLowerCase() === p)) || availableModels[0] || "openai/gpt-oss-120b";
      const pingRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keyToTest}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: chosenModel,
          messages: [{ role: "user", content: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK" }],
          temperature: 0.1,
          max_tokens: 256
        }),
        signal: AbortSignal.timeout(15e3)
      });
      if (pingRes.ok) {
        resultStatus = "Connected";
        const visionStatusText = availableVisionModels.length > 0 ? `Vision OCR s\u1EB5n s\xE0ng: ${availableVisionModels.slice(0, 2).join(", ")}` : "Ch\u01B0a th\u1EA5y model Vision OCR tr\xEAn key Groq n\xE0y \u2014 h\u1EC7 th\u1ED1ng s\u1EBD d\xF9ng Cloudflare Workers AI ho\u1EB7c Mistral AI \u0111\u1EC3 \u0111\u1ECDc \u1EA3nh";
        resultMessage = `K\u1EBFt n\u1ED1i Groq Cloud th\xE0nh c\xF4ng (model ${chosenModel} ph\u1EA3n h\u1ED3i t\u1ED1t; ${availableModels.length} model kh\u1EA3 d\u1EE5ng; ${visionStatusText}).`;
      } else {
        const errText = await pingRes.text().catch(() => "");
        if (pingRes.status === 401 || pingRes.status === 403) {
          resultStatus = "Invalid key";
          resultMessage = "Groq API Key kh\xF4ng c\xF3 quy\u1EC1n g\u1ECDi chat completion.";
        } else if (pingRes.status === 429) {
          resultStatus = "Quota exceeded";
          resultMessage = "Groq API Key \u0111\xE3 ch\u1EA1m h\u1EA1n m\u1EE9c (429).";
        } else if (pingRes.status === 404) {
          resultStatus = "Model unavailable";
          resultMessage = `Model ${chosenModel} kh\xF4ng kh\u1EA3 d\u1EE5ng tr\xEAn t\xE0i kho\u1EA3n Groq n\xE0y.`;
        } else {
          resultStatus = "Temporary provider error";
          resultMessage = `L\u1ED7i Groq (HTTP ${pingRes.status}): ${errText.slice(0, 120)}`;
        }
      }
    }
  } catch (err) {
    resultStatus = "Temporary provider error";
    resultMessage = `L\u1ED7i k\u1EBFt n\u1ED1i Groq Cloud: ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`;
  }
  if (testedSource === "preview_input" && resultStatus === "Connected") {
    const check = validateApiKeyInput(keyToTest);
    if (check.valid) {
      await setGroqApiKey({
        rawKey: keyToTest,
        label: cachedGroqKey?.label || "Groq Cloud Free API Key",
        actorUid,
        actorEmail,
        idToken
      });
      resultMessage = `${resultMessage} \u0110\xE3 t\u1EF1 \u0111\u1ED9ng l\u01B0u v\xE0 k\xEDch ho\u1EA1t kh\xF3a Groq n\xE0y cho Ki\u1EC3m \u0111\u1ECBnh.`;
    }
  }
  if ((testedSource === "admin" || testedSource === "preview_input" && resultStatus === "Connected") && cachedGroqKey) {
    cachedGroqKey.lastTestStatus = resultStatus;
    cachedGroqKey.lastTestAt = testedAt;
    cachedGroqKey.lastTestMessage = resultMessage.slice(0, 280);
    const encrypted = encryptSecretPayload(cachedGroqKey.rawKey);
    const updatedDoc = {
      secretId: "groq",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedGroqKey.maskedKey.slice(0, 40),
      label: cachedGroqKey.label.slice(0, 100),
      updatedAt: cachedGroqKey.updatedAt,
      updatedBy: cachedGroqKey.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: cachedGroqKey.lastTestMessage
    };
    writeEncryptedSecretFiles(GROQ_ENCRYPTED_KEY_FILE, TMP_GROQ_ENCRYPTED_KEY_FILE, updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_GROQ_DOC,
        updatedDoc,
        idToken
      );
    } catch {
    }
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "GROQ_API_KEY_TESTED",
      resourceType: "adminSecrets",
      resourceId: "groq",
      status: resultStatus === "Connected" ? "success" : "failure",
      metadata: {
        resultStatus,
        testedSource
      }
    },
    idToken
  );
  return {
    status: resultStatus,
    message: resultMessage,
    testedSource,
    testedAt,
    keyStatus: await getGroqKeyStatus(),
    availableModels: availableModels.slice(0, 10)
  };
}
async function testCloudflareCredentials(params) {
  const { accountIdOverride, apiTokenOverride, actorUid, actorEmail, idToken } = params;
  const testedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (!cachedCloudflareCreds) {
    await hydrateCloudflareSecretFromFirestore(idToken);
  }
  let accountId = "";
  let apiToken = "";
  let testedSource = "none";
  if (accountIdOverride?.trim() || apiTokenOverride?.trim()) {
    accountId = (accountIdOverride || "").trim() || cachedCloudflareCreds?.accountId || "";
    apiToken = (apiTokenOverride || "").trim() || cachedCloudflareCreds?.apiToken || "";
    testedSource = "preview_input";
  } else if (cachedCloudflareCreds) {
    accountId = cachedCloudflareCreds.accountId;
    apiToken = cachedCloudflareCreds.apiToken;
    testedSource = "admin";
  } else {
    const envCreds = getEnvFallbackCloudflareCredentials();
    if (envCreds) {
      accountId = envCreds.accountId;
      apiToken = envCreds.apiToken;
      testedSource = "server_env";
    }
  }
  if (!accountId || !apiToken) {
    return {
      status: "Invalid key",
      message: "Ch\u01B0a \u0111\u1EE7 th\xF4ng tin Cloudflare Workers AI (c\u1EA7n c\u1EA3 Account ID v\xE0 API Token). H\xE3y \u0111i\u1EC1n \u0111\u1EE7 2 tr\u01B0\u1EDDng r\u1ED3i b\u1EA5m L\u01B0u ho\u1EB7c Th\u1EED nghi\u1EC7m.",
      testedSource: "none",
      testedAt,
      keyStatus: await getCloudflareKeyStatus()
    };
  }
  const accCheck = validateCloudflareAccountId(accountId);
  if (!accCheck.valid) {
    return {
      status: "Invalid key",
      message: accCheck.reason || "Cloudflare Account ID kh\xF4ng h\u1EE3p l\u1EC7.",
      testedSource,
      testedAt,
      keyStatus: await getCloudflareKeyStatus()
    };
  }
  let resultStatus = "Connected";
  const testModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  let resultMessage = `K\u1EBFt n\u1ED1i Cloudflare Workers AI th\xE0nh c\xF4ng (${testModel} ph\u1EA3n h\u1ED3i t\u1ED1t).`;
  try {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
    const pingRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: "user", content: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK" }],
        temperature: 0.1,
        max_tokens: 128
      }),
      signal: AbortSignal.timeout(15e3)
    });
    if (!pingRes.ok) {
      const errText = await pingRes.text().catch(() => "");
      if (pingRes.status === 401 || pingRes.status === 403) {
        resultStatus = "Permission denied";
        resultMessage = "Cloudflare Account ID ho\u1EB7c API Token kh\xF4ng h\u1EE3p l\u1EC7 (h\xE3y \u0111\u1EA3m b\u1EA3o token c\xF3 quy\u1EC1n Workers AI Read/Edit).";
      } else if (pingRes.status === 429) {
        resultStatus = "Quota exceeded";
        resultMessage = "T\xE0i kho\u1EA3n Cloudflare Workers AI \u0111\xE3 ch\u1EA1m gi\u1EDBi h\u1EA1n 10.000 Neurons/ng\xE0y (429).";
      } else if (pingRes.status === 404) {
        resultStatus = "Model unavailable";
        resultMessage = "Account ID kh\xF4ng t\u1ED3n t\u1EA1i ho\u1EB7c model Cloudflare kh\xF4ng kh\u1EA3 d\u1EE5ng.";
      } else {
        resultStatus = "Temporary provider error";
        resultMessage = `L\u1ED7i Cloudflare Workers AI (HTTP ${pingRes.status}): ${errText.slice(0, 120)}`;
      }
    }
  } catch (err) {
    resultStatus = "Temporary provider error";
    resultMessage = `L\u1ED7i k\u1EBFt n\u1ED1i Cloudflare Workers AI: ${(err instanceof Error ? err.message : String(err)).slice(0, 140)}`;
  }
  if (testedSource === "preview_input" && resultStatus === "Connected") {
    const tokCheck = validateCloudflareToken(apiToken);
    if (tokCheck.valid) {
      await setCloudflareCredentials({
        accountId,
        apiToken,
        label: cachedCloudflareCreds?.label || "Cloudflare Workers AI Free",
        actorUid,
        actorEmail,
        idToken
      });
      resultMessage = `${resultMessage} \u0110\xE3 t\u1EF1 \u0111\u1ED9ng l\u01B0u v\xE0 k\xEDch ho\u1EA1t Cloudflare Workers AI cho Ki\u1EC3m \u0111\u1ECBnh.`;
    }
  }
  if ((testedSource === "admin" || testedSource === "preview_input" && resultStatus === "Connected") && cachedCloudflareCreds) {
    cachedCloudflareCreds.lastTestStatus = resultStatus;
    cachedCloudflareCreds.lastTestAt = testedAt;
    cachedCloudflareCreds.lastTestMessage = resultMessage.slice(0, 280);
    const encrypted = encryptSecretPayload(
      JSON.stringify({
        accountId: cachedCloudflareCreds.accountId,
        apiToken: cachedCloudflareCreds.apiToken
      })
    );
    const updatedDoc = {
      secretId: "cloudflare",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedCloudflareCreds.maskedIdentifier.slice(0, 40),
      label: cachedCloudflareCreds.label.slice(0, 100),
      updatedAt: cachedCloudflareCreds.updatedAt,
      updatedBy: cachedCloudflareCreds.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: cachedCloudflareCreds.lastTestMessage
    };
    writeEncryptedSecretFiles(CF_ENCRYPTED_KEY_FILE, TMP_CF_ENCRYPTED_KEY_FILE, updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_CF_DOC,
        updatedDoc,
        idToken
      );
    } catch {
    }
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "CLOUDFLARE_CREDENTIALS_TESTED",
      resourceType: "adminSecrets",
      resourceId: "cloudflare",
      status: resultStatus === "Connected" ? "success" : "failure",
      metadata: {
        resultStatus,
        testedSource
      }
    },
    idToken
  );
  return {
    status: resultStatus,
    message: resultMessage,
    testedSource,
    testedAt,
    keyStatus: await getCloudflareKeyStatus()
  };
}
function getActiveMistralApiKeySync() {
  if (cachedMistralKey?.rawKey) {
    return cachedMistralKey.rawKey;
  }
  return getEnvFallbackMistralKey() || "";
}
function resolveActiveMistralApiKey() {
  return getActiveMistralApiKeySync();
}
function resolveActiveGroqApiKey() {
  if (cachedGroqKey?.rawKey) {
    return cachedGroqKey.rawKey;
  }
  return getEnvFallbackGroqKey() || "";
}
function resolveActiveCloudflareCredentials() {
  if (cachedCloudflareCreds?.accountId && cachedCloudflareCreds?.apiToken) {
    return {
      accountId: cachedCloudflareCreds.accountId,
      apiToken: cachedCloudflareCreds.apiToken
    };
  }
  return getEnvFallbackCloudflareCredentials() || { accountId: "", apiToken: "" };
}
function resolveScopedApiKeyForStage(provider, stage, slot) {
  const defaultKey = provider === "groq" ? resolveActiveGroqApiKey() : resolveActiveMistralApiKey();
  const resolved = resolveScopedStageApiKey({
    provider,
    stage,
    slot,
    env: process.env,
    defaultKey
  });
  return resolved || void 0;
}
function getColdStartEnvTemplate() {
  return [
    "# Bi\u1EBFn m\xF4i tr\u01B0\u1EDDng c\u1ED1t l\xF5i cho ki\u1EBFn tr\xFAc 3 nh\xE0 cung c\u1EA5p mi\u1EC5n ph\xED 24/7 (Mistral + Cloudflare + Groq)",
    "MISTRAL_API_KEY=",
    "GROQ_API_KEY=",
    "CLOUDFLARE_ACCOUNT_ID=",
    "CLOUDFLARE_API_TOKEN=",
    "# Kh\xF3a b\xED m\u1EADt ng\u1EABu nhi\xEAn (t\u1ED1i thi\u1EC3u 32 k\xFD t\u1EF1) \u0111\u1EC3 gi\u1EEF kh\xF3a nh\u1EADp tr\xEAn Admin UI kh\xF4ng b\u1ECB m\u1EA5t sau restart",
    "KEY_ENCRYPTION_SECRET=",
    "# T\xEAn mi\u1EC1n web production c\u1EE7a b\u1EA1n (n\u1EBFu frontend v\xE0 backend kh\xE1c domain)",
    "ALLOWED_ORIGIN=",
    "# T\xF9y ch\u1ECDn: Kh\xF3a chuy\xEAn bi\u1EC7t theo t\u1EEBng giai \u0111o\u1EA1n Qu\xE9t (QUET), Ch\u1EA5m (CHAM), \u0110\u1ED1i so\xE1t (DO) cho v\u0103n b\u1EA3n d\xE0i",
    "# GROQ_KEY_QUET_1=",
    "# MISTRAL_KEY_CHAM_1=",
    "# GROQ_KEY_DO_1=",
    "# GROQ_KEY_DO_2="
  ].join("\n");
}
function detectProviderFromModelId(modelId) {
  const lower = (modelId || "").trim().toLowerCase();
  if (lower.startsWith("groq:")) return "groq";
  if (lower.startsWith("cf:") || lower.startsWith("cloudflare:") || lower.startsWith("@cf/")) {
    return "cloudflare";
  }
  return "mistral";
}
function buildColdStartReadinessReport(input) {
  const activeProvider = detectProviderFromModelId(input.activeModel);
  const mistral = {
    provider: "mistral",
    label: "Mistral AI Free",
    envVarNames: ["MISTRAL_API_KEY"],
    envConfigured: input.mistralEnvConfigured,
    adminOverrideActive: input.mistralAdminOverrideActive,
    configuredNow: input.mistralEnvConfigured || input.mistralAdminOverrideActive,
    survivesColdStartWhenAdminOffline: input.mistralEnvConfigured
  };
  const groq = {
    provider: "groq",
    label: "Groq Cloud Free",
    envVarNames: ["GROQ_API_KEY"],
    envConfigured: input.groqEnvConfigured,
    adminOverrideActive: input.groqAdminOverrideActive,
    configuredNow: input.groqEnvConfigured || input.groqAdminOverrideActive,
    survivesColdStartWhenAdminOffline: input.groqEnvConfigured
  };
  const cloudflare = {
    provider: "cloudflare",
    label: "Cloudflare Workers AI",
    envVarNames: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"],
    envConfigured: input.cloudflareEnvConfigured,
    adminOverrideActive: input.cloudflareAdminOverrideActive,
    configuredNow: input.cloudflareEnvConfigured || input.cloudflareAdminOverrideActive,
    survivesColdStartWhenAdminOffline: input.cloudflareEnvConfigured
  };
  const providers = { mistral, groq, cloudflare };
  const activeProviderInfo = providers[activeProvider];
  const activeModelCoveredByEnv = activeProviderInfo.envConfigured;
  const anyProviderCoveredByEnv = mistral.envConfigured || groq.envConfigured || cloudflare.envConfigured;
  const warnings = [];
  if (!anyProviderCoveredByEnv) {
    warnings.push(
      "Ch\u01B0a c\xF3 API key n\xE0o trong bi\u1EBFn m\xF4i tr\u01B0\u1EDDng m\xE1y ch\u1EE7 (MISTRAL_API_KEY / GROQ_API_KEY / CLOUDFLARE_*). Khi Vercel ho\u1EB7c Render t\u1EF1 ng\u1EE7 v\xE0 kh\u1EDFi \u0111\u1ED9ng l\u1EA1i l\xFAc Admin ngo\u1EA1i tuy\u1EBFn, h\u1ECDc sinh s\u1EBD g\u1EB7p l\u1ED7i 503."
    );
  } else if (!activeModelCoveredByEnv) {
    warnings.push(
      `Model m\u1EB7c \u0111\u1ECBnh \u0111ang ch\u1ECDn (${activeProviderInfo.label}) ch\u01B0a c\xF3 bi\u1EBFn m\xF4i tr\u01B0\u1EDDng ${activeProviderInfo.envVarNames.join(" / ")} tr\xEAn m\xE1y ch\u1EE7. Khi server reset l\xFAc Admin ngo\u1EA1i tuy\u1EBFn, h\u1EC7 th\u1ED1ng s\u1EBD t\u1EF1 chuy\u1EC3n sang nh\xE0 cung c\u1EA5p d\u1EF1 ph\xF2ng.`
    );
  }
  if (!input.encryptionSecretConfigured) {
    warnings.push(
      "Ch\u01B0a c\u1EA5u h\xECnh KEY_ENCRYPTION_SECRET tr\xEAn m\xE1y ch\u1EE7. M\u1ECDi API key d\xE1n tr\u1EF1c ti\u1EBFp trong trang Admin ch\u1EC9 c\xF3 t\xE1c d\u1EE5ng t\u1EA1m th\u1EDDi trong RAM v\xE0 s\u1EBD kh\xF4ng gi\u1EA3i m\xE3 \u0111\u01B0\u1EE3c sau khi server kh\u1EDFi \u0111\u1ED9ng l\u1EA1i."
    );
  }
  const anyAdminOnlyWithoutEnv = mistral.adminOverrideActive && !mistral.envConfigured || groq.adminOverrideActive && !groq.envConfigured || cloudflare.adminOverrideActive && !cloudflare.envConfigured;
  if (anyAdminOnlyWithoutEnv && anyProviderCoveredByEnv) {
    const missingEnvLabels = [mistral, groq, cloudflare].filter((p) => p.adminOverrideActive && !p.envConfigured).map((p) => `${p.label} (${p.envVarNames.join(" + ")})`);
    warnings.push(
      `C\xE1c kh\xF3a \u0111ang d\xE1n trong Admin nh\u01B0ng ch\u01B0a c\xF3 bi\u1EBFn m\xF4i tr\u01B0\u1EDDng d\u1EF1 ph\xF2ng tr\xEAn server: ${missingEnvLabels.join(", ")}.`
    );
  }
  let overallStatus = "ready_24_7";
  if (!anyProviderCoveredByEnv) {
    overallStatus = "at_risk";
  } else if (!activeModelCoveredByEnv || !input.encryptionSecretConfigured) {
    overallStatus = "partial_risk";
  }
  return {
    overallStatus,
    runtimePlatform: input.runtimePlatform,
    activeModel: input.activeModel,
    activeProvider,
    activeModelCoveredByEnv,
    anyProviderCoveredByEnv,
    encryptionSecretConfigured: input.encryptionSecretConfigured,
    providers,
    warnings,
    envTemplate: getColdStartEnvTemplate()
  };
}
function evaluateColdStartReadiness(activeModel) {
  const runtimePlatform = process.env.VERCEL === "1" ? "vercel" : process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID) ? "render" : "standard";
  return buildColdStartReadinessReport({
    activeModel,
    runtimePlatform,
    encryptionSecretConfigured: isPersistentEncryptionSecretConfigured(),
    mistralEnvConfigured: Boolean(getEnvFallbackMistralKey()),
    mistralAdminOverrideActive: Boolean(cachedMistralKey?.rawKey),
    groqEnvConfigured: Boolean(getEnvFallbackGroqKey()),
    groqAdminOverrideActive: Boolean(cachedGroqKey?.rawKey),
    cloudflareEnvConfigured: Boolean(getEnvFallbackCloudflareCredentials()),
    cloudflareAdminOverrideActive: Boolean(
      cachedCloudflareCreds?.accountId && cachedCloudflareCreds?.apiToken
    )
  });
}

// src/server/mistralProvider.ts
var MISTRAL_API_URL = "https://api.mistral.ai/v1/chat/completions";
var MISTRAL_PRIMARY_MODEL = "mistral:mistral-small-latest";
var MISTRAL_FAST_MODEL = "mistral:ministral-8b-latest";
function isMistralModelId(modelId) {
  if (!modelId) return false;
  const clean = modelId.trim().toLowerCase();
  return clean.startsWith("mistral:") || clean.startsWith("mistral-") || clean.startsWith("ministral-") || clean.startsWith("pixtral-");
}
function stripMistralPrefix(modelId) {
  const trimmed = modelId.trim();
  if (trimmed.toLowerCase().startsWith("mistral:")) {
    return trimmed.slice("mistral:".length).trim();
  }
  return trimmed;
}
function normalizeMistralModelId(modelId) {
  const trimmed = modelId.trim();
  if (!trimmed) return MISTRAL_PRIMARY_MODEL;
  if (trimmed.toLowerCase().startsWith("mistral:")) return trimmed;
  if (isMistralModelId(trimmed)) return `mistral:${trimmed}`;
  return trimmed;
}
function getMistralApiKey() {
  const resolved = getActiveMistralApiKeySync();
  if (resolved) return resolved;
  const raw = process.env.MISTRAL_API_KEY?.trim();
  if (!raw || raw === "YOUR_MISTRAL_API_KEY") return null;
  return raw;
}
function isMistralConfigured() {
  return Boolean(getMistralApiKey());
}
function buildUserContent(prompt, images) {
  if (!images || images.length === 0) return prompt;
  const parts = [];
  for (const img of images) {
    const rawB64 = img.base64Data ?? img.base64 ?? "";
    const cleanBase64 = rawB64.replace(/^data:[^;]+;base64,/, "");
    if (!cleanBase64) continue;
    const mime = img.mimeType || "image/jpeg";
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${mime};base64,${cleanBase64}`
      }
    });
  }
  parts.push({ type: "text", text: prompt });
  return parts;
}
async function callMistralChatCompletion(params) {
  const apiKey = params.apiKeyOverride?.trim() || getMistralApiKey();
  if (!apiKey) {
    throw new Error(
      "MISTRAL_API_KEY_UNCONFIGURED: M\xE1y ch\u1EE7 ch\u01B0a c\u1EA5u h\xECnh MISTRAL_API_KEY."
    );
  }
  const mistralModel = stripMistralPrefix(params.modelId || MISTRAL_PRIMARY_MODEL);
  const messages = [];
  if (params.systemInstruction && params.systemInstruction.trim()) {
    messages.push({ role: "system", content: params.systemInstruction.trim() });
  }
  const effectivePrompt = params.jsonMode && params.jsonSchemaHint ? `${params.prompt}

[\u0110\u1ECANH D\u1EA0NG JSON B\u1EAET BU\u1ED8C \u2014 ch\u1EC9 tr\u1EA3 v\u1EC1 JSON h\u1EE3p l\u1EC7, kh\xF4ng k\xE8m v\u0103n b\u1EA3n th\u1EEBa]:
${params.jsonSchemaHint}` : params.prompt;
  messages.push({
    role: "user",
    content: buildUserContent(effectivePrompt, params.images)
  });
  const baseBody = {
    model: mistralModel,
    messages,
    temperature: params.temperature ?? 0,
    max_tokens: params.maxOutputTokens ?? 4096
  };
  if (typeof params.seed === "number" && Number.isFinite(params.seed)) {
    baseBody.random_seed = Math.max(0, Math.floor(Math.abs(params.seed)));
  }
  if (params.jsonMode) {
    baseBody.response_format = { type: "json_object" };
  }
  const doFetch = async (body) => fetch(MISTRAL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: params.signal
  });
  let res = await doFetch(baseBody);
  if (res.status === 400 && baseBody.response_format) {
    const fallbackBody = { ...baseBody };
    delete fallbackBody.response_format;
    res = await doFetch(fallbackBody);
  }
  const rawText = await res.text();
  if (!res.ok) {
    let errDetail = rawText.slice(0, 320);
    try {
      const parsed = JSON.parse(rawText);
      errDetail = parsed?.message || parsed?.error?.message || parsed?.detail || errDetail;
    } catch {
    }
    if (res.status === 402) {
      throw new Error(`Mistral 402 MISTRAL_BILLING_REQUIRED (${mistralModel}): ${errDetail}`);
    }
    if (res.status === 429) {
      throw new Error(`Mistral 429 RESOURCE_EXHAUSTED (${mistralModel}): ${errDetail}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`Mistral ${res.status} API_KEY_INVALID (${mistralModel}): ${errDetail}`);
    }
    throw new Error(`Mistral HTTP ${res.status} (${mistralModel}): ${errDetail}`);
  }
  const data = JSON.parse(rawText);
  const rawContent = data?.choices?.[0]?.message?.content;
  let content = "";
  if (typeof rawContent === "string") {
    content = rawContent;
  } else if (Array.isArray(rawContent)) {
    content = rawContent.map((part) => typeof part?.text === "string" ? part.text : "").join("");
  }
  if (!content.trim()) {
    throw new Error(`Mistral (${mistralModel}) tr\u1EA3 v\u1EC1 ph\u1EA3n h\u1ED3i r\u1ED7ng.`);
  }
  const finalText = params.jsonMode ? extractJsonStringFromModelOutput(content) : content.trim();
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const candidateTokens = data.usage?.completion_tokens ?? 0;
  const totalTokens = data.usage?.total_tokens ?? promptTokens + candidateTokens;
  const resolvedModel = `mistral:${data.model || mistralModel}`;
  return {
    text: finalText,
    modelUsed: resolvedModel,
    resolvedModel,
    promptTokens,
    candidateTokens,
    totalTokens,
    usageMetadata: data.usage ? {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidateTokens,
      totalTokenCount: totalTokens
    } : void 0
  };
}

// src/server/cloudflareProvider.ts
var CF_RESCUE_MODEL_STRONG = "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast";
var CF_RESCUE_MODEL_FAST = "cf:@cf/meta/llama-3.1-8b-instruct-fast";
var CF_VISION_MODEL2 = "cf:@cf/qwen/qwen3.8-27b";
var CF_VISION_MODELS = [
  "@cf/qwen/qwen3.8-27b",
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "@cf/meta/llama-4-scout-17b-16e-instruct"
];
var CF_FALLBACK_ON_404 = {
  "@cf/meta/llama-3.1-8b-instruct-fast": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/qwen/qwen3.8-27b": "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/mistralai/mistral-small-3.1-24b-instruct": "@cf/meta/llama-3.2-11b-vision-instruct",
  "@cf/meta/llama-3.2-11b-vision-instruct": "@cf/qwen/qwen3.8-27b"
};
function isCloudflareVisionModelId(modelId) {
  const raw = stripCloudflarePrefix(modelId).toLowerCase();
  return raw.includes("vision") || raw.includes("llava") || raw.includes("qwen3.8") || raw.includes("qwen3.6") || raw.includes("mistral-small-3.1") || raw.includes("llama-4-scout") || raw.includes("moondream");
}
function isCloudflareModelId(modelId) {
  return modelId.trim().toLowerCase().startsWith("cf:");
}
function stripCloudflarePrefix(modelId) {
  const trimmed = modelId.trim();
  return trimmed.toLowerCase().startsWith("cf:") ? trimmed.slice(3).trim() : trimmed;
}
function getCloudflareCredentials() {
  return resolveActiveCloudflareCredentials();
}
function isCloudflareConfigured() {
  const { accountId, apiToken } = getCloudflareCredentials();
  return accountId.length > 0 && apiToken.length > 0;
}
function buildCloudflareChatEndpoint(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/v1/chat/completions`;
}
async function executeCloudflareRequest(params) {
  const sendOnce = async (includeSeed) => {
    const body = {
      model: params.cfModel,
      messages: params.messages,
      temperature: params.temperature,
      max_tokens: params.maxTokens
    };
    if (includeSeed && typeof params.seed === "number" && Number.isFinite(params.seed)) {
      body.seed = Math.floor(params.seed);
    }
    if (params.jsonMode && !params.hasImages) {
      body.response_format = { type: "json_object" };
    }
    const res = await fetch(buildCloudflareChatEndpoint(params.accountId), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: params.signal
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, status: res.status, errText };
    }
    const data = await res.json();
    const rawText = data.choices?.[0]?.message?.content || data.result?.response || "";
    const text = params.jsonMode ? extractJsonStringFromModelOutput(rawText) : rawText.trim();
    return {
      ok: true,
      result: {
        text,
        promptTokens: data.usage?.prompt_tokens || 0,
        candidateTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
        resolvedModel: `cf:${params.cfModel}`,
        ...typeof data.system_fingerprint === "string" && data.system_fingerprint.trim() ? { systemFingerprint: data.system_fingerprint.trim() } : {}
      }
    };
  };
  const hasSeed = typeof params.seed === "number" && Number.isFinite(params.seed);
  const first = await sendOnce(hasSeed);
  if (!first.ok && first.status === 400 && hasSeed && first.errText.toLowerCase().includes("seed")) {
    return sendOnce(false);
  }
  return first;
}
async function callCloudflareChatCompletion(params) {
  const activeCreds = params.credentialsOverride || getCloudflareCredentials();
  const accountId = (activeCreds.accountId || "").trim();
  const apiToken = (activeCreds.apiToken || "").trim();
  if (!accountId || !apiToken) {
    throw new Error(
      "CLOUDFLARE_AI_UNCONFIGURED: Ch\u01B0a c\u1EA5u h\xECnh Cloudflare Account ID / API Token. Qu\u1EA3n tr\u1ECB vi\xEAn c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp trong Qu\u1EA3n tr\u1ECB h\u1EC7 th\u1ED1ng \u2192 API Key & B\u1EA3o m\u1EADt ho\u1EB7c bi\u1EBFn m\xF4i tr\u01B0\u1EDDng."
    );
  }
  const hasImages = Array.isArray(params.images) && params.images.length > 0;
  const requestedCfModel = stripCloudflarePrefix(params.modelId);
  const cfModel = hasImages && !isCloudflareVisionModelId(requestedCfModel) ? stripCloudflarePrefix(CF_VISION_MODEL2) : requestedCfModel;
  const systemParts = [];
  if (params.systemInstruction) {
    systemParts.push(params.systemInstruction.trim());
  }
  if (params.jsonMode) {
    systemParts.push(
      "B\u1EAET BU\u1ED8C tr\u1EA3 v\u1EC1 duy nh\u1EA5t 1 JSON object h\u1EE3p l\u1EC7 (kh\xF4ng th\xEAm markdown, kh\xF4ng th\xEAm gi\u1EA3i th\xEDch ngo\xE0i JSON)."
    );
    if (params.jsonSchemaHint) {
      systemParts.push(`C\u1EA5u tr\xFAc JSON b\u1EAFt bu\u1ED9c:
${params.jsonSchemaHint}`);
    }
  }
  const messages = [];
  if (hasImages) {
    const combinedPrompt = systemParts.length > 0 ? `${systemParts.join("\n\n")}

${params.prompt}` : params.prompt;
    const userContent = [
      ...params.images.map((img) => ({
        type: "image_url",
        image_url: { url: `data:${img.mimeType};base64,${img.base64}` }
      })),
      { type: "text", text: combinedPrompt }
    ];
    messages.push({ role: "user", content: userContent });
  } else {
    if (systemParts.length > 0) {
      messages.push({ role: "system", content: systemParts.join("\n\n") });
    }
    messages.push({ role: "user", content: params.prompt });
  }
  const maxTokens = Math.min(4096, Math.max(128, params.maxOutputTokens || 2048));
  const effectiveTemperature = typeof params.temperature === "number" && Number.isFinite(params.temperature) ? Math.max(0, Math.min(2, params.temperature)) : 0;
  const firstAttempt = await executeCloudflareRequest({
    accountId,
    apiToken,
    cfModel,
    messages,
    hasImages,
    jsonMode: params.jsonMode,
    maxTokens,
    temperature: effectiveTemperature,
    seed: params.seed,
    signal: params.signal
  });
  if (firstAttempt.ok) {
    return firstAttempt.result;
  }
  let lastStatus = firstAttempt.status;
  let lastErrText = firstAttempt.errText;
  const triedCfModels = /* @__PURE__ */ new Set([cfModel]);
  const fallbackCandidates = [];
  if (!params.strictModelLock) {
    if (hasImages) {
      for (const v of CF_VISION_MODELS) {
        if (!triedCfModels.has(v)) fallbackCandidates.push(v);
      }
    } else if (CF_FALLBACK_ON_404[cfModel]) {
      fallbackCandidates.push(CF_FALLBACK_ON_404[cfModel]);
    }
  }
  if (!params.strictModelLock && (firstAttempt.status === 404 || hasImages && (firstAttempt.status === 400 || firstAttempt.status === 403 || firstAttempt.status === 503)) && fallbackCandidates.length > 0) {
    for (const candidate of fallbackCandidates) {
      if (triedCfModels.has(candidate)) continue;
      triedCfModels.add(candidate);
      const retryAttempt = await executeCloudflareRequest({
        accountId,
        apiToken,
        cfModel: candidate,
        messages,
        hasImages,
        jsonMode: params.jsonMode,
        maxTokens,
        temperature: effectiveTemperature,
        seed: params.seed,
        signal: params.signal
      });
      if (retryAttempt.ok) {
        return retryAttempt.result;
      }
      if (lastStatus === 404 || retryAttempt.status !== 404 && retryAttempt.status !== 500) {
        lastStatus = retryAttempt.status;
        lastErrText = retryAttempt.errText;
      }
    }
  }
  if (lastStatus === 429) {
    throw new Error(`429 RESOURCE_EXHAUSTED (Cloudflare Workers AI): ${lastErrText.slice(0, 180)}`);
  }
  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error(
      `PERMISSION_DENIED (Cloudflare ${lastStatus}): Cloudflare Account ID ho\u1EB7c API Token kh\xF4ng c\xF3 quy\u1EC1n Workers AI Run/Edit. Chi ti\u1EBFt: ${lastErrText.slice(0, 140)}`
    );
  }
  if (lastStatus === 404) {
    throw new Error(
      `NOT_FOUND (Cloudflare 404): Model [${Array.from(triedCfModels).join(", ")}] kh\xF4ng kh\u1EA3 d\u1EE5ng. Chi ti\u1EBFt: ${lastErrText.slice(0, 180)}`
    );
  }
  if (lastStatus === 503 || lastStatus === 502) {
    throw new Error(`503 UNAVAILABLE (Cloudflare Workers AI): ${lastErrText.slice(0, 180)}`);
  }
  throw new Error(`Cloudflare Workers AI error (HTTP ${lastStatus}): ${lastErrText.slice(0, 200)}`);
}

// src/server/modelRouter.ts
function defaultMistralRescueModelForTask(taskType) {
  switch (taskType) {
    case "subject_classification":
    case "claim_validation":
    case "quiz_validation":
    case "flashcard_generation":
    case "feedback_analysis":
      return MISTRAL_FAST_MODEL;
    default:
      return MISTRAL_PRIMARY_MODEL;
  }
}
function defaultGroqRescueModelForTask(taskType) {
  switch (taskType) {
    case "knowledge_analysis":
    case "completeness_analysis":
    case "quiz_generation":
    case "quiz_blueprint":
      return GROQ_RESCUE_MODEL_STRONG;
    default:
      return GROQ_RESCUE_MODEL_FAST;
  }
}
function defaultCloudflareRescueModelForTask(taskType) {
  switch (taskType) {
    case "knowledge_analysis":
    case "completeness_analysis":
    case "quiz_generation":
    case "quiz_blueprint":
      return CF_RESCUE_MODEL_STRONG;
    default:
      return CF_RESCUE_MODEL_FAST;
  }
}
function normalizeSupportedModelId(modelId) {
  const trimmed = String(modelId || "").trim();
  if (!trimmed) return UNIFIED_PRIMARY_MODEL;
  if (isGroqModelId(trimmed)) return normalizeGroqModelId(trimmed);
  if (isCloudflareModelId(trimmed)) return trimmed;
  if (trimmed.toLowerCase().startsWith("@cf/")) return `cf:${trimmed}`;
  if (isMistralModelId(trimmed)) return normalizeMistralModelId(trimmed);
  return UNIFIED_PRIMARY_MODEL;
}
var aiResponseCache = new BoundedTtlCache(320, 6 * 60 * 60 * 1e3);
var inFlightTasks = /* @__PURE__ */ new Map();
var executionLogs = [];
var providerCooldowns = /* @__PURE__ */ new Map();
var BILLING_COOLDOWN_MS = 10 * 60 * 1e3;
var AUTH_COOLDOWN_MS = 5 * 60 * 1e3;
function getProviderForModel(modelId) {
  if (isGroqModelId(modelId)) return "groq";
  if (isCloudflareModelId(modelId)) return "cloudflare";
  return "mistral";
}
function classifyProviderFailure(err) {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (msg.includes("MISTRAL_BILLING_REQUIRED") || msg.includes("HTTP 402") || msg.includes(" 402 ") || lower.includes("need a subscription") || lower.includes("payment required")) {
    return {
      code: "MISTRAL_BILLING_REQUIRED",
      shouldCooldown: true,
      cooldownStatus: "billing_blocked",
      cooldownMs: BILLING_COOLDOWN_MS
    };
  }
  if (msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED") || msg.includes(" 401 ") || msg.includes("HTTP 401") || msg.includes(" 403 ") || msg.includes("HTTP 403")) {
    return {
      code: "PROVIDER_AUTH_ERROR",
      shouldCooldown: true,
      cooldownStatus: "auth_error",
      cooldownMs: AUTH_COOLDOWN_MS
    };
  }
  if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
    return { code: "PROVIDER_QUOTA_EXCEEDED", shouldCooldown: false };
  }
  if (msg.includes("v\u01B0\u1EE3t qu\xE1 th\u1EDDi gian ch\u1EDD") || msg.includes("AbortError") || msg.includes("timed out")) {
    return { code: "AI_TIMEOUT", shouldCooldown: false };
  }
  if (msg.includes("UNCONFIGURED")) {
    return { code: "PROVIDER_UNCONFIGURED", shouldCooldown: false };
  }
  return { code: "PROVIDER_ERROR", shouldCooldown: false };
}
function markProviderUnhealthy(provider, code, errorMessage, options) {
  const ttlMs = options?.ttlMs ?? BILLING_COOLDOWN_MS;
  providerCooldowns.set(provider, {
    provider,
    status: options?.status ?? "cooldown",
    code,
    lastError: errorMessage.slice(0, 320),
    failedAt: (/* @__PURE__ */ new Date()).toISOString(),
    untilMs: Date.now() + ttlMs
  });
}
function isProviderCoolingDown(provider) {
  const entry = providerCooldowns.get(provider);
  if (!entry) return false;
  if (Date.now() >= entry.untilMs) {
    providerCooldowns.delete(provider);
    return false;
  }
  return true;
}
function clearProviderCooldown(provider) {
  if (provider) {
    providerCooldowns.delete(provider);
    return;
  }
  providerCooldowns.clear();
}
function getProviderHealthSnapshot() {
  const now = Date.now();
  const build = (provider, configured) => {
    const entry = providerCooldowns.get(provider);
    if (entry && now >= entry.untilMs) {
      providerCooldowns.delete(provider);
    }
    const activeEntry = providerCooldowns.get(provider);
    if (!configured) {
      return {
        provider,
        configured: false,
        status: "unconfigured",
        coolingDown: false,
        remainingSeconds: 0
      };
    }
    if (activeEntry) {
      return {
        provider,
        configured: true,
        status: activeEntry.status,
        coolingDown: true,
        cooldownUntil: new Date(activeEntry.untilMs).toISOString(),
        remainingSeconds: Math.max(0, Math.ceil((activeEntry.untilMs - now) / 1e3)),
        lastErrorCode: activeEntry.code,
        lastError: activeEntry.lastError,
        failedAt: activeEntry.failedAt
      };
    }
    return {
      provider,
      configured: true,
      status: "healthy",
      coolingDown: false,
      remainingSeconds: 0
    };
  };
  return {
    mistral: build("mistral", isMistralConfigured()),
    groq: build("groq", isGroqConfigured()),
    cloudflare: build("cloudflare", isCloudflareConfigured())
  };
}
function clearAiResponseCache() {
  aiResponseCache.clear();
  inFlightTasks.clear();
}
function getRecentExecutionLogs() {
  return [...executionLogs];
}
function appendExecutionLog(log) {
  executionLogs.unshift(log);
  if (executionLogs.length > 120) {
    executionLogs.length = 120;
  }
}
var AI_REQUEST_TIMEOUT_MS = 45e3;
async function callWithTimeout(operation, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Y\xEAu c\u1EA7u AI v\u01B0\u1EE3t qu\xE1 th\u1EDDi gian ch\u1EDD (${Math.round(timeoutMs / 1e3)} gi\xE2y).`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function isTransientProviderError(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("v\u01B0\u1EE3t qu\xE1 th\u1EDDi gian ch\u1EDD")) {
    return false;
  }
  return msg.includes("429") || msg.includes("503") || msg.includes("502") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("UNAVAILABLE") || msg.includes("ECONNRESET");
}
async function withExponentialBackoff(fn, maxRetries = 2) {
  let attempt = 0;
  let lastDelayMs = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isTransientProviderError(err)) {
        throw err;
      }
      const baseDelay = attempt === 1 ? 1e3 : 2500;
      const jitter = Math.floor(Math.random() * 200);
      const delayMs = Math.max(lastDelayMs + 500, baseDelay + jitter);
      lastDelayMs = delayMs;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
function isModelProviderConfigured(modelId) {
  if (isGroqModelId(modelId)) return isGroqConfigured();
  if (isCloudflareModelId(modelId)) return isCloudflareConfigured();
  if (isMistralModelId(modelId)) return isMistralConfigured();
  return isMistralConfigured();
}
function isModelProviderHealthy(modelId) {
  return isModelProviderConfigured(modelId) && !isProviderCoolingDown(getProviderForModel(modelId));
}
function pickConfiguredProviderModel(taskType, preferredModel, activeModel, excludeModel) {
  const normPreferred = normalizeSupportedModelId(preferredModel);
  const normActive = normalizeSupportedModelId(activeModel);
  if (isModelProviderHealthy(normPreferred) && normPreferred !== excludeModel) {
    return normPreferred;
  }
  if (isModelProviderHealthy(normActive) && normActive !== excludeModel) {
    return normActive;
  }
  if (isMistralConfigured() && !isProviderCoolingDown("mistral")) {
    const mistralPrimary = defaultMistralRescueModelForTask(taskType);
    if (mistralPrimary !== excludeModel) return mistralPrimary;
    return mistralPrimary === MISTRAL_PRIMARY_MODEL ? MISTRAL_FAST_MODEL : MISTRAL_PRIMARY_MODEL;
  }
  if (isGroqConfigured() && !isProviderCoolingDown("groq")) {
    const groqPrimary = defaultGroqRescueModelForTask(taskType);
    if (groqPrimary !== excludeModel) return groqPrimary;
    return groqPrimary === GROQ_RESCUE_MODEL_STRONG ? GROQ_RESCUE_MODEL_FAST : GROQ_VISION_MODEL;
  }
  if (isCloudflareConfigured() && !isProviderCoolingDown("cloudflare")) {
    const cfPrimary = defaultCloudflareRescueModelForTask(taskType);
    if (cfPrimary !== excludeModel) return cfPrimary;
    return cfPrimary === CF_RESCUE_MODEL_STRONG ? CF_RESCUE_MODEL_FAST : CF_RESCUE_MODEL_STRONG;
  }
  if (isModelProviderConfigured(normPreferred) && normPreferred !== excludeModel) {
    return normPreferred;
  }
  if (isModelProviderConfigured(normActive) && normActive !== excludeModel) {
    return normActive;
  }
  if (isMistralConfigured()) {
    const mistralPrimary = defaultMistralRescueModelForTask(taskType);
    if (mistralPrimary !== excludeModel) return mistralPrimary;
    return mistralPrimary === MISTRAL_PRIMARY_MODEL ? MISTRAL_FAST_MODEL : MISTRAL_PRIMARY_MODEL;
  }
  if (isGroqConfigured()) {
    const groqPrimary = defaultGroqRescueModelForTask(taskType);
    if (groqPrimary !== excludeModel) return groqPrimary;
    return groqPrimary === GROQ_RESCUE_MODEL_STRONG ? GROQ_RESCUE_MODEL_FAST : GROQ_VISION_MODEL;
  }
  if (isCloudflareConfigured()) {
    const cfPrimary = defaultCloudflareRescueModelForTask(taskType);
    if (cfPrimary !== excludeModel) return cfPrimary;
    return cfPrimary === CF_RESCUE_MODEL_STRONG ? CF_RESCUE_MODEL_FAST : CF_RESCUE_MODEL_STRONG;
  }
  return normPreferred;
}
function resolveModelForTask(taskType, config, consumeOverride) {
  const taskCfg = config.taskModels?.[taskType] || DEFAULT_TASK_MODELS[taskType];
  const activeFallbackDefault = normalizeSupportedModelId(
    config.activeModel || UNIFIED_PRIMARY_MODEL
  );
  let modelId = normalizeSupportedModelId(taskCfg.defaultModel || activeFallbackDefault);
  let usedOverride = false;
  if (taskCfg.oneTimeOverrideModel && taskCfg.oneTimeOverrideModel.trim()) {
    modelId = normalizeSupportedModelId(taskCfg.oneTimeOverrideModel);
    usedOverride = true;
    consumeOverride?.();
  }
  let fallbackModelId = normalizeSupportedModelId(
    taskCfg.fallbackModel || UNIFIED_FALLBACK_MODEL
  );
  if (!isModelProviderHealthy(modelId)) {
    modelId = pickConfiguredProviderModel(taskType, modelId, activeFallbackDefault);
  }
  if (!isModelProviderHealthy(fallbackModelId) || fallbackModelId === modelId) {
    fallbackModelId = pickConfiguredProviderModel(
      taskType,
      fallbackModelId,
      activeFallbackDefault,
      modelId
    );
  }
  return {
    taskType,
    modelId,
    fallbackModelId,
    enableFallback: taskCfg.enableFallback !== false,
    usedOverride,
    promptVersion: taskCfg.promptVersion || "v4.2_3provider",
    configVersion: config.configVersion || 1
  };
}
async function executeRoutedAiTask(params) {
  const {
    taskType,
    config,
    consumeOneTimeOverride,
    cacheInput,
    bypassCache,
    groqRescueModelId,
    preferredPrimaryModelId,
    preferredFallbackModelId,
    strictModelLock = false,
    overallTimeoutMs,
    maxFallbackRetries = 0,
    extractExecutionMeta,
    runWithModel
  } = params;
  const allowCrossProviderRescue = params.allowCrossProviderRescue ?? params.allowGroqRescue ?? true;
  let overrideConsumed = false;
  const decision = resolveModelForTask(taskType, config, () => {
    overrideConsumed = true;
  });
  let requestedModel = preferredPrimaryModelId ? normalizeSupportedModelId(preferredPrimaryModelId) : decision.modelId;
  let fallbackModelId = preferredFallbackModelId ? normalizeSupportedModelId(preferredFallbackModelId) : decision.fallbackModelId;
  if (!strictModelLock && !isModelProviderHealthy(requestedModel)) {
    requestedModel = pickConfiguredProviderModel(taskType, requestedModel, decision.modelId);
  }
  if (!strictModelLock && (!isModelProviderHealthy(fallbackModelId) || fallbackModelId === requestedModel)) {
    fallbackModelId = pickConfiguredProviderModel(
      taskType,
      fallbackModelId,
      decision.fallbackModelId,
      requestedModel
    );
  }
  const cacheKey = cacheInput && !bypassCache ? buildDeterministicCacheKey({
    taskType,
    modelId: requestedModel,
    strictModelLock,
    promptVersion: decision.promptVersion,
    configVersion: decision.configVersion,
    ...cacheInput
  }) : null;
  if (cacheKey) {
    const hit = aiResponseCache.get(cacheKey);
    if (hit !== void 0) {
      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
        taskType,
        modelId: hit.actualModel,
        requestedModel: hit.requestedModel,
        actualModel: hit.actualModel,
        ...hit.systemFingerprint ? { systemFingerprint: hit.systemFingerprint } : {},
        usedFallback: hit.usedFallback,
        usedOverride: hit.usedOverride,
        promptVersion: hit.promptVersion,
        configVersion: hit.configVersion,
        status: "success",
        durationMs: 0,
        cached: true,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return {
        data: hit.data,
        modelId: hit.actualModel,
        requestedModel: hit.requestedModel,
        actualModel: hit.actualModel,
        usedFallback: hit.usedFallback,
        usedOverride: hit.usedOverride,
        cached: true,
        ...hit.systemFingerprint ? { systemFingerprint: hit.systemFingerprint } : {},
        promptVersion: hit.promptVersion,
        configVersion: hit.configVersion
      };
    }
    const pending = inFlightTasks.get(cacheKey);
    if (pending) {
      const shared = await pending;
      return {
        data: shared.data,
        modelId: shared.actualModel,
        requestedModel: shared.requestedModel,
        actualModel: shared.actualModel,
        usedFallback: shared.usedFallback,
        usedOverride: shared.usedOverride,
        cached: true,
        ...shared.systemFingerprint ? { systemFingerprint: shared.systemFingerprint } : {},
        promptVersion: shared.promptVersion,
        configVersion: shared.configVersion
      };
    }
  }
  const canFallback = !strictModelLock && decision.enableFallback && Boolean(fallbackModelId) && fallbackModelId !== requestedModel && isModelProviderConfigured(fallbackModelId);
  const primaryUnconfigured = !isModelProviderConfigured(requestedModel);
  const finalizeSuccess = (result, executedModel, usedFallback, startMs) => {
    const meta = extractExecutionMeta?.(result);
    const actualModel = (meta?.actualModel || executedModel).trim();
    const systemFingerprint = meta?.systemFingerprint;
    const effectiveFallback = usedFallback || actualModel !== requestedModel;
    if (cacheKey) {
      aiResponseCache.set(cacheKey, {
        data: result,
        requestedModel,
        actualModel,
        usedFallback: effectiveFallback,
        usedOverride: decision.usedOverride,
        ...systemFingerprint ? { systemFingerprint } : {},
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion
      });
    }
    appendExecutionLog({
      executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
      taskType,
      modelId: actualModel,
      requestedModel,
      actualModel,
      ...systemFingerprint ? { systemFingerprint } : {},
      usedFallback: effectiveFallback,
      usedOverride: decision.usedOverride,
      promptVersion: decision.promptVersion,
      configVersion: decision.configVersion,
      status: "success",
      durationMs: Date.now() - startMs,
      cached: false,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return {
      data: result,
      modelId: actualModel,
      requestedModel,
      actualModel,
      usedFallback: effectiveFallback,
      usedOverride: decision.usedOverride,
      cached: false,
      ...systemFingerprint ? { systemFingerprint } : {},
      promptVersion: decision.promptVersion,
      configVersion: decision.configVersion
    };
  };
  const executeTask = async () => {
    const start = Date.now();
    const overallDeadline = typeof overallTimeoutMs === "number" && overallTimeoutMs > 0 ? start + overallTimeoutMs : null;
    const isBudgetExhausted = () => overallDeadline !== null && Date.now() >= overallDeadline - 400;
    const attemptTrace = [];
    const recordAttemptFailure = (modelId, hopStartMs, err) => {
      const provider = getProviderForModel(modelId);
      const rawMsg = err instanceof Error ? err.message : String(err);
      const classified = classifyProviderFailure(err);
      if (classified.shouldCooldown && classified.cooldownStatus) {
        markProviderUnhealthy(provider, classified.code, rawMsg, {
          status: classified.cooldownStatus,
          ttlMs: classified.cooldownMs
        });
      }
      attemptTrace.push({
        provider,
        modelId,
        status: "failed",
        durationMs: Date.now() - hopStartMs,
        errorCode: classified.code,
        error: rawMsg.slice(0, 240)
      });
    };
    const primaryStart = Date.now();
    try {
      if (primaryUnconfigured) {
        throw new Error(
          isGroqModelId(requestedModel) ? "GROQ_API_KEY_UNCONFIGURED" : isCloudflareModelId(requestedModel) ? "CLOUDFLARE_CREDENTIALS_UNCONFIGURED" : "MISTRAL_API_KEY_UNCONFIGURED"
        );
      }
      const primaryRetries = canFallback || overallDeadline !== null ? 0 : 1;
      const result = await withExponentialBackoff(() => runWithModel(requestedModel), primaryRetries);
      if (overrideConsumed && consumeOneTimeOverride) {
        await consumeOneTimeOverride(taskType);
      }
      return finalizeSuccess(result, requestedModel, false, start);
    } catch (primaryErr) {
      let lastErr = primaryErr;
      recordAttemptFailure(requestedModel, primaryStart, primaryErr);
      if (strictModelLock) {
        const reason = primaryErr instanceof Error ? primaryErr.message.slice(0, 220) : String(primaryErr).slice(0, 220);
        appendExecutionLog({
          executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
          taskType,
          modelId: requestedModel,
          requestedModel,
          actualModel: requestedModel,
          usedFallback: false,
          usedOverride: decision.usedOverride,
          promptVersion: decision.promptVersion,
          configVersion: decision.configVersion,
          status: "failed",
          error: `STRICT_LOCK: ${reason}`.slice(0, 180),
          durationMs: Date.now() - start,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        });
        if (reason.includes("GRADING_JSON_INVALID") || reason.includes("GROQ_API_KEY_UNCONFIGURED") || reason.includes("MISTRAL_API_KEY_UNCONFIGURED") || reason.includes("CLOUDFLARE_CREDENTIALS_UNCONFIGURED") || reason.includes("MISTRAL_BILLING_REQUIRED")) {
          if (primaryErr instanceof Error) {
            primaryErr.attemptTrace = attemptTrace;
          }
          throw primaryErr;
        }
        const strictErr = new Error(
          `STRICT_GRADING_MODEL_UNAVAILABLE: Model ch\u1EA5m \u0111i\u1EC3m c\u1ED1 \u0111\u1ECBnh (${requestedModel}) t\u1EA1m th\u1EDDi kh\xF4ng ph\u1EA3n h\u1ED3i v\xE0 y\xEAu c\u1EA7u \u0111\xE3 b\u1EADt kh\xF3a model. Chi ti\u1EBFt: ${reason}`
        );
        strictErr.attemptTrace = attemptTrace;
        throw strictErr;
      }
      const triedProviders = /* @__PURE__ */ new Set();
      triedProviders.add(getProviderForModel(requestedModel));
      if (canFallback && !isBudgetExhausted()) {
        const fbProvider = getProviderForModel(fallbackModelId);
        if (!isProviderCoolingDown(fbProvider)) {
          triedProviders.add(fbProvider);
          const fbStart = Date.now();
          try {
            const fbResult = await withExponentialBackoff(
              () => runWithModel(fallbackModelId),
              maxFallbackRetries
            );
            if (overrideConsumed && consumeOneTimeOverride) {
              await consumeOneTimeOverride(taskType);
            }
            return finalizeSuccess(fbResult, fallbackModelId, true, start);
          } catch (fbErr) {
            lastErr = fbErr;
            recordAttemptFailure(fallbackModelId, fbStart, fbErr);
          }
        }
      }
      if (allowCrossProviderRescue && !isBudgetExhausted()) {
        const rescueHops = [
          {
            provider: "groq",
            configured: isGroqConfigured(),
            modelId: groqRescueModelId || defaultGroqRescueModelForTask(taskType)
          },
          {
            provider: "cloudflare",
            configured: isCloudflareConfigured(),
            modelId: defaultCloudflareRescueModelForTask(taskType)
          },
          {
            provider: "mistral",
            configured: isMistralConfigured(),
            modelId: defaultMistralRescueModelForTask(taskType)
          }
        ];
        for (const hop of rescueHops) {
          if (isBudgetExhausted()) break;
          if (!hop.configured || triedProviders.has(hop.provider) || isProviderCoolingDown(hop.provider)) {
            continue;
          }
          triedProviders.add(hop.provider);
          const hopStart = Date.now();
          try {
            const rescueResult = await withExponentialBackoff(
              () => runWithModel(hop.modelId),
              maxFallbackRetries
            );
            return finalizeSuccess(rescueResult, hop.modelId, true, start);
          } catch (rescueErr) {
            lastErr = rescueErr;
            recordAttemptFailure(hop.modelId, hopStart, rescueErr);
          }
        }
      }
      const traceSummary = attemptTrace.map((t) => `${t.modelId} [${t.errorCode || "ERR"}]`).join(" -> ");
      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
        taskType,
        modelId: canFallback ? fallbackModelId : requestedModel,
        requestedModel,
        actualModel: canFallback ? fallbackModelId : requestedModel,
        usedFallback: canFallback || attemptTrace.length > 1,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: "failed",
        error: (attemptTrace.length > 1 ? `${traceSummary} | ${lastErr instanceof Error ? lastErr.message : String(lastErr)}` : lastErr instanceof Error ? lastErr.message : String(lastErr)).slice(0, 240),
        durationMs: Date.now() - start,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      const finalErr = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
      finalErr.attemptTrace = attemptTrace;
      throw finalErr;
    }
  };
  if (!cacheKey) {
    return executeTask();
  }
  const taskPromise = executeTask().finally(() => {
    inFlightTasks.delete(cacheKey);
  });
  inFlightTasks.set(cacheKey, taskPromise);
  return taskPromise;
}
async function testModelConnectivity(modelId) {
  const start = Date.now();
  const targetModel = normalizeSupportedModelId(modelId);
  try {
    if (isGroqModelId(targetModel)) {
      if (!isGroqConfigured()) {
        return {
          ok: false,
          modelId: targetModel,
          latencyMs: Date.now() - start,
          message: 'Ch\u01B0a c\u1EA5u h\xECnh Groq API Key. Super Admin c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp t\u1EA1i tab "API Key & B\u1EA3o m\u1EADt" trong web.'
        };
      }
      const resp2 = await callWithTimeout(
        (signal) => callGroqChatCompletion({
          modelId: targetModel,
          prompt: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK",
          maxOutputTokens: 256,
          signal
        }),
        15e3
      );
      const text2 = (resp2.text || "").trim();
      const effectiveModel = resp2.resolvedModel || targetModel;
      const visionHint = isGroqVisionModelId(effectiveModel) ? " (h\u1ED7 tr\u1EE3 tr\u1EF1c ti\u1EBFp OCR \u1EA3nh)" : ` (v\u0103n b\u1EA3n OK; t\xE1c v\u1EE5 OCR \u1EA3nh s\u1EBD d\xF9ng ${GROQ_VISION_MODEL})`;
      return {
        ok: Boolean(text2),
        modelId: effectiveModel,
        latencyMs: Date.now() - start,
        message: text2 ? `Model ${effectiveModel} (Groq Cloud Free) ho\u1EA1t \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng (${Date.now() - start}ms)${visionHint}.` : `Model ${targetModel} tr\u1EA3 v\u1EC1 n\u1ED9i dung r\u1ED7ng.`
      };
    }
    if (isCloudflareModelId(targetModel)) {
      if (!isCloudflareConfigured()) {
        return {
          ok: false,
          modelId: targetModel,
          latencyMs: Date.now() - start,
          message: 'Ch\u01B0a c\u1EA5u h\xECnh Cloudflare Account ID & API Token. Super Admin c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp t\u1EA1i tab "API Key & B\u1EA3o m\u1EADt" trong web.'
        };
      }
      const resp2 = await callWithTimeout(
        (signal) => callCloudflareChatCompletion({
          modelId: targetModel,
          prompt: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK",
          maxOutputTokens: 128,
          signal
        }),
        15e3
      );
      const text2 = (resp2.text || "").trim();
      return {
        ok: Boolean(text2),
        modelId: resp2.resolvedModel || targetModel,
        latencyMs: Date.now() - start,
        message: text2 ? `Model ${resp2.resolvedModel || targetModel} (Cloudflare Workers AI Free) ho\u1EA1t \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng (${Date.now() - start}ms).` : `Model ${targetModel} tr\u1EA3 v\u1EC1 n\u1ED9i dung r\u1ED7ng.`
      };
    }
    if (!isMistralConfigured()) {
      return {
        ok: false,
        modelId: targetModel,
        latencyMs: Date.now() - start,
        message: 'Ch\u01B0a c\u1EA5u h\xECnh Mistral AI API Key. Super Admin c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp t\u1EA1i tab "API Key & B\u1EA3o m\u1EADt" ho\u1EB7c bi\u1EBFn MISTRAL_API_KEY.'
      };
    }
    const resp = await callWithTimeout(
      (signal) => callMistralChatCompletion({
        modelId: targetModel,
        prompt: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK",
        maxOutputTokens: 64,
        signal
      }),
      15e3
    );
    const text = (resp.text || "").trim();
    return {
      ok: Boolean(text),
      modelId: resp.modelUsed || targetModel,
      latencyMs: Date.now() - start,
      message: text ? `Model ${resp.modelUsed || targetModel} (Mistral AI Free) ho\u1EA1t \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng (${Date.now() - start}ms).` : `Model ${targetModel} tr\u1EA3 v\u1EC1 n\u1ED9i dung r\u1ED7ng.`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      modelId: targetModel,
      latencyMs: Date.now() - start,
      message: `L\u1ED7i k\u1EBFt n\u1ED1i model ${targetModel}: ${msg.slice(0, 220)}`
    };
  }
}

// src/server/aiGuardService.ts
var DEFAULT_RATE_LIMITS = {
  requestsPerMinute: 15,
  requestsPerHour: 120,
  analysesPerDay: 35,
  cooldownSeconds: 2,
  maximumConcurrentJobs: 3,
  maximumPagesPerAnalysis: 25,
  maximumFileSizeMb: 20,
  adaptiveLongTextThresholdChars: ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD
};
var DEFAULT_MAINTENANCE_MESSAGE = "StudyCheck AI \u0111ang t\u1EA1m ng\u1EEBng x\u1EED l\xFD AI. Nh\u1EEFng t\xE0i li\u1EC7u v\xE0 k\u1EBFt qu\u1EA3 \u0111\xE3 l\u01B0u v\u1EABn c\xF3 th\u1EC3 \u0111\u01B0\u1EE3c truy c\u1EADp b\xECnh th\u01B0\u1EDDng.";
function cloneDefaultTaskModels() {
  const out = {};
  for (const [key, val] of Object.entries(DEFAULT_TASK_MODELS)) {
    out[key] = { ...val };
  }
  return out;
}
var authoritativeAiConfig = {
  enabled: true,
  disabledReason: "",
  maintenanceMessage: DEFAULT_MAINTENANCE_MESSAGE,
  updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
  updatedBy: SUPER_ADMIN_EMAIL,
  rateLimitConfig: { ...DEFAULT_RATE_LIMITS },
  activeModel: UNIFIED_PRIMARY_MODEL,
  configVersion: 1,
  allowedOrigins: [],
  taskModels: cloneDefaultTaskModels(),
  adaptiveLongTextThresholdChars: ADAPTIVE_LONG_TEXT_CHAR_THRESHOLD
};
function serializeSystemConfigForFirestore(cfg) {
  const threshold = clampAdaptiveThresholdChars(
    cfg.adaptiveLongTextThresholdChars ?? cfg.rateLimitConfig?.adaptiveLongTextThresholdChars
  );
  return {
    enabled: Boolean(cfg.enabled),
    disabledReason: String(cfg.disabledReason || "").slice(0, 300),
    maintenanceMessage: String(cfg.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE).slice(0, 400),
    updatedAt: cfg.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
    updatedBy: String(cfg.updatedBy || SUPER_ADMIN_EMAIL).slice(0, 128),
    rateLimitConfig: {
      ...DEFAULT_RATE_LIMITS,
      ...cfg.rateLimitConfig || {},
      adaptiveLongTextThresholdChars: threshold
    },
    activeModel: normalizeSupportedModelId(cfg.activeModel),
    configVersion: typeof cfg.configVersion === "number" && cfg.configVersion >= 1 ? cfg.configVersion : 1,
    allowedOrigins: Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins.slice(0, 50) : [],
    taskModels: cfg.taskModels
  };
}
var minuteWindows = /* @__PURE__ */ new Map();
var hourWindows = /* @__PURE__ */ new Map();
var dailyAnalyses = /* @__PURE__ */ new Map();
var lastAnalysisTime = /* @__PURE__ */ new Map();
var concurrentJobs = /* @__PURE__ */ new Map();
var idempotencyCache = /* @__PURE__ */ new Map();
var usageDailyStore = /* @__PURE__ */ new Map();
var userDailyUsageStore = /* @__PURE__ */ new Map();
var auditLogStore = [];
function todayDateKey() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function getOrCreateDailyUsage(date = todayDateKey()) {
  const existing = usageDailyStore.get(date);
  if (existing) return existing;
  const fresh = {
    date,
    requestCount: 0,
    successfulCount: 0,
    failedCount: 0,
    blockedCount: 0,
    analysisCount: 0,
    quizGenerationCount: 0,
    ocrCount: 0,
    webGroundedCount: 0,
    actualPromptTokens: 0,
    actualCandidateTokens: 0,
    actualTotalTokens: 0,
    quotaExceededEvents: 0,
    providerErrorEvents: 0,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  usageDailyStore.set(date, fresh);
  return fresh;
}
function mergeTaskModels(base, patch, upgradeLegacyPreV42 = false) {
  const merged = {};
  for (const taskKey of Object.keys(DEFAULT_TASK_MODELS)) {
    const incomingPatch = patch?.[taskKey];
    const isLegacyPreV42 = upgradeLegacyPreV42 && (!incomingPatch?.promptVersion || incomingPatch.promptVersion !== "v4.2_3provider");
    if (isLegacyPreV42) {
      merged[taskKey] = {
        ...DEFAULT_TASK_MODELS[taskKey]
      };
      continue;
    }
    const combined = {
      ...DEFAULT_TASK_MODELS[taskKey],
      ...base?.[taskKey] || {},
      ...incomingPatch || {},
      promptVersion: "v4.2_3provider"
    };
    merged[taskKey] = {
      ...combined,
      defaultModel: normalizeSupportedModelId(combined.defaultModel),
      fallbackModel: normalizeSupportedModelId(combined.fallbackModel),
      oneTimeOverrideModel: combined.oneTimeOverrideModel ? normalizeSupportedModelId(combined.oneTimeOverrideModel) : null
    };
  }
  return merged;
}
var lastRemoteConfigSyncAt = 0;
var CONFIG_SYNC_TTL_MS = 6e4;
var pendingConsumedOverrides = /* @__PURE__ */ new Set();
function getAuthoritativeAiConfigSnapshot() {
  return authoritativeAiConfig;
}
async function loadAuthoritativeAiConfig(idToken, forceRefresh = false) {
  const now = Date.now();
  if (idToken && (forceRefresh || now - lastRemoteConfigSyncAt >= CONFIG_SYNC_TTL_MS)) {
    try {
      const remote = await firestoreRestGet("systemConfig/aiService", idToken);
      lastRemoteConfigSyncAt = now;
      if (remote && typeof remote.enabled === "boolean") {
        const remoteTasks = remote.taskModels || {};
        const hasLegacyPreV42Tasks = Object.keys(DEFAULT_TASK_MODELS).some(
          (k) => !remoteTasks[k]?.promptVersion || remoteTasks[k]?.promptVersion !== "v4.2_3provider"
        );
        const migratedTaskModels = mergeTaskModels(
          authoritativeAiConfig.taskModels,
          remote.taskModels,
          true
        );
        let needsRemoteFlush = false;
        for (const consumedTask of pendingConsumedOverrides) {
          if (migratedTaskModels[consumedTask]?.oneTimeOverrideModel) {
            migratedTaskModels[consumedTask] = {
              ...migratedTaskModels[consumedTask],
              oneTimeOverrideModel: null
            };
            needsRemoteFlush = true;
          } else {
            pendingConsumedOverrides.delete(consumedTask);
          }
        }
        const resolvedActiveModel = hasLegacyPreV42Tasks ? UNIFIED_PRIMARY_MODEL : normalizeSupportedModelId(remote.activeModel || UNIFIED_PRIMARY_MODEL);
        const resolvedThreshold = clampAdaptiveThresholdChars(
          remote.adaptiveLongTextThresholdChars ?? remote.rateLimitConfig?.adaptiveLongTextThresholdChars ?? authoritativeAiConfig.adaptiveLongTextThresholdChars
        );
        authoritativeAiConfig = {
          ...authoritativeAiConfig,
          ...remote,
          activeModel: resolvedActiveModel,
          adaptiveLongTextThresholdChars: resolvedThreshold,
          configVersion: typeof remote.configVersion === "number" ? remote.configVersion : authoritativeAiConfig.configVersion,
          allowedOrigins: Array.isArray(remote.allowedOrigins) ? remote.allowedOrigins : authoritativeAiConfig.allowedOrigins,
          taskModels: migratedTaskModels,
          rateLimitConfig: {
            ...DEFAULT_RATE_LIMITS,
            ...remote.rateLimitConfig || {},
            adaptiveLongTextThresholdChars: resolvedThreshold
          }
        };
        if (needsRemoteFlush) {
          try {
            await firestoreRestSet(
              "systemConfig/aiService",
              serializeSystemConfigForFirestore(authoritativeAiConfig),
              idToken
            );
            pendingConsumedOverrides.clear();
          } catch {
          }
        }
      }
    } catch {
    }
  }
  return authoritativeAiConfig;
}
async function consumeOneTimeModelOverride(taskType, idToken) {
  const cur = authoritativeAiConfig.taskModels[taskType];
  if (!cur?.oneTimeOverrideModel) return;
  pendingConsumedOverrides.add(taskType);
  authoritativeAiConfig = {
    ...authoritativeAiConfig,
    taskModels: {
      ...authoritativeAiConfig.taskModels,
      [taskType]: {
        ...cur,
        oneTimeOverrideModel: null
      }
    },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  lastRemoteConfigSyncAt = Date.now();
  if (idToken) {
    try {
      await firestoreRestSet(
        "systemConfig/aiService",
        serializeSystemConfigForFirestore(authoritativeAiConfig),
        idToken
      );
      pendingConsumedOverrides.delete(taskType);
    } catch {
    }
  }
}
async function setOneTimeTaskOverride(params) {
  const { taskType, modelId, actorUid, actorEmail, idToken } = params;
  if (modelId && modelId.trim()) {
    pendingConsumedOverrides.delete(taskType);
  } else {
    pendingConsumedOverrides.add(taskType);
  }
  const curTask = authoritativeAiConfig.taskModels[taskType] || DEFAULT_TASK_MODELS[taskType];
  const next = {
    ...authoritativeAiConfig,
    taskModels: {
      ...authoritativeAiConfig.taskModels,
      [taskType]: {
        ...curTask,
        oneTimeOverrideModel: modelId ? normalizeSupportedModelId(modelId) : null
      }
    },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedBy: actorUid
  };
  authoritativeAiConfig = next;
  lastRemoteConfigSyncAt = Date.now();
  try {
    await firestoreRestSet("systemConfig/aiService", serializeSystemConfigForFirestore(next), idToken);
    pendingConsumedOverrides.delete(taskType);
  } catch (err) {
    console.warn("Warning: unable to persist 1-run model override via REST:", err);
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "ONE_TIME_MODEL_OVERRIDE_SET",
      resourceType: "systemConfig",
      resourceId: taskType,
      status: "success",
      metadata: {
        taskType,
        overrideModel: modelId || "cleared"
      }
    },
    idToken
  );
  return next;
}
async function updateAuthoritativeAiConfig(patch, actorUid, actorEmail, idToken) {
  const hasThresholdPatch = patch.adaptiveLongTextThresholdChars !== void 0 || patch.rateLimitConfig?.adaptiveLongTextThresholdChars !== void 0;
  const shouldBumpVersion = Boolean(
    patch.taskModels || patch.activeModel || patch.allowedOrigins || hasThresholdPatch
  );
  if (patch.taskModels || patch.activeModel || hasThresholdPatch) {
    clearAiResponseCache();
  }
  let updatedTaskModels = patch.taskModels ? mergeTaskModels(authoritativeAiConfig.taskModels, patch.taskModels) : { ...authoritativeAiConfig.taskModels };
  if (patch.activeModel && !patch.taskModels) {
    const normalizedActive = normalizeSupportedModelId(patch.activeModel.trim());
    const propagated = {};
    for (const taskKey of Object.keys(DEFAULT_TASK_MODELS)) {
      const cur = updatedTaskModels[taskKey] || DEFAULT_TASK_MODELS[taskKey];
      propagated[taskKey] = {
        ...cur,
        defaultModel: normalizedActive
      };
    }
    updatedTaskModels = propagated;
  }
  const nextThreshold = clampAdaptiveThresholdChars(
    patch.adaptiveLongTextThresholdChars ?? patch.rateLimitConfig?.adaptiveLongTextThresholdChars ?? authoritativeAiConfig.adaptiveLongTextThresholdChars
  );
  const next = {
    ...authoritativeAiConfig,
    ...patch,
    activeModel: patch.activeModel ? normalizeSupportedModelId(patch.activeModel.trim()) : authoritativeAiConfig.activeModel,
    adaptiveLongTextThresholdChars: nextThreshold,
    configVersion: shouldBumpVersion ? (authoritativeAiConfig.configVersion || 1) + 1 : authoritativeAiConfig.configVersion || 1,
    allowedOrigins: Array.isArray(patch.allowedOrigins) ? patch.allowedOrigins.map((o) => o.trim()).filter(Boolean) : authoritativeAiConfig.allowedOrigins,
    taskModels: updatedTaskModels,
    rateLimitConfig: {
      ...authoritativeAiConfig.rateLimitConfig,
      ...patch.rateLimitConfig || {},
      adaptiveLongTextThresholdChars: nextThreshold
    },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedBy: actorUid
  };
  authoritativeAiConfig = next;
  lastRemoteConfigSyncAt = Date.now();
  pendingConsumedOverrides.clear();
  try {
    await firestoreRestSet("systemConfig/aiService", serializeSystemConfigForFirestore(next), idToken);
  } catch (err) {
    console.warn("Warning: unable to persist systemConfig/aiService via REST:", err);
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: patch.enabled === false ? "AI_SERVICE_DISABLED" : patch.enabled === true ? "AI_SERVICE_ACTIVATED" : "SYSTEM_CONFIG_UPDATED",
      resourceType: "systemConfig",
      resourceId: "aiService",
      status: "success",
      metadata: {
        enabled: next.enabled,
        disabledReason: next.disabledReason,
        activeModel: next.activeModel,
        configVersion: next.configVersion
      }
    },
    idToken
  );
  return next;
}
async function checkAiRequestGuard(params) {
  const { uid, email, idToken, requestType } = params;
  const config = await loadAuthoritativeAiConfig(idToken);
  if (!config.enabled) {
    recordUsageEvent({
      uid,
      email,
      requestType,
      outcome: "blocked",
      quotaBlocked: false
    });
    return {
      allowed: false,
      httpStatus: 503,
      code: "AI_SERVICE_DISABLED",
      message: config.maintenanceMessage || DEFAULT_MAINTENANCE_MESSAGE,
      config
    };
  }
  const now = Date.now();
  const limits = config.rateLimitConfig;
  const minWindow = (minuteWindows.get(uid) || []).filter((t) => now - t < 6e4);
  if (minWindow.length >= limits.requestsPerMinute) {
    recordUsageEvent({ uid, email, requestType, outcome: "blocked", quotaBlocked: true });
    return {
      allowed: false,
      httpStatus: 429,
      code: "RATE_LIMIT_MINUTE",
      message: `B\u1EA1n \u0111\xE3 v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n ${limits.requestsPerMinute} y\xEAu c\u1EA7u AI m\u1ED7i ph\xFAt. Vui l\xF2ng \u0111\u1EE3i m\u1ED9t l\xE1t.`,
      config
    };
  }
  const hrWindow = (hourWindows.get(uid) || []).filter((t) => now - t < 36e5);
  if (hrWindow.length >= limits.requestsPerHour) {
    recordUsageEvent({ uid, email, requestType, outcome: "blocked", quotaBlocked: true });
    return {
      allowed: false,
      httpStatus: 429,
      code: "RATE_LIMIT_HOUR",
      message: `B\u1EA1n \u0111\xE3 \u0111\u1EA1t gi\u1EDBi h\u1EA1n ${limits.requestsPerHour} y\xEAu c\u1EA7u AI m\u1ED7i gi\u1EDD.`,
      config
    };
  }
  if (requestType === "analysis") {
    const today = todayDateKey();
    const userDay = dailyAnalyses.get(uid);
    const dayCount = userDay && userDay.date === today ? userDay.count : 0;
    if (dayCount >= limits.analysesPerDay) {
      recordUsageEvent({ uid, email, requestType, outcome: "blocked", quotaBlocked: true });
      return {
        allowed: false,
        httpStatus: 429,
        code: "DAILY_ANALYSIS_LIMIT",
        message: `B\u1EA1n \u0111\xE3 \u0111\u1EA1t gi\u1EDBi h\u1EA1n ${limits.analysesPerDay} l\u1EA7n ph\xE2n t\xEDch t\xE0i li\u1EC7u trong ng\xE0y h\xF4m nay.`,
        config
      };
    }
    const lastTs = lastAnalysisTime.get(uid) || 0;
    if (now - lastTs < limits.cooldownSeconds * 1e3) {
      const waitSec = Math.ceil((limits.cooldownSeconds * 1e3 - (now - lastTs)) / 1e3);
      recordUsageEvent({ uid, email, requestType, outcome: "blocked", quotaBlocked: true });
      return {
        allowed: false,
        httpStatus: 429,
        code: "COOLDOWN_ACTIVE",
        message: `Vui l\xF2ng \u0111\u1EE3i ${waitSec} gi\xE2y tr\u01B0\u1EDBc khi g\u1EEDi ph\xE2n t\xEDch ti\u1EBFp theo.`,
        config
      };
    }
    const activeJobs = concurrentJobs.get(uid) || 0;
    if (activeJobs >= limits.maximumConcurrentJobs) {
      recordUsageEvent({ uid, email, requestType, outcome: "blocked", quotaBlocked: true });
      return {
        allowed: false,
        httpStatus: 429,
        code: "MAX_CONCURRENT_JOBS",
        message: `\u0110ang c\xF3 ${activeJobs} t\xE1c v\u1EE5 ph\xE2n t\xEDch ch\u1EA1y song song (t\u1ED1i \u0111a ${limits.maximumConcurrentJobs}).`,
        config
      };
    }
    lastAnalysisTime.set(uid, now);
    dailyAnalyses.set(uid, { date: today, count: dayCount + 1 });
  }
  minWindow.push(now);
  hrWindow.push(now);
  minuteWindows.set(uid, minWindow);
  hourWindows.set(uid, hrWindow);
  return { allowed: true, config };
}
function incrementConcurrentJob(uid) {
  concurrentJobs.set(uid, (concurrentJobs.get(uid) || 0) + 1);
}
function decrementConcurrentJob(uid) {
  const cur = concurrentJobs.get(uid) || 0;
  concurrentJobs.set(uid, Math.max(0, cur - 1));
}
function rollbackAiRequestGuard(uid, requestType) {
  if (requestType === "analysis") {
    const today = todayDateKey();
    const userDay = dailyAnalyses.get(uid);
    if (userDay && userDay.date === today && userDay.count > 0) {
      dailyAnalyses.set(uid, { date: today, count: userDay.count - 1 });
    }
    lastAnalysisTime.delete(uid);
  }
  const minW = minuteWindows.get(uid);
  if (minW && minW.length > 0) {
    minW.pop();
  }
  const hrW = hourWindows.get(uid);
  if (hrW && hrW.length > 0) {
    hrW.pop();
  }
}
function getIdempotentResult(key) {
  const hit = idempotencyCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    idempotencyCache.delete(key);
    return null;
  }
  return hit.payload;
}
function setIdempotentResult(key, payload, ttlMs = 6e5) {
  idempotencyCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    payload
  });
}
function recordUsageEvent(params) {
  const date = todayDateKey();
  const daily = getOrCreateDailyUsage(date);
  daily.requestCount += 1;
  if (params.outcome === "success") daily.successfulCount += 1;
  if (params.outcome === "failed") daily.failedCount += 1;
  if (params.outcome === "blocked") daily.blockedCount += 1;
  if (params.requestType === "analysis" && params.outcome !== "blocked") daily.analysisCount += 1;
  if (params.requestType === "quiz" && params.outcome !== "blocked") daily.quizGenerationCount += 1;
  if (params.requestType === "ocr" && params.outcome !== "blocked") daily.ocrCount += 1;
  if (params.webGrounded) daily.webGroundedCount += 1;
  if (params.quotaBlocked) daily.quotaExceededEvents += 1;
  if (params.providerError) daily.providerErrorEvents += 1;
  if (params.promptTokens) daily.actualPromptTokens += params.promptTokens;
  if (params.candidateTokens) daily.actualCandidateTokens += params.candidateTokens;
  if (params.totalTokens) daily.actualTotalTokens += params.totalTokens;
  daily.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const userKey = `${params.uid}_${date}`;
  const uStat = userDailyUsageStore.get(userKey) || {
    uid: params.uid,
    email: params.email,
    date,
    requests: 0,
    analyses: 0,
    blocked: 0,
    tokens: 0
  };
  uStat.requests += 1;
  if (params.requestType === "analysis" && params.outcome !== "blocked") uStat.analyses += 1;
  if (params.outcome === "blocked") uStat.blocked += 1;
  if (params.totalTokens) uStat.tokens += params.totalTokens;
  userDailyUsageStore.set(userKey, uStat);
}
async function persistUsageSnapshot(idToken, isSuperAdmin, uid) {
  const date = todayDateKey();
  if (uid) {
    const userStat = userDailyUsageStore.get(`${uid}_${date}`);
    if (userStat) {
      try {
        await firestoreRestSet(
          `users/${uid}/usageDaily/${date}`,
          userStat,
          idToken
        );
      } catch {
      }
    }
  }
  if (!isSuperAdmin) return;
  const daily = getOrCreateDailyUsage(date);
  try {
    await firestoreRestSet(`apiUsageDaily/${date}`, daily, idToken);
  } catch {
  }
}
async function getUsageStatistics(idToken) {
  const todayKey = todayDateKey();
  const inMemory = Array.from(usageDailyStore.values());
  let remoteDocs = [];
  try {
    remoteDocs = await firestoreRestList("apiUsageDaily", idToken, 60);
  } catch {
    remoteDocs = [];
  }
  const mergedMap = /* @__PURE__ */ new Map();
  for (const d of remoteDocs) {
    if (d && d.date) mergedMap.set(d.date, d);
  }
  for (const d of inMemory) {
    const existing = mergedMap.get(d.date);
    if (!existing || d.requestCount >= existing.requestCount) {
      mergedMap.set(d.date, d);
    }
  }
  const today = mergedMap.get(todayKey) || getOrCreateDailyUsage(todayKey);
  const dailySeries = Array.from(mergedMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const perUserToday = Array.from(userDailyUsageStore.values()).filter((u) => u.date === todayKey).sort((a, b) => b.requests - a.requests);
  return { today, dailySeries, perUserToday };
}
async function recordAuditLog(entry, idToken) {
  const log = {
    logId: `log_${Date.now()}_${crypto5.randomBytes(4).toString("hex")}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    ...entry
  };
  auditLogStore.unshift(log);
  if (auditLogStore.length > 200) auditLogStore.length = 200;
  if (idToken) {
    try {
      await firestoreRestSet(`auditLogs/${log.logId}`, log, idToken);
    } catch {
    }
  }
  return log;
}
async function getAuditLogs(idToken) {
  let remote = [];
  try {
    remote = await firestoreRestList("auditLogs", idToken, 100);
  } catch {
    remote = [];
  }
  const map = /* @__PURE__ */ new Map();
  for (const r of remote) {
    if (r?.logId) map.set(r.logId, r);
  }
  for (const l of auditLogStore) {
    map.set(l.logId, l);
  }
  return Array.from(map.values()).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

// src/server/geminiPipeline.ts
import crypto6 from "node:crypto";

// src/core/scoring.ts
function calculateAccuracyScore(claims, hasReferenceTextbook) {
  const counts = {
    total: claims.length,
    correct: 0,
    partiallyCorrect: 0,
    incorrect: 0,
    missing: 0,
    unverified: 0,
    ambiguous: 0,
    ocrUncertain: 0,
    outOfScope: 0
  };
  let totalClaimWeight = 0;
  let verifiedWeight = 0;
  let earnedWeight = 0;
  let ocrConfidenceSum = 0;
  let ocrCount = 0;
  for (const claim of claims) {
    const w = claim.importanceWeight || 1;
    if (claim.evaluationStatus !== "MISSING" && claim.evaluationStatus !== "OUT_OF_SCOPE") {
      totalClaimWeight += w;
      ocrConfidenceSum += typeof claim.ocrConfidence === "number" ? claim.ocrConfidence : 1;
      ocrCount += 1;
    }
    switch (claim.evaluationStatus) {
      case "CORRECT":
        counts.correct += 1;
        verifiedWeight += w;
        earnedWeight += w * 1;
        break;
      case "PARTIALLY_CORRECT":
        counts.partiallyCorrect += 1;
        verifiedWeight += w;
        earnedWeight += w * 0.5;
        break;
      case "INCORRECT":
        counts.incorrect += 1;
        verifiedWeight += w;
        break;
      case "MISSING":
        counts.missing += 1;
        break;
      case "UNVERIFIED":
        counts.unverified += 1;
        break;
      case "AMBIGUOUS":
        counts.ambiguous += 1;
        break;
      case "OCR_UNCERTAIN":
        counts.ocrUncertain += 1;
        break;
      case "OUT_OF_SCOPE":
        counts.outOfScope += 1;
        break;
    }
  }
  const accuracyScore = verifiedWeight > 0 ? Math.round(earnedWeight / verifiedWeight * 1e3) / 10 : null;
  const evidenceCoverage = totalClaimWeight > 0 ? Math.round(verifiedWeight / totalClaimWeight * 1e3) / 10 : null;
  const avgOcrConfidence = ocrCount > 0 ? ocrConfidenceSum / ocrCount : 0;
  let confidenceLevel = "Ch\u01B0a \u0111\u1EE7 d\u1EEF li\u1EC7u \u0111\xE1nh gi\xE1";
  let confidenceReason = "Ch\u01B0a c\xF3 \u0111\u1EE7 m\u1EC7nh \u0111\u1EC1 ki\u1EBFn th\u1EE9c \u0111\u01B0\u1EE3c x\xE1c minh \u0111\u1EC3 \u0111\xE1nh gi\xE1 \u0111\u1ED9 tin c\u1EADy.";
  if (verifiedWeight > 0 && evidenceCoverage !== null) {
    if (avgOcrConfidence >= 0.85 && evidenceCoverage >= 75 && hasReferenceTextbook) {
      confidenceLevel = "Cao";
      confidenceReason = `\u0110\u1ED9 r\xF5 OCR \u0111\u1EA1t ${Math.round(avgOcrConfidence * 100)}%, t\u1EF7 l\u1EC7 d\u1EABn ch\u1EE9ng ki\u1EC3m ch\u1EE9ng ${evidenceCoverage}% v\xE0 c\xF3 s\xE1ch gi\xE1o khoa tham chi\u1EBFu tr\u1EF1c ti\u1EBFp.`;
    } else if (avgOcrConfidence >= 0.65 && evidenceCoverage >= 45) {
      confidenceLevel = "Trung b\xECnh";
      confidenceReason = hasReferenceTextbook ? `T\u1EF7 l\u1EC7 c\xF3 d\u1EABn ch\u1EE9ng \u0111\u1EA1t ${evidenceCoverage}% v\u1EDBi \u0111\u1ED9 r\xF5 v\u0103n b\u1EA3n ${Math.round(avgOcrConfidence * 100)}%. M\u1ED9t s\u1ED1 \xFD c\u1EA7n \u0111\u1ED1i chi\u1EBFu th\xEAm.` : `Ch\u01B0a ch\u1ECDn s\xE1ch gi\xE1o khoa tham chi\u1EBFu c\u1ED1 \u0111\u1ECBnh; t\u1EF7 l\u1EC7 ki\u1EC3m ch\u1EE9ng \u0111\u1EA1t ${evidenceCoverage}%.`;
    } else {
      confidenceLevel = "Th\u1EA5p";
      confidenceReason = `T\u1EF7 l\u1EC7 n\u1ED9i dung c\xF3 \u0111\u1EE7 c\u0103n c\u1EE9 ki\u1EC3m ch\u1EE9ng m\u1EDBi \u0111\u1EA1t ${evidenceCoverage}% ho\u1EB7c \u0111\u1ED9 r\xF5 OCR c\xF2n th\u1EA5p (${Math.round(avgOcrConfidence * 100)}%).`;
    }
  }
  return {
    accuracyScore,
    verifiedWeight,
    earnedWeight,
    totalClaimWeight,
    evidenceCoverage,
    confidenceLevel,
    confidenceReason,
    counts
  };
}
function calculateCompletenessScore(coverageItems, hasValidScope, options = {}) {
  const effectiveRubricMode = options.rubricMode || (hasValidScope ? "scope_guided" : "unscoped");
  if (!hasValidScope || effectiveRubricMode === "unscoped" || coverageItems.length === 0) {
    return {
      completenessScore: null,
      coveredWeight: 0,
      totalRequiredWeight: 0,
      missingCount: 0,
      partialCount: 0,
      coveredCount: 0,
      rubricMode: "unscoped",
      rubricItemCount: 0,
      extraObservationsCount: options.extraObservationsCount ?? 0
    };
  }
  let totalRequiredWeight = 0;
  let coveredWeight = 0;
  let missingCount = 0;
  let partialCount = 0;
  let coveredCount = 0;
  for (const item of coverageItems) {
    if (item.status === "OUT_OF_SCOPE") continue;
    const w = item.importanceWeight || 1;
    totalRequiredWeight += w;
    if (item.status === "COVERED") {
      coveredWeight += w * 1;
      coveredCount += 1;
    } else if (item.status === "PARTIALLY_COVERED") {
      coveredWeight += w * 0.5;
      partialCount += 1;
    } else {
      missingCount += 1;
    }
  }
  const completenessScore = totalRequiredWeight > 0 ? Math.round(coveredWeight / totalRequiredWeight * 1e3) / 10 : null;
  return {
    completenessScore,
    coveredWeight,
    totalRequiredWeight,
    missingCount,
    partialCount,
    coveredCount,
    rubricMode: effectiveRubricMode,
    rubricItemCount: options.rubricItemCount ?? coverageItems.length,
    extraObservationsCount: options.extraObservationsCount ?? 0
  };
}

// src/core/quizValidation.ts
function normalizeVietnameseText(input) {
  return input.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function normalizeCognitiveLevel(level, difficulty) {
  if (level === "nhan_biet" || level === "thong_hieu" || level === "van_dung" || level === "van_dung_cao") {
    return level;
  }
  if (difficulty === "basic") return "nhan_biet";
  if (difficulty === "medium") return "thong_hieu";
  return "van_dung";
}
function validateSingleQuizQuestion(q) {
  const issues = [];
  let repaired = false;
  let rejected = false;
  const next = { ...q };
  next.questionText = (next.questionText || "").trim();
  next.optionA = (next.optionA || "").trim();
  next.optionB = (next.optionB || "").trim();
  next.optionC = (next.optionC || "").trim();
  next.optionD = (next.optionD || "").trim();
  next.explanation = (next.explanation || "").trim();
  if (next.questionText.length < 10) {
    issues.push("N\u1ED9i dung c\xE2u h\u1ECFi qu\xE1 ng\u1EAFn ho\u1EB7c tr\u1ED1ng.");
    rejected = true;
  }
  const options = [next.optionA, next.optionB, next.optionC, next.optionD];
  if (options.some((opt) => !opt)) {
    issues.push("C\xF3 \u0111\xE1p \xE1n A/B/C/D b\u1ECB b\u1ECF tr\u1ED1ng.");
    rejected = true;
  }
  const normalizedOptions = options.map((opt) => normalizeVietnameseText(opt));
  const uniqueOptions = new Set(normalizedOptions.filter(Boolean));
  if (uniqueOptions.size < 4 && !rejected) {
    issues.push("C\xE1c ph\u01B0\u01A1ng \xE1n A/B/C/D b\u1ECB tr\xF9ng l\u1EB7p n\u1ED9i dung.");
  }
  if (!["A", "B", "C", "D"].includes(next.correctAnswer)) {
    next.correctAnswer = "A";
    issues.push("\u0110\xE1p \xE1n \u0111\xFAng kh\xF4ng h\u1EE3p l\u1EC7, \u0111\xE3 \u0111\u1EB7t l\u1EA1i m\u1EB7c \u0111\u1ECBnh A.");
    repaired = true;
  }
  const correctIdx = ["A", "B", "C", "D"].indexOf(next.correctAnswer);
  const correctLen = options[correctIdx]?.length || 0;
  const distractorLens = options.filter((_, idx) => idx !== correctIdx).map((o) => o.length).filter((len) => len > 0);
  const avgDistractorLen = distractorLens.length > 0 ? distractorLens.reduce((acc, v) => acc + v, 0) / distractorLens.length : 0;
  if (avgDistractorLen >= 12 && correctLen > avgDistractorLen * 2.3) {
    issues.push("C\u1EA3nh b\xE1o thi\xEAn l\u1EC7ch \u0111\u1ED9 d\xE0i: \u0111\xE1p \xE1n \u0111\xFAng d\xE0i v\u01B0\u1EE3t tr\u1ED9i so v\u1EDBi \u0111\xE1p \xE1n nhi\u1EC5u.");
  }
  if (!next.explanation || next.explanation.length < 8) {
    next.explanation = `\u0110\xE1p \xE1n ${next.correctAnswer} ph\xF9 h\u1EE3p nh\u1EA5t theo n\u1ED9i dung ki\u1EBFn th\u1EE9c \u0111\xE3 ki\u1EC3m ch\u1EE9ng.`;
    issues.push("Thi\u1EBFu gi\u1EA3i th\xEDch chi ti\u1EBFt, \u0111\xE3 b\u1ED5 sung gi\u1EA3i th\xEDch chu\u1EA9n.");
    repaired = true;
  }
  const normalizedCog = normalizeCognitiveLevel(next.cognitiveLevel, next.difficulty);
  if (next.cognitiveLevel !== normalizedCog) {
    next.cognitiveLevel = normalizedCog;
  }
  next.validationIssues = issues;
  if (rejected) {
    next.validationStatus = "rejected";
  } else if (issues.length > 0) {
    next.validationStatus = repaired ? "repaired" : "needs_review";
  } else {
    next.validationStatus = "passed";
  }
  return { issues, repaired, rejected, question: next };
}
function validateQuizQuestionSet(questions) {
  const seenStems = /* @__PURE__ */ new Set();
  const kept = [];
  const allIssues = [];
  let validCount = 0;
  let repairedCount = 0;
  let rejectedCount = 0;
  for (const raw of questions) {
    const stemKey = normalizeVietnameseText(raw.questionText || "");
    if (stemKey && seenStems.has(stemKey)) {
      rejectedCount += 1;
      allIssues.push(`Lo\u1EA1i c\xE2u tr\xF9ng l\u1EB7p: "${raw.questionText.slice(0, 60)}..."`);
      continue;
    }
    const res = validateSingleQuizQuestion(raw);
    if (res.rejected) {
      rejectedCount += 1;
      allIssues.push(...res.issues);
      continue;
    }
    if (stemKey) seenStems.add(stemKey);
    if (res.repaired) repairedCount += 1;
    else validCount += 1;
    allIssues.push(...res.issues);
    kept.push(res.question);
  }
  return {
    validCount,
    repairedCount,
    rejectedCount,
    issues: Array.from(new Set(allIssues)),
    questions: kept
  };
}
function validateExamBlueprint(blueprint) {
  const errors = [];
  if (!blueprint.title?.trim()) errors.push("Thi\u1EBFu ti\xEAu \u0111\u1EC1 ma tr\u1EADn \u0111\u1EC1.");
  if (!blueprint.rows || blueprint.rows.length === 0) {
    errors.push("Ma tr\u1EADn \u0111\u1EC1 ph\u1EA3i c\xF3 \xEDt nh\u1EA5t 1 d\xF2ng ph\xE2n b\u1ED5 ki\u1EBFn th\u1EE9c.");
  }
  let computedScore = 0;
  let totalQuestions = 0;
  for (const row of blueprint.rows || []) {
    if (row.questionCount <= 0) {
      errors.push(`D\xF2ng "${row.topic || row.chapter}" c\xF3 s\u1ED1 c\xE2u <= 0.`);
    }
    if (row.scorePerQuestion <= 0) {
      errors.push(`D\xF2ng "${row.topic || row.chapter}" c\xF3 \u0111i\u1EC3m m\u1ED7i c\xE2u <= 0.`);
    }
    computedScore += row.questionCount * row.scorePerQuestion;
    totalQuestions += row.questionCount;
  }
  computedScore = Math.round(computedScore * 100) / 100;
  if (Math.abs(computedScore - blueprint.totalScore) > 0.05) {
    errors.push(
      `T\u1ED5ng \u0111i\u1EC3m ma tr\u1EADn (${computedScore}) ch\u01B0a kh\u1EDBp thang \u0111i\u1EC3m quy \u0111\u1ECBnh (${blueprint.totalScore}).`
    );
  }
  return {
    valid: errors.length === 0,
    errors,
    computedScore,
    totalQuestions
  };
}
function distributeExamQuestionScores(questions, totalScore) {
  if (questions.length === 0) return [];
  const safeTotal = Math.max(1, Number(totalScore) || 10);
  const perQuestion = Math.max(0.05, Math.round(safeTotal / questions.length * 100) / 100);
  let running = 0;
  return questions.map((q, idx) => {
    let weight = perQuestion;
    if (idx === questions.length - 1) {
      const remainder = Math.round((safeTotal - running) * 100) / 100;
      if (remainder >= 0.05) {
        weight = remainder;
      }
    }
    running = Math.round((running + weight) * 100) / 100;
    return {
      ...q,
      orderIndex: idx + 1,
      scoreWeight: weight
    };
  });
}
function normalizeQuizQuestionOrigin(rawOrigin, isExternalAdvanced, fallbackOrigin) {
  if (isExternalAdvanced || rawOrigin === "external_advanced") {
    return "external_advanced";
  }
  if (rawOrigin === "upload" || rawOrigin === "mistake_variation" || rawOrigin === "textbook_supplement") {
    return rawOrigin;
  }
  return fallbackOrigin;
}
function normalizeJsonEscapesForSalvage(input) {
  let out = "";
  let inString = false;
  let escaped = false;
  const isHex = (ch) => /^[0-9a-fA-F]$/.test(ch);
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        const next = input[i + 1] || "";
        const isStandardEscape = next === '"' || next === "\\" || next === "/" || next === "b" || next === "f" || next === "n" || next === "r" || next === "t" || next === "u" && i + 5 < input.length && isHex(input[i + 2]) && isHex(input[i + 3]) && isHex(input[i + 4]) && isHex(input[i + 5]);
        if (isStandardEscape) {
          out += ch;
          escaped = true;
        } else {
          out += "\\\\";
        }
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "	") {
        out += "\\t";
        continue;
      }
      if (ch.charCodeAt(0) < 32) {
        out += " ";
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}
function salvageQuestionsFromTruncatedJson(rawText) {
  const stripped = (rawText || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!stripped) return [];
  const fenced = stripped.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  const body = (fenced && fenced[1] ? fenced[1] : stripped).trim();
  const candidates = [body];
  const fb = body.indexOf("{");
  const lb = body.lastIndexOf("}");
  if (fb >= 0 && lb > fb) {
    candidates.push(body.slice(fb, lb + 1));
  }
  for (const cand of candidates) {
    for (const attempt of [cand, normalizeJsonEscapesForSalvage(cand)]) {
      try {
        const parsed = JSON.parse(attempt);
        if (Array.isArray(parsed)) {
          return parsed.filter((item) => Boolean(item) && typeof item === "object");
        }
        if (parsed && typeof parsed === "object") {
          const obj = parsed;
          if (Array.isArray(obj.questions)) {
            return obj.questions.filter(
              (item) => Boolean(item) && typeof item === "object"
            );
          }
        }
      } catch {
      }
    }
  }
  const qKeyMatch = /"questions"\s*:\s*\[/i.exec(body);
  const arrayStart = qKeyMatch ? qKeyMatch.index + qKeyMatch[0].length - 1 : body.indexOf("[");
  if (arrayStart < 0) return [];
  const salvaged = [];
  let inString = false;
  let escaped = false;
  let braceDepth = 0;
  let objStart = -1;
  for (let i = arrayStart + 1; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (braceDepth === 0) objStart = i;
      braceDepth += 1;
      continue;
    }
    if (ch === "}") {
      if (braceDepth > 0) {
        braceDepth -= 1;
        if (braceDepth === 0 && objStart >= 0) {
          const slice = body.slice(objStart, i + 1);
          objStart = -1;
          for (const attempt of [slice, normalizeJsonEscapesForSalvage(slice)]) {
            try {
              const item = JSON.parse(attempt);
              if (item && typeof item === "object" && !Array.isArray(item)) {
                salvaged.push(item);
                break;
              }
            } catch {
            }
          }
        }
      }
      continue;
    }
    if (ch === "]" && braceDepth === 0) {
      break;
    }
  }
  return salvaged;
}
function resolveQuizScopeStrategy(params) {
  const { scope, baseTargetCount, claims, coverageItems, chapterFilter } = params;
  const safeBase = Math.max(1, baseTargetCount);
  const countDistinct = (cList, mList) => new Set(
    [
      ...cList.map((c) => normalizeVietnameseText(c.concept || c.sourceText.slice(0, 40))),
      ...mList.map((m) => normalizeVietnameseText(m.concept || ""))
    ].filter(Boolean)
  ).size;
  const allMissingOrPartial = coverageItems.filter(
    (i) => i.status === "MISSING" || i.status === "PARTIALLY_COVERED"
  );
  if (scope === "incorrect" || scope === "partial" || scope === "missing") {
    const targetClaims2 = scope === "incorrect" ? claims.filter((c) => c.evaluationStatus === "INCORRECT") : scope === "partial" ? claims.filter((c) => c.evaluationStatus === "PARTIALLY_CORRECT") : [];
    const missingItems2 = scope === "missing" ? allMissingOrPartial : scope === "partial" ? coverageItems.filter((i) => i.status === "PARTIALLY_COVERED") : [];
    const hasTargetedData = targetClaims2.length > 0 || missingItems2.length > 0;
    if (hasTargetedData) {
      const distinctConceptCount2 = Math.max(1, countDistinct(targetClaims2, missingItems2));
      return {
        mode: "mistake_variation",
        targetClaims: targetClaims2,
        missingItems: missingItems2,
        distinctConceptCount: distinctConceptCount2,
        needsTextbookSupplement: false,
        expectedUploadSlots: safeBase,
        expectedSupplementSlots: 0
      };
    }
    const fallbackDistinct = countDistinct(claims, allMissingOrPartial);
    return {
      mode: "empty_scope_fallback",
      targetClaims: claims,
      missingItems: allMissingOrPartial,
      distinctConceptCount: fallbackDistinct,
      needsTextbookSupplement: fallbackDistinct < safeBase,
      expectedUploadSlots: Math.min(safeBase, fallbackDistinct),
      expectedSupplementSlots: Math.max(0, safeBase - fallbackDistinct)
    };
  }
  let targetClaims = claims;
  let missingItems = allMissingOrPartial;
  if (scope === "chapter" && chapterFilter?.trim()) {
    const needle = chapterFilter.trim().toLowerCase();
    const filteredClaims = claims.filter((c) => (c.chapter || "").toLowerCase().includes(needle));
    const filteredMissing = allMissingOrPartial.filter(
      (m) => (m.chapter || "").toLowerCase().includes(needle)
    );
    if (filteredClaims.length === 0 && filteredMissing.length === 0) {
      const fallbackDistinct = countDistinct(claims, allMissingOrPartial);
      return {
        mode: "empty_scope_fallback",
        targetClaims: claims,
        missingItems: allMissingOrPartial,
        distinctConceptCount: fallbackDistinct,
        needsTextbookSupplement: fallbackDistinct < safeBase,
        expectedUploadSlots: Math.min(safeBase, fallbackDistinct),
        expectedSupplementSlots: Math.max(0, safeBase - fallbackDistinct)
      };
    }
    targetClaims = filteredClaims;
    missingItems = filteredMissing;
  }
  const distinctConceptCount = countDistinct(targetClaims, missingItems);
  const needsTextbookSupplement = distinctConceptCount < safeBase;
  return {
    mode: needsTextbookSupplement ? "upload_plus_textbook" : "upload_sufficient",
    targetClaims,
    missingItems,
    distinctConceptCount,
    needsTextbookSupplement,
    expectedUploadSlots: Math.min(safeBase, distinctConceptCount),
    expectedSupplementSlots: Math.max(0, safeBase - distinctConceptCount)
  };
}
function mergeQuizQuestionsWithQuota(params) {
  const { existing, incoming, baseTargetCount, advancedTargetCount } = params;
  const safeBaseTarget = Math.max(1, baseTargetCount);
  const safeAdvTarget = Math.max(0, advancedTargetCount);
  const normalizedIncoming = incoming.map((q) => {
    if (safeAdvTarget === 0 && q.isExternalAdvanced) {
      return {
        ...q,
        isExternalAdvanced: false,
        questionOrigin: q.questionOrigin === "external_advanced" ? "textbook_supplement" : q.questionOrigin
      };
    }
    return q;
  });
  const validated = validateQuizQuestionSet([...existing, ...normalizedIncoming]);
  const baseQuestions = [];
  const advancedQuestions = [];
  for (const q of validated.questions) {
    if (safeAdvTarget > 0 && q.isExternalAdvanced) {
      if (advancedQuestions.length < safeAdvTarget) {
        advancedQuestions.push(q);
      }
    } else if (baseQuestions.length < safeBaseTarget) {
      baseQuestions.push(q);
    }
  }
  return {
    questions: [...baseQuestions, ...advancedQuestions],
    baseQuestions,
    advancedQuestions,
    missingBase: Math.max(0, safeBaseTarget - baseQuestions.length),
    missingAdvanced: Math.max(0, safeAdvTarget - advancedQuestions.length)
  };
}
async function runQuizGenerationWithTopUp(params) {
  const maxTopUpPasses = Math.max(0, Math.min(3, params.maxTopUpPasses ?? 2));
  let merged = mergeQuizQuestionsWithQuota({
    existing: [],
    incoming: [],
    baseTargetCount: params.baseTargetCount,
    advancedTargetCount: params.advancedTargetCount
  });
  let modelUsed = "";
  let attemptsUsed = 0;
  for (let attempt = 0; attempt <= maxTopUpPasses; attempt += 1) {
    if (attempt > 0 && merged.missingBase === 0 && merged.missingAdvanced === 0) {
      break;
    }
    attemptsUsed += 1;
    try {
      const batch = await params.generateBatch({
        attempt,
        missingBase: merged.missingBase,
        missingAdvanced: merged.missingAdvanced,
        existingQuestions: merged.questions
      });
      if (batch.modelUsed && !modelUsed) {
        modelUsed = batch.modelUsed;
      }
      merged = mergeQuizQuestionsWithQuota({
        existing: merged.questions,
        incoming: batch.questions,
        baseTargetCount: params.baseTargetCount,
        advancedTargetCount: params.advancedTargetCount
      });
    } catch (err) {
      if (attempt === 0 && merged.questions.length === 0) {
        throw err;
      }
      break;
    }
  }
  return {
    ...merged,
    attemptsUsed,
    topUpPassesUsed: Math.max(0, attemptsUsed - 1),
    modelUsed
  };
}

// src/server/geminiPipeline.ts
init_retrieval();

// src/core/rubric.ts
function normalizeConceptKey(text) {
  return (text || "").toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function tokenizeWords(text) {
  return normalizeConceptKey(text).split(" ").filter((w) => w.length >= 2);
}
function inferDeterministicCriterionWeight(concept, sourceKind) {
  const norm = normalizeConceptKey(concept);
  const coreSignals = [
    "kh\xE1i ni\u1EC7m",
    "\u0111\u1ECBnh ngh\u0129a",
    "\u0111\u1ECBnh lu\u1EADt",
    "\u0111\u1ECBnh l\xED",
    "\u0111\u1ECBnh l\xFD",
    "c\xF4ng th\u1EE9c",
    "ph\u01B0\u01A1ng tr\xECnh",
    "b\u1EA3n ch\u1EA5t",
    "c\u1EA5u t\u1EA1o",
    "nguy\xEAn l\xED",
    "nguy\xEAn l\xFD",
    "quy lu\u1EADt",
    "vai tr\xF2",
    "c\u01A1 ch\u1EBF",
    "t\xEDnh ch\u1EA5t",
    "\u0111i\u1EC1u ki\u1EC7n",
    "\u0111\u1EB7c \u0111i\u1EC3m",
    "ph\xE2n lo\u1EA1i"
  ];
  const detailSignals = [
    "v\xED d\u1EE5",
    "l\u01B0u \xFD",
    "m\u1EDF r\u1ED9ng",
    "v\u1EADn d\u1EE5ng",
    "li\xEAn h\u1EC7",
    "th\u1EF1c t\u1EBF",
    "ghi ch\xFA",
    "em c\xF3 bi\u1EBFt",
    "b\xE0i t\u1EADp"
  ];
  if (detailSignals.some((s) => norm.includes(s))) {
    return 1;
  }
  if (coreSignals.some((s) => norm.includes(s))) {
    return 3;
  }
  if (sourceKind === "objective") {
    return 3;
  }
  if (sourceKind === "section") {
    return 2;
  }
  return 2;
}
function buildFixedRubricFromChunks(params) {
  const {
    chunks,
    subject,
    grade,
    textbookReferenceId,
    textbookTitle,
    selectedChapters = [],
    maxCriteria = 24
  } = params;
  const sortedChunks = [...chunks].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.chunkId.localeCompare(b.chunkId)
  );
  const seenKeys = /* @__PURE__ */ new Set();
  const rawCriteria = [];
  const tryAddCriterion = (candidate) => {
    if (rawCriteria.length >= maxCriteria) return;
    const key = normalizeConceptKey(candidate.concept);
    if (!key || key.length < 3) return;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    rawCriteria.push(candidate);
  };
  for (const chunk of sortedChunks) {
    const objectives = Array.isArray(chunk.learningObjectives) ? chunk.learningObjectives : [];
    for (const obj of objectives) {
      const clean = (obj || "").trim();
      if (!clean) continue;
      tryAddCriterion({
        concept: clean.slice(0, 180),
        chapter: chunk.chapter,
        lesson: chunk.lesson,
        importanceWeight: inferDeterministicCriterionWeight(clean, "objective"),
        referenceChunkId: chunk.chunkId,
        referencePage: chunk.pageNumber,
        referenceExcerpt: chunk.content.slice(0, 280),
        expectedKeywords: Array.from(
          /* @__PURE__ */ new Set([...tokenizeWords(clean), ...(chunk.conceptTags || []).map(normalizeConceptKey)])
        ).filter(Boolean).slice(0, 10)
      });
    }
  }
  for (const chunk of sortedChunks) {
    const section = (chunk.sectionTitle || "").trim();
    const isGenericSection = !section || normalizeConceptKey(section) === "noi dung chinh" || normalizeConceptKey(section) === "n\u1ED9i dung ch\xEDnh" || normalizeConceptKey(section) === "n\u1ED9i dung chu\u1EA9n sgk";
    const label = !isGenericSection ? section : (chunk.lesson || "").trim();
    if (!label) continue;
    tryAddCriterion({
      concept: label.slice(0, 180),
      chapter: chunk.chapter,
      lesson: chunk.lesson,
      importanceWeight: inferDeterministicCriterionWeight(label, "section"),
      referenceChunkId: chunk.chunkId,
      referencePage: chunk.pageNumber,
      referenceExcerpt: chunk.content.slice(0, 280),
      expectedKeywords: Array.from(
        /* @__PURE__ */ new Set([...tokenizeWords(label), ...(chunk.keywords || []).map(normalizeConceptKey)])
      ).filter(Boolean).slice(0, 10)
    });
  }
  if (rawCriteria.length < 4) {
    for (const chunk of sortedChunks) {
      for (const tag of chunk.conceptTags || []) {
        const clean = (tag || "").trim();
        if (!clean || clean.length < 3) continue;
        tryAddCriterion({
          concept: clean.slice(0, 140),
          chapter: chunk.chapter,
          lesson: chunk.lesson,
          importanceWeight: inferDeterministicCriterionWeight(clean, "concept_tag"),
          referenceChunkId: chunk.chunkId,
          referencePage: chunk.pageNumber,
          referenceExcerpt: chunk.content.slice(0, 280),
          expectedKeywords: tokenizeWords(clean).slice(0, 8)
        });
      }
    }
  }
  const criteria = rawCriteria.map((item, idx) => ({
    ...item,
    criterionId: `KT${String(idx + 1).padStart(2, "0")}`
  }));
  const totalRequiredWeight = criteria.reduce((sum, c) => sum + c.importanceWeight, 0);
  const rubricMode = criteria.length > 0 ? "fixed_textbook_rubric" : selectedChapters.length > 0 ? "scope_guided" : "unscoped";
  const rubricHash = buildDeterministicCacheKey({
    rubricMode,
    subject,
    grade,
    textbookReferenceId,
    selectedChapters: [...selectedChapters].sort(),
    criteria: criteria.map((c) => ({
      criterionId: c.criterionId,
      concept: c.concept,
      chapter: c.chapter,
      importanceWeight: c.importanceWeight,
      referenceChunkId: c.referenceChunkId
    }))
  });
  return {
    rubricId: `rub_${rubricHash.slice(0, 12)}`,
    rubricHash,
    rubricMode,
    subject,
    grade,
    textbookReferenceId,
    textbookTitle,
    selectedChapters,
    criteria,
    totalRequiredWeight
  };
}
function formatFixedRubricForPrompt(rubric) {
  if (rubric.criteria.length === 0) {
    return "Kh\xF4ng c\xF3 b\u1EA3ng rubric SGK c\u1ED1 \u0111\u1ECBnh cho ph\u1EA1m vi n\xE0y.";
  }
  const lines = [
    `B\u1EA2NG RUBRIC C\u1ED0 \u0110\u1ECANH B\u1EAET BU\u1ED8C (${rubric.criteria.length} ti\xEAu ch\xED | t\u1ED5ng tr\u1ECDng s\u1ED1 ${rubric.totalRequiredWeight} | m\xE3 rubric ${rubric.rubricId}):`,
    "B\u1EAET BU\u1ED8C \u0111\xE1nh gi\xE1 \u0110\u1EA6Y \u0110\u1EE6 T\u1EA4T C\u1EA2 c\xE1c ti\xEAu ch\xED t\u1EEB KT01 \u0111\u1EBFn KT" + String(rubric.criteria.length).padStart(2, "0") + " trong m\u1EA3ng coverageItems. KH\xD4NG \u0111\u01B0\u1EE3c x\xF3a ti\xEAu ch\xED, KH\xD4NG \u0111\u01B0\u1EE3c t\u1EF1 \u0111\u1ED5i importanceWeight, v\xE0 PH\u1EA2I ghi \u0111\xFAng criterionId."
  ];
  for (const c of rubric.criteria) {
    lines.push(
      `- [${c.criterionId} | weight=${c.importanceWeight} | chunkId=${c.referenceChunkId} | Tr.${c.referencePage ?? "?"}] ${c.concept} (${c.chapter}${c.lesson ? ` - ${c.lesson}` : ""})`
    );
  }
  return lines.join("\n");
}
function normalizeCoverageStatus(rawStatus) {
  if (rawStatus === "COVERED" || rawStatus === "PARTIALLY_COVERED" || rawStatus === "MISSING" || rawStatus === "OUT_OF_SCOPE") {
    return rawStatus;
  }
  return "MISSING";
}
function computeConceptOverlap(a, b) {
  const wordsA = new Set(tokenizeWords(a));
  const wordsB = new Set(tokenizeWords(b));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) shared += 1;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}
function reconcileCoverageAgainstFixedRubric(fixedRubric, aiCoverageItems) {
  const usedAiIndices = /* @__PURE__ */ new Set();
  const coverageItems = [];
  for (const criterion of fixedRubric.criteria) {
    let matchedIdx = aiCoverageItems.findIndex(
      (item, idx) => !usedAiIndices.has(idx) && typeof item.criterionId === "string" && item.criterionId.trim().toUpperCase() === criterion.criterionId.toUpperCase()
    );
    if (matchedIdx < 0) {
      let bestScore = 0;
      let bestIdx = -1;
      for (let i = 0; i < aiCoverageItems.length; i += 1) {
        if (usedAiIndices.has(i)) continue;
        const score = computeConceptOverlap(criterion.concept, aiCoverageItems[i].concept || "");
        if (score >= 0.45 && score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      matchedIdx = bestIdx;
    }
    if (matchedIdx >= 0) {
      usedAiIndices.add(matchedIdx);
      const aiItem = aiCoverageItems[matchedIdx];
      const status = normalizeCoverageStatus(aiItem.status);
      const safeStatus = status === "OUT_OF_SCOPE" ? "MISSING" : status;
      coverageItems.push({
        itemId: criterion.criterionId,
        criterionId: criterion.criterionId,
        concept: criterion.concept,
        chapter: criterion.chapter,
        ...criterion.lesson ? { lesson: criterion.lesson } : {},
        importanceWeight: criterion.importanceWeight,
        // Locked by fixed rubric!
        status: safeStatus,
        suggestedAddition: safeStatus === "COVERED" ? (aiItem.suggestedAddition || "").trim() : (aiItem.suggestedAddition || "").trim() || `B\u1ED5 sung \u0111\u1EA7y \u0111\u1EE7 n\u1ED9i dung chu\u1EA9n SGK cho ti\xEAu ch\xED "${criterion.concept}".`,
        referenceExcerpt: (aiItem.referenceExcerpt || "").trim() || criterion.referenceExcerpt,
        ...typeof criterion.referencePage === "number" && criterion.referencePage > 0 ? { referencePage: criterion.referencePage } : {},
        matchedChunkId: criterion.referenceChunkId
      });
    } else {
      coverageItems.push({
        itemId: criterion.criterionId,
        criterionId: criterion.criterionId,
        concept: criterion.concept,
        chapter: criterion.chapter,
        ...criterion.lesson ? { lesson: criterion.lesson } : {},
        importanceWeight: criterion.importanceWeight,
        status: "MISSING",
        suggestedAddition: `B\u1ED5 sung n\u1ED9i dung chu\u1EA9n SGK cho ti\xEAu ch\xED "${criterion.concept}".`,
        referenceExcerpt: criterion.referenceExcerpt,
        ...typeof criterion.referencePage === "number" && criterion.referencePage > 0 ? { referencePage: criterion.referencePage } : {},
        matchedChunkId: criterion.referenceChunkId
      });
    }
  }
  const extraObservations = [];
  aiCoverageItems.forEach((item, idx) => {
    if (usedAiIndices.has(idx)) return;
    if (!item.concept || !item.concept.trim()) return;
    const wRaw = Number(item.importanceWeight);
    const w = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
    extraObservations.push({
      itemId: `extra_${extraObservations.length + 1}`,
      concept: item.concept.trim(),
      chapter: (item.chapter || fixedRubric.selectedChapters[0] || "Ghi nh\u1EADn b\u1ED5 sung").trim(),
      importanceWeight: w,
      status: normalizeCoverageStatus(item.status),
      suggestedAddition: (item.suggestedAddition || "").trim(),
      referenceExcerpt: (item.referenceExcerpt || "").trim(),
      ...typeof item.referencePage === "number" && item.referencePage > 0 ? { referencePage: item.referencePage } : {}
    });
  });
  return { coverageItems, extraObservations };
}

// src/core/semanticBlocks.ts
var BULLET_LINE_RE = /^([-*+•▪▫◦–—]|\d+[.)]|[a-zA-Z][.)])\s+/;
var ANNOTATION_INTRO_RE = /^(trong\s+đó|trong\s+do|với|voi|ký\s+hiệu|ky\s+hieu|chú\s+thích|chu\s+thich|ở\s+đây|o\s+day)\s*[:,-]?\s*$/i;
var FORMULA_OPERATOR_RE = /[=≈≠≤≥±×÷·]|(\b[a-zA-Z][a-zA-Z0-9_]*\s*=\s*[-+a-zA-Z0-9_(])/;
function isBulletLine(line) {
  return BULLET_LINE_RE.test((line || "").trim());
}
function isAnnotationIntroLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed || trimmed.length > 48) return false;
  return ANNOTATION_INTRO_RE.test(trimmed);
}
function isFormulaLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed || trimmed.length > 110) return false;
  if (isBulletLine(trimmed)) return false;
  if (/[:?!]$/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount > 14) return false;
  if (!FORMULA_OPERATOR_RE.test(trimmed)) return false;
  const vietnameseProseWords = (trimmed.match(/\b(là|của|theo|trong|khi|với|thời|gian|quãng|đường|vật|chuyển|động|được|định|nghĩa)\b/gi) || []).length;
  if (vietnameseProseWords >= 3) return false;
  return true;
}
function isLeadInLabel(line) {
  const trimmed = (line || "").trim();
  if (!trimmed || trimmed.length > 96) return false;
  if (!/:\s*$/.test(trimmed)) return false;
  if (isBulletLine(trimmed)) return false;
  if (/[=≈≠≤≥]/.test(trimmed)) return false;
  return true;
}
function isSymbolAnnotationLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed || trimmed.length > 150) return false;
  if (isBulletLine(trimmed)) return true;
  if (isLeadInLabel(trimmed) || isAnnotationIntroLine(trimmed) || isFormulaLine(trimmed)) {
    return false;
  }
  return /^[a-zA-Z][a-zA-Z0-9_0-9,.\s]{0,12}\s+(?:là|:|-|–)\s+/i.test(trimmed);
}
function isNonGradableLeadInClaim(sourceText) {
  const trimmed = (sourceText || "").trim();
  if (!trimmed) return true;
  if (trimmed.includes("\n")) return false;
  if (trimmed.length > 96) return false;
  if (/[=≈≠≤≥]/.test(trimmed)) return false;
  if (isAnnotationIntroLine(trimmed)) return true;
  if (/:\s*$/.test(trimmed)) return true;
  return false;
}
function groupRawTextIntoSemanticBlocks(rawText, pageNumber, confidence) {
  const safeConf = Math.max(0.1, Math.min(1, Number(confidence) || 0.92));
  const lines = (rawText || "").split(/\r?\n+/).map((l) => l.trim()).filter((l) => l.length > 0);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isAnnotationIntroLine(line)) {
      const grouped = [line];
      let j = i + 1;
      while (j < lines.length && isSymbolAnnotationLine(lines[j])) {
        grouped.push(lines[j]);
        j += 1;
      }
      if (grouped.length > 1) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: grouped.join("\n"),
          textType: "list",
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null
        });
        i = j;
        continue;
      }
      if (j < lines.length && !isLeadInLabel(lines[j]) && !isFormulaLine(lines[j]) && !isAnnotationIntroLine(lines[j])) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: `${line}
${lines[j]}`,
          textType: "paragraph",
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null
        });
        i = j + 1;
        continue;
      }
    }
    if (isLeadInLabel(line) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (isFormulaLine(nextLine)) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: `${line}
${nextLine}`,
          textType: "formula",
          formulaText: nextLine,
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null
        });
        i += 2;
        continue;
      }
      if (isBulletLine(nextLine)) {
        const grouped = [line];
        let j = i + 1;
        while (j < lines.length && isBulletLine(lines[j])) {
          grouped.push(lines[j]);
          j += 1;
        }
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: grouped.join("\n"),
          textType: "list",
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null
        });
        i = j;
        continue;
      }
      if (!isLeadInLabel(nextLine) && !isAnnotationIntroLine(nextLine)) {
        blocks.push({
          blockId: `p${pageNumber}_b${blocks.length + 1}`,
          pageNumber,
          extractedText: `${line}
${nextLine}`,
          textType: "paragraph",
          confidence: safeConf,
          readingOrder: blocks.length + 1,
          boundingBox: null
        });
        i += 2;
        continue;
      }
    }
    if (isFormulaLine(line)) {
      blocks.push({
        blockId: `p${pageNumber}_b${blocks.length + 1}`,
        pageNumber,
        extractedText: line,
        textType: "formula",
        formulaText: line,
        confidence: safeConf,
        readingOrder: blocks.length + 1,
        boundingBox: null
      });
      i += 1;
      continue;
    }
    if (isBulletLine(line)) {
      blocks.push({
        blockId: `p${pageNumber}_b${blocks.length + 1}`,
        pageNumber,
        extractedText: line,
        textType: "list",
        confidence: safeConf,
        readingOrder: blocks.length + 1,
        boundingBox: null
      });
      i += 1;
      continue;
    }
    const isGenuineTitle = blocks.length === 0 && line.length < 80 && !/[.!?]$/.test(line) && !isLeadInLabel(line);
    blocks.push({
      blockId: `p${pageNumber}_b${blocks.length + 1}`,
      pageNumber,
      extractedText: line,
      textType: isGenuineTitle ? "heading" : "paragraph",
      confidence: safeConf,
      readingOrder: blocks.length + 1,
      boundingBox: null
    });
    i += 1;
  }
  return blocks;
}

// src/core/uploadBatching.ts
var MAX_IMAGE_UPLOAD_MB = 5;
var MAX_DOCUMENT_UPLOAD_MB = 4;
var TARGET_COMPRESSED_IMAGE_BYTES = 900 * 1024;
var DEFAULT_MAX_BATCH_BYTES = Math.floor(2.6 * 1024 * 1024);
function getEffectiveUploadLimits(adminMaxFileMb) {
  const safeAdmin = typeof adminMaxFileMb === "number" && Number.isFinite(adminMaxFileMb) && adminMaxFileMb > 0 ? adminMaxFileMb : 20;
  const maxImageMb = Math.min(safeAdmin, MAX_IMAGE_UPLOAD_MB);
  const maxDocumentMb = Math.min(safeAdmin, MAX_DOCUMENT_UPLOAD_MB);
  return {
    maxImageMb,
    maxDocumentMb,
    maxImageBytes: Math.round(maxImageMb * 1024 * 1024),
    maxDocumentBytes: Math.round(maxDocumentMb * 1024 * 1024)
  };
}
function isDocumentFileLike(file) {
  const lower = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  return mime === "application/pdf" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || lower.endsWith(".pdf") || lower.endsWith(".docx");
}
function validateUploadFileSize(file, adminMaxFileMb) {
  const limits = getEffectiveUploadLimits(adminMaxFileMb);
  const isDoc = isDocumentFileLike(file);
  if (isDoc) {
    if (file.size > limits.maxDocumentBytes) {
      const actualMb = (file.size / (1024 * 1024)).toFixed(2);
      return {
        ok: false,
        isDocumentLimit: true,
        error: `T\u1EC7p t\xE0i li\u1EC7u "${file.name}" (${actualMb}MB) v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n an to\xE0n ${limits.maxDocumentMb}MB cho PDF/DOCX tr\xEAn m\xE1y ch\u1EE7 Vercel. H\xE3y n\xE9n file nh\u1ECF h\u01A1n ${limits.maxDocumentMb}MB ho\u1EB7c ch\u1EE5p \u1EA3nh t\u1EEBng trang (h\u1ED7 tr\u1EE3 \u1EA3nh g\u1ED1c t\u1EDBi ${limits.maxImageMb}MB/\u1EA3nh).`
      };
    }
    return { ok: true };
  }
  if (file.size > limits.maxImageBytes) {
    const actualMb = (file.size / (1024 * 1024)).toFixed(2);
    return {
      ok: false,
      isDocumentLimit: false,
      error: `\u1EA2nh "${file.name}" (${actualMb}MB) v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n t\u1ED1i \u0111a ${limits.maxImageMb}MB/\u1EA3nh.`
    };
  }
  return { ok: true };
}
function normalizeVietnameseTokenText(raw) {
  return (raw || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/\.[^.]+$/, "").replace(/[_\-.,()[\]]+/g, " ").replace(/\s+/g, " ").trim();
}
var SUBJECT_KEYWORD_RULES = [
  {
    subject: "vat_ly",
    patterns: [
      /\b(vat\s*ly|vat\s*li|vly|mon\s*ly|de\s*ly|dao\s*dong|song\s*co|song\s*dien\s*tu|dien\s*xoay\s*chieu|mach\s*rlc|hat\s*nhan|luong\s*tu|quang\s*hoc|nhiet\s*hoc|dong\s*luc\s*hoc|dong\s*hoc|chuyen\s*dong|con\s*lac|tu\s*truong|dien\s*truong|cam\s*ung\s*dien\s*tu|dinh\s*luat\s*ohm|newton|coulomb)\b/,
      /\b(ly|li)\s*(10|11|12)\b/
    ]
  },
  {
    subject: "hoa_hoc",
    patterns: [
      /\b(hoa\s*hoc|mon\s*hoa|de\s*hoa|este|lipit|cacbohidrat|glucozo|fructozo|saccarozo|tinh\s*bot|xenlulozo|amin|amino\s*axit|peptit|protein|polime|kim\s*loai|kiem\s*tho|nhom|sat|crom|hidrocacbon|ankan|anken|ankin|ankadien|aren|benzen|ancol|phenol|andehit|axit\s*cacboxylic|nguyen\s*tu|bang\s*tuan\s*hoan|phan\s*ung\s*oxi\s*hoa|dien\s*li|dien\s*phan|toc\s*do\s*phan\s*ung|can\s*bang\s*hoa\s*hoc)\b/,
      /\bhoa\s*(10|11|12)\b/
    ]
  },
  {
    subject: "toan",
    patterns: [
      /\b(toan\s*hoc|mon\s*toan|de\s*toan|dai\s*so|hinh\s*hoc|giai\s*tich|ham\s*so|dao\s*ham|tich\s*phan|nguyen\s*ham|logarit|mu\s*logarit|luong\s*giac|to\s*hop|xac\s*suat|cap\s*so\s*cong|cap\s*so\s*nhan|vecto|toa\s*do\s*oxy|oxyz|so\s*phuc|bat\s*phuong\s*trinh|he\s*phuong\s*trinh|khoi\s*da\s*dien|mat\s*cau|mat\s*non|mat\s*tru|thong\s*ke)\b/,
      /\btoan\s*(10|11|12)?\b/
    ]
  },
  {
    subject: "sinh_hoc",
    patterns: [
      /\b(sinh\s*hoc|mon\s*sinh|de\s*sinh|di\s*truyen|bien\s*di|dot\s*bien|adn|arn|gen|ma\s*di\s*truyen|phien\s*ma|dich\s*ma|nhiem\s*sac\s*the|te\s*bao|quang\s*hop|ho\s*hap|tien\s*hoa|sinh\s*thai|quan\s*the|quan\s*xa|he\s*sinh\s*thai|chuyen\s*hoa\s*vat\s*chat)\b/,
      /\bsinh\s*(10|11|12)\b/
    ]
  },
  {
    subject: "ngu_van",
    patterns: [
      /\b(ngu\s*van|mon\s*van|van\s*hoc|nghi\s*luan|doc\s*hieu|lam\s*van|phan\s*tich\s*tho|truyen\s*ngan|tay\s*tien|viet\s*bac|dat\s*nuoc|vo\s*nhat|vo\s*chong\s*a\s*phu|chi\s*pheo|hai\s*dua\s*tre|chu\s*nguoi\s*tu\s*tu)\b/,
      /\bvan\s*(10|11|12)\b/
    ]
  },
  {
    subject: "tieng_anh",
    patterns: [
      /\b(tieng\s*anh|mon\s*anh|english|grammar|vocabulary|reading|listening|ielts|toeic|phonetics|tenses|relative\s*clause|passive\s*voice|conditional|reported\s*speech)\b/,
      /\banh\s*(10|11|12)\b/
    ]
  },
  {
    subject: "lich_su",
    patterns: [
      /\b(lich\s*su|mon\s*su|de\s*su|cach\s*mang|chien\s*tranh|the\s*gioi|viet\s*nam|khang\s*chien|phong\s*trao|dien\s*bien\s*phu|asean|lien\s*hop\s*quoc|chien\s*tranh\s*lanh)\b/,
      /\bsu\s*(10|11|12)\b/
    ]
  },
  {
    subject: "dia_ly",
    patterns: [
      /\b(dia\s*ly|dia\s*li|mon\s*dia|de\s*dia|khi\s*hau|dia\s*hinh|dan\s*cu|vung\s*kinh\s*te|atlat|tu\s*nhien|dong\s*bang\s*song\s*hong|dong\s*bang\s*song\s*cuu\s*long|tay\s*nguyen)\b/,
      /\bdia\s*(10|11|12)\b/
    ]
  },
  {
    subject: "gdkt_pl",
    patterns: [
      /\b(gdkt\s*pl|gdktpl|gdcd|giao\s*duc\s*kinh\s*te|phap\s*luat|cong\s*dan|hien\s*phap|thi\s*truong|ngan\s*sach|thue|tin\s*dung|lam\s*phat|that\s*nghiep|quyen\s*binh\s*dang)\b/
    ]
  },
  {
    subject: "tin_hoc",
    patterns: [
      /\b(tin\s*hoc|mon\s*tin|lap\s*trinh|python|c\+\+|pascal|thuat\s*toan|co\s*so\s*du\s*lieu|sql|html|css|mang\s*may\s*tinh|tri\s*tue\s*nhan\s*tao)\b/,
      /\btin\s*(10|11|12)\b/
    ]
  }
];
function isGenericCameraFileNames(fileNames) {
  const clean = fileNames.map((n) => (n || "").trim()).filter(Boolean);
  if (clean.length === 0) return true;
  return clean.every((name) => {
    const stem = name.replace(/\.[a-z0-9]{1,8}$/i, "").trim();
    if (!stem) return true;
    return /^(img|dsc|screenshot|image|photo|page|trang|scan|cam|whatsapp|viber|zalo|pxl|mvimg|z\d+)[\s_\-\d().a-f]*$/i.test(
      stem
    ) || /^[\d_\-\s().]+$/i.test(stem) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:[_-][0-9a-f]{4,16})?$/i.test(
      stem
    ) || /^[0-9a-f_\-]{12,}$/i.test(stem);
  });
}
function buildFileNameSuggestionCacheKey(fileNames, defaultGrade = "10") {
  const normalized = fileNames.map(normalizeVietnameseTokenText).filter(Boolean).slice(0, 15).join("|");
  return `${defaultGrade}::${normalized}`;
}
function inferGradeAndSubjectFromFileNames(fileNames) {
  const combined = fileNames.map(normalizeVietnameseTokenText).filter(Boolean).join(" ");
  if (!combined) {
    return { grade: null, subject: null, confidence: "low" };
  }
  let detectedGrade = null;
  const explicitGradeMatch = combined.match(/\b(?:lop|khoi|k|grade)\s*(10|11|12)\b/) || combined.match(/\b(?:toan|ly|li|hoa|sinh|van|anh|su|dia|tin|gdcd|gdktpl)(10|11|12)\b/) || combined.match(/\b(?:toan|ly|li|hoa|sinh|van|anh|su|dia|tin|gdcd|gdktpl)\s+(10|11|12)\b/);
  if (explicitGradeMatch) {
    detectedGrade = explicitGradeMatch[1];
  } else {
    const standaloneGradeMatch = combined.match(/(?:^|\s)(10|11|12)(?:\s|$)/);
    if (standaloneGradeMatch) {
      detectedGrade = standaloneGradeMatch[1];
    }
  }
  let detectedSubject = null;
  for (const rule of SUBJECT_KEYWORD_RULES) {
    if (rule.patterns.some((re) => re.test(combined))) {
      detectedSubject = rule.subject;
      break;
    }
  }
  const confidence = detectedSubject && detectedGrade ? "high" : detectedSubject || detectedGrade ? "medium" : "low";
  return {
    grade: detectedGrade,
    subject: detectedSubject,
    confidence
  };
}
function inferScopeFromContentHeuristic(sampleText, fallbackTitle = "T\xE0i li\u1EC7u \xF4n t\u1EADp") {
  const cleanTitle = (fallbackTitle || "T\xE0i li\u1EC7u \xF4n t\u1EADp").replace(/\.[^.]+$/, "").trim() || "T\xE0i li\u1EC7u \xF4n t\u1EADp";
  const snippet = `${cleanTitle}
${(sampleText || "").slice(0, 2600)}`;
  const normalized = normalizeVietnameseTokenText(snippet);
  let detectedGrade = "10";
  const gradeMatch = normalized.match(/\b(?:lop|khoi|chuong trinh|sgk|on tap|de kiem tra|de thi)\s*(10|11|12)\b/) || normalized.match(/\b(?:toan|vat ly|vat li|hoa hoc|sinh hoc|ngu van|tieng anh|lich su|dia ly|tin hoc|gdkt pl|gdcd)\s*(10|11|12)\b/);
  if (gradeMatch && (gradeMatch[1] === "10" || gradeMatch[1] === "11" || gradeMatch[1] === "12")) {
    detectedGrade = gradeMatch[1];
  }
  let bestSubject = "khac";
  let bestScore = 0;
  for (const rule of SUBJECT_KEYWORD_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      const globalPattern = new RegExp(pattern.source, "gi");
      const matches = normalized.match(globalPattern);
      if (matches) {
        score += matches.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestSubject = rule.subject;
    }
  }
  const chapterHints = (sampleText || "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 6 && line.length <= 90).filter((line) => /^(chương|bài|chủ đề|phần)\s+[\dIVX]+/i.test(line)).slice(0, 3);
  return {
    suggestedGrade: detectedGrade,
    suggestedSubject: bestSubject,
    suggestedChapters: chapterHints,
    suggestedTitle: cleanTitle.slice(0, 110)
  };
}

// src/core/types.ts
var SUBJECT_LABELS = {
  toan: "To\xE1n h\u1ECDc",
  vat_ly: "V\u1EADt l\xFD",
  hoa_hoc: "H\xF3a h\u1ECDc",
  sinh_hoc: "Sinh h\u1ECDc",
  ngu_van: "Ng\u1EEF v\u0103n",
  lich_su: "L\u1ECBch s\u1EED",
  dia_ly: "\u0110\u1ECBa l\xFD",
  tieng_anh: "Ti\u1EBFng Anh",
  tin_hoc: "Tin h\u1ECDc",
  gdkt_pl: "Gi\xE1o d\u1EE5c Kinh t\u1EBF & Ph\xE1p lu\u1EADt",
  khac: "M\xF4n h\u1ECDc kh\xE1c"
};
var EXAM_TYPE_LABELS = {
  giua_ky_1: "\u0110\u1EC1 ki\u1EC3m tra Gi\u1EEFa k\u1EF3 I",
  cuoi_ky_1: "\u0110\u1EC1 ki\u1EC3m tra Cu\u1ED1i k\u1EF3 I",
  giua_ky_2: "\u0110\u1EC1 ki\u1EC3m tra Gi\u1EEFa k\u1EF3 II",
  cuoi_ky_2: "\u0110\u1EC1 ki\u1EC3m tra Cu\u1ED1i k\u1EF3 II",
  on_tap_tong_hop: "\u0110\u1EC1 \xF4n t\u1EADp t\u1ED5ng h\u1EE3p"
};

// src/server/geminiPipeline.ts
function accumulateRawTokens(acc, usage) {
  acc.promptTokens += usage.promptTokens || 0;
  acc.candidateTokens += usage.candidateTokens || 0;
  acc.totalTokens += usage.totalTokens || 0;
}
function repairJsonLikeText(rawText) {
  const trimmed = (rawText || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!trimmed) return "{}";
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = fenced && fenced[1] ? fenced[1].trim() : trimmed;
  const fb = candidate.indexOf("{");
  const lb = candidate.lastIndexOf("}");
  if (fb >= 0 && lb > fb) {
    candidate = candidate.slice(fb, lb + 1);
  }
  return candidate;
}
function normalizeJsonEscapeAndControlChars(jsonCandidate) {
  let out = "";
  let inString = false;
  let escaped = false;
  const isHex = (ch) => /^[0-9a-fA-F]$/.test(ch);
  for (let i = 0; i < jsonCandidate.length; i += 1) {
    const ch = jsonCandidate[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        const next = jsonCandidate[i + 1] || "";
        const isStandardEscape = next === '"' || next === "\\" || next === "/" || next === "b" || next === "f" || next === "n" || next === "r" || next === "t" || next === "u" && i + 5 < jsonCandidate.length && isHex(jsonCandidate[i + 2]) && isHex(jsonCandidate[i + 3]) && isHex(jsonCandidate[i + 4]) && isHex(jsonCandidate[i + 5]);
        if (isStandardEscape) {
          out += ch;
          escaped = true;
        } else {
          out += "\\\\";
        }
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "	") {
        out += "\\t";
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 32) {
        out += " ";
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') {
        inString = true;
      }
      out += ch;
    }
  }
  return out.replace(/,\s*([}\]])/g, "$1");
}
var DETERMINISTIC_GRADING_SEED = 20261123;
var GRADING_PROMPT_VERSION = "v4.2_3provider_adaptive";
var MAX_STUDENT_GRADING_CHARS = 48e3;
var MAX_TEXTBOOK_GRADING_CHARS = 24e3;
function parseAndValidateKnowledgeEvalJson(rawText) {
  const trimmed = (rawText || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!trimmed || trimmed === "{}") {
    throw new Error(
      "GRADING_JSON_INVALID: M\xF4 h\xECnh AI tr\u1EA3 v\u1EC1 ph\u1EA3n h\u1ED3i r\u1ED7ng khi ki\u1EC3m \u0111\u1ECBnh ki\u1EBFn th\u1EE9c. Vui l\xF2ng th\u1EED ch\u1EA5m l\u1EA1i."
    );
  }
  const candidate = repairJsonLikeText(trimmed);
  let parsed = null;
  let lastParseErr = null;
  for (const attempt of [candidate, normalizeJsonEscapeAndControlChars(candidate)]) {
    try {
      parsed = JSON.parse(attempt);
      lastParseErr = null;
      break;
    } catch (err) {
      lastParseErr = err;
    }
  }
  if (lastParseErr || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const detail = lastParseErr instanceof Error ? lastParseErr.message : "C\u1EA5u tr\xFAc JSON kh\xF4ng h\u1EE3p l\u1EC7";
    throw new Error(
      `GRADING_JSON_INVALID: Ph\u1EA3n h\u1ED3i ch\u1EA5m \u0111i\u1EC3m t\u1EEB AI b\u1ECB c\u1EAFt c\u1EE5t ho\u1EB7c sai \u0111\u1ECBnh d\u1EA1ng JSON (${detail.slice(0, 120)}). H\u1EC7 th\u1ED1ng kh\xF4ng tr\u1EA3 k\u1EBFt qu\u1EA3 r\u1ED7ng gi\u1EA3 \u2014 vui l\xF2ng th\u1EED l\u1EA1i.`
    );
  }
  const obj = parsed;
  if (!Array.isArray(obj.claims)) {
    throw new Error(
      "GRADING_JSON_INVALID: Ph\u1EA3n h\u1ED3i ki\u1EC3m \u0111\u1ECBnh thi\u1EBFu m\u1EA3ng m\u1EC7nh \u0111\u1EC1 (claims). Vui l\xF2ng th\u1EED ch\u1EA5m l\u1EA1i."
    );
  }
  if (obj.coverageItems !== void 0 && !Array.isArray(obj.coverageItems)) {
    throw new Error(
      "GRADING_JSON_INVALID: Tr\u01B0\u1EDDng coverageItems trong ph\u1EA3n h\u1ED3i ki\u1EC3m \u0111\u1ECBnh kh\xF4ng \u0111\xFAng \u0111\u1ECBnh d\u1EA1ng m\u1EA3ng."
    );
  }
  return obj;
}
function safeParseModelJson(rawText, fallbackJson) {
  const source = (rawText || "").trim() || fallbackJson;
  const candidate = repairJsonLikeText(source);
  try {
    return JSON.parse(candidate);
  } catch {
    const repaired = normalizeJsonEscapeAndControlChars(candidate);
    try {
      return JSON.parse(repaired);
    } catch {
      return JSON.parse(fallbackJson);
    }
  }
}
function parseOcrResponsePayload(rawText) {
  const trimmed = (rawText || "").trim();
  if (!trimmed) {
    return { rawText: "", ocrConfidence: 0.85 };
  }
  const candidate = repairJsonLikeText(trimmed);
  for (const attemptText of [candidate, normalizeJsonEscapeAndControlChars(candidate)]) {
    try {
      const obj = JSON.parse(attemptText);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        return obj;
      }
    } catch {
    }
  }
  const rawFieldMatch = trimmed.match(/"rawText"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (rawFieldMatch && rawFieldMatch[1]) {
    const recoveredText = rawFieldMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    if (recoveredText.length > 0) {
      return { rawText: recoveredText, ocrConfidence: 0.8 };
    }
  }
  const cleanedPlain = trimmed.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^```[a-zA-Z]*\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!cleanedPlain || cleanedPlain === "{}") {
    throw new Error("M\xF4 h\xECnh AI tr\u1EA3 v\u1EC1 d\u1EEF li\u1EC7u OCR r\u1ED7ng.");
  }
  return { rawText: cleanedPlain, ocrConfidence: 0.85 };
}
async function generateJsonWithProviderDetailed(params) {
  const parseOutput = (rawText) => params.strictJsonParser ? params.strictJsonParser(rawText) : safeParseModelJson(rawText, params.fallbackJson);
  if (isGroqModelId(params.modelId)) {
    const apiKeyOverride2 = params.stage && params.slot ? resolveScopedApiKeyForStage("groq", params.stage, params.slot) || void 0 : void 0;
    const resp2 = await callWithTimeout(
      (signal) => callGroqChatCompletion({
        modelId: params.modelId,
        prompt: params.prompt,
        jsonMode: true,
        jsonSchemaHint: params.groqSchemaHint,
        maxOutputTokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0,
        seed: params.seed,
        strictModelLock: params.strictModelLock,
        apiKeyOverride: apiKeyOverride2,
        signal
      }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp2);
    return {
      data: parseOutput(resp2.text),
      resolvedModel: resp2.resolvedModel || params.modelId,
      ...resp2.systemFingerprint ? { systemFingerprint: resp2.systemFingerprint } : {}
    };
  }
  if (isCloudflareModelId(params.modelId)) {
    const resp2 = await callWithTimeout(
      (signal) => callCloudflareChatCompletion({
        modelId: params.modelId,
        prompt: params.prompt,
        jsonMode: true,
        jsonSchemaHint: params.groqSchemaHint,
        maxOutputTokens: params.maxOutputTokens,
        temperature: params.temperature ?? 0,
        seed: params.seed,
        strictModelLock: params.strictModelLock,
        signal
      }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp2);
    return {
      data: parseOutput(resp2.text),
      resolvedModel: resp2.resolvedModel || params.modelId,
      ...resp2.systemFingerprint ? { systemFingerprint: resp2.systemFingerprint } : {}
    };
  }
  const mistralModel = isMistralModelId(params.modelId) ? params.modelId : MISTRAL_PRIMARY_MODEL;
  const apiKeyOverride = params.stage && params.slot ? resolveScopedApiKeyForStage("mistral", params.stage, params.slot) || void 0 : void 0;
  const resp = await callWithTimeout(
    (signal) => callMistralChatCompletion({
      modelId: mistralModel,
      prompt: params.prompt,
      jsonMode: true,
      jsonSchemaHint: params.groqSchemaHint,
      maxOutputTokens: params.maxOutputTokens,
      temperature: params.temperature ?? 0,
      seed: params.seed,
      strictModelLock: params.strictModelLock,
      apiKeyOverride,
      signal
    }),
    params.timeoutMs
  );
  accumulateRawTokens(params.tokensOut, resp);
  return {
    data: parseOutput(resp.text),
    resolvedModel: resp.resolvedModel || mistralModel,
    ...resp.systemFingerprint ? { systemFingerprint: resp.systemFingerprint } : {}
  };
}
async function generateJsonWithProvider(params) {
  const res = await generateJsonWithProviderDetailed(params);
  return res.data;
}
async function generatePlainTextWithProvider(params) {
  if (isGroqModelId(params.modelId)) {
    const apiKeyOverride2 = params.stage && params.slot ? resolveScopedApiKeyForStage("groq", params.stage, params.slot) || void 0 : void 0;
    const resp2 = await callWithTimeout(
      (signal) => callGroqChatCompletion({
        modelId: params.modelId,
        prompt: params.prompt,
        jsonMode: false,
        maxOutputTokens: params.maxOutputTokens,
        apiKeyOverride: apiKeyOverride2,
        signal
      }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp2);
    return resp2.text.trim();
  }
  if (isCloudflareModelId(params.modelId)) {
    const resp2 = await callWithTimeout(
      (signal) => callCloudflareChatCompletion({
        modelId: params.modelId,
        prompt: params.prompt,
        jsonMode: false,
        maxOutputTokens: params.maxOutputTokens,
        signal
      }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp2);
    return resp2.text.trim();
  }
  const mistralModel = isMistralModelId(params.modelId) ? params.modelId : MISTRAL_PRIMARY_MODEL;
  const apiKeyOverride = params.stage && params.slot ? resolveScopedApiKeyForStage("mistral", params.stage, params.slot) || void 0 : void 0;
  const resp = await callWithTimeout(
    (signal) => callMistralChatCompletion({
      modelId: mistralModel,
      prompt: params.prompt,
      jsonMode: false,
      maxOutputTokens: params.maxOutputTokens,
      apiKeyOverride,
      signal
    }),
    params.timeoutMs
  );
  accumulateRawTokens(params.tokensOut, resp);
  return resp.text.trim();
}
async function runTaskWithRouter(params) {
  const cfg = params.config || getAuthoritativeAiConfigSnapshot();
  return executeRoutedAiTask({
    taskType: params.taskType,
    config: cfg,
    consumeOneTimeOverride: (task) => consumeOneTimeModelOverride(task, params.idToken),
    cacheInput: params.cacheInput,
    bypassCache: params.bypassCache,
    allowGroqRescue: params.allowGroqRescue,
    groqRescueModelId: params.groqRescueModelId,
    preferredPrimaryModelId: params.preferredPrimaryModelId,
    preferredFallbackModelId: params.preferredFallbackModelId,
    strictModelLock: params.strictModelLock,
    overallTimeoutMs: params.overallTimeoutMs,
    maxFallbackRetries: params.maxFallbackRetries,
    extractExecutionMeta: params.extractExecutionMeta,
    runWithModel: params.runWithModel
  });
}
var OCR_FAST_TIMEOUT_MS = 3e4;
function buildExtractedBlocksFromRawText(rawText, pageNumber, confidence) {
  return groupRawTextIntoSemanticBlocks(rawText, pageNumber, confidence);
}
var recentInlineScopeByTextHash = /* @__PURE__ */ new Map();
var lastExtractedInlineScope = null;
function getInlineScopeSuggestionForText(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;
  const hash = crypto6.createHash("sha256").update(trimmed.slice(0, 1200)).digest("hex");
  const direct = recentInlineScopeByTextHash.get(hash);
  if (direct) return direct;
  if (lastExtractedInlineScope && trimmed.includes(lastExtractedInlineScope.textPrefix)) {
    return lastExtractedInlineScope.suggestion;
  }
  return null;
}
var DocumentExtractionService = class {
  static async extractFromImageBuffers(files, tokensOut, opts) {
    const pageOffset = Math.max(0, Number(opts?.pageOffset) || 0);
    const cfg = opts?.config || getAuthoritativeAiConfigSnapshot();
    const jsonHint = '{"rawText":"...","ocrConfidence":0.95,"suggestedGrade":"10|11|12","suggestedSubject":"toan|vat_ly|hoa_hoc|sinh_hoc|ngu_van|lich_su|dia_ly|tieng_anh|tin_hoc|gdkt_pl|khac","suggestedChapters":["..."],"suggestedTitle":"..."}';
    const runVisionWithFallback = async (params) => {
      const runners = {
        groq: {
          name: "Groq",
          enabled: isGroqConfigured(),
          run: async () => {
            const apiKeyOverride = resolveScopedApiKeyForStage("groq", "QUET", params.slot) || void 0;
            const resp = await callWithTimeout(
              (signal) => callGroqChatCompletion({
                modelId: GROQ_SCAN_VISION_MODEL,
                prompt: params.prompt,
                images: [{ mimeType: params.mimeType, base64: params.base64 }],
                jsonMode: true,
                jsonSchemaHint: jsonHint,
                maxOutputTokens: 2048,
                temperature: 0,
                seed: DETERMINISTIC_GRADING_SEED,
                apiKeyOverride,
                signal
              }),
              OCR_FAST_TIMEOUT_MS
            );
            accumulateRawTokens(tokensOut, resp);
            return parseOcrResponsePayload(resp.text || "");
          }
        },
        cloudflare: {
          name: "Cloudflare",
          enabled: isCloudflareConfigured(),
          run: async () => {
            const resp = await callWithTimeout(
              (signal) => callCloudflareChatCompletion({
                modelId: CF_VISION_MODEL,
                prompt: params.prompt,
                images: [{ mimeType: params.mimeType, base64: params.base64 }],
                jsonMode: true,
                jsonSchemaHint: jsonHint,
                maxOutputTokens: 2048,
                temperature: 0,
                seed: DETERMINISTIC_GRADING_SEED,
                signal
              }),
              OCR_FAST_TIMEOUT_MS
            );
            accumulateRawTokens(tokensOut, resp);
            return parseOcrResponsePayload(resp.text || "");
          }
        },
        mistral: {
          name: "Mistral",
          enabled: isMistralConfigured(),
          run: async () => {
            const apiKeyOverride = resolveScopedApiKeyForStage("mistral", "QUET", params.slot) || void 0;
            const resp = await callWithTimeout(
              (signal) => callMistralChatCompletion({
                modelId: MISTRAL_VISION_MODEL,
                prompt: params.prompt,
                images: [{ mimeType: params.mimeType, base64: params.base64 }],
                jsonMode: true,
                jsonSchemaHint: jsonHint,
                maxOutputTokens: 2048,
                temperature: 0,
                seed: DETERMINISTIC_GRADING_SEED,
                apiKeyOverride,
                signal
              }),
              OCR_FAST_TIMEOUT_MS
            );
            accumulateRawTokens(tokensOut, resp);
            return parseOcrResponsePayload(resp.text || "");
          }
        }
      };
      let firstVisionError = null;
      const errorSummary = [];
      for (const providerKey of params.order) {
        const provider = runners[providerKey];
        if (!provider.enabled) continue;
        try {
          return await provider.run();
        } catch (err) {
          if (!firstVisionError) firstVisionError = err;
          const msg = err instanceof Error ? err.message : String(err);
          errorSummary.push(`${provider.name}: ${msg.slice(0, 320)}`);
        }
      }
      if (errorSummary.length > 1) {
        throw new Error(errorSummary.join(" | "));
      }
      if (firstVisionError) {
        throw firstVisionError;
      }
      return await runners[params.order[0]].run();
    };
    const pass1Results = await Promise.all(
      files.map(async (file, idx) => {
        const pageNum = pageOffset + idx + 1;
        const contentHash = crypto6.createHash("sha256").update(file.buffer).digest("hex");
        const base64 = file.buffer.toString("base64");
        const { data: parsed } = await runTaskWithRouter({
          taskType: "curriculum_extraction",
          config: cfg,
          idToken: opts?.idToken,
          preferredPrimaryModelId: GROQ_SCAN_VISION_MODEL,
          preferredFallbackModelId: CF_VISION_MODEL,
          allowGroqRescue: true,
          groqRescueModelId: GROQ_SCAN_VISION_MODEL,
          cacheInput: { ocrKind: "image_fast_v4_3provider", mimeType: file.mimeType, sha256: contentHash },
          runWithModel: async (modelId) => {
            const ocrPrompt = [
              "\u0110\u1ECDc OCR to\xE0n b\u1ED9 v\u0103n b\u1EA3n, c\xF4ng th\u1EE9c v\xE0 ch\u1EEF vi\u1EBFt tay trong trang \u1EA3nh n\xE0y.",
              "- Gi\u1EEF nguy\xEAn 100% ch\xEDnh t\u1EA3 v\xE0 c\xF4ng th\u1EE9c g\u1ED1c c\u1EE7a h\u1ECDc sinh theo t\u1EEBng d\xF2ng xu\u1ED1ng h\xE0ng (\\n), KH\xD4NG t\u1EF1 s\u1EEDa l\u1ED7i ki\u1EBFn th\u1EE9c, KH\xD4NG b\xECnh lu\u1EADn.",
              "- Ch\u1EA5m \u0111\u1ED9 r\xF5 n\xE9t ch\u1EEF vi\u1EBFt ocrConfidence (0.0-1.0; n\u1EBFu m\u1EDD/kh\xF3 \u0111\u1ECDc \u0111\u1EB7t < 0.65).",
              '- Nh\u1EADn di\u1EC7n lu\xF4n l\u1EDBp ("10"|"11"|"12"), m\xF4n h\u1ECDc THPT, t\xEAn ch\u01B0\u01A1ng v\xE0 ti\xEAu \u0111\u1EC1 b\xE0i ghi.'
            ].join("\n");
            const order = isCloudflareModelId(modelId) ? ["cloudflare", "groq", "mistral"] : isMistralModelId(modelId) ? ["mistral", "groq", "cloudflare"] : ["groq", "cloudflare", "mistral"];
            return runVisionWithFallback({
              base64,
              mimeType: file.mimeType,
              prompt: ocrPrompt,
              order,
              slot: 1
            });
          }
        });
        let rawText = (parsed.rawText || "").trim();
        let avgConf = Math.max(0.1, Math.min(1, Number(parsed.ocrConfidence) || 0.9));
        if (!rawText && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
          rawText = parsed.blocks.map((b) => (b.extractedText || "").trim()).filter(Boolean).join("\n");
        }
        return {
          file,
          base64,
          contentHash,
          pageNum,
          parsed,
          rawText,
          avgConf
        };
      })
    );
    const combinedPass1Length = computeNormalizedTextLength(
      pass1Results.map((r) => ({ rawText: r.rawText }))
    );
    const scanPlan = computeAdaptiveApiPlan(
      combinedPass1Length,
      cfg.adaptiveLongTextThresholdChars
    );
    const refinedResults = scanPlan.isLongText ? await Promise.all(
      pass1Results.map(async (item) => {
        if (!item.rawText || item.rawText.length < 40) {
          return item;
        }
        try {
          const refinePrompt = [
            "\u0110\u1ECDc \u0111\u1ED1i chi\u1EBFu l\u1EA1i to\xE0n b\u1ED9 trang \u1EA3nh (Pass 2) \u0111\u1EC3 ph\u1EE5c h\u1ED3i c\xE1c d\xF2ng b\u1ECB s\xF3t, c\xF4ng th\u1EE9c to\xE1n/l\xFD/h\xF3a, ch\u1EC9 s\u1ED1 d\u01B0\u1EDBi/tr\xEAn, ph\xE2n s\u1ED1, \u0111\u01A1n v\u1ECB \u0111o v\xE0 d\u1EA5u c\xE2u so v\u1EDBi b\u1EA3n nh\xE1p Pass 1 b\xEAn d\u01B0\u1EDBi.",
            "- GI\u1EEE NGUY\xCAN 100% l\u1ED7i ki\u1EBFn th\u1EE9c g\u1ED1c c\u1EE7a h\u1ECDc sinh (KH\xD4NG t\u1EF1 s\u1EEDa sai n\u1ED9i dung h\u1ECDc thu\u1EADt), ch\u1EC9 kh\xF4i ph\u1EE5c ch\xEDnh x\xE1c nh\u1EEFng g\xEC th\u1EF1c s\u1EF1 xu\u1EA5t hi\u1EC7n tr\xEAn \u1EA3nh.",
            '- Tr\u1EA3 v\u1EC1 to\xE0n b\u1ED9 v\u0103n b\u1EA3n \u0111\u1EA7y \u0111\u1EE7 c\u1EE7a trang trong tr\u01B0\u1EDDng "rawText" (kh\xF4ng b\u1ECF b\u1EDBt c\xE1c \u0111o\u1EA1n \u0111\xE3 \u0111\u1ECDc \u0111\xFAng \u1EDF Pass 1).',
            "",
            "=== B\u1EA2N NH\xC1P PASS 1 ===",
            item.rawText.slice(0, 6e3)
          ].join("\n");
          const pass2Parsed = await runVisionWithFallback({
            base64: item.base64,
            mimeType: item.file.mimeType,
            prompt: refinePrompt,
            order: ["cloudflare", "mistral", "groq"],
            slot: 2
          });
          const pass2Text = (pass2Parsed.rawText || "").trim();
          if (pass2Text.length >= item.rawText.length * 0.65) {
            const refinedConf = Math.max(
              item.avgConf,
              Math.max(0.1, Math.min(1, Number(pass2Parsed.ocrConfidence) || item.avgConf))
            );
            return {
              ...item,
              rawText: pass2Text,
              avgConf: refinedConf,
              parsed: {
                ...item.parsed,
                rawText: pass2Text,
                ocrConfidence: refinedConf
              }
            };
          }
        } catch (pass2Err) {
          console.warn(`Adaptive OCR Pass 2 non-fatal fallback on page ${item.pageNum}:`, pass2Err);
        }
        return item;
      })
    ) : pass1Results;
    const pages = refinedResults.map((item) => {
      const blocks = buildExtractedBlocksFromRawText(item.rawText, item.pageNum, item.avgConf);
      const finalConf = blocks.length > 0 ? item.avgConf : 0;
      if (item.rawText && item.parsed.suggestedSubject) {
        const grade = item.parsed.suggestedGrade === "11" || item.parsed.suggestedGrade === "12" ? item.parsed.suggestedGrade : "10";
        const subject = item.parsed.suggestedSubject in SUBJECT_LABELS ? item.parsed.suggestedSubject : "khac";
        const textHash = crypto6.createHash("sha256").update(item.rawText.slice(0, 1200)).digest("hex");
        const suggestionObj = {
          suggestedGrade: grade,
          suggestedSubject: subject,
          suggestedChapters: Array.isArray(item.parsed.suggestedChapters) ? item.parsed.suggestedChapters.slice(0, 4) : [],
          suggestedTitle: (item.parsed.suggestedTitle || "").trim() || item.file.originalName.replace(/\.[^.]+$/, "") || "T\xE0i li\u1EC7u \xF4n t\u1EADp"
        };
        recentInlineScopeByTextHash.set(textHash, suggestionObj);
        lastExtractedInlineScope = {
          textPrefix: item.rawText.slice(0, 160),
          suggestion: suggestionObj
        };
        if (recentInlineScopeByTextHash.size > 100) {
          const oldestKey = recentInlineScopeByTextHash.keys().next().value;
          if (oldestKey) recentInlineScopeByTextHash.delete(oldestKey);
        }
      }
      return {
        pageNumber: item.pageNum,
        rawText: item.rawText,
        blocks,
        ocrAverageConfidence: finalConf
      };
    });
    return pages.sort((a, b) => a.pageNumber - b.pageNumber);
  }
  static async extractFromPdfBuffer(buffer, _tokensOut, _opts) {
    try {
      const { extractPdfPagesFromBuffer: extractPdfPagesFromBuffer2 } = await Promise.resolve().then(() => (init_referenceIngestService(), referenceIngestService_exports));
      const textPages = await extractPdfPagesFromBuffer2(buffer);
      const totalChars = textPages.reduce((sum, p) => sum + p.text.trim().length, 0);
      if (totalChars >= 12) {
        return textPages.map((p) => {
          const blocks = buildExtractedBlocksFromRawText(p.text, p.pageNumber, 0.98);
          return {
            pageNumber: p.pageNumber,
            rawText: p.text,
            blocks,
            ocrAverageConfidence: 0.98
          };
        });
      }
    } catch {
    }
    throw new Error(
      "T\u1EC7p PDF n\xE0y l\xE0 b\u1EA3n scan \u1EA3nh (kh\xF4ng c\xF3 l\u1EDBp v\u0103n b\u1EA3n nh\xFAng). Vui l\xF2ng ch\u1EE5p ho\u1EB7c xu\u1EA5t t\u1EEBng trang sang \u1EA3nh JPG/PNG/WEBP (ho\u1EB7c d\xF9ng t\u1EC7p PDF/DOCX c\xF3 ch\u1EEF ch\u1ECDn \u0111\u01B0\u1EE3c) \u0111\u1EC3 h\u1EC7 th\u1ED1ng OCR \u0111a m\xF4 h\xECnh (Groq / Cloudflare / Mistral Vision) qu\xE9t ch\xEDnh x\xE1c h\u01A1n."
    );
  }
  static async extractFromDocxBuffer(buffer) {
    let raw = "";
    try {
      const mammothMod = await import("mammoth");
      const mammothApi = mammothMod.default || mammothMod;
      const result = await mammothApi.extractRawText({ buffer });
      raw = (result.value || "").trim();
    } catch (docxErr) {
      const detail = docxErr instanceof Error ? docxErr.message : String(docxErr);
      throw new Error(
        `Kh\xF4ng th\u1EC3 \u0111\u1ECDc c\u1EA5u tr\xFAc t\u1EC7p Word (.docx). Vui l\xF2ng l\u01B0u l\u1EA1i d\u01B0\u1EDBi \u0111\u1ECBnh d\u1EA1ng .docx chu\u1EA9n ho\u1EB7c xu\u1EA5t sang PDF/\u1EA3nh r\u1ED3i t\u1EA3i l\xEAn l\u1EA1i. (${detail.slice(0, 90)})`
      );
    }
    if (!raw) {
      throw new Error("File DOCX kh\xF4ng c\xF3 v\u0103n b\u1EA3n \u0111\u1ECDc \u0111\u01B0\u1EE3c (c\xF3 th\u1EC3 ch\u1EC9 ch\u1EE9a \u1EA3nh ch\u1EE5p b\xEAn trong). H\xE3y l\u01B0u th\xE0nh PDF/\u1EA3nh v\xE0 t\u1EA3i l\xEAn l\u1EA1i.");
    }
    const paragraphs = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const pageSize = 18;
    const pages = [];
    for (let i = 0; i < paragraphs.length; i += pageSize) {
      const pageNum = Math.floor(i / pageSize) + 1;
      const slice = paragraphs.slice(i, i + pageSize);
      const rawSlice = slice.join("\n");
      const blocks = buildExtractedBlocksFromRawText(rawSlice, pageNum, 0.99);
      pages.push({
        pageNumber: pageNum,
        rawText: rawSlice,
        blocks,
        ocrAverageConfidence: 0.99
      });
    }
    return pages;
  }
};
var SubjectDetectionService = class {
  static async detectScope(sampleText, tokensOut, opts) {
    const inlineCached = getInlineScopeSuggestionForText(sampleText);
    if (inlineCached) {
      return inlineCached;
    }
    const scopePrompt = [
      "Ph\xE2n t\xEDch \u0111o\u1EA1n ghi ch\xE9p h\u1ECDc t\u1EADp sau \u0111\u1EC3 x\xE1c \u0111\u1ECBnh \u0110\xDANG l\u1EDBp (10, 11 ho\u1EB7c 12), m\xF4n h\u1ECDc THPT, ti\xEAu \u0111\u1EC1 ng\u1EAFn v\xE0 t\u1ED1i \u0111a 3 ch\u01B0\u01A1ng/ch\u1EE7 \u0111\u1EC1 ph\xF9 h\u1EE3p.",
      'L\u01AFU \xDD QUAN TR\u1ECCNG: X\xE1c \u0111\u1ECBnh ch\u1EE7 \u0111\u1EC1 d\u1EF1a tr\xEAn KH\xC1I NI\u1EC6M/\u0110\u1ED0I T\u01AF\u1EE2NG CH\xCDNH m\xE0 t\xE0i li\u1EC7u \u0111ang tr\xECnh b\xE0y ho\u1EB7c \u0111\u1ECBnh ngh\u0129a (v\xED d\u1EE5: n\u1EBFu \u0111o\u1EA1n v\u0103n vi\u1EBFt "Chuy\u1EC3n \u0111\u1ED9ng th\u1EB3ng \u0111\u1EC1u l\xE0..." nh\u01B0ng h\u1ECDc sinh vi\u1EBFt nh\u1EA7m chi ti\u1EBFt b\xEAn trong th\xE0nh "t\u1ED1c \u0111\u1ED9 thay \u0111\u1ED5i", ch\u1EE7 \u0111\u1EC1 V\u1EAAN L\xC0 "Chuy\u1EC3n \u0111\u1ED9ng th\u1EB3ng \u0111\u1EC1u", TUY\u1EC6T \u0110\u1ED0I KH\xD4NG b\u1ECB l\u1ED7i sai c\u1EE7a h\u1ECDc sinh \u0111\xE1nh l\u1EEBa sang ch\u01B0\u01A1ng kh\xE1c nh\u01B0 "Chuy\u1EC3n \u0111\u1ED9ng bi\u1EBFn \u0111\u1ED5i").',
      "",
      sampleText.slice(0, 1800)
    ].join("\n");
    const heuristicFallback = inferScopeFromContentHeuristic(sampleText);
    try {
      const { data: parsed } = await callWithTimeout(
        () => runTaskWithRouter({
          taskType: "subject_classification",
          config: opts?.config,
          idToken: opts?.idToken,
          allowGroqRescue: false,
          overallTimeoutMs: 7e3,
          maxFallbackRetries: 0,
          cacheInput: { sample: sampleText.slice(0, 1500), rev: "v4_3provider_topic_strict" },
          runWithModel: async (modelId) => generateJsonWithProvider({
            modelId,
            prompt: scopePrompt,
            thinkingTier: "minimal",
            maxOutputTokens: 320,
            timeoutMs: 5e3,
            tokensOut,
            fallbackJson: "{}",
            groqSchemaHint: '{"suggestedGrade":"10|11|12","suggestedSubject":"toan|vat_ly|hoa_hoc|sinh_hoc|ngu_van|lich_su|dia_ly|tieng_anh|tin_hoc|gdkt_pl|khac","suggestedChapters":["..."],"suggestedTitle":"..."}'
          })
        }),
        7500
      );
      const grade = parsed.suggestedGrade === "11" || parsed.suggestedGrade === "12" ? parsed.suggestedGrade : parsed.suggestedGrade === "10" ? "10" : heuristicFallback.suggestedGrade;
      const subject = parsed.suggestedSubject && parsed.suggestedSubject in SUBJECT_LABELS ? parsed.suggestedSubject : heuristicFallback.suggestedSubject;
      return {
        suggestedGrade: grade,
        suggestedSubject: subject,
        suggestedChapters: Array.isArray(parsed.suggestedChapters) && parsed.suggestedChapters.length > 0 ? parsed.suggestedChapters.slice(0, 5) : heuristicFallback.suggestedChapters,
        suggestedTitle: parsed.suggestedTitle?.trim() || heuristicFallback.suggestedTitle
      };
    } catch {
      return heuristicFallback;
    }
  }
};
var KnowledgeAnalysisService = class {
  static async runFullVerification(params) {
    const {
      pages,
      grade,
      subject,
      textbookReferenceId,
      textbookTitle,
      selectedChapters,
      scope,
      referenceChunks,
      enableWebGrounding,
      strictModelLock = false,
      ocrConfirmed = false,
      ocrTextHash: providedOcrTextHash,
      tokensOut,
      config,
      idToken
    } = params;
    const effectiveConfig = config || getAuthoritativeAiConfigSnapshot();
    const subjectName = SUBJECT_LABELS[subject];
    const formattedStudentBlocks = pages.map((p) => {
      const blocksStr = p.blocks.map(
        (b) => `[blockId=${b.blockId} | page=${p.pageNumber} | ocrConf=${ocrConfirmed ? Math.max(b.confidence, 0.95) : b.confidence}] ${b.extractedText}`
      ).join("\n");
      return `--- TRANG ${p.pageNumber} ---
${blocksStr}`;
    }).join("\n\n");
    const fullText = pages.map((p) => p.rawText).join("\n").normalize("NFC");
    const normalizedTextLength = computeNormalizedTextLength(pages);
    const adaptivePlan = computeAdaptiveApiPlan(
      normalizedTextLength,
      effectiveConfig.adaptiveLongTextThresholdChars
    );
    const computedOcrTextHash = crypto6.createHash("sha256").update(fullText, "utf8").digest("hex").slice(0, 24);
    const ocrTextHash = (providedOcrTextHash || "").trim() || computedOcrTextHash;
    const retrievedHits = retrieveRelevantChunks(fullText, referenceChunks, {
      referenceId: textbookReferenceId || void 0,
      selectedChapters: selectedChapters.length > 0 ? selectedChapters : void 0,
      topK: 16
    });
    const retrievedChunks = retrievedHits.map((h) => h.chunk);
    const sortedChunkIds = retrievedChunks.map((c) => c.chunkId).sort();
    const fixedRubric = buildFixedRubricFromChunks({
      chunks: retrievedChunks,
      subject,
      grade,
      textbookReferenceId,
      textbookTitle,
      selectedChapters,
      maxCriteria: 24
    });
    const hasIndexedTextbookChunks = retrievedHits.length > 0;
    const rubricMode = fixedRubric.criteria.length > 0 ? "fixed_textbook_rubric" : selectedChapters.length > 0 || scope.trim().length > 0 ? "scope_guided" : "unscoped";
    const textbookContext = retrievedHits.length > 0 ? retrievedHits.map(
      (h) => `[chunkId=${h.chunk.chunkId} | Trang ${h.chunk.pageNumber} | ${h.chunk.chapter} - ${h.chunk.lesson} | ${h.chunk.sectionTitle}]
${h.chunk.content}`
    ).join("\n\n") : "Kh\xF4ng c\xF3 \u0111o\u1EA1n tr\xEDch s\xE1ch gi\xE1o khoa \u0111\u01B0\u1EE3c l\u1EADp ch\u1EC9 m\u1EE5c trong kho tham chi\u1EBFu cho ph\u1EA1m vi n\xE0y.";
    const webSources = [];
    const usedWebGrounding = false;
    const webGroundingNotice = enableWebGrounding === true ? "H\u1EC7 th\u1ED1ng ki\u1EC3m \u0111\u1ECBnh v\u1EADn h\xE0nh tr\xEAn c\u1EE5m 3 nh\xE0 cung c\u1EA5p AI \u0111\u1ED9c l\u1EADp (Mistral AI, Cloudflare Workers AI, Groq) v\xE0 \u0111\u1ED1i chi\u1EBFu tr\u1EF1c ti\u1EBFp v\u1EDBi kho s\xE1ch gi\xE1o khoa tham chi\u1EBFu & chu\u1EA9n GDPT 2018." : void 0;
    const studentTruncated = formattedStudentBlocks.length > MAX_STUDENT_GRADING_CHARS;
    const textbookTruncated = textbookContext.length > MAX_TEXTBOOK_GRADING_CHARS;
    const truncationApplied = studentTruncated || textbookTruncated;
    const studentSlice = formattedStudentBlocks.slice(0, MAX_STUDENT_GRADING_CHARS);
    const textbookSlice = textbookContext.slice(0, MAX_TEXTBOOK_GRADING_CHARS);
    const rubricSection = rubricMode === "fixed_textbook_rubric" ? [
      "=== RUBRIC KI\u1EC2M \u0110\u1ECANH \u0110\u1ED8 \u0110\u1EA6Y \u0110\u1EE6 C\u1ED0 \u0110\u1ECANH (\u0110\xC3 KH\xD3A TR\u01AF\u1EDAC KHI CH\u1EA4M) ===",
      formatFixedRubricForPrompt(fixedRubric),
      ""
    ].join("\n") : "";
    const coverageInstruction = rubricMode === "fixed_textbook_rubric" ? `- \u0110\xC1NH GI\xC1 \u0110\u1ED8 \u0110\u1EA6Y \u0110\u1EE6 (coverageItems): B\u1EAET BU\u1ED8C ch\u1EA5m \u0111\u1EE7 T\u1EA4T C\u1EA2 ${fixedRubric.criteria.length} ti\xEAu ch\xED KT01..KT${String(fixedRubric.criteria.length).padStart(2, "0")} t\u1EEB b\u1EA3ng Rubric c\u1ED1 \u0111\u1ECBnh b\xEAn d\u01B0\u1EDBi. Ghi \u0111\xFAng tr\u01B0\u1EDDng "criterionId", gi\u1EEF nguy\xEAn "importanceWeight" c\u1EE7a rubric, tr\xEDch d\u1EABn \u0111\xFAng "matchedChunkId" & "referenceExcerpt". KH\xD4NG gi\u1EDBi h\u1EA1n 10 \xFD v\xE0 KH\xD4NG b\u1ECF s\xF3t ti\xEAu ch\xED n\xE0o.` : rubricMode === "scope_guided" ? "- \u0110\xC1NH GI\xC1 \u0110\u1ED8 \u0110\u1EA6Y \u0110\u1EE6 (coverageItems): \u0110\xE1nh gi\xE1 \u0111\u1EA7y \u0111\u1EE7 c\xE1c \xFD tr\u1ECDng t\xE2m theo ph\u1EA1m vi ch\u01B0\u01A1ng \u0111\xE3 ch\u1ECDn (kh\xF4ng t\u1EF1 c\u1EAFt ng\u1EAFn khi t\xE0i li\u1EC7u d\xE0i), ph\xE2n lo\u1EA1i r\xF5 COVERED / PARTIALLY_COVERED / MISSING." : "- Kh\xF4ng c\xF3 SGK hay ph\u1EA1m vi ch\u01B0\u01A1ng c\u1ED1 \u0111\u1ECBnh: ch\u1EC9 ghi nh\u1EADn c\xE1c thi\u1EBFu s\xF3t tr\u1EF1c ti\u1EBFp trong b\xE0i vi\u1EBFt (nh\u01B0 thi\u1EBFu ch\xFA th\xEDch k\xFD hi\u1EC7u/\u0111\u01A1n v\u1ECB c\u1EE7a c\xF4ng th\u1EE9c) n\u1EBFu th\u1EF1c s\u1EF1 t\u1ED3n t\u1EA1i.";
    const buildGradingPrompt = (studentBodyText, partNote) => [
      "B\u1EA1n l\xE0 chuy\xEAn gia ki\u1EC3m \u0111\u1ECBnh ki\u1EBFn th\u1EE9c gi\xE1o d\u1EE5c THPT Vi\u1EC7t Nam c\u1EE7a StudyCheck AI. H\xE3y ch\u1EA5m c\u1EF1c k\u1EF3 ch\xEDnh x\xE1c, ch\u1EB7t ch\u1EBD, nh\u1EA5t qu\xE1n tuy\u1EC7t \u0111\u1ED1i gi\u1EEFa tr\u1EA1ng th\xE1i, l\u1EDDi gi\u1EA3i th\xEDch v\xE0 \u0111\xE1p \xE1n s\u1EEDa chu\u1EA9n.",
      `M\xF4n h\u1ECDc: ${subjectName} | L\u1EDBp: ${grade} | S\xE1ch tham chi\u1EBFu: ${textbookTitle || "Chu\u1EA9n ch\u01B0\u01A1ng tr\xECnh GDPT 2018 & ki\u1EBFn th\u1EE9c khoa h\u1ECDc ph\u1ED5 th\xF4ng"} | Ph\u1EA1m vi: ${scope || selectedChapters.join(", ") || "Theo \u0111\xFAng ch\u1EE7 \u0111\u1EC1 ch\xEDnh trong t\xE0i li\u1EC7u"}`,
      partNote ? `PH\u1EA0M VI PH\u1EA6N \u0110ANG CH\u1EA4M: ${partNote}` : "",
      "",
      "NGU\u1ED2N C\u0102N C\u1EE8 \u0110\u1ED0I CHI\u1EBEU:",
      hasIndexedTextbookChunks ? "- \u01AFu ti\xEAn \u0111\u1ED1i chi\u1EBFu tr\u1EF1c ti\u1EBFp c\xE1c \u0111o\u1EA1n tr\xEDch SGK b\xEAn d\u01B0\u1EDBi v\xE0 g\u1EAFn \u0111\xFAng matchedChunkId, matchedPage. V\u1EDBi ki\u1EBFn th\u1EE9c khoa h\u1ECDc ph\u1ED5 th\xF4ng kh\xF4ng xu\u1EA5t hi\u1EC7n tr\u1EF1c ti\u1EBFp trong \u0111o\u1EA1n tr\xEDch nh\u01B0ng thu\u1ED9c chu\u1EA9n GDPT 2018, v\u1EABn ki\u1EC3m \u0111\u1ECBnh chu\u1EA9n x\xE1c theo khoa h\u1ECDc ph\u1ED5 th\xF4ng." : '- Hi\u1EC7n ch\u01B0a c\xF3 \u0111o\u1EA1n tr\xEDch SGK trong kho cho b\xE0i n\xE0y. B\u1EAET BU\u1ED8C d\xF9ng chu\u1EA9n ki\u1EBFn th\u1EE9c khoa h\u1ECDc ch\xEDnh th\u1ED1ng v\xE0 ch\u01B0\u01A1ng tr\xECnh GDPT 2018 c\u1EE7a B\u1ED9 GD&\u0110T \u0111\u1EC3 ki\u1EC3m \u0111\u1ECBnh d\u1EE9t kho\xE1t m\u1ECDi \u0111\u1ECBnh ngh\u0129a, \u0111\u1ECBnh lu\u1EADt, c\xF4ng th\u1EE9c, t\xEDnh ch\u1EA5t v\xE0 \u0111\u01A1n v\u1ECB \u0111o. TUY\u1EC6T \u0110\u1ED0I KH\xD4NG \u0111\xE1nh UNVERIFIED v\u1EDBi l\u1ED7i sai ki\u1EBFn th\u1EE9c hay sai c\xF4ng th\u1EE9c ph\u1ED5 th\xF4ng r\xF5 r\xE0ng (v\xED d\u1EE5: sai "t\u1ED1c \u0111\u1ED9 thay \u0111\u1ED5i" trong chuy\u1EC3n \u0111\u1ED9ng th\u1EB3ng \u0111\u1EC1u, sai "t\u1EC9 l\u1EC7 ngh\u1ECBch", sai ph\xE9p to\xE1n "s = v + t").',
      "",
      "QUY TR\xCCNH KI\u1EC2M \u0110\u1ECANH 4 L\u1EDAP B\u1EAET BU\u1ED8C:",
      "L\u1EDAP 1 \u2014 T\xC1CH M\u1EC6NH \u0110\u1EC0 NG\u1EEE NGH\u0128A & C\u1EA4M CH\u1EA4M TI\xCAU \u0110\u1EC0 D\u1EAAN NH\u1EACP:",
      '- T\xE1ch t\xE0i li\u1EC7u h\u1ECDc sinh th\xE0nh t\u1EEBng \u0111\u01A1n v\u1ECB ki\u1EBFn th\u1EE9c \u0111\u1ED9c l\u1EADp theo \u0111\xFAng t\u1EEBng c\xE2u, t\u1EEBng c\u1EE5m c\xF4ng th\u1EE9c (nh\xE3n d\u1EABn nh\u1EADp + c\xF4ng th\u1EE9c) v\xE0 t\u1EEBng c\u1EE5m gi\u1EA3i th\xEDch "Trong \u0111\xF3: ..." (kh\xF4ng g\u1ED9p nhi\u1EC1u l\u1ED7i kh\xE1c nhau v\xE0o chung 1 claim).',
      '- TUY\u1EC6T \u0110\u1ED0I KH\xD4NG t\u1EA1o claim \u0111\u1ED9c l\u1EADp cho d\xF2ng nh\xE3n d\u1EABn nh\u1EADp / ti\xEAu \u0111\u1EC1 ng\u1EAFn k\u1EBFt th\xFAc b\u1EB1ng d\u1EA5u hai ch\u1EA5m (v\xED d\u1EE5: "C\xF4ng th\u1EE9c t\xEDnh qu\xE3ng \u0111\u01B0\u1EDDng:", "Ph\u01B0\u01A1ng tr\xECnh chuy\u1EC3n \u0111\u1ED9ng th\u1EB3ng \u0111\u1EC1u:", "Trong \u0111\xF3:", "\u0110\u1ECBnh ngh\u0129a:"). H\xE3y gi\u1EEF nh\xE3n d\u1EABn nh\u1EADp g\u1EAFn li\u1EC1n v\u1EDBi c\xF4ng th\u1EE9c ho\u1EB7c n\u1ED9i dung ph\xEDa sau th\xE0nh 1 claim duy nh\u1EA5t \u0111\u1EC3 kh\xF4ng b\u01A1m \u0111i\u1EC3m Ch\xEDnh x\xE1c \u1EA3o.',
      '- Ki\u1EC3m tra k\u1EF9 m\u1ECDi t\u1EEB kh\xF3a mang t\xEDnh b\u1EA3n ch\u1EA5t: "kh\xF4ng \u0111\u1ED5i" vs "thay \u0111\u1ED5i", "t\u1EC9 l\u1EC7 thu\u1EADn" vs "t\u1EC9 l\u1EC7 ngh\u1ECBch", "t\u0103ng" vs "gi\u1EA3m", "c\xF9ng chi\u1EC1u" vs "ng\u01B0\u1EE3c chi\u1EC1u", "b\u1EA3o to\xE0n" vs "kh\xF4ng b\u1EA3o to\xE0n", \u0111i\u1EC1u ki\u1EC7n \xE1p d\u1EE5ng.',
      "- \u0110\u1ED1i chi\u1EBFu theo ngh\u0129a h\u1ECDc thu\u1EADt (kh\xF4ng b\u1EAFt b\u1EBB c\xE1ch di\u1EC5n \u0111\u1EA1t t\u01B0\u01A1ng \u0111\u01B0\u01A1ng n\u1EBFu \u0111\xFAng b\u1EA3n ch\u1EA5t).",
      "",
      "L\u1EDAP 2 \u2014 SOI T\u1EEANG C\xD4NG TH\u1EE8C, PH\xC9P TO\xC1N & TR\xCDCH CH\xCDNH X\xC1C C\u1EE4M SAI (errorSpan):",
      "- Ki\u1EC3m tra t\u1EEBng d\u1EA5u ph\xE9p to\xE1n (+, -, \xD7, ., /, ^), d\u1EA5u \xE2m/d\u01B0\u01A1ng, h\u1EC7 s\u1ED1, ch\u1EC9 s\u1ED1 d\u01B0\u1EDBi v\xE0 ki\u1EC3m tra th\u1EE9 nguy\xEAn v\u1EADt l\xFD/to\xE1n h\u1ECDc (v\xED d\u1EE5: v [m/s] kh\xF4ng th\u1EC3 c\u1ED9ng v\u1EDBi t [s] trong s = v + t; c\xF4ng th\u1EE9c \u0111\xFAng ph\u1EA3i l\xE0 s = v.t).",
      '- T\xE1ch ri\xEAng claim cho c\u1EE5m c\xF4ng th\u1EE9c v\xE0 claim cho c\u1EE5m ch\xFA th\xEDch "Trong \u0111\xF3: ..." \u0111i k\xE8m \u0111\u1EC3 ph\xE2n bi\u1EC7t r\xF5: c\xF4ng th\u1EE9c \u0111\xFAng nh\u01B0ng thi\u1EBFu gi\u1EA3i th\xEDch bi\u1EBFn s\u1ED1 kh\xE1c v\u1EDBi c\xF4ng th\u1EE9c vi\u1EBFt sai.',
      '- V\u1EDBi M\u1ECCI claim c\xF3 tr\u1EA1ng th\xE1i INCORRECT ho\u1EB7c PARTIALLY_CORRECT: B\u1EAET BU\u1ED8C \u0111i\u1EC1n tr\u01B0\u1EDDng "errorSpan" tr\xEDch NGUY\xCAN V\u0102N c\u1EE5m t\u1EEB/v\u1EBF/c\xF4ng th\u1EE9c b\u1ECB sai ho\u1EB7c thi\u1EBFu b\xEAn trong sourceText (v\xED d\u1EE5: "t\u1ED1c \u0111\u1ED9 thay \u0111\u1ED5i theo th\u1EDDi gian", "t\u1EC9 l\u1EC7 ngh\u1ECBch", "s = v + t") \u0111\u1EC3 h\u1EC7 th\u1ED1ng g\u1EA1ch ch\xE2n/t\xF4 \u0111\u1ECF ch\xEDnh x\xE1c v\u1ECB tr\xED l\u1ED7i, v\xE0 \u0111i\u1EC1n tr\u01B0\u1EDDng "shortFix" (1 c\xE2u th\u1EADt ng\u1EAFn g\u1ECDn, tr\u1EF1c di\u1EC7n c\xE1ch s\u1EEDa nhanh, t\u1ED1i \u0111a 15\u201320 t\u1EEB).',
      "",
      "L\u1EDAP 3 \u2014 KI\u1EC2M TRA \u0110\u1ED8 \u0110\u1EA6Y \u0110\u1EE6 CH\xDA TH\xCDCH K\xDD HI\u1EC6U & \u0110\u01A0N V\u1ECA C\u1EE6A M\u1ECCI C\xD4NG TH\u1EE8C:",
      '- V\u1EDBi M\u1ECCI c\xF4ng th\u1EE9c xu\u1EA5t hi\u1EC7n trong t\xE0i li\u1EC7u (v\xED d\u1EE5 s = v.t, x = x0 + v.t, F = m.a...), li\u1EC7t k\xEA T\u1EA4T C\u1EA2 c\xE1c k\xFD hi\u1EC7u/bi\u1EBFn s\u1ED1 c\xF3 m\u1EB7t trong c\xF4ng th\u1EE9c \u0111\xF3 v\xE0 \u0111\u1ED1i chi\u1EBFu v\u1EDBi c\u1EE5m ch\xFA th\xEDch ("Trong \u0111\xF3: ...") ngay k\u1EBF ti\u1EBFp.',
      "- N\u1EBFu h\u1ECDc sinh B\u1ECE S\xD3T gi\u1EA3i th\xEDch \xFD ngh\u0129a HO\u1EB6C thi\u1EBFu \u0111\u01A1n v\u1ECB \u0111o c\u1EE7a b\u1EA5t k\u1EF3 k\xFD hi\u1EC7u n\xE0o:",
      "  + \u0110\xE1nh gi\xE1 c\u1EE5m ch\xFA th\xEDch \u0111\xF3 l\xE0 PARTIALLY_CORRECT (Thi\u1EBFu th\xF4ng tin / \u0110i\u1EC1u ki\u1EC7n), n\xEAu \u0110\xCDCH DANH k\xFD hi\u1EC7u v\xE0 \u0111\u01A1n v\u1ECB c\xF2n thi\u1EBFu trong explanation, ghi r\xF5 c\xE1ch b\u1ED5 sung ng\u1EAFn g\u1ECDn trong shortFix v\xE0 tr\u1ECDn b\u1ED9 ch\xFA th\xEDch \u0111\u1EA7y \u0111\u1EE7 trong suggestedFix.",
      '  + Ghi nh\u1EADn thi\u1EBFu s\xF3t t\u01B0\u01A1ng \u1EE9ng v\xE0o weaknesses \u0111\u1EC3 hi\u1EC3n th\u1ECB r\xF5 trong danh s\xE1ch "Thi\u1EBFu th\xF4ng tin".',
      "",
      "L\u1EDAP 4 \u2014 T\u1EF0 KI\u1EC2M CH\xC9O NH\u1EA4T QU\xC1N TR\u01AF\u1EDAC KHI TR\u1EA2 K\u1EBET QU\u1EA2:",
      "- Ph\xE2n lo\u1EA1i tr\u1EA1ng th\xE1i chu\u1EA9n:",
      "  + CORRECT: ho\xE0n to\xE0n \u0111\xFAng b\u1EA3n ch\u1EA5t, kh\xF4ng thi\u1EBFu k\xFD hi\u1EC7u hay \u0111i\u1EC1u ki\u1EC7n quan tr\u1ECDng.",
      "  + INCORRECT: sai b\u1EA3n ch\u1EA5t ki\u1EBFn th\u1EE9c, sai quan h\u1EC7, sai c\xF4ng th\u1EE9c/ph\xE9p to\xE1n.",
      "  + PARTIALLY_CORRECT: c\xF3 ph\u1EA7n \u0111\xFAng nh\u01B0ng thi\u1EBFu th\xF4ng tin quan tr\u1ECDng (thi\u1EBFu gi\u1EA3i th\xEDch k\xFD hi\u1EC7u/\u0111\u01A1n v\u1ECB, thi\u1EBFu \u0111i\u1EC1u ki\u1EC7n \xE1p d\u1EE5ng, ph\xE1t bi\u1EC3u ch\u01B0a tr\u1ECDn v\u1EB9n).",
      "  + UNVERIFIED: CH\u1EC8 d\xF9ng khi th\xF4ng tin ri\xEAng l\u1EBB/m\u01A1 h\u1ED3/kh\xF4ng \u0111\u1EE7 ng\u1EEF c\u1EA3nh \u0111\u1EC3 x\xE1c minh. KH\xD4NG d\xF9ng cho \u0111\u1ECBnh ngh\u0129a/c\xF4ng th\u1EE9c ph\u1ED5 th\xF4ng.",
      ocrConfirmed ? "  + L\u01B0u \xFD OCR: V\u0103n b\u1EA3n \u0111\xE3 \u0111\u01B0\u1EE3c ng\u01B0\u1EDDi d\xF9ng ki\u1EC3m tra/x\xE1c nh\u1EADn n\xEAn KH\xD4NG t\u1EF1 \xFD g\u1EAFn OCR_UNCERTAIN tr\u1EEB khi c\xE2u ch\u1EEF b\u1ECB m\u1EA5t k\xFD t\u1EF1 kh\xF4ng th\u1EC3 hi\u1EC3u ngh\u0129a." : "  + OCR_UNCERTAIN: \u0111\u1ED9 tin c\u1EADy OCR < 0.65.",
      "  + OUT_OF_SCOPE: n\u1ED9i dung l\u1EA1c \u0111\u1EC1 ho\xE0n to\xE0n kh\u1ECFi m\xF4n h\u1ECDc.",
      "- KI\u1EC2M TRA CH\xC9O: N\u1EBFu explanation ch\u1EC9 ra h\u1ECDc sinh vi\u1EBFt sai \u2192 evaluationStatus B\u1EAET BU\u1ED8C l\xE0 INCORRECT. N\u1EBFu explanation ch\u1EC9 ra h\u1ECDc sinh vi\u1EBFt thi\u1EBFu k\xFD hi\u1EC7u/\u0111\u01A1n v\u1ECB/\u0111i\u1EC1u ki\u1EC7n \u2192 evaluationStatus B\u1EAET BU\u1ED8C l\xE0 PARTIALLY_CORRECT. C\u1EA4M TUY\u1EC6T \u0110\u1ED0I vi\u1EC7c gi\u1EA3i th\xEDch 1 \u0111\u1EB1ng m\xE0 ch\u1EA5m tr\u1EA1ng th\xE1i 1 n\u1EBBo.",
      "- G\xE1n tr\u1ECDng s\u1ED1 importanceWeight cho claims theo quy t\u1EAFc c\u1ED1 \u0111\u1ECBnh: 3 (\u0111\u1ECBnh ngh\u0129a/\u0111\u1ECBnh lu\u1EADt/c\xF4ng th\u1EE9c c\u1ED1t l\xF5i), 2 (h\u1ED7 tr\u1EE3/ch\xFA th\xEDch k\xFD hi\u1EC7u/\u0111i\u1EC1u ki\u1EC7n), 1 (chi ti\u1EBFt/v\xED d\u1EE5 m\u1EDF r\u1ED9ng).",
      coverageInstruction,
      "- Tuy\u1EC7t \u0111\u1ED1i KH\xD4NG b\u1ECBa URL hay s\u1ED1 trang SGK n\u1EBFu kh\xF4ng c\xF3 trong ng\u1EEF c\u1EA3nh.",
      "- Vi\u1EBFt r\xF5 r\xE0ng, tr\u1EF1c di\u1EC7n, s\xFAc t\xEDch (m\u1ED7i shortFix t\u1ED1i \u0111a 1 c\xE2u ng\u1EAFn g\u1ECDn; explanation/correctKnowledge/suggestedFix t\u1ED1i \u0111a 2-3 c\xE2u \u0111i th\u1EB3ng v\xE0o b\u1EA3n ch\u1EA5t kh\xE1i ni\u1EC7m; weaknesses t\u1ED1i \u0111a 10 \xFD; strengths t\u1ED1i \u0111a 5 \xFD; suggestions t\u1ED1i \u0111a 5 \xFD).",
      "",
      rubricSection,
      "=== T\xC0I LI\u1EC6U C\u1EE6A H\u1ECCC SINH ===",
      studentBodyText,
      "",
      "=== \u0110O\u1EA0N TR\xCDCH S\xC1CH GI\xC1O KHOA THAM CHI\u1EBEU ===",
      textbookSlice
    ].filter((line) => line !== void 0).join("\n");
    const analysisPrompt = buildGradingPrompt(studentSlice);
    const gradeSchemaHint = '{"claims":[{"blockId":"...","blockIds":["..."],"sourcePage":1,"sourceText":"...","errorSpan":"c\u1EE5m t\u1EEB/c\xF4ng th\u1EE9c sai tr\xEDch nguy\xEAn v\u0103n t\u1EEB sourceText","shortFix":"c\xE2u s\u1EEDa ng\u1EAFn g\u1ECDn 1 d\xF2ng","chapter":"...","concept":"...","importanceWeight":1|2|3,"knowledgeType":"textbook_core|advanced_extension|insufficient_evidence","evaluationStatus":"CORRECT|PARTIALLY_CORRECT|INCORRECT|MISSING|UNVERIFIED|AMBIGUOUS|OCR_UNCERTAIN|OUT_OF_SCOPE","explanation":"...","correctKnowledge":"...","suggestedFix":"...","matchedChunkId":"...","matchedExcerpt":"...","matchedPage":1}],"coverageItems":[{"criterionId":"KT01","concept":"...","chapter":"...","importanceWeight":1|2|3,"status":"COVERED|PARTIALLY_COVERED|MISSING|OUT_OF_SCOPE","suggestedAddition":"...","referenceExcerpt":"...","referencePage":1,"matchedChunkId":"..."}],"strengths":[{"title":"...","detail":"...","sourceExcerpt":"...","pageNumber":1}],"weaknesses":[{"title":"...","detail":"...","pageNumber":1}],"suggestions":[{"priority":1,"title":"...","description":"..."}]}';
    const fullStudentTextHash = crypto6.createHash("sha256").update(formattedStudentBlocks, "utf8").digest("hex");
    const fullPromptHash = crypto6.createHash("sha256").update(analysisPrompt, "utf8").digest("hex");
    const inputHash = crypto6.createHash("sha256").update(
      JSON.stringify({
        promptVersion: GRADING_PROMPT_VERSION,
        fullStudentTextHash,
        fullPromptHash,
        ocrTextHash,
        ocrConfirmed,
        textbookReferenceId,
        grade,
        subject,
        scope,
        selectedChapters: [...selectedChapters].sort(),
        chunkIds: sortedChunkIds,
        rubricHash: fixedRubric.rubricHash,
        enableWebGrounding: Boolean(enableWebGrounding),
        strictModelLock,
        adaptiveMode: adaptivePlan.isLongText ? "long_2api" : "short_1api",
        adaptiveThreshold: adaptivePlan.thresholdChars,
        seed: DETERMINISTIC_GRADING_SEED
      }),
      "utf8"
    ).digest("hex");
    const runGradeSlot = async (slotParams) => runTaskWithRouter({
      taskType: "knowledge_analysis",
      config: effectiveConfig,
      idToken,
      strictModelLock,
      allowGroqRescue: !strictModelLock,
      preferredPrimaryModelId: slotParams.preferredPrimaryModelId,
      preferredFallbackModelId: slotParams.preferredFallbackModelId,
      extractExecutionMeta: (res) => ({
        actualModel: res.resolvedModel,
        systemFingerprint: res.systemFingerprint
      }),
      cacheInput: {
        promptVersion: GRADING_PROMPT_VERSION,
        partKey: slotParams.partKey,
        inputHash,
        fullStudentTextHash,
        fullPromptHash,
        rubricHash: fixedRubric.rubricHash,
        chunkIds: sortedChunkIds,
        textbookRef: textbookReferenceId,
        grade,
        subject,
        scope,
        ocrConfirmed
      },
      runWithModel: async (modelId) => generateJsonWithProviderDetailed({
        modelId,
        prompt: slotParams.promptText,
        thinkingTier: slotParams.thinkingTier,
        maxOutputTokens: slotParams.maxOutputTokens,
        timeoutMs: 36e3,
        temperature: 0,
        seed: DETERMINISTIC_GRADING_SEED,
        strictModelLock,
        strictJsonParser: parseAndValidateKnowledgeEvalJson,
        stage: "CHAM",
        slot: slotParams.slot,
        tokensOut,
        fallbackJson: '{"claims":[],"coverageItems":[],"strengths":[],"weaknesses":[],"suggestions":[]}',
        groqSchemaHint: gradeSchemaHint
      })
    });
    let rawEval;
    let primaryRoutedResult;
    let gradeModelsUsed = [];
    let gradeProvidersUsed = [];
    let part1ClaimCount = 0;
    if (adaptivePlan.isLongText) {
      const studentGradingBlocks = pages.flatMap((page) => {
        if (page.blocks && page.blocks.length > 0) {
          return page.blocks.map((b) => ({
            pageNumber: page.pageNumber,
            blockId: b.blockId,
            text: String(b.extractedText || "").trim()
          })).filter((b) => b.text.length > 0);
        }
        const preferredText = (page.rawText || "").trim();
        if (!preferredText) return [];
        const semanticBlocks = groupRawTextIntoSemanticBlocks(preferredText, page.pageNumber, 0.92);
        return semanticBlocks.map((b) => ({
          pageNumber: page.pageNumber,
          blockId: b.blockId,
          text: String(b.extractedText || "").trim()
        })).filter((b) => b.text.length > 0);
      });
      const [half1Blocks, half2Blocks] = splitStudentBlocksIntoTwoHalves(studentGradingBlocks);
      if (half1Blocks.length > 0 && half2Blocks.length > 0) {
        const part1Text = formatStudentBlocksForPrompt(half1Blocks).slice(
          0,
          Math.floor(MAX_STUDENT_GRADING_CHARS / 2)
        );
        const part2Text = formatStudentBlocksForPrompt(half2Blocks).slice(
          0,
          Math.floor(MAX_STUDENT_GRADING_CHARS / 2)
        );
        const part1Prompt = buildGradingPrompt(
          part1Text,
          "Ph\u1EA7n 1/2 (n\u1EEDa \u0111\u1EA7u t\xE0i li\u1EC7u). Ch\u1EC9 t\xE1ch claims xu\u1EA5t hi\u1EC7n trong Ph\u1EA7n 1/2."
        );
        const part2Prompt = buildGradingPrompt(
          part2Text,
          "Ph\u1EA7n 2/2 (n\u1EEDa sau t\xE0i li\u1EC7u). Ch\u1EC9 t\xE1ch claims xu\u1EA5t hi\u1EC7n trong Ph\u1EA7n 2/2."
        );
        const [res1, res2] = await Promise.all([
          runGradeSlot({
            promptText: part1Prompt,
            preferredPrimaryModelId: MISTRAL_GRADE_MODEL,
            preferredFallbackModelId: GROQ_GRADE_FALLBACK_MODEL,
            slot: 1,
            partKey: "long_part_1",
            maxOutputTokens: 7168,
            thinkingTier: "medium"
          }),
          runGradeSlot({
            promptText: part2Prompt,
            preferredPrimaryModelId: CF_GRADE_MODEL,
            preferredFallbackModelId: GROQ_GRADE_FALLBACK_MODEL,
            slot: 2,
            partKey: "long_part_2",
            maxOutputTokens: 7168,
            thinkingTier: "medium"
          })
        ]);
        primaryRoutedResult = res1;
        part1ClaimCount = (res1.data.data.claims || []).length;
        const normalizeCov = (items) => (items || []).map((it) => ({
          ...it,
          chapter: it.chapter || "",
          importanceWeight: it.importanceWeight === 1 || it.importanceWeight === 2 || it.importanceWeight === 3 ? it.importanceWeight : void 0,
          status: ["COVERED", "PARTIALLY_COVERED", "MISSING", "OUT_OF_SCOPE"].includes(
            String(it.status || "").toUpperCase()
          ) ? String(it.status).toUpperCase() : "MISSING"
        }));
        const mergedHalves = mergeGradedHalves(
          {
            claims: res1.data.data.claims || [],
            coverageItems: normalizeCov(res1.data.data.coverageItems),
            strengths: [],
            weaknesses: [],
            suggestions: []
          },
          {
            claims: res2.data.data.claims || [],
            coverageItems: normalizeCov(res2.data.data.coverageItems),
            strengths: [],
            weaknesses: [],
            suggestions: []
          }
        );
        const dedupByTitle = (a = [], b = []) => {
          const seen = /* @__PURE__ */ new Set();
          const out = [];
          for (const item of [...a, ...b]) {
            const key = String(item?.title || "").trim().toLowerCase();
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            out.push(item);
          }
          return out;
        };
        rawEval = {
          claims: mergedHalves.claims,
          coverageItems: mergedHalves.coverageItems.map((it) => ({
            ...it,
            chapter: it.chapter || ""
          })),
          strengths: dedupByTitle(res1.data.data.strengths, res2.data.data.strengths).slice(0, 8),
          weaknesses: dedupByTitle(res1.data.data.weaknesses, res2.data.data.weaknesses).slice(0, 12),
          suggestions: dedupByTitle(res1.data.data.suggestions, res2.data.data.suggestions).slice(0, 8)
        };
        gradeModelsUsed = [res1.actualModel, res2.actualModel];
        gradeProvidersUsed = [
          detectProviderIdFromModel(res1.actualModel),
          detectProviderIdFromModel(res2.actualModel)
        ];
      } else {
        const singleRes = await runGradeSlot({
          promptText: analysisPrompt,
          preferredPrimaryModelId: MISTRAL_GRADE_MODEL,
          preferredFallbackModelId: GROQ_GRADE_FALLBACK_MODEL,
          slot: 1,
          partKey: "long_fallback_single",
          maxOutputTokens: 7168,
          thinkingTier: "medium"
        });
        primaryRoutedResult = singleRes;
        rawEval = singleRes.data.data;
        part1ClaimCount = (rawEval.claims || []).length;
        gradeModelsUsed = [singleRes.actualModel];
        gradeProvidersUsed = [detectProviderIdFromModel(singleRes.actualModel)];
      }
    } else {
      const singleRes = await runGradeSlot({
        promptText: analysisPrompt,
        preferredPrimaryModelId: MISTRAL_GRADE_MODEL,
        preferredFallbackModelId: GROQ_GRADE_FALLBACK_MODEL,
        slot: 1,
        partKey: "short_single",
        maxOutputTokens: pages.length <= 2 && fixedRubric.criteria.length <= 10 ? 4096 : 7168,
        thinkingTier: pages.length <= 2 && formattedStudentBlocks.length <= 3500 ? "low" : "medium"
      });
      primaryRoutedResult = singleRes;
      rawEval = singleRes.data.data;
      part1ClaimCount = (rawEval.claims || []).length;
      gradeModelsUsed = [singleRes.actualModel];
      gradeProvidersUsed = [detectProviderIdFromModel(singleRes.actualModel)];
    }
    const validStatuses = /* @__PURE__ */ new Set([
      "CORRECT",
      "PARTIALLY_CORRECT",
      "INCORRECT",
      "MISSING",
      "UNVERIFIED",
      "AMBIGUOUS",
      "OCR_UNCERTAIN",
      "OUT_OF_SCOPE"
    ]);
    const filteredRawClaims = (rawEval.claims || []).filter(
      (c) => !isNonGradableLeadInClaim(c.sourceText || "")
    );
    const configuredProviders = {
      mistral: isMistralConfigured(),
      cloudflare: isCloudflareConfigured(),
      groq: isGroqConfigured()
    };
    const verifySchemaHint = '{"adjustments":[{"claimIndex":0,"evaluationStatus":"CORRECT|PARTIALLY_CORRECT|INCORRECT|UNVERIFIED|OUT_OF_SCOPE","errorSpan":"...","shortFix":"...","explanation":"...","correctKnowledge":"...","suggestedFix":"..."}]}';
    const verifyModelsUsed = [];
    let verifyExecutedApiCount = 0;
    let verifyAdjustmentsCount = 0;
    const runVerifySlice = async (verifyParams) => {
      if (verifyParams.indexedClaims.length === 0) {
        return { adjustments: [], executed: false };
      }
      const verifierChoice = selectCrossProviderVerifierModel({
        gradedByProvider: verifyParams.gradedByProvider,
        slot: verifyParams.slot,
        configuredProviders,
        slot1VerifyModel: verifyParams.slot1VerifyModel
      });
      const compactClaimsPayload = verifyParams.indexedClaims.map(({ index, claim }) => ({
        claimIndex: index,
        sourcePage: claim.sourcePage,
        sourceText: (claim.sourceText || "").slice(0, 360),
        concept: claim.concept,
        evaluationStatus: claim.evaluationStatus,
        errorSpan: claim.errorSpan || "",
        shortFix: claim.shortFix || "",
        explanation: (claim.explanation || "").slice(0, 320),
        correctKnowledge: (claim.correctKnowledge || "").slice(0, 320)
      }));
      const verifyPrompt = [
        `B\u1EA1n l\xE0 H\u1ED9i \u0111\u1ED3ng d\xF2 ch\xE9o \u0111\u1ED9c l\u1EADp (Cross-Provider Verifier) c\u1EE7a StudyCheck AI cho m\xF4n ${subjectName} l\u1EDBp ${grade}.`,
        "NHI\u1EC6M V\u1EE4: Ki\u1EC3m tra l\u1EA1i danh s\xE1ch m\u1EC7nh \u0111\u1EC1 \u0111\xE3 ch\u1EA5m b\xEAn d\u01B0\u1EDBi \u0111\u1EC3 ph\xE1t hi\u1EC7n:",
        "1. M\xE2u thu\u1EABn gi\u1EEFa explanation v\xE0 evaluationStatus (v\xED d\u1EE5 explanation n\xF3i sai nh\u01B0ng l\u1EA1i g\u1EAFn CORRECT, ho\u1EB7c n\xF3i thi\u1EBFu k\xFD hi\u1EC7u/\u0111\u01A1n v\u1ECB nh\u01B0ng g\u1EAFn CORRECT).",
        "2. L\u1ED7i b\xE1o sai oan (false positive) ho\u1EB7c b\u1ECF s\xF3t l\u1ED7i c\xF4ng th\u1EE9c/\u0111\u1ECBnh ngh\u0129a/\u0111\u01A1n v\u1ECB (false negative).",
        "3. \u0110\u1EA3m b\u1EA3o m\u1ECDi claim INCORRECT ho\u1EB7c PARTIALLY_CORRECT \u0111\u1EC1u c\xF3 errorSpan tr\xEDch \u0111\xFAng t\u1EEB sourceText v\xE0 shortFix s\xFAc t\xEDch.",
        'CH\u1EC8 tr\u1EA3 v\u1EC1 c\xE1c m\u1EE5c th\u1EF1c s\u1EF1 c\u1EA7n \u0111i\u1EC1u ch\u1EC9nh trong m\u1EA3ng "adjustments" (n\u1EBFu t\u1EA5t c\u1EA3 \u0111\xE3 ch\xEDnh x\xE1c v\xE0 nh\u1EA5t qu\xE1n, tr\u1EA3 v\u1EC1 {"adjustments":[]}).',
        "",
        "=== DANH S\xC1CH CLAIMS C\u1EA6N D\xD2 CH\xC9O ===",
        JSON.stringify(compactClaimsPayload),
        textbookSlice ? `
=== T\xD3M T\u1EAET NG\u1EEE LI\u1EC6U SGK ===
${textbookSlice.slice(0, 5e3)}` : ""
      ].filter(Boolean).join("\n");
      try {
        const res = await runTaskWithRouter({
          taskType: "claim_validation",
          config: effectiveConfig,
          idToken,
          strictModelLock: false,
          allowGroqRescue: true,
          preferredPrimaryModelId: verifierChoice.primaryModel,
          preferredFallbackModelId: verifierChoice.fallbackModel,
          extractExecutionMeta: (out) => ({
            actualModel: out.resolvedModel,
            systemFingerprint: out.systemFingerprint
          }),
          cacheInput: {
            verifyRev: "v4.2_cross_provider",
            slot: verifyParams.slot,
            inputHash,
            gradedByProvider: verifyParams.gradedByProvider,
            claimDigest: crypto6.createHash("sha256").update(JSON.stringify(compactClaimsPayload), "utf8").digest("hex").slice(0, 24)
          },
          runWithModel: async (modelId) => generateJsonWithProviderDetailed({
            modelId,
            prompt: verifyPrompt,
            thinkingTier: "medium",
            maxOutputTokens: 3072,
            timeoutMs: 28e3,
            temperature: 0,
            seed: DETERMINISTIC_GRADING_SEED,
            strictModelLock: false,
            stage: "DO",
            slot: verifyParams.slot,
            tokensOut,
            fallbackJson: '{"adjustments":[]}',
            groqSchemaHint: verifySchemaHint
          })
        });
        return {
          adjustments: Array.isArray(res.data.data?.adjustments) ? res.data.data.adjustments : [],
          modelUsed: res.actualModel,
          executed: true
        };
      } catch (verifyErr) {
        console.warn(`Cross-provider verification non-fatal fallback (slot ${verifyParams.slot}):`, verifyErr);
        return { adjustments: [], executed: false };
      }
    };
    const indexedAllClaims = filteredRawClaims.map((claim, index) => ({ index, claim }));
    const collectedAdjustments = [];
    if (adaptivePlan.isLongText && indexedAllClaims.length >= 2) {
      const [verifyHalf1, verifyHalf2] = splitClaimsIntoTwoHalves(indexedAllClaims);
      const slot1Provider = gradeProvidersUsed[0] || "mistral";
      const slot2Provider = gradeProvidersUsed[1] || gradeProvidersUsed[0] || "cloudflare";
      const slot1PlannedChoice = selectCrossProviderVerifierModel({
        gradedByProvider: slot1Provider,
        slot: 1,
        configuredProviders
      });
      const [v1, v2] = await Promise.all([
        runVerifySlice({
          indexedClaims: verifyHalf1,
          gradedByProvider: slot1Provider,
          slot: 1
        }),
        runVerifySlice({
          indexedClaims: verifyHalf2,
          gradedByProvider: slot2Provider,
          slot: 2,
          slot1VerifyModel: slot1PlannedChoice.primaryModel
        })
      ]);
      for (const vr of [v1, v2]) {
        if (vr.executed) {
          verifyExecutedApiCount += 1;
          if (vr.modelUsed) verifyModelsUsed.push(vr.modelUsed);
          collectedAdjustments.push(...vr.adjustments);
        }
      }
    } else if (indexedAllClaims.length > 0) {
      const slot1Provider = gradeProvidersUsed[0] || "mistral";
      const v1 = await runVerifySlice({
        indexedClaims: indexedAllClaims,
        gradedByProvider: slot1Provider,
        slot: 1
      });
      if (v1.executed) {
        verifyExecutedApiCount += 1;
        if (v1.modelUsed) verifyModelsUsed.push(v1.modelUsed);
        collectedAdjustments.push(...v1.adjustments);
      }
    }
    for (const adj of collectedAdjustments) {
      const idx = Number(adj?.claimIndex);
      if (!Number.isInteger(idx) || idx < 0 || idx >= filteredRawClaims.length) continue;
      const target = filteredRawClaims[idx];
      let mutated = false;
      if (typeof adj.evaluationStatus === "string" && validStatuses.has(adj.evaluationStatus) && adj.evaluationStatus !== target.evaluationStatus) {
        target.evaluationStatus = adj.evaluationStatus;
        mutated = true;
      }
      if (typeof adj.errorSpan === "string" && adj.errorSpan.trim().length >= 2) {
        target.errorSpan = adj.errorSpan.trim();
        mutated = true;
      }
      if (typeof adj.shortFix === "string" && adj.shortFix.trim().length > 0) {
        target.shortFix = adj.shortFix.trim();
        mutated = true;
      }
      if (typeof adj.explanation === "string" && adj.explanation.trim().length >= 8) {
        target.explanation = adj.explanation.trim();
        mutated = true;
      }
      if (typeof adj.correctKnowledge === "string" && adj.correctKnowledge.trim().length >= 4) {
        target.correctKnowledge = adj.correctKnowledge.trim();
        mutated = true;
      }
      if (typeof adj.suggestedFix === "string" && adj.suggestedFix.trim().length >= 4) {
        target.suggestedFix = adj.suggestedFix.trim();
        mutated = true;
      }
      if (mutated) {
        verifyAdjustmentsCount += 1;
      }
    }
    const modelUsed = gradeModelsUsed.length > 1 ? Array.from(new Set(gradeModelsUsed)).join(" + ") : primaryRoutedResult.actualModel;
    const blockMap = /* @__PURE__ */ new Map();
    for (const p of pages) {
      for (const b of p.blocks) {
        blockMap.set(b.blockId, b);
      }
    }
    const chunkMap = /* @__PURE__ */ new Map();
    for (const c of referenceChunks) {
      chunkMap.set(c.chunkId, c);
    }
    const claims = filteredRawClaims.map((c, idx) => {
      const normalizedBlockIds = Array.isArray(c.blockIds) ? c.blockIds.filter((id) => typeof id === "string" && blockMap.has(id)) : [];
      const primaryBlockId = (c.blockId && blockMap.has(c.blockId) ? c.blockId : normalizedBlockIds[0]) || void 0;
      const matchedBlock = primaryBlockId ? blockMap.get(primaryBlockId) : void 0;
      const rawOcrConf = matchedBlock ? matchedBlock.confidence : 0.9;
      const ocrConf = ocrConfirmed ? Math.max(rawOcrConf, 0.95) : rawOcrConf;
      let status = validStatuses.has(c.evaluationStatus) ? c.evaluationStatus : "UNVERIFIED";
      if (!ocrConfirmed && ocrConf < 0.65 && status === "INCORRECT") {
        status = "OCR_UNCERTAIN";
      }
      const wRaw = Number(c.importanceWeight);
      const importanceWeight = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
      const evidences = [];
      if (c.matchedChunkId && chunkMap.has(c.matchedChunkId)) {
        const ch = chunkMap.get(c.matchedChunkId);
        evidences.push({
          evidenceId: `ev_${idx + 1}_tb`,
          sourceType: "textbook",
          referenceId: ch.referenceId,
          chunkId: ch.chunkId,
          title: textbookTitle || ch.textbookSeries,
          chapter: ch.chapter,
          lesson: ch.lesson,
          pageNumber: ch.pageNumber,
          excerpt: c.matchedExcerpt || ch.content.slice(0, 320)
        });
      } else if (c.matchedExcerpt) {
        evidences.push({
          evidenceId: `ev_${idx + 1}_ref`,
          sourceType: "textbook",
          ...textbookReferenceId ? { referenceId: textbookReferenceId } : {},
          title: textbookTitle || "Chu\u1EA9n ch\u01B0\u01A1ng tr\xECnh GDPT 2018",
          ...typeof c.matchedPage === "number" && c.matchedPage > 0 ? { pageNumber: c.matchedPage } : {},
          excerpt: c.matchedExcerpt
        });
      }
      const resolvedSuggestedFix = c.suggestedFix && c.suggestedFix.trim() ? c.suggestedFix.trim() : status !== "CORRECT" && c.correctKnowledge ? c.correctKnowledge : null;
      const resolvedErrorSpan = typeof c.errorSpan === "string" && c.errorSpan.trim().length >= 2 ? c.errorSpan.trim() : void 0;
      const resolvedShortFix = typeof c.shortFix === "string" && c.shortFix.trim().length > 0 ? c.shortFix.trim() : void 0;
      const claimDigest = crypto6.createHash("sha256").update(
        `${idx + 1}|${c.sourcePage || matchedBlock?.pageNumber || 1}|${(c.sourceText || "").trim().normalize("NFC")}|${(c.concept || "").trim().normalize("NFC")}`,
        "utf8"
      ).digest("hex").slice(0, 8);
      return {
        claimId: `claim_${idx + 1}_${claimDigest}`,
        sourceText: c.sourceText,
        normalizedMeaning: c.sourceText,
        subject,
        chapter: c.chapter || selectedChapters[0] || "T\u1ED5ng h\u1EE3p",
        concept: c.concept || "Kh\xE1i ni\u1EC7m ch\xEDnh",
        importanceLevel: importanceWeight === 3 ? "core" : importanceWeight === 1 ? "detail" : "supporting",
        importanceWeight,
        sourcePage: c.sourcePage || matchedBlock?.pageNumber || 1,
        ...matchedBlock?.blockId ? { blockId: matchedBlock.blockId } : {},
        ...normalizedBlockIds.length > 0 ? { blockIds: normalizedBlockIds } : {},
        ...resolvedErrorSpan ? { errorSpan: resolvedErrorSpan } : {},
        ...resolvedShortFix ? { shortFix: resolvedShortFix } : {},
        boundingBox: matchedBlock?.boundingBox || null,
        ocrConfidence: ocrConf,
        knowledgeType: c.knowledgeType === "advanced_extension" ? "advanced_extension" : c.knowledgeType === "insufficient_evidence" ? "insufficient_evidence" : "textbook_core",
        evaluationStatus: status,
        explanation: c.explanation,
        correctKnowledge: c.correctKnowledge,
        ...resolvedSuggestedFix ? { suggestedFix: resolvedSuggestedFix } : {},
        evidences
      };
    });
    let coverageItems = [];
    let extraCoverageCount = 0;
    if (rubricMode === "fixed_textbook_rubric") {
      const reconciled = reconcileCoverageAgainstFixedRubric(
        fixedRubric,
        rawEval.coverageItems || []
      );
      coverageItems = reconciled.coverageItems;
      extraCoverageCount = reconciled.extraObservations.length;
    } else {
      coverageItems = (rawEval.coverageItems || []).map((item, idx) => {
        const wRaw = Number(item.importanceWeight);
        const importanceWeight = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
        const validCov = item.status === "COVERED" || item.status === "PARTIALLY_COVERED" || item.status === "MISSING" || item.status === "OUT_OF_SCOPE" ? item.status : "PARTIALLY_COVERED";
        return {
          itemId: `cov_${idx + 1}`,
          concept: item.concept,
          chapter: item.chapter,
          importanceWeight,
          status: validCov,
          suggestedAddition: item.suggestedAddition || "",
          referenceExcerpt: item.referenceExcerpt || "",
          ...typeof item.referencePage === "number" && item.referencePage > 0 ? { referencePage: item.referencePage } : {},
          ...item.matchedChunkId ? { matchedChunkId: item.matchedChunkId } : {}
        };
      });
    }
    const hasTextbook = Boolean(textbookReferenceId && retrievedHits.length > 0);
    const hasValidScope = rubricMode !== "unscoped";
    const baseAccuracyBreakdown = calculateAccuracyScore(claims, hasTextbook);
    const completenessBreakdown = calculateCompletenessScore(coverageItems, hasValidScope, {
      rubricMode,
      rubricItemCount: rubricMode === "fixed_textbook_rubric" ? fixedRubric.criteria.length : coverageItems.length,
      extraObservationsCount: extraCoverageCount
    });
    const adaptiveApiPlanAudit = createAdaptiveAuditMetadata(adaptivePlan, {
      gradeModels: gradeModelsUsed,
      verifyModels: verifyModelsUsed,
      verifyExecutedApiCount,
      verifyAdjustmentsCount
    });
    const gradingAudit = {
      requestedModel: primaryRoutedResult.requestedModel,
      actualModel: modelUsed,
      usedFallback: primaryRoutedResult.usedFallback,
      usedOverride: primaryRoutedResult.usedOverride,
      cached: primaryRoutedResult.cached,
      strictModelLock,
      ...primaryRoutedResult.systemFingerprint ? { systemFingerprint: primaryRoutedResult.systemFingerprint } : {},
      promptVersion: GRADING_PROMPT_VERSION,
      configVersion: primaryRoutedResult.configVersion,
      inputHash: inputHash.slice(0, 24),
      ocrTextHash,
      ocrConfirmed,
      rubricMode,
      ...fixedRubric.criteria.length > 0 ? { rubricHash: fixedRubric.rubricHash.slice(0, 24) } : {},
      rubricItemCount: fixedRubric.criteria.length,
      extraCoverageCount,
      chunkIds: sortedChunkIds,
      truncationApplied,
      studentCharCount: formattedStudentBlocks.length,
      textbookCharCount: textbookContext.length,
      webGroundingEnabled: Boolean(enableWebGrounding),
      deterministicSeed: DETERMINISTIC_GRADING_SEED,
      adaptiveApiPlan: adaptiveApiPlanAudit
    };
    void part1ClaimCount;
    const accuracyBreakdown = {
      ...baseAccuracyBreakdown,
      gradingAudit
    };
    const annotations = [];
    for (const claim of claims) {
      if (claim.evaluationStatus === "MISSING" || claim.evaluationStatus === "OUT_OF_SCOPE") continue;
      const color = claim.evaluationStatus === "INCORRECT" ? "red" : claim.evaluationStatus === "PARTIALLY_CORRECT" ? "orange" : claim.evaluationStatus === "UNVERIFIED" || claim.evaluationStatus === "OCR_UNCERTAIN" || claim.evaluationStatus === "AMBIGUOUS" ? "yellow" : "green";
      annotations.push({
        annotationId: `ann_${claim.claimId}`,
        pageNumber: claim.sourcePage,
        ...claim.blockId ? { blockId: claim.blockId } : {},
        ...claim.blockIds && claim.blockIds.length > 0 ? { blockIds: claim.blockIds } : {},
        textExcerpt: claim.sourceText,
        ...claim.errorSpan ? { errorSpan: claim.errorSpan } : {},
        claimId: claim.claimId,
        ...claim.evidences[0]?.referenceId ? { referenceId: claim.evidences[0].referenceId } : {},
        boundingBox: claim.boundingBox || null,
        annotationColor: color,
        reason: claim.explanation,
        ...claim.evidences[0]?.evidenceId ? { evidenceId: claim.evidences[0].evidenceId } : {}
      });
    }
    const mappedWeaknesses = (rawEval.weaknesses || []).map((w) => ({
      title: w.title,
      category: "knowledge_error",
      detail: w.detail,
      ...typeof w.pageNumber === "number" && w.pageNumber > 0 ? { pageNumber: w.pageNumber } : {}
    }));
    const mappedSuggestions = (rawEval.suggestions || []).map((s, idx) => ({
      priority: Number(s.priority) || idx + 1,
      actionType: "fix_error",
      title: s.title,
      description: s.description
    }));
    return {
      claims,
      coverageItems,
      annotations,
      strengths: rawEval.strengths || [],
      weaknesses: mappedWeaknesses,
      suggestions: mappedSuggestions,
      webSources,
      usedWebGrounding,
      ...webGroundingNotice ? { webGroundingNotice } : {},
      modelUsed,
      accuracyScore: accuracyBreakdown.accuracyScore,
      completenessScore: completenessBreakdown.completenessScore,
      evidenceCoverage: accuracyBreakdown.evidenceCoverage,
      confidenceLevel: accuracyBreakdown.confidenceLevel,
      confidenceReason: accuracyBreakdown.confidenceReason,
      accuracyBreakdown,
      completenessBreakdown,
      gradingAudit
    };
  }
};
var QuizGenerationService = class {
  static async generateQuiz(params) {
    const {
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      referenceChunks = [],
      count,
      difficulty,
      scope,
      chapterFilter,
      advancedEnabled = false,
      advancedCount = 0,
      tokensOut,
      config,
      idToken
    } = params;
    const safeAdvancedExtra = advancedEnabled ? Math.min(6, Math.max(1, Number(advancedCount) || 2)) : 0;
    const baseTargetCount = Math.min(20, Math.max(5, Number(count) || 5));
    const totalWanted = baseTargetCount + safeAdvancedExtra;
    const strategy = resolveQuizScopeStrategy({
      scope,
      baseTargetCount,
      claims,
      coverageItems,
      chapterFilter
    });
    const querySeedText = [
      chapterFilter || "",
      ...strategy.targetClaims.map((c) => `${c.chapter} ${c.concept} ${c.correctKnowledge}`),
      ...strategy.missingItems.map((m) => `${m.chapter} ${m.concept} ${m.suggestedAddition}`)
    ].join(" ").trim();
    const sameSubjectChunks = referenceChunks.filter(
      (rc) => rc.grade === grade && rc.subject === subject
    );
    const retrievedSupplementHits = sameSubjectChunks.length > 0 && querySeedText ? retrieveRelevantChunks(querySeedText, sameSubjectChunks, {
      selectedChapters: chapterFilter?.trim() ? [chapterFilter.trim()] : void 0,
      topK: 10
    }) : [];
    const supplementChunks = retrievedSupplementHits.length > 0 ? retrievedSupplementHits.map((h) => h.chunk) : sameSubjectChunks.slice(0, 10);
    const buildContextText = (includeTextbookChunks) => {
      const lines = [
        ...strategy.targetClaims.map(
          (c) => `[UploadClaim ${c.claimId} | ${c.evaluationStatus} | ${c.chapter} | ${c.concept}] H\u1ECDc sinh vi\u1EBFt: "${c.sourceText}" | Chu\u1EA9n: "${c.correctKnowledge}" | Gi\u1EA3i th\xEDch: "${c.explanation}"`
        ),
        ...strategy.missingItems.map(
          (m) => `[UploadMissing | ${m.chapter} | ${m.concept}] G\u1EE3i \xFD: "${m.suggestedAddition}" | Tr\xEDch d\u1EABn: "${m.referenceExcerpt}"`
        ),
        ...includeTextbookChunks ? supplementChunks.map(
          (ch) => `[TextbookSupplement | ${ch.chapter} - ${ch.lesson} | Tr.${ch.pageNumber}] ${ch.content.slice(0, 420)}`
        ) : []
      ];
      if (lines.length > 0) return lines.join("\n").slice(0, 18e3);
      return claims.map((c) => `[FallbackClaim | ${c.chapter} | ${c.concept}] ${c.correctKnowledge}`).join("\n").slice(0, 18e3);
    };
    const diffLabel = difficulty === "basic" ? "C\u01A1 b\u1EA3n (Nh\u1EADn bi\u1EBFt, Th\xF4ng hi\u1EC3u)" : difficulty === "medium" ? "Trung b\xECnh (Th\xF4ng hi\u1EC3u, V\u1EADn d\u1EE5ng)" : difficulty === "advanced" ? "N\xE2ng cao (V\u1EADn d\u1EE5ng, V\u1EADn d\u1EE5ng cao)" : "H\u1ED7n h\u1EE3p c\xE2n b\u1EB1ng (Nh\u1EADn bi\u1EBFt 30% - Th\xF4ng hi\u1EC3u 30% - V\u1EADn d\u1EE5ng 25% - V\u1EADn d\u1EE5ng cao 15%)";
    const scopeHumanLabel = scope === "incorrect" ? "ch\u1ED7 l\xE0m sai" : scope === "partial" ? "ph\u1EA7n thi\u1EBFu \u0111i\u1EC1u ki\u1EC7n" : scope === "missing" ? "ph\u1EA7n ki\u1EBFn th\u1EE9c c\xF2n thi\u1EBFu" : scope === "chapter" && chapterFilter?.trim() ? `ch\u01B0\u01A1ng "${chapterFilter.trim()}"` : "to\xE0n b\u1ED9 n\u1ED9i dung \u0111\xE3 ph\xE2n t\xEDch";
    const quizGroqSchemaHint = '{"questions":[{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","explanation":"...","distractorA":"...","distractorB":"...","distractorC":"...","distractorD":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","chapter":"...","concept":"...","sourceReference":"...","isExternalAdvanced":false,"questionOrigin":"upload|mistake_variation|textbook_supplement|external_advanced"}]}';
    const unitTypes = /* @__PURE__ */ new Set([
      "concept",
      "mechanism",
      "condition",
      "characteristic",
      "formula",
      "problem_type"
    ]);
    const refLabel = textbookTitle || `SGK & chu\u1EA9n ch\u01B0\u01A1ng tr\xECnh GDPT 2018 m\xF4n ${SUBJECT_LABELS[subject]} L\u1EDBp ${grade}`;
    const runResult = await runQuizGenerationWithTopUp({
      baseTargetCount,
      advancedTargetCount: safeAdvancedExtra,
      maxTopUpPasses: 2,
      generateBatch: async ({ attempt, missingBase, missingAdvanced, existingQuestions }) => {
        const batchTotal = missingBase + missingAdvanced;
        const allowTextbookOnThisPass = strategy.needsTextbookSupplement || strategy.mode === "empty_scope_fallback" || strategy.mode === "mistake_variation" && attempt >= 2 || strategy.mode !== "mistake_variation" && attempt >= 1;
        const effectiveContext = buildContextText(allowTextbookOnThisPass);
        let strategyInstruction = "";
        if (strategy.mode === "mistake_variation") {
          if (attempt < 2) {
            strategyInstruction = [
              `CHI\u1EBEN L\u01AF\u1EE2C PH\u1EA0M VI (${scopeHumanLabel}): \u01AFu ti\xEAn T\u1EA0O C\xC1C C\xC2U H\u1ECEI BI\u1EBEN TH\u1EC2 \u0110A G\xD3C \u0110\u1ED8 xoay quanh ch\xEDnh c\xE1c l\u1ED7i sai/\xFD thi\u1EBFu trong ng\u1EEF c\u1EA3nh (v\xED d\u1EE5: nh\u1EADn di\u1EC7n ph\xE1t bi\u1EC3u \u0111\xFAng/sai v\u1EC1 l\u1ED7i \u0111\xF3, s\u1EEDa sai c\xF4ng th\u1EE9c/\u0111i\u1EC1u ki\u1EC7n, gi\u1EA3i th\xEDch b\u1EA3n ch\u1EA5t, b\xE0i t\u1EADp t\xEDnh to\xE1n/v\u1EADn d\u1EE5ng ng\u1EAFn v\u1EDBi s\u1ED1 li\u1EC7u m\u1EDBi, t\xECnh hu\u1ED1ng g\xE2y nh\u1EA7m l\u1EABn t\u01B0\u01A1ng t\u1EF1) \u0111\u1EC3 \u0111\u1EA1t CH\xCDNH X\xC1C ${missingBase} c\xE2u c\u01A1 b\u1EA3n.`,
              'G\xE1n questionOrigin = "mistake_variation" cho c\xE1c c\xE2u bi\u1EBFn th\u1EC3 t\u1EEB l\u1ED7i sai/\xFD thi\u1EBFu.'
            ].join("\n");
          } else {
            strategyInstruction = [
              `L\u01AF\u1EE2T B\u1ED4 SUNG CU\u1ED0I (${scopeHumanLabel}): Ti\u1EBFp t\u1EE5c t\u1EA1o bi\u1EBFn th\u1EC3 m\u1EDBi t\u1EEB l\u1ED7i sai/\xFD thi\u1EBFu (questionOrigin = "mistake_variation"). N\u1EBFu \u0111\xE3 khai th\xE1c h\u1EBFt c\xE1c g\xF3c \u0111\u1ED9 bi\u1EBFn th\u1EC3 t\u1EF1 nhi\xEAn, \u0111\u01B0\u1EE3c ph\xE9p b\u1ED5 sung ph\u1EA7n c\xF2n thi\u1EBFu t\u1EEB ki\u1EBFn th\u1EE9c c\xF9ng b\xE0i trong ${refLabel} v\xE0 g\xE1n questionOrigin = "textbook_supplement" \u0111\u1EC3 \u0111\u1EA1t \u0110\xDANG ${missingBase} c\xE2u c\u01A1 b\u1EA3n.`
            ].join("\n");
          }
        } else if (strategy.mode === "upload_plus_textbook" || strategy.mode === "empty_scope_fallback") {
          strategyInstruction = attempt === 0 ? [
            `CHI\u1EBEN L\u01AF\u1EE2C PH\u1EA0M VI (${scopeHumanLabel}): T\xE0i li\u1EC7u t\u1EA3i l\xEAn hi\u1EC7n c\xF3 ${strategy.distinctConceptCount} \u0111\u01A1n v\u1ECB ki\u1EBFn th\u1EE9c (\xEDt h\u01A1n ${baseTargetCount} c\xE2u c\u1EA7n t\u1EA1o).`,
            `- Tr\u01B0\u1EDBc ti\xEAn, khai th\xE1c t\u1ED1i \u0111a c\xE1c \xFD trong t\xE0i li\u1EC7u t\u1EA3i l\xEAn (g\xE1n questionOrigin = "upload").`,
            `- T\u1EF1 \u0111\u1ED9ng b\u1ED5 sung c\xE1c c\xE2u c\xF2n l\u1EA1i t\u1EEB ${refLabel} \u0111\xFAng ch\u1EE7 \u0111\u1EC1/ch\u01B0\u01A1ng \u0111ang h\u1ECDc (g\xE1n questionOrigin = "textbook_supplement") sao cho T\u1ED4NG S\u1ED0 C\xC2U C\u01A0 B\u1EA2N \u0111\u1EA1t CH\xCDNH X\xC1C ${missingBase} c\xE2u.`
          ].join("\n") : [
            `L\u01AF\u1EE2T SINH B\xD9 ${attempt}: T\u1EA1o th\xEAm CH\xCDNH X\xC1C ${missingBase} c\xE2u c\u01A1 b\u1EA3n m\u1EDBi ho\xE0n to\xE0n (kh\xF4ng tr\xF9ng c\xE2u \u0111\xE3 c\xF3), \u01B0u ti\xEAn \xFD ch\u01B0a h\u1ECFi trong t\xE0i li\u1EC7u (questionOrigin = "upload") v\xE0 b\u1ED5 sung t\u1EEB ${refLabel} (questionOrigin = "textbook_supplement").`
          ].join("\n");
        } else {
          strategyInstruction = attempt === 0 ? `CHI\u1EBEN L\u01AF\u1EE2C PH\u1EA0M VI (${scopeHumanLabel}): T\u1EA1o CH\xCDNH X\xC1C ${missingBase} c\xE2u c\u1ED1t l\xF5i b\xE1m s\xE1t to\xE0n b\u1ED9 n\u1ED9i dung t\xE0i li\u1EC7u t\u1EA3i l\xEAn (g\xE1n questionOrigin = "upload"). N\u1EBFu v\u1EABn c\u1EA7n m\u1EDF r\u1ED9ng th\xEAm \u0111\u1EC3 tr\xE1nh tr\xF9ng \xFD, b\u1ED5 sung t\u1EEB ${refLabel} v\xE0 g\xE1n questionOrigin = "textbook_supplement".` : `L\u01AF\u1EE2T SINH B\xD9 ${attempt}: T\u1EA1o th\xEAm CH\xCDNH X\xC1C ${missingBase} c\xE2u c\u01A1 b\u1EA3n m\u1EDBi ho\xE0n to\xE0n (kh\xF4ng tr\xF9ng c\xE2u \u0111\xE3 c\xF3) t\u1EEB c\xE1c \xFD ch\u01B0a khai th\xE1c trong t\xE0i li\u1EC7u (questionOrigin = "upload") ho\u1EB7c b\u1ED5 sung t\u1EEB ${refLabel} (questionOrigin = "textbook_supplement").`;
        }
        const existingExclusionBlock = existingQuestions.length > 0 ? [
          "DANH S\xC1CH C\xC2U H\u1ECEI \u0110\xC3 T\u1EA0O (TUY\u1EC6T \u0110\u1ED0I KH\xD4NG \u0110\u01AF\u1EE2C L\u1EB6P L\u1EA0I C\xC2U H\u1ECEI HO\u1EB6C \xDD H\u1ECEI T\u01AF\u01A0NG T\u1EF0):",
          ...existingQuestions.map(
            (q, i) => `${i + 1}. [${q.concept}] ${q.questionText.slice(0, 140)}`
          )
        ].join("\n") : "";
        const countRequirementLines = [];
        if (missingBase > 0) {
          countRequirementLines.push(
            `- PH\u1EA2I T\u1EA0O \u0110\xDANG ${missingBase} c\xE2u h\u1ECFi c\u01A1 b\u1EA3n (isExternalAdvanced = false).`
          );
        }
        if (missingAdvanced > 0) {
          countRequirementLines.push(
            `- PH\u1EA2I T\u1EA0O \u0110\xDANG ${missingAdvanced} c\xE2u h\u1ECFi N\xC2NG CAO B\xCAN NGO\xC0I (isExternalAdvanced = true, questionOrigin = "external_advanced", m\u1EE9c V\u1EADn d\u1EE5ng / V\u1EADn d\u1EE5ng cao, m\u1EDF r\u1ED9ng t\u01B0 duy gi\u1EA3i quy\u1EBFt v\u1EA5n \u0111\u1EC1 \u1EDF c\xF9ng ch\u1EE7 \u0111\u1EC1 m\xF4n h\u1ECDc).`
          );
        }
        const prompt = [
          `So\u1EA1n CH\xCDNH X\xC1C ${batchTotal} c\xE2u h\u1ECFi tr\u1EAFc nghi\u1EC7m ABCD cho h\u1ECDc sinh l\u1EDBp ${grade}, m\xF4n ${SUBJECT_LABELS[subject]}.`,
          `QUY T\u1EAEC S\u1ED0 L\u01AF\u1EE2NG B\u1EAET BU\u1ED8C: M\u1EA3ng "questions" trong JSON PH\u1EA2I C\xD3 \u0110\xDANG ${batchTotal} PH\u1EA6N T\u1EEC, TUY\u1EC6T \u0110\u1ED0I KH\xD4NG \xCDT H\u01A0N.`,
          ...countRequirementLines,
          missingBase > 0 ? strategyInstruction : "",
          `\u0110\u1ED9 kh\xF3: ${diffLabel}. Ngu\u1ED3n tham chi\u1EBFu: ${refLabel}.`,
          "Y\xCAU C\u1EA6U CH\u1EA4T L\u01AF\u1EE2NG & C\xD4 \u0110\u1ECCNG:",
          "- M\u1ED7i c\xE2u CH\u1EC8 C\xD3 DUY NH\u1EA4T 1 \u0111\xE1p \xE1n \u0111\xFAng (A, B, C ho\u1EB7c D); 4 ph\u01B0\u01A1ng \xE1n A/B/C/D kh\xE1c nhau r\xF5 r\xE0ng v\xE0 c\xF3 \u0111\u1ED9 d\xE0i t\u01B0\u01A1ng \u0111\u1ED3ng h\u1EE3p l\xFD.",
          "- Ph\xE2n lo\u1EA1i \u0111\xFAng cognitiveLevel (nhan_biet | thong_hieu | van_dung | van_dung_cao), knowledgeUnitType v\xE0 questionOrigin.",
          "- Gi\u1EEF v\u0103n phong ng\u1EAFn g\u1ECDn \u0111\u1EC3 b\u1EA3o \u0111\u1EA3m \u0111\u1EE7 s\u1ED1 c\xE2u: explanation t\u1ED1i \u0111a 1-2 c\xE2u; m\u1ED7i distractorA/B/C/D t\u1ED1i \u0111a 1 c\xE2u th\u1EADt ng\u1EAFn (<= 14 t\u1EEB).",
          existingExclusionBlock,
          "",
          "NG\u1EEE C\u1EA2NH KI\u1EBEN TH\u1EE8C:",
          effectiveContext
        ].filter(Boolean).join("\n");
        const quizMaxTokens = Math.min(8192, Math.max(3072, batchTotal * 520));
        const { data: parsed, modelId: batchModelUsed } = await runTaskWithRouter({
          taskType: "quiz_generation",
          config,
          idToken,
          allowGroqRescue: true,
          bypassCache: attempt > 0,
          cacheInput: attempt === 0 ? {
            rev: "v4_scope_adaptive_topup",
            subject,
            grade,
            baseTargetCount,
            safeAdvancedExtra,
            difficulty,
            scope,
            chapterFilter: chapterFilter || "",
            ctx: effectiveContext.slice(0, 8e3)
          } : void 0,
          runWithModel: async (modelId) => generateJsonWithProvider({
            modelId,
            prompt,
            thinkingTier: "minimal",
            maxOutputTokens: quizMaxTokens,
            tokensOut,
            fallbackJson: '{"questions":[]}',
            strictJsonParser: (rawText) => {
              const salvaged = salvageQuestionsFromTruncatedJson(rawText);
              if (salvaged.length === 0) {
                throw new Error(
                  "QUIZ_EMPTY_RESPONSE: M\xF4 h\xECnh AI tr\u1EA3 v\u1EC1 danh s\xE1ch c\xE2u h\u1ECFi r\u1ED7ng ho\u1EB7c JSON b\u1ECB l\u1ED7i."
                );
              }
              return { questions: salvaged };
            },
            groqSchemaHint: quizGroqSchemaHint
          })
        });
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const defaultBaseOrigin = strategy.mode === "mistake_variation" ? attempt >= 2 ? "textbook_supplement" : "mistake_variation" : strategy.mode === "upload_sufficient" && attempt === 0 ? "upload" : "textbook_supplement";
        const mapped = (parsed.questions || []).slice(0, batchTotal + 4).map((q, idx) => {
          const ans = q.correctAnswer === "A" || q.correctAnswer === "B" || q.correctAnswer === "C" || q.correctAnswer === "D" ? q.correctAnswer : "A";
          const fallbackDiff = difficulty === "basic" || difficulty === "advanced" ? difficulty : "medium";
          const cog = normalizeCognitiveLevel(q.cognitiveLevel, fallbackDiff);
          const diff = cog === "nhan_biet" ? "basic" : cog === "thong_hieu" ? "medium" : "advanced";
          const isAdv = missingBase === 0 && missingAdvanced > 0 ? true : missingAdvanced === 0 ? false : Boolean(q.isExternalAdvanced || q.questionOrigin === "external_advanced");
          const fallbackOriginForIdx = isAdv ? "external_advanced" : attempt === 0 && strategy.mode === "upload_plus_textbook" && idx < strategy.expectedUploadSlots ? "upload" : defaultBaseOrigin;
          const origin = normalizeQuizQuestionOrigin(
            q.questionOrigin,
            isAdv,
            fallbackOriginForIdx
          );
          return {
            questionId: `q_${Date.now()}_${attempt}_${idx + 1}_${crypto6.randomBytes(2).toString("hex")}`,
            questionText: q.questionText,
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
            correctAnswer: ans,
            explanation: q.explanation,
            distractorExplanations: q.distractorA || q.distractorB || q.distractorC || q.distractorD ? {
              A: q.distractorA,
              B: q.distractorB,
              C: q.distractorC,
              D: q.distractorD
            } : void 0,
            difficulty: diff,
            cognitiveLevel: cog,
            knowledgeUnitType: unitTypes.has(q.knowledgeUnitType) ? q.knowledgeUnitType : "concept",
            subject,
            grade,
            chapter: q.chapter || chapterFilter || "T\u1ED5ng h\u1EE3p",
            concept: q.concept || "Kh\xE1i ni\u1EC7m tr\u1ECDng t\xE2m",
            sourceReference: q.sourceReference || textbookTitle || "T\xE0i li\u1EC7u tham chi\u1EBFu",
            sourceType: origin === "external_advanced" ? "external_extension" : "textbook_reference",
            questionOrigin: origin,
            modelId: batchModelUsed,
            isExternalAdvanced: isAdv,
            createdAt: now
          };
        });
        return {
          questions: mapped,
          modelUsed: batchModelUsed
        };
      }
    });
    const finalQuestions = runResult.questions;
    const baseFinal = runResult.baseQuestions;
    const uploadCount = baseFinal.filter((q) => q.questionOrigin === "upload").length;
    const variationCount = baseFinal.filter((q) => q.questionOrigin === "mistake_variation").length;
    const supplementCount = baseFinal.filter((q) => q.questionOrigin === "textbook_supplement").length;
    const noticeParts = [];
    if (strategy.mode === "empty_scope_fallback") {
      noticeParts.push(
        `B\xE0i ph\xE2n t\xEDch kh\xF4ng c\xF3 m\u1EE5c n\xE0o kh\u1EDBp b\u1ED9 l\u1ECDc "${scopeHumanLabel}". H\u1EC7 th\u1ED1ng \u0111\xE3 t\u1EF1 \u0111\u1ED9ng t\u1ED5ng h\u1EE3p t\u1EEB to\xE0n b\u1ED9 t\xE0i li\u1EC7u v\xE0 ${refLabel} \u0111\u1EC3 t\u1EA1o ${baseFinal.length} c\xE2u c\u01A1 b\u1EA3n.`
      );
    } else if (strategy.mode === "mistake_variation") {
      if (supplementCount > 0) {
        noticeParts.push(
          `\u0110\xE3 t\u1EA1o ${variationCount} c\xE2u bi\u1EBFn th\u1EC3 \u0111a g\xF3c \u0111\u1ED9 t\u1EEB ${scopeHumanLabel} v\xE0 b\u1ED5 sung ${supplementCount} c\xE2u c\xF9ng ch\u1EE7 \u0111\u1EC1 t\u1EEB ${refLabel} \u0111\u1EC3 \u0111\u1EE7 ${baseFinal.length} c\xE2u c\u01A1 b\u1EA3n.`
        );
      } else if (variationCount > 0) {
        noticeParts.push(
          `\u0110\xE3 t\u1EA1o ${variationCount} c\xE2u h\u1ECFi bi\u1EBFn th\u1EC3 \u0111a g\xF3c \u0111\u1ED9 xoay quanh \u0111\xFAng ${scopeHumanLabel} trong b\xE0i ph\xE2n t\xEDch \u0111\u1EC3 gi\xFAp b\u1EA1n kh\u1EAFc ph\u1EE5c tri\u1EC7t \u0111\u1EC3 l\u1ED7 h\u1ED5ng.`
        );
      }
    } else if (supplementCount > 0) {
      noticeParts.push(
        `N\u1ED9i dung t\u1EA3i l\xEAn c\xF3 ${strategy.distinctConceptCount} \u0111\u01A1n v\u1ECB ki\u1EBFn th\u1EE9c. B\u1ED9 \u0111\u1EC1 g\u1ED3m ${uploadCount} c\xE2u b\xE1m s\xE1t t\xE0i li\u1EC7u t\u1EA3i l\xEAn v\xE0 ${supplementCount} c\xE2u b\u1ED5 sung t\u1EEB ${refLabel} \u0111\u1EC3 \u0111\u1EE7 ${baseFinal.length} c\xE2u c\u01A1 b\u1EA3n.`
      );
    }
    if (finalQuestions.length < totalWanted) {
      noticeParts.push(
        `H\u1EC7 th\u1ED1ng \u0111\xE3 t\u1EF1 \u0111\u1ED9ng sinh b\xF9 ${runResult.topUpPassesUsed} l\u01B0\u1EE3t nh\u01B0ng ch\u1EC9 thu \u0111\u01B0\u1EE3c ${finalQuestions.length}/${totalWanted} c\xE2u h\u1EE3p l\u1EC7 kh\xF4ng tr\xF9ng l\u1EB7p.`
      );
    }
    const supplementNotice = noticeParts.length > 0 ? noticeParts.join(" ") : void 0;
    return {
      questions: finalQuestions,
      supplementedFromTextbook: supplementCount > 0 || Boolean(supplementNotice),
      supplementNotice,
      modelUsed: runResult.modelUsed || "unknown"
    };
  }
};
var ExamPipelineService = class {
  static async generateBlueprint(params) {
    const {
      title,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters,
      durationMinutes,
      totalScore,
      referenceChunks,
      actorUid,
      tokensOut,
      config,
      idToken
    } = params;
    const relevant = referenceChunks.filter((c) => c.grade === grade && c.subject === subject).slice(0, 10).map((c) => `${c.chapter} - ${c.lesson}: ${c.content.slice(0, 220)}`).join("\n");
    const prompt = [
      `L\u1EADp MA TR\u1EACN \u0110\u1EC0 KI\u1EC2M TRA chu\u1EA9n GDPT 2018 cho m\xF4n ${SUBJECT_LABELS[subject]} l\u1EDBp ${grade} (${textbookSeries}).`,
      `Lo\u1EA1i k\u1EF3 thi: ${EXAM_TYPE_LABELS[examType]} | H\u1ECDc k\u1EF3 ${semester} | Th\u1EDDi gian: ${durationMinutes} ph\xFAt | T\u1ED5ng \u0111i\u1EC3m b\u1EAFt bu\u1ED9c: ${totalScore}.`,
      `Ph\u1EA1m vi ch\u01B0\u01A1ng/b\xE0i: ${chapters.length > 0 ? chapters.join(", ") : "To\xE0n b\u1ED9 h\u1ECDc k\u1EF3"}.`,
      "Y\xEAu c\u1EA7u b\u1EAFt bu\u1ED9c:",
      "- T\u1EA1o t\u1EEB 4 \u0111\u1EBFn 10 d\xF2ng ma tr\u1EADn ph\xE2n b\u1ED5 r\xF5 r\xE0ng gi\u1EEFa c\xE1c ch\u01B0\u01A1ng, m\u1EE9c \u0111\u1ED9 nh\u1EADn th\u1EE9c (nhan_biet ~30%, thong_hieu ~30%, van_dung ~25%, van_dung_cao ~15%) v\xE0 d\u1EA1ng c\xE2u h\u1ECFi (abcd, true_false, short_answer).",
      `- T\u1ED5ng c\u1EE7a (questionCount * scorePerQuestion) qua T\u1EA4T C\u1EA2 c\xE1c d\xF2ng PH\u1EA2I B\u1EB0NG \u0110\xDANG ${totalScore}. learningOutcome vi\u1EBFt ng\u1EAFn g\u1ECDn t\u1ED1i \u0111a 1 c\xE2u.`,
      relevant ? `N\u1ED9i dung tham chi\u1EBFu c\xF3 s\u1EB5n:
${relevant}` : ""
    ].filter(Boolean).join("\n\n");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "quiz_blueprint",
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        grade,
        subject,
        textbookSeries,
        examType,
        semester,
        chapters: [...chapters].sort().join("|"),
        durationMinutes,
        totalScore,
        relevantDigest: relevant.slice(0, 1200)
      },
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt,
        thinkingTier: "low",
        maxOutputTokens: 1536,
        tokensOut,
        fallbackJson: '{"title":"","rows":[]}',
        groqSchemaHint: '{"title":"...","rows":[{"chapter":"...","topic":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","questionType":"abcd|true_false|short_answer","questionCount":2,"scorePerQuestion":0.25,"learningOutcome":"..."}]}'
      })
    });
    const validCogs = /* @__PURE__ */ new Set(["nhan_biet", "thong_hieu", "van_dung", "van_dung_cao"]);
    const validTypes = /* @__PURE__ */ new Set(["abcd", "true_false", "short_answer"]);
    const rows = (parsed.rows || []).map((r, idx) => ({
      rowId: `row_${idx + 1}`,
      chapter: r.chapter || chapters[0] || "Ch\u01B0\u01A1ng 1",
      topic: r.topic || "Ch\u1EE7 \u0111\u1EC1 tr\u1ECDng t\xE2m",
      cognitiveLevel: validCogs.has(r.cognitiveLevel) ? r.cognitiveLevel : "thong_hieu",
      questionType: validTypes.has(r.questionType) ? r.questionType : "abcd",
      questionCount: Math.max(1, Math.round(Number(r.questionCount) || 2)),
      scorePerQuestion: Math.max(0.25, Number(r.scorePerQuestion) || 0.25),
      learningOutcome: r.learningOutcome || "N\u1EAFm v\u1EEFng ki\u1EBFn th\u1EE9c v\xE0 v\u1EADn d\u1EE5ng gi\u1EA3i b\xE0i t\u1EADp."
    }));
    const bpCheck = validateExamBlueprint({
      blueprintId: "tmp",
      title: title || parsed.title || `${EXAM_TYPE_LABELS[examType]} - ${SUBJECT_LABELS[subject]} ${grade}`,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters,
      durationMinutes,
      totalScore,
      cognitiveDistribution: { nhan_biet: 30, thong_hieu: 30, van_dung: 25, van_dung_cao: 15 },
      rows,
      status: "draft",
      createdBy: actorUid,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (!bpCheck.valid && rows.length > 0) {
      const currentSum = rows.reduce((s, r) => s + r.questionCount * r.scorePerQuestion, 0);
      if (currentSum > 0) {
        const factor = totalScore / currentSum;
        for (const r of rows) {
          r.scorePerQuestion = Math.round(r.scorePerQuestion * factor * 100) / 100;
        }
        const afterSum = rows.reduce((s, r) => s + r.questionCount * r.scorePerQuestion, 0);
        const diff = Math.round((totalScore - afterSum) * 100) / 100;
        if (Math.abs(diff) > 1e-3) {
          const last = rows[rows.length - 1];
          last.scorePerQuestion = Math.round((last.scorePerQuestion + diff / last.questionCount) * 100) / 100;
        }
      }
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return {
      blueprintId: `bp_${Date.now()}_${crypto6.randomBytes(3).toString("hex")}`,
      title: title?.trim() || parsed.title || `${EXAM_TYPE_LABELS[examType]} - ${SUBJECT_LABELS[subject]} ${grade}`,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters,
      durationMinutes,
      totalScore,
      cognitiveDistribution: { nhan_biet: 30, thong_hieu: 30, van_dung: 25, van_dung_cao: 15 },
      rows,
      status: "draft",
      createdBy: actorUid,
      createdAt: now,
      updatedAt: now
    };
  }
  static async generateExamFromBlueprint(params) {
    const { blueprint, referenceChunks, tokensOut, config, idToken } = params;
    const contextChunks = referenceChunks.filter((c) => c.grade === blueprint.grade && c.subject === blueprint.subject).slice(0, 12).map((c) => `[${c.chapter} | Tr.${c.pageNumber}] ${c.content.slice(0, 350)}`).join("\n");
    const rowsSpec = blueprint.rows.map(
      (r, idx) => `${idx + 1}. Ch\u01B0\u01A1ng "${r.chapter}" | Ch\u1EE7 \u0111\u1EC1 "${r.topic}" | M\u1EE9c: ${r.cognitiveLevel} | D\u1EA1ng: ${r.questionType} | S\u1ED1 c\xE2u: ${r.questionCount} | \u0110i\u1EC3m/c\xE2u: ${r.scorePerQuestion} | Y\xEAu c\u1EA7u c\u1EA7n \u0111\u1EA1t: ${r.learningOutcome}`
    ).join("\n");
    const prompt = [
      `So\u1EA1n \u0110\u1EC0 KI\u1EC2M TRA ho\xE0n ch\u1EC9nh tu\xE2n th\u1EE7 CH\xCDNH X\xC1C Ma tr\u1EADn \u0111\u1EC1 sau (${SUBJECT_LABELS[blueprint.subject]} l\u1EDBp ${blueprint.grade}, b\u1ED9 s\xE1ch ${blueprint.textbookSeries}):`,
      rowsSpec,
      "",
      "QUY \u0110\u1ECANH D\u1EA0NG C\xC2U H\u1ECEI:",
      '- D\u1EA1ng abcd: c\xF3 optionA, optionB, optionC, optionD v\xE0 correctAnswer ("A"|"B"|"C"|"D").',
      '- D\u1EA1ng true_false: c\xF3 \u0111\xFAng 4 \xFD a, b, c, d trong trueFalseStatements [{ label: "a"|"b"|"c"|"d", text, isTrue }].',
      '- D\u1EA1ng short_answer: c\xF3 shortAnswerAccepted (m\u1EA3ng c\xE1c \u0111\xE1p \xE1n ng\u1EAFn chu\u1EA9n, v\xED d\u1EE5 ["0.5", "0,5"] ho\u1EB7c t\u1EEB kh\xF3a ng\u1EAFn).',
      "- M\u1ED7i c\xE2u ghi r\xF5 explanation (ng\u1EAFn g\u1ECDn t\u1ED1i \u0111a 2 c\xE2u) v\xE0 sourceReference.",
      contextChunks ? `
NG\u1EEE LI\u1EC6U S\xC1CH GI\xC1O KHOA THAM CHI\u1EBEU:
${contextChunks}` : ""
    ].filter(Boolean).join("\n");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "quiz_generation",
      config,
      idToken,
      bypassCache: true,
      allowGroqRescue: true,
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt,
        thinkingTier: "low",
        maxOutputTokens: 4096,
        tokensOut,
        fallbackJson: '{"questions":[]}',
        groqSchemaHint: '{"questions":[{"chapterId":"...","conceptId":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","questionType":"abcd|true_false|short_answer","scoreWeight":0.25,"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","trueFalseStatements":[{"label":"a","text":"...","isTrue":true}],"shortAnswerAccepted":["..."],"explanation":"...","sourceReference":"..."}]}'
      })
    });
    const validCogs = /* @__PURE__ */ new Set(["nhan_biet", "thong_hieu", "van_dung", "van_dung_cao"]);
    const validTypes = /* @__PURE__ */ new Set(["abcd", "true_false", "short_answer"]);
    let needsReview = false;
    const questions = (parsed.questions || []).map((q, idx) => {
      const qType = validTypes.has(q.questionType) ? q.questionType : "abcd";
      const cog = validCogs.has(q.cognitiveLevel) ? q.cognitiveLevel : "thong_hieu";
      const ans = q.correctAnswer === "A" || q.correctAnswer === "B" || q.correctAnswer === "C" || q.correctAnswer === "D" ? q.correctAnswer : "A";
      const stmts = qType === "true_false" ? ["a", "b", "c", "d"].map((lbl, sIdx) => ({
        label: lbl,
        text: q.trueFalseStatements?.[sIdx]?.text || `Ph\xE1t bi\u1EC3u ${lbl}`,
        isTrue: Boolean(q.trueFalseStatements?.[sIdx]?.isTrue)
      })) : void 0;
      const accepted = qType === "short_answer" ? q.shortAnswerAccepted && q.shortAnswerAccepted.length > 0 ? q.shortAnswerAccepted : ["0"] : void 0;
      if (!q.questionText || !q.explanation) {
        needsReview = true;
      }
      return {
        questionId: `eq_${Date.now()}_${idx + 1}_${crypto6.randomBytes(2).toString("hex")}`,
        orderIndex: idx + 1,
        chapterId: q.chapterId || blueprint.chapters[0] || "T\u1ED5ng h\u1EE3p",
        conceptId: q.conceptId || "Ki\u1EBFn th\u1EE9c tr\u1ECDng t\xE2m",
        learningOutcome: q.learningOutcome || "\u0110\u1EA1t chu\u1EA9n ki\u1EBFn th\u1EE9c k\u1EF9 n\u0103ng",
        cognitiveLevel: cog,
        questionType: qType,
        scoreWeight: Math.max(0.1, Number(q.scoreWeight) || 0.25),
        questionText: q.questionText,
        optionA: qType === "abcd" ? q.optionA || "Ph\u01B0\u01A1ng \xE1n A" : void 0,
        optionB: qType === "abcd" ? q.optionB || "Ph\u01B0\u01A1ng \xE1n B" : void 0,
        optionC: qType === "abcd" ? q.optionC || "Ph\u01B0\u01A1ng \xE1n C" : void 0,
        optionD: qType === "abcd" ? q.optionD || "Ph\u01B0\u01A1ng \xE1n D" : void 0,
        correctAnswer: qType === "abcd" ? ans : void 0,
        trueFalseStatements: stmts,
        shortAnswerAccepted: accepted,
        explanation: q.explanation,
        sourceReference: q.sourceReference || blueprint.textbookSeries,
        sourceType: "textbook_reference",
        validationStatus: q.questionText && q.explanation ? "passed" : "needs_review"
      };
    });
    return {
      questions,
      validationStatus: needsReview ? "needs_review" : "passed"
    };
  }
  static async rewriteSingleQuestion(params) {
    const { question, instruction, grade, subject, textbookSeries, tokensOut, config, idToken } = params;
    const prompt = [
      `Vi\u1EBFt l\u1EA1i c\xE2u h\u1ECFi ki\u1EC3m tra m\xF4n ${SUBJECT_LABELS[subject]} l\u1EDBp ${grade} (${textbookSeries}) theo y\xEAu c\u1EA7u c\u1EE7a Admin.`,
      `Y\xEAu c\u1EA7u ch\u1EC9nh s\u1EEDa: ${instruction || "L\xE0m c\xE2u h\u1ECFi r\xF5 r\xE0ng, ch\xEDnh x\xE1c, ph\u01B0\u01A1ng \xE1n nhi\u1EC5u h\u1EE3p l\xFD h\u01A1n."}`,
      `Gi\u1EEF nguy\xEAn questionType="${question.questionType}", scoreWeight=${question.scoreWeight}, cognitiveLevel="${question.cognitiveLevel}". explanation ng\u1EAFn g\u1ECDn t\u1ED1i \u0111a 2 c\xE2u.`,
      `C\xE2u h\u1ECFi hi\u1EC7n t\u1EA1i:
${JSON.stringify(question)}`
    ].join("\n\n");
    const { data: updated } = await runTaskWithRouter({
      taskType: "quiz_validation",
      config,
      idToken,
      bypassCache: true,
      allowGroqRescue: true,
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt,
        thinkingTier: "minimal",
        maxOutputTokens: 768,
        tokensOut,
        fallbackJson: "{}",
        groqSchemaHint: '{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","shortAnswerAccepted":["..."],"explanation":"...","sourceReference":"..."}'
      })
    });
    return {
      ...question,
      questionText: updated.questionText || question.questionText,
      optionA: question.questionType === "abcd" ? updated.optionA || question.optionA : void 0,
      optionB: question.questionType === "abcd" ? updated.optionB || question.optionB : void 0,
      optionC: question.questionType === "abcd" ? updated.optionC || question.optionC : void 0,
      optionD: question.questionType === "abcd" ? updated.optionD || question.optionD : void 0,
      correctAnswer: question.questionType === "abcd" && (updated.correctAnswer === "A" || updated.correctAnswer === "B" || updated.correctAnswer === "C" || updated.correctAnswer === "D") ? updated.correctAnswer : question.correctAnswer,
      shortAnswerAccepted: question.questionType === "short_answer" && updated.shortAnswerAccepted?.length ? updated.shortAnswerAccepted : question.shortAnswerAccepted,
      explanation: updated.explanation || question.explanation,
      sourceReference: updated.sourceReference || question.sourceReference,
      validationStatus: "repaired"
    };
  }
  static async extractQuestionsFromSampleExam(params) {
    const {
      files,
      title,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      durationMinutes,
      totalScore,
      includeTrueFalse = false,
      actorUid,
      tokensOut,
      config,
      idToken
    } = params;
    const first = files[0];
    if (!first) {
      throw new Error("Vui l\xF2ng ch\u1ECDn \xEDt nh\u1EA5t m\u1ED9t t\u1EC7p \u0111\u1EC1 m\u1EABu.");
    }
    const extractedChunks = [];
    const inlineParts = [];
    for (const f of files) {
      if (f.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const mammothMod = await import("mammoth");
        const mammothApi = mammothMod.default || mammothMod;
        const result = await mammothApi.extractRawText({ buffer: f.buffer });
        const txt = (result.value || "").trim();
        if (txt) {
          extractedChunks.push(`=== T\u1EC6P DOCX: ${f.originalName} ===
${txt}`);
        }
      } else if (f.mimeType === "application/pdf") {
        let pdfExtracted = "";
        try {
          const { extractPdfPagesFromBuffer: extractPdfPagesFromBuffer2 } = await Promise.resolve().then(() => (init_referenceIngestService(), referenceIngestService_exports));
          const textPages = await extractPdfPagesFromBuffer2(f.buffer);
          const joined = textPages.map((p) => `--- TRANG ${p.pageNumber} ---
${p.text}`).join("\n\n");
          if (joined.replace(/\s+/g, "").length >= 80) {
            pdfExtracted = joined;
          }
        } catch {
        }
        if (pdfExtracted) {
          extractedChunks.push(`=== T\u1EC6P PDF: ${f.originalName} ===
${pdfExtracted}`);
        } else {
          inlineParts.push({
            inlineData: {
              mimeType: "application/pdf",
              data: f.buffer.toString("base64")
            }
          });
        }
      } else {
        inlineParts.push({
          inlineData: {
            mimeType: f.mimeType,
            data: f.buffer.toString("base64")
          }
        });
      }
    }
    const extractedTextContent = extractedChunks.join("\n\n");
    if (!extractedTextContent && inlineParts.length === 0) {
      throw new Error("Kh\xF4ng \u0111\u1ECDc \u0111\u01B0\u1EE3c n\u1ED9i dung v\u0103n b\u1EA3n ho\u1EB7c h\xECnh \u1EA3nh t\u1EEB t\u1EC7p \u0111\u1EC1 m\u1EABu \u0111\xE3 ch\u1ECDn.");
    }
    const allowedFormatsDesc = includeTrueFalse ? "Tr\u1EAFc nghi\u1EC7m 4 l\u1EF1a ch\u1ECDn (abcd), Tr\u1EAFc nghi\u1EC7m \u0110\xFAng/Sai 4 \xFD (true_false) v\xE0 Tr\u1EA3 l\u1EDDi ng\u1EAFn (short_answer). B\u1ECE QUA ph\u1EA7n t\u1EF1 lu\u1EADn d\xE0i." : 'CH\u1EC8 2 d\u1EA1ng: Tr\u1EAFc nghi\u1EC7m 4 l\u1EF1a ch\u1ECDn ABCD (questionType = "abcd") v\xE0 Tr\u1EA3 l\u1EDDi ng\u1EAFn / \u0111i\u1EC1n \u0111\xE1p s\u1ED1 (questionType = "short_answer"). B\u1ECE QUA ph\u1EA7n \u0110\xFAng/Sai v\xE0 T\u1EF1 lu\u1EADn d\xE0i.';
    const promptText = [
      `NHI\u1EC6M V\u1EE4: \u0110\u1ECDc file \u0111\u1EC1 ki\u1EC3m tra m\u1EABu m\xF4n ${SUBJECT_LABELS[subject]} l\u1EDBp ${grade} v\xE0 SAO CH\xC9P NGUY\xCAN V\u0102N c\xE1c c\xE2u h\u1ECFi theo \u0111\xFAng \u0111\u1EC1 g\u1ED1c.`,
      `Ph\u1EA1m vi tr\xEDch xu\u1EA5t: ${allowedFormatsDesc}`,
      "QUY T\u1EAEC SAO CH\xC9P NGHI\xCAM NG\u1EB6T:",
      "1. Gi\u1EEF nguy\xEAn v\u0103n n\u1ED9i dung c\xE2u h\u1ECFi (questionText), c\xF4ng th\u1EE9c, s\u1ED1 li\u1EC7u t\u1EEB \u0111\u1EC1 m\u1EABu \u2014 TUY\u1EC6T \u0110\u1ED0I KH\xD4NG t\u1EF1 ch\u1EBF hay b\u1ECBa th\xEAm c\xE2u m\u1EDBi.",
      '2. V\u1EDBi c\xE2u "abcd": ch\xE9p nguy\xEAn v\u0103n 4 ph\u01B0\u01A1ng \xE1n v\xE0o optionA, optionB, optionC, optionD (lo\u1EA1i b\u1ECF ti\u1EC1n t\u1ED1 "A.", "B.", "C.", "D." \u1EDF \u0111\u1EA7u n\u1EBFu c\xF3 \u0111\u1EC3 tr\xE1nh l\u1EB7p khi hi\u1EC3n th\u1ECB).',
      '3. V\u1EDBi c\xE2u "short_answer": ch\xE9p nguy\xEAn v\u0103n \u0111\u1EC1 b\xE0i v\xE0o questionText v\xE0 \u0111i\u1EC1n \u0111\xE1p \xE1n ng\u1EAFn v\xE0o shortAnswerAccepted (n\u1EBFu l\xE0 s\u1ED1 th\u1EADp ph\xE2n h\xE3y ghi c\u1EA3 d\u1EA1ng d\u1EA5u ch\u1EA5m v\xE0 d\u1EA5u ph\u1EA9y, v\xED d\u1EE5 ["0.5", "0,5"]).',
      includeTrueFalse ? '4. V\u1EDBi c\xE2u "true_false": ch\xE9p 4 m\u1EC7nh \u0111\u1EC1 a, b, c, d v\xE0o trueFalseStatements [{ label, text, isTrue }].' : "",
      "5. \u0110\xE1p \xE1n: N\u1EBFu file \u0111\u1EC1 c\xF3 b\u1EA3ng \u0111\xE1p \xE1n/\u0111\xE1nh d\u1EA5u s\u1EB5n \u0111\xE1p \xE1n \u0111\xFAng th\xEC ch\xE9p ch\xEDnh x\xE1c v\xE0 \u0111\u1EB7t answerFromSource = true. N\u1EBFu file ch\u01B0a k\xE8m \u0111\xE1p \xE1n th\xEC gi\u1EA3i nhanh ch\xEDnh x\xE1c \u0111\u1EC3 \u0111i\u1EC1n correctAnswer / shortAnswerAccepted v\xE0 \u0111\u1EB7t answerFromSource = false.",
      "6. N\u1EBFu \u0111\u1EC1 g\u1ED1c c\xF3 ghi \u0111i\u1EC3m t\u1EEBng c\xE2u (v\xED d\u1EE5 0.25\u0111, 0.5\u0111), \u0111i\u1EC1n v\xE0o scoreWeight; n\u1EBFu kh\xF4ng ghi th\xEC \u0111\u1EB7t 0.25.",
      "7. T\u1ED1i \u0111a 60 c\xE2u h\u1ECFi. Gi\u1EEF \u0111\xFAng th\u1EE9 t\u1EF1 t\u1EEB \u0111\u1EA7u \u0111\u1EBFn cu\u1ED1i \u0111\u1EC1. explanation vi\u1EBFt ng\u1EAFn g\u1ECDn t\u1ED1i \u0111a 1-2 c\xE2u.",
      extractedTextContent ? `
=== N\u1ED8I DUNG FILE \u0110\u1EC0 M\u1EAAU ===
${extractedTextContent.slice(0, 48e3)}` : ""
    ].filter(Boolean).join("\n");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "curriculum_extraction",
      config,
      idToken,
      bypassCache: true,
      allowGroqRescue: true,
      runWithModel: async (modelId) => {
        const hasPdfBinary = inlineParts.some((p) => p.inlineData.mimeType === "application/pdf");
        if (hasPdfBinary) {
          throw new Error(
            "T\u1EC7p \u0111\u1EC1 m\u1EABu PDF n\xE0y l\xE0 b\u1EA3n scan \u1EA3nh (kh\xF4ng ch\u1EE9a l\u1EDBp v\u0103n b\u1EA3n nh\xFAng). Vui l\xF2ng ch\u1EE5p ho\u1EB7c xu\u1EA5t t\u1EEBng trang sang \u1EA3nh JPG/PNG/WEBP (ho\u1EB7c t\u1EA3i t\u1EC7p PDF/DOCX c\xF3 v\u0103n b\u1EA3n ch\u1ECDn \u0111\u01B0\u1EE3c) \u0111\u1EC3 h\u1EC7 th\u1ED1ng tr\xEDch xu\u1EA5t c\xE2u h\u1ECFi ch\xEDnh x\xE1c."
          );
        }
        const imageParts = inlineParts.filter((p) => p.inlineData.mimeType.startsWith("image/")).map((p) => ({ mimeType: p.inlineData.mimeType, base64: p.inlineData.data }));
        const sampleSchemaHint = '{"detectedTitle":"...","questions":[{"questionType":"abcd|short_answer|true_false","questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","shortAnswerAccepted":["..."],"scoreWeight":0.25,"answerFromSource":true,"explanation":"...","chapter":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao"}]}';
        if (isGroqModelId(modelId)) {
          const resp2 = await callWithTimeout(
            (signal) => callGroqChatCompletion({
              modelId: imageParts.length > 0 ? GROQ_SCAN_VISION_MODEL : modelId,
              prompt: promptText,
              images: imageParts.length > 0 ? imageParts : void 0,
              jsonMode: true,
              jsonSchemaHint: sampleSchemaHint,
              maxOutputTokens: 6144,
              signal
            })
          );
          accumulateRawTokens(tokensOut, resp2);
          return safeParseModelJson(resp2.text || "", '{"questions":[]}');
        }
        if (isCloudflareModelId(modelId)) {
          const resp2 = await callWithTimeout(
            (signal) => callCloudflareChatCompletion({
              modelId: imageParts.length > 0 ? CF_VISION_MODEL : modelId,
              prompt: promptText,
              images: imageParts.length > 0 ? imageParts : void 0,
              jsonMode: true,
              jsonSchemaHint: sampleSchemaHint,
              maxOutputTokens: 6144,
              signal
            })
          );
          accumulateRawTokens(tokensOut, resp2);
          return safeParseModelJson(resp2.text || "", '{"questions":[]}');
        }
        const resp = await callWithTimeout(
          (signal) => callMistralChatCompletion({
            modelId: imageParts.length > 0 ? MISTRAL_VISION_MODEL : isMistralModelId(modelId) ? modelId : MISTRAL_PRIMARY_MODEL,
            prompt: promptText,
            images: imageParts.length > 0 ? imageParts : void 0,
            jsonMode: true,
            jsonSchemaHint: sampleSchemaHint,
            maxOutputTokens: 6144,
            signal
          })
        );
        accumulateRawTokens(tokensOut, resp);
        return safeParseModelJson(resp.text || "", '{"questions":[]}');
      }
    });
    const allowedTypes = new Set(
      includeTrueFalse ? ["abcd", "short_answer", "true_false"] : ["abcd", "short_answer"]
    );
    const validCogs = /* @__PURE__ */ new Set(["nhan_biet", "thong_hieu", "van_dung", "van_dung_cao"]);
    const cleanOptionPrefix = (raw, fallback) => (raw || fallback).trim().replace(/^[A-Da-d][.):\-]\s*/, "").trim() || fallback;
    let abcdCount = 0;
    let shortAnswerCount = 0;
    let trueFalseCount = 0;
    let inferredAnswersCount = 0;
    let hasExplicitWeights = false;
    const rawMapped = [];
    for (const q of parsed.questions || []) {
      if (rawMapped.length >= 60) break;
      const qText = (q.questionText || "").trim();
      if (!qText) continue;
      const qType = allowedTypes.has(q.questionType) ? q.questionType : q.optionA || q.optionB ? "abcd" : q.shortAnswerAccepted && q.shortAnswerAccepted.length > 0 ? "short_answer" : "abcd";
      if (!allowedTypes.has(qType)) continue;
      const cog = validCogs.has(q.cognitiveLevel) ? q.cognitiveLevel : "thong_hieu";
      const ansLetter = q.correctAnswer === "A" || q.correctAnswer === "B" || q.correctAnswer === "C" || q.correctAnswer === "D" ? q.correctAnswer : "A";
      let shortAccepted;
      if (qType === "short_answer") {
        const baseList = (q.shortAnswerAccepted || []).map((s) => String(s).trim()).filter(Boolean);
        const expanded = new Set(baseList);
        for (const item of baseList) {
          if (item.includes(".")) expanded.add(item.replace(/\./g, ","));
          if (item.includes(",")) expanded.add(item.replace(/,/g, "."));
        }
        shortAccepted = expanded.size > 0 ? Array.from(expanded) : [""];
      }
      const stmts = qType === "true_false" ? ["a", "b", "c", "d"].map((lbl, sIdx) => ({
        label: lbl,
        text: q.trueFalseStatements?.[sIdx]?.text || `Ph\xE1t bi\u1EC3u ${lbl}`,
        isTrue: Boolean(q.trueFalseStatements?.[sIdx]?.isTrue)
      })) : void 0;
      const answerKnown = q.answerFromSource !== false;
      if (!answerKnown) inferredAnswersCount += 1;
      if (typeof q.scoreWeight === "number" && q.scoreWeight > 0) {
        hasExplicitWeights = true;
      }
      if (qType === "abcd") abcdCount += 1;
      else if (qType === "short_answer") shortAnswerCount += 1;
      else if (qType === "true_false") trueFalseCount += 1;
      rawMapped.push({
        questionId: `eq_${Date.now()}_${rawMapped.length + 1}_${crypto6.randomBytes(2).toString("hex")}`,
        orderIndex: rawMapped.length + 1,
        chapterId: (q.chapter || "Theo \u0111\u1EC1 m\u1EABu").slice(0, 120),
        conceptId: "Theo \u0111\u1EC1 m\u1EABu",
        learningOutcome: "Theo c\u1EA5u tr\xFAc \u0111\u1EC1 m\u1EABu",
        cognitiveLevel: cog,
        questionType: qType,
        scoreWeight: typeof q.scoreWeight === "number" && q.scoreWeight > 0 ? q.scoreWeight : 0.25,
        questionText: qText,
        optionA: qType === "abcd" ? cleanOptionPrefix(q.optionA, "Ph\u01B0\u01A1ng \xE1n A") : void 0,
        optionB: qType === "abcd" ? cleanOptionPrefix(q.optionB, "Ph\u01B0\u01A1ng \xE1n B") : void 0,
        optionC: qType === "abcd" ? cleanOptionPrefix(q.optionC, "Ph\u01B0\u01A1ng \xE1n C") : void 0,
        optionD: qType === "abcd" ? cleanOptionPrefix(q.optionD, "Ph\u01B0\u01A1ng \xE1n D") : void 0,
        correctAnswer: qType === "abcd" ? ansLetter : void 0,
        trueFalseStatements: stmts,
        shortAnswerAccepted: shortAccepted,
        explanation: (q.explanation || "").trim() || (answerKnown ? "Tr\xEDch xu\u1EA5t t\u1EEB \u0111\u1EC1 m\u1EABu." : "\u0110\xE1p \xE1n do AI gi\u1EA3i t\u1EEB \u0111\u1EC1 m\u1EABu \u2014 Admin vui l\xF2ng r\xE0 so\xE1t l\u1EA1i."),
        sourceReference: `\u0110\u1EC1 m\u1EABu: ${first.originalName}`,
        sourceType: "public_exam_reference",
        validationStatus: answerKnown ? "passed" : "needs_review"
      });
    }
    if (rawMapped.length === 0) {
      throw new Error(
        "Kh\xF4ng t\xECm th\u1EA5y c\xE2u h\u1ECFi Tr\u1EAFc nghi\u1EC7m ABCD ho\u1EB7c Tr\u1EA3 l\u1EDDi ng\u1EAFn n\xE0o trong t\u1EC7p \u0111\u1EC1 m\u1EABu \u0111\xE3 t\u1EA3i l\xEAn."
      );
    }
    const sumExplicit = rawMapped.reduce((s, q) => s + q.scoreWeight, 0);
    const shouldRedistribute = !hasExplicitWeights || Math.abs(sumExplicit - totalScore) > 0.25;
    const questions = shouldRedistribute ? distributeExamQuestionScores(rawMapped, totalScore) : rawMapped;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const fallbackTitle = first.originalName.replace(/\.[^.]+$/, "") || `${EXAM_TYPE_LABELS[examType]} - ${SUBJECT_LABELS[subject]} ${grade}`;
    const exam = {
      examId: `exam_${Date.now()}_${crypto6.randomBytes(3).toString("hex")}`,
      blueprintId: "imported_sample_exam",
      title: (title?.trim() || parsed.detectedTitle?.trim() || fallbackTitle).slice(0, 190),
      description: `Tr\xEDch xu\u1EA5t nguy\xEAn v\u0103n t\u1EEB \u0111\u1EC1 m\u1EABu "${first.originalName}" (${abcdCount} c\xE2u ABCD, ${shortAnswerCount} c\xE2u Tr\u1EA3 l\u1EDDi ng\u1EAFn${trueFalseCount > 0 ? `, ${trueFalseCount} c\xE2u \u0110\xFAng/Sai` : ""}).`,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters: [],
      durationMinutes,
      totalScore,
      allowRetake: true,
      published: false,
      validationStatus: inferredAnswersCount > 0 ? "needs_review" : "passed",
      questions,
      createdBy: actorUid,
      createdAt: now,
      updatedAt: now
    };
    return {
      exam,
      summary: {
        totalExtracted: questions.length,
        abcdCount,
        shortAnswerCount,
        trueFalseCount,
        inferredAnswersCount
      }
    };
  }
};
var FlashcardGenerationService = class {
  static async generateFromAnalysis(params) {
    const {
      ownerUid,
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      count = 6,
      tokensOut,
      config,
      idToken
    } = params;
    const weakClaims = claims.filter(
      (c) => c.evaluationStatus === "INCORRECT" || c.evaluationStatus === "PARTIALLY_CORRECT" || c.evaluationStatus === "UNVERIFIED"
    );
    const missing = coverageItems.filter((m) => m.status === "MISSING" || m.status === "PARTIALLY_COVERED");
    const sourceContext = [
      ...weakClaims.map((c) => `[${c.chapter} | ${c.concept}] Sai/Thi\u1EBFu: "${c.sourceText}" -> \u0110\xFAng: "${c.correctKnowledge}"`),
      ...missing.map((m) => `[${m.chapter} | ${m.concept}] B\u1ED5 sung: "${m.suggestedAddition}"`)
    ];
    if (sourceContext.length === 0) {
      for (const c of claims.slice(0, 6)) {
        sourceContext.push(`[${c.chapter} | ${c.concept}] "${c.correctKnowledge || c.sourceText}"`);
      }
    }
    const safeCount = Math.min(12, Math.max(3, count));
    const prompt = [
      `T\u1EA1o ${safeCount} th\u1EBB ghi nh\u1EDB (Flashcard) ng\u1EAFn g\u1ECDn, s\xFAc t\xEDch cho h\u1ECDc sinh l\u1EDBp ${grade} m\xF4n ${SUBJECT_LABELS[subject]} (${textbookTitle || "SGK chu\u1EA9n"}).`,
      "M\u1EB7t tr\u01B0\u1EDBc (front): T\u1ED1i \u0111a 1 c\xE2u ng\u1EAFn g\u1EE3i nh\u1EDB ho\u1EB7c t\xEAn c\xF4ng th\u1EE9c/\u0111i\u1EC1u ki\u1EC7n d\u1EC5 nh\u1EA7m.",
      "M\u1EB7t sau (back): T\u1ED1i \u0111a 2 c\xE2u ng\u1EAFn g\u1ECDn v\u1EC1 ki\u1EBFn th\u1EE9c chu\u1EA9n, \u0111i\u1EC1u ki\u1EC7n \xE1p d\u1EE5ng ho\u1EB7c c\xE1ch s\u1EEDa l\u1ED7i sai.",
      "",
      sourceContext.join("\n").slice(0, 8e3)
    ].join("\n");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "flashcard_generation",
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: { subject, grade, safeCount, sourceDigest: sourceContext.join("|").slice(0, 3e3) },
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt,
        thinkingTier: "minimal",
        maxOutputTokens: 1536,
        tokensOut,
        fallbackJson: '{"cards":[]}',
        groqSchemaHint: '{"cards":[{"front":"...","back":"...","chapter":"...","concept":"...","cardType":"concept|formula|condition|mistake_fix|example","sourceReference":"..."}]}'
      })
    });
    const validCardTypes = /* @__PURE__ */ new Set([
      "concept",
      "formula",
      "condition",
      "mistake_fix",
      "example"
    ]);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return (parsed.cards || []).slice(0, safeCount).map((card, idx) => ({
      flashcardId: `fc_${Date.now()}_${idx + 1}_${crypto6.randomBytes(2).toString("hex")}`,
      ownerUid,
      front: card.front,
      back: card.back,
      sourceReference: card.sourceReference || textbookTitle || "T\xE0i li\u1EC7u tham chi\u1EBFu",
      subject,
      grade,
      chapter: card.chapter || "T\u1ED5ng h\u1EE3p",
      concept: card.concept || "Kh\xE1i ni\u1EC7m tr\u1ECDng t\xE2m",
      cardType: validCardTypes.has(card.cardType) ? card.cardType : "mistake_fix",
      masteryStatus: "M\u1EDBi t\u1EA1o",
      reviewStage: 0,
      nextReviewAt: new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString(),
      createdAt: now,
      updatedAt: now
    }));
  }
};
var FeedbackAnalysisService = class {
  static async classifyFeedback(params) {
    const { data } = await runTaskWithRouter({
      taskType: "feedback_analysis",
      config: params.config,
      idToken: params.idToken,
      allowGroqRescue: true,
      cacheInput: { targetType: params.targetType, category: params.category, note: params.note },
      runWithModel: async (modelId) => {
        const text = await generatePlainTextWithProvider({
          modelId,
          prompt: `T\xF3m t\u1EAFt ng\u1EAFn g\u1ECDn (1 c\xE2u ti\u1EBFng Vi\u1EC7t) nguy\xEAn nh\xE2n & h\u01B0\u1EDBng x\u1EED l\xFD cho ph\u1EA3n h\u1ED3i h\u1ECDc sinh [${params.targetType} | ${params.category}]: "${params.note}"`,
          thinkingTier: "minimal",
          maxOutputTokens: 120,
          tokensOut: params.tokensOut
        });
        return text || "C\u1EA7n qu\u1EA3n tr\u1ECB vi\xEAn ki\u1EC3m tra \u0111\u1ED1i chi\u1EBFu l\u1EA1i ngu\u1ED3n s\xE1ch gi\xE1o khoa.";
      }
    });
    return data;
  }
};
var TextbookSynthesisService = class {
  static async synthesizeOutline(params) {
    const {
      grade,
      subject,
      textbookSeries,
      title,
      customTocHint,
      tokensOut,
      config,
      idToken
    } = params;
    const subjectName = SUBJECT_LABELS[subject] || subject;
    const defaultBookTitle = title?.trim() || `SGK ${subjectName} ${grade} - ${textbookSeries}`;
    const webTocContext = "";
    const prompt = [
      `B\u1EA1n l\xE0 chuy\xEAn gia ch\u01B0\u01A1ng tr\xECnh Gi\xE1o d\u1EE5c ph\u1ED5 th\xF4ng 2018 (GDPT 2018) c\u1EE7a B\u1ED9 GD&\u0110T Vi\u1EC7t Nam.`,
      `H\xE3y l\u1EADp danh s\xE1ch M\u1EE4C L\u1EE4C CHU\u1EA8N g\u1ED3m \u0111\u1EA7y \u0111\u1EE7 c\xE1c Ch\u01B0\u01A1ng/Ch\u1EE7 \u0111\u1EC1 v\xE0 danh s\xE1ch c\xE1c B\xE0i h\u1ECDc cho cu\u1ED1n s\xE1ch gi\xE1o khoa:`,
      `- M\xF4n h\u1ECDc: ${subjectName}`,
      `- Kh\u1ED1i l\u1EDBp: L\u1EDBp ${grade}`,
      `- B\u1ED9 s\xE1ch: ${textbookSeries}`,
      `- T\xEAn s\xE1ch g\u1EE3i \xFD: ${defaultBookTitle}`,
      customTocHint?.trim() ? `
[M\u1EE4C L\u1EE4C DO QU\u1EA2N TR\u1ECA VI\xCAN CUNG C\u1EA4P - H\xC3Y B\xC1M S\xC1T 100%]:
${customTocHint.trim().slice(0, 6e3)}` : "",
      webTocContext ? `
[TH\xD4NG TIN TRA C\u1EE8U M\u1EE4C L\u1EE4C THAM KH\u1EA2O]:
${webTocContext}` : "",
      "",
      "Y\xCAU C\u1EA6U \u0110\u1EA6U RA JSON:",
      "- Tr\u1EA3 v\u1EC1 t\u1EEB 4 \u0111\u1EBFn 10 Ch\u01B0\u01A1ng/Ch\u1EE7 \u0111\u1EC1 \u0111\xFAng th\u1EF1c t\u1EBF SGK GDPT 2018.",
      '- M\u1ED7i ch\u01B0\u01A1ng c\xF3: chapterIndex (1, 2, 3...), chapterTitle (v\xED d\u1EE5: "Ch\u01B0\u01A1ng 1: C\u1EA5u t\u1EA1o nguy\xEAn t\u1EED"), lessons (m\u1EA3ng 2-6 t\xEAn b\xE0i h\u1ECDc c\u1EE5 th\u1EC3, v\xED d\u1EE5: ["B\xE0i 1: Th\xE0nh ph\u1EA7n c\u1EE7a nguy\xEAn t\u1EED", "B\xE0i 2: Nguy\xEAn t\u1ED1 h\xF3a h\u1ECDc"]), estimatedPageStart (s\u1ED1 trang b\u1EAFt \u0111\u1EA7u \u01B0\u1EDBc t\xEDnh t\u0103ng d\u1EA7n, v\xED d\u1EE5: 6, 25, 48...).'
    ].filter(Boolean).join("\n");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "curriculum_extraction",
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        outlineTask: "sgk_outline_v1",
        grade,
        subject,
        textbookSeries,
        customTocHint: (customTocHint || "").trim().slice(0, 1200)
      },
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt,
        thinkingTier: "low",
        maxOutputTokens: 2048,
        tokensOut,
        fallbackJson: '{"bookTitle":"","chapters":[]}',
        groqSchemaHint: '{"bookTitle":"...","chapters":[{"chapterIndex":1,"chapterTitle":"Ch\u01B0\u01A1ng 1: ...","lessons":["B\xE0i 1: ...","B\xE0i 2: ..."],"estimatedPageStart":6}]}'
      })
    });
    const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    const normalizedChapters = rawChapters.filter((ch) => ch && typeof ch.chapterTitle === "string" && ch.chapterTitle.trim().length > 0).slice(0, 15).map((ch, idx) => {
      const chapterIndex = idx + 1;
      const rawTitle = ch.chapterTitle.trim().slice(0, 180);
      const chapterTitle = /^(chương|chủ đề|chuyên đề)/i.test(rawTitle) ? rawTitle : `Ch\u01B0\u01A1ng ${chapterIndex}: ${rawTitle}`;
      const lessons = Array.isArray(ch.lessons) ? ch.lessons.map((l) => typeof l === "string" ? l.trim().slice(0, 160) : "").filter(Boolean).slice(0, 10) : [`B\xE0i ${chapterIndex}.1: Ki\u1EBFn th\u1EE9c tr\u1ECDng t\xE2m ${chapterTitle}`];
      const estimatedPageStart = Math.max(
        1,
        Number(ch.estimatedPageStart) || 6 + idx * 22
      );
      return {
        chapterIndex,
        chapterTitle,
        lessons: lessons.length > 0 ? lessons : [`B\xE0i 1: N\u1ED9i dung tr\u1ECDng t\xE2m`],
        estimatedPageStart
      };
    });
    if (normalizedChapters.length === 0) {
      throw new Error("AI kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c m\u1EE5c l\u1EE5c ch\u01B0\u01A1ng h\u1EE3p l\u1EC7. Vui l\xF2ng th\u1EED l\u1EA1i ho\u1EB7c d\xE1n g\u1EE3i \xFD m\u1EE5c l\u1EE5c.");
    }
    return {
      bookTitle: (parsed.bookTitle?.trim() || defaultBookTitle).slice(0, 190),
      chapters: normalizedChapters
    };
  }
  static async synthesizeChapterChunks(params) {
    const {
      referenceId,
      grade,
      subject,
      textbookSeries,
      chapterIndex,
      chapterTitle,
      lessons,
      estimatedPageStart,
      tokensOut,
      config,
      idToken
    } = params;
    const subjectName = SUBJECT_LABELS[subject] || subject;
    const lessonListStr = lessons.length > 0 ? lessons.map((l, i) => `${i + 1}. ${l}`).join("\n") : "1. Ki\u1EBFn th\u1EE9c c\u1ED1t l\xF5i trong ch\u01B0\u01A1ng";
    const prompt = [
      `B\u1EA1n l\xE0 bi\xEAn t\u1EADp vi\xEAn S\xE1ch gi\xE1o khoa chu\u1EA9n ch\u01B0\u01A1ng tr\xECnh GDPT 2018 m\xF4n ${subjectName} L\u1EDBp ${grade} (B\u1ED9 s\xE1ch: ${textbookSeries}).`,
      `H\xE3y bi\xEAn so\u1EA1n c\xE1c \u0111o\u1EA1n tri th\u1EE9c chu\u1EA9n (ReferenceChunk) cho DUY NH\u1EA4T ch\u01B0\u01A1ng sau \u0111\u1EC3 ph\u1EE5c v\u1EE5 h\u1EC7 th\u1ED1ng ki\u1EC3m \u0111\u1ECBnh b\xE0i l\xE0m c\u1EE7a h\u1ECDc sinh:`,
      `- Ch\u01B0\u01A1ng: ${chapterTitle}`,
      `- Danh s\xE1ch b\xE0i h\u1ECDc trong ch\u01B0\u01A1ng:
${lessonListStr}`,
      `- Trang b\u1EAFt \u0111\u1EA7u \u01B0\u1EDBc l\u01B0\u1EE3ng: trang ${estimatedPageStart}`,
      "",
      "Y\xCAU C\u1EA6U N\u1ED8I DUNG T\u1EEANG \u0110O\u1EA0N TRI TH\u1EE8C (CHUNKS):",
      "- T\u1EA1o t\u1EEB 3 \u0111\u1EBFn 8 \u0111o\u1EA1n tri th\u1EE9c (chunks) bao ph\u1EE7 to\xE0n b\u1ED9 c\xE1c b\xE0i h\u1ECDc trong ch\u01B0\u01A1ng tr\xEAn.",
      "- M\u1ED7i \u0111o\u1EA1n (content) d\xE0i kho\u1EA3ng 350\u20131200 k\xFD t\u1EF1, tr\xECnh b\xE0y r\xF5 r\xE0ng, ch\xEDnh x\xE1c tuy\u1EC7t \u0111\u1ED1i theo SGK GDPT 2018:",
      "  1. Kh\xE1i ni\u1EC7m / \u0110\u1ECBnh ngh\u0129a / \u0110\u1ECBnh l\xFD chu\u1EA9n SGK.",
      "  2. C\xF4ng th\u1EE9c / Ph\u01B0\u01A1ng tr\xECnh / Quy t\u1EAFc (n\u1EBFu c\xF3) k\xE8m gi\u1EA3i th\xEDch k\xFD hi\u1EC7u & \u0111\u01A1n v\u1ECB chu\u1EA9n SI.",
      "  3. \u0110i\u1EC1u ki\u1EC7n \xE1p d\u1EE5ng / \u0110i\u1EC1u ki\u1EC7n t\u1ED3n t\u1EA1i (r\u1EA5t quan tr\u1ECDng \u0111\u1EC3 ch\u1EA5m l\u1ED7i thi\u1EBFu \u0111i\u1EC1u ki\u1EC7n).",
      "  4. L\u01B0u \xFD c\xE1c nh\u1EA7m l\u1EABn ho\u1EB7c l\u1ED7i sai h\u1ECDc sinh THPT th\u01B0\u1EDDng g\u1EB7p.",
      "- learningObjectives: 2\u20134 m\u1EE5c ti\xEAu c\u1EA7n \u0111\u1EA1t c\u1EE7a b\xE0i h\u1ECDc (d\xF9ng \u0111\u1EC3 ch\u1EA5m \u0110\u1ED9 \u0111\u1EA7y \u0111\u1EE7 - Completeness).",
      "- keywords: 4\u20138 thu\u1EADt ng\u1EEF tr\u1ECDng t\xE2m.",
      "- conceptTags: 2\u20134 t\xEAn kh\xE1i ni\u1EC7m ng\u1EAFn g\u1ECDn."
    ].join("\n");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "curriculum_extraction",
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        chapterTask: "sgk_chapter_v1",
        grade,
        subject,
        textbookSeries,
        chapterIndex,
        chapterTitle,
        lessons: lessons.join("|")
      },
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt,
        thinkingTier: "low",
        maxOutputTokens: 4096,
        tokensOut,
        fallbackJson: '{"chunks":[]}',
        groqSchemaHint: '{"chunks":[{"lesson":"B\xE0i 1: ...","pageNumber":10,"sectionTitle":"1. Kh\xE1i ni\u1EC7m & C\xF4ng th\u1EE9c","content":"...","keywords":["..."],"learningObjectives":["..."],"conceptTags":["..."]}]}'
      })
    });
    const rawChunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
    const safeRefId = referenceId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
    const sanitizedChunks = rawChunks.filter((c) => c && typeof c.content === "string" && c.content.trim().length >= 30).slice(0, 12).map(
      (c, idx) => sanitizeReferenceChunkForFirestore({
        chunkId: `${safeRefId}_ch${chapterIndex}_${idx + 1}`,
        referenceId: safeRefId,
        grade,
        subject,
        textbookSeries,
        chapter: chapterTitle,
        lesson: c.lesson || lessons[idx % Math.max(1, lessons.length)] || `B\xE0i ${chapterIndex}.${idx + 1}`,
        pageNumber: Math.max(1, Number(c.pageNumber) || estimatedPageStart + idx * 3),
        sectionTitle: c.sectionTitle || c.lesson || "Ki\u1EBFn th\u1EE9c chu\u1EA9n SGK",
        content: c.content,
        keywords: c.keywords,
        learningObjectives: c.learningObjectives,
        conceptTags: c.conceptTags,
        fallbackIndex: chapterIndex * 100 + idx + 1
      })
    );
    if (sanitizedChunks.length === 0) {
      throw new Error(`Kh\xF4ng t\u1EA1o \u0111\u01B0\u1EE3c \u0111o\u1EA1n tri th\u1EE9c n\xE0o cho "${chapterTitle}". Vui l\xF2ng b\u1EA5m Th\u1EED l\u1EA1i ch\u01B0\u01A1ng n\xE0y.`);
    }
    return sanitizedChunks;
  }
  static async ocrScannedTextbookPages(params) {
    const extractedPages = await DocumentExtractionService.extractFromImageBuffers(
      params.files.map((f) => ({
        buffer: f.buffer,
        mimeType: f.mimeType,
        originalName: `page_${f.pageNumber}.jpg`
      })),
      params.tokensOut,
      {
        config: params.config,
        idToken: params.idToken,
        pageOffset: 0
      }
    );
    return params.files.map((f, idx) => ({
      pageNumber: f.pageNumber,
      text: (extractedPages[idx]?.rawText || "").trim()
    }));
  }
};

// src/server/app.ts
init_referenceIngestService();

// src/core/textEncoding.ts
var WIN1252_REVERSE_MAP = {
  8364: 128,
  8218: 130,
  402: 131,
  8222: 132,
  8230: 133,
  8224: 134,
  8225: 135,
  710: 136,
  8240: 137,
  352: 138,
  8249: 139,
  338: 140,
  381: 142,
  8216: 145,
  8217: 146,
  8220: 147,
  8221: 148,
  8226: 149,
  8211: 150,
  8212: 151,
  732: 152,
  8482: 153,
  353: 154,
  8250: 155,
  339: 156,
  382: 158,
  376: 159
};
var HIGH_BYTE_RUN_REGEX = /[\u0080-\u00FF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178]{2,}/g;
var utf8FatalDecoder = new TextDecoder("utf-8", { fatal: true });
function decodeLatin1HighRunAsUtf8(segment) {
  const bytes = new Uint8Array(segment.length);
  for (let i = 0; i < segment.length; i += 1) {
    const code = segment.charCodeAt(i);
    if (code <= 255) {
      bytes[i] = code;
    } else {
      const mapped = WIN1252_REVERSE_MAP[code];
      if (mapped === void 0) {
        return segment;
      }
      bytes[i] = mapped;
    }
  }
  try {
    const decoded = utf8FatalDecoder.decode(bytes);
    if (!decoded || /[\u0000-\u001F\u007F-\u009F\uFFFD]/.test(decoded)) {
      return segment;
    }
    return decoded;
  } catch {
    return segment;
  }
}
function repairUtf8Mojibake(value) {
  if (!value || typeof value !== "string") return value || "";
  let current = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const next = current.replace(HIGH_BYTE_RUN_REGEX, (run) => decodeLatin1HighRunAsUtf8(run));
    if (next === current) break;
    current = next;
  }
  return current;
}

// src/server/app.ts
init_urlSecurity();
var filenameScopeServerCache = /* @__PURE__ */ new Map();
var ALLOWED_UPLOAD_MIMES = /* @__PURE__ */ new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
var upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8",
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 25
  }
});
function hasValidMagicSignature(buffer, mimeType) {
  if (buffer.length < 4) return false;
  if (mimeType === "application/pdf") {
    return buffer.subarray(0, 4).toString("ascii") === "%PDF";
  }
  if (mimeType === "image/png") {
    return buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71;
  }
  if (mimeType === "image/jpeg") {
    return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  }
  if (mimeType === "image/webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return buffer[0] === 80 && buffer[1] === 75 && buffer[2] === 3 && buffer[3] === 4;
  }
  return false;
}
async function requireAuth(req, res, next) {
  try {
    const authUser = await verifyFirebaseRequest(req);
    if (!authUser.emailVerified) {
      res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        error: "Vui l\xF2ng x\xE1c minh \u0111\u1ECBa ch\u1EC9 email tr\u01B0\u1EDBc khi s\u1EED d\u1EE5ng t\xEDnh n\u0103ng x\u1EED l\xFD t\xE0i li\u1EC7u."
      });
      return;
    }
    if (authUser.isSuperAdmin) {
      await hydrateSingleKeyForSuperAdmin(authUser.idToken);
    }
    req.authUser = authUser;
    next();
  } catch {
    res.status(401).json({
      code: "UNAUTHORIZED",
      error: "Phi\xEAn \u0111\u0103ng nh\u1EADp kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 h\u1EBFt h\u1EA1n. Vui l\xF2ng \u0111\u0103ng nh\u1EADp l\u1EA1i."
    });
  }
}
async function requireSuperAdmin(req, res, next) {
  try {
    let authed = false;
    await requireAuth(req, res, () => {
      authed = true;
    });
    if (!authed) return;
    if (!req.authUser?.isSuperAdmin) {
      res.status(403).json({
        code: "FORBIDDEN_SUPER_ADMIN",
        error: "Ch\u1EC9 t\xE0i kho\u1EA3n Super Admin \u0111\u01B0\u1EE3c \u1EE7y quy\u1EC1n m\u1EDBi c\xF3 quy\u1EC1n truy c\u1EADp khu v\u1EF1c qu\u1EA3n tr\u1ECB n\xE0y."
      });
      return;
    }
    next();
  } catch (err) {
    if (res.headersSent) return;
    res.status(500).json({
      code: "AUTH_MIDDLEWARE_ERROR",
      error: err instanceof Error ? err.message : "L\u1ED7i x\xE1c th\u1EF1c quy\u1EC1n qu\u1EA3n tr\u1ECB."
    });
  }
}
function mapGeminiErrorResponse(err, includeDebug = false) {
  const msg = err instanceof Error ? err.message : String(err);
  const lowerMsg = msg.toLowerCase();
  const attemptTrace = err instanceof Error && Array.isArray(err.attemptTrace) ? err.attemptTrace : void 0;
  const cfg = getAuthoritativeAiConfigSnapshot();
  const configuredProviders = {
    mistral: isMistralConfigured(),
    groq: isGroqConfigured(),
    cloudflare: isCloudflareConfigured()
  };
  const providerHealth = getProviderHealthSnapshot();
  const debugExtras = includeDebug ? {
    technicalDetail: msg,
    debug: {
      activeModel: cfg.activeModel,
      configuredProviders,
      providerHealth,
      ...attemptTrace && attemptTrace.length > 0 ? { attemptTrace } : {},
      recentExecutions: getRecentExecutionLogs().slice(0, 10),
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    }
  } : {};
  if (msg.includes("GRADING_JSON_INVALID")) {
    return {
      status: 502,
      code: "GRADING_JSON_INVALID",
      error: "Ph\u1EA3n h\u1ED3i ki\u1EC3m \u0111\u1ECBnh t\u1EEB AI b\u1ECB c\u1EAFt c\u1EE5t ho\u1EB7c sai \u0111\u1ECBnh d\u1EA1ng JSON. H\u1EC7 th\u1ED1ng \u0111\xE3 ch\u1EB7n k\u1EBFt qu\u1EA3 r\u1ED7ng gi\u1EA3 \u0111\u1EC3 tr\xE1nh ch\u1EA5m sai \u2014 vui l\xF2ng b\u1EA5m Th\u1EED l\u1EA1i.",
      ...debugExtras
    };
  }
  if (msg.includes("STRICT_GRADING_MODEL_UNAVAILABLE")) {
    return {
      status: 503,
      code: "STRICT_GRADING_MODEL_UNAVAILABLE",
      error: "Model ch\u1EA5m \u0111i\u1EC3m c\u1ED1 \u0111\u1ECBnh \u0111ang t\u1EA1m b\u1EADn ho\u1EB7c qu\xE1 t\u1EA3i. H\u1EC7 th\u1ED1ng \u0111\xE3 kh\xF3a kh\xF4ng t\u1EF1 \xFD \u0111\u1ED5i sang model kh\xE1c \u0111\u1EC3 \u0111\u1EA3m b\u1EA3o t\xEDnh nh\u1EA5t qu\xE1n \u0111i\u1EC3m s\u1ED1 \u2014 vui l\xF2ng th\u1EED l\u1EA1i sau v\xE0i gi\xE2y.",
      ...debugExtras
    };
  }
  if (msg.includes("v\u01B0\u1EE3t qu\xE1 th\u1EDDi gian ch\u1EDD") || msg.includes("AbortError") || msg.includes("timed out")) {
    return {
      status: 504,
      code: "AI_TIMEOUT",
      error: "AI ph\u1EA3n h\u1ED3i qu\xE1 th\u1EDDi gian ch\u1EDD n\xEAn h\u1EC7 th\u1ED1ng \u0111\xE3 t\u1EF1 \u0111\u1ED9ng ng\u1EAFt \u0111\u1EC3 b\u1EA3o v\u1EC7 k\u1EBFt n\u1ED1i. Vui l\xF2ng th\u1EED l\u1EA1i.",
      ...debugExtras
    };
  }
  if (msg.includes("MISTRAL_API_KEY_UNCONFIGURED") || msg.includes("Ch\u01B0a c\u1EA5u h\xECnh Mistral")) {
    return {
      status: 503,
      code: "MISTRAL_KEY_MISSING",
      error: includeDebug ? "Ch\u01B0a c\xF3 Mistral AI API Key tr\xEAn m\xE1y ch\u1EE7. H\xE3y th\xEAm bi\u1EBFn m\xF4i tr\u01B0\u1EDDng MISTRAL_API_KEY tr\xEAn Vercel/Render \u0111\u1EC3 ch\u1EA1y 24/7 ho\u1EB7c d\xE1n kh\xF3a t\u1EA1i Qu\u1EA3n tr\u1ECB h\u1EC7 th\u1ED1ng \u2192 API Key & B\u1EA3o m\u1EADt." : "H\u1EC7 th\u1ED1ng AI v\u1EEBa kh\u1EDFi \u0111\u1ED9ng l\u1EA1i v\xE0 \u0111ang ch\u1EDD c\u1EA5u h\xECnh kh\xF3a k\u1EBFt n\u1ED1i. Vui l\xF2ng th\u1EED l\u1EA1i sau \xEDt ph\xFAt ho\u1EB7c b\xE1o cho qu\u1EA3n tr\u1ECB vi\xEAn.",
      ...debugExtras
    };
  }
  if (msg.includes("GROQ_API_KEY_UNCONFIGURED") || msg.includes("Ch\u01B0a c\u1EA5u h\xECnh Groq API Key")) {
    return {
      status: 503,
      code: "GROQ_KEY_MISSING",
      error: includeDebug ? "Ch\u01B0a c\xF3 Groq API Key tr\xEAn m\xE1y ch\u1EE7. H\xE3y th\xEAm bi\u1EBFn m\xF4i tr\u01B0\u1EDDng GROQ_API_KEY tr\xEAn Vercel/Render \u0111\u1EC3 ch\u1EA1y 24/7 ho\u1EB7c d\xE1n kh\xF3a t\u1EA1m t\u1EA1i Qu\u1EA3n tr\u1ECB h\u1EC7 th\u1ED1ng \u2192 API Key & B\u1EA3o m\u1EADt." : "H\u1EC7 th\u1ED1ng AI v\u1EEBa kh\u1EDFi \u0111\u1ED9ng l\u1EA1i v\xE0 \u0111ang ch\u1EDD c\u1EA5u h\xECnh kh\xF3a k\u1EBFt n\u1ED1i. Vui l\xF2ng th\u1EED l\u1EA1i sau \xEDt ph\xFAt ho\u1EB7c b\xE1o cho qu\u1EA3n tr\u1ECB vi\xEAn.",
      ...debugExtras
    };
  }
  if (msg.includes("CLOUDFLARE_CREDENTIALS_UNCONFIGURED") || msg.includes("Ch\u01B0a c\u1EA5u h\xECnh Cloudflare")) {
    return {
      status: 503,
      code: "CLOUDFLARE_KEY_MISSING",
      error: includeDebug ? "Ch\u01B0a c\u1EA5u h\xECnh Cloudflare Workers AI. H\xE3y \u0111\u1EB7t bi\u1EBFn CLOUDFLARE_ACCOUNT_ID v\xE0 CLOUDFLARE_API_TOKEN tr\xEAn m\xE1y ch\u1EE7 \u0111\u1EC3 ch\u1EA1y 24/7 ho\u1EB7c nh\u1EADp t\u1EA1i Qu\u1EA3n tr\u1ECB h\u1EC7 th\u1ED1ng \u2192 API Key & B\u1EA3o m\u1EADt." : "H\u1EC7 th\u1ED1ng AI v\u1EEBa kh\u1EDFi \u0111\u1ED9ng l\u1EA1i v\xE0 \u0111ang ch\u1EDD c\u1EA5u h\xECnh kh\xF3a k\u1EBFt n\u1ED1i. Vui l\xF2ng th\u1EED l\u1EA1i sau \xEDt ph\xFAt ho\u1EB7c b\xE1o cho qu\u1EA3n tr\u1ECB vi\xEAn.",
      ...debugExtras
    };
  }
  if (msg.includes("MISTRAL_BILLING_REQUIRED") || msg.includes("HTTP 402") || msg.includes(" 402 ") || lowerMsg.includes("need a subscription") || lowerMsg.includes("payment required")) {
    const hasBackup = configuredProviders.groq || configuredProviders.cloudflare;
    return {
      status: 402,
      code: "MISTRAL_BILLING_REQUIRED",
      error: includeDebug ? hasBackup ? "Mistral b\xE1o HTTP 402 (C\u1EA7n k\xEDch ho\u1EA1t g\xF3i Experiment mi\u1EC5n ph\xED ho\u1EB7c Billing t\u1EA1i console.mistral.ai) v\xE0 c\xE1c nh\xE0 cung c\u1EA5p d\u1EF1 ph\xF2ng hi\u1EC7n ch\u01B0a ph\u1EA3n h\u1ED3i. H\u1EC7 th\u1ED1ng \u0111\xE3 t\u1EA1m khoanh v\xF9ng Mistral 10 ph\xFAt." : "Mistral b\xE1o HTTP 402: Key mi\u1EC5n ph\xED c\u1EE7a Mistral v\u1EABn b\u1EAFt bu\u1ED9c v\xE0o console.mistral.ai \u2192 Billing / Subscription \u0111\u1EC3 ch\u1ECDn g\xF3i Experiment (mi\u1EC5n ph\xED, x\xE1c minh S\u0110T) ho\u1EB7c n\u1EA1p credit. B\u1EA1n c\u0169ng n\xEAn th\xEAm GROQ_API_KEY (mi\u1EC5n ph\xED) \u0111\u1EC3 h\u1EC7 th\u1ED1ng t\u1EF1 \u0111\u1ED9ng d\u1EF1 ph\xF2ng kh\xF4ng gi\xE1n \u0111o\u1EA1n." : "D\u1ECBch v\u1EE5 AI t\u1EA1m th\u1EDDi kh\xF4ng kh\u1EA3 d\u1EE5ng do gi\u1EDBi h\u1EA1n t\xE0i kho\u1EA3n nh\xE0 cung c\u1EA5p. Vui l\xF2ng th\u1EED l\u1EA1i sau ho\u1EB7c b\xE1o qu\u1EA3n tr\u1ECB vi\xEAn.",
      ...debugExtras
    };
  }
  if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
    return {
      status: 429,
      code: "PROVIDER_QUOTA_EXCEEDED",
      error: includeDebug ? `D\u1ECBch v\u1EE5 AI t\u1EA1m th\u1EDDi \u0111\u1EA1t gi\u1EDBi h\u1EA1n l\u01B0u l\u01B0\u1EE3ng (429). Chi ti\u1EBFt: ${msg.slice(0, 180)}` : "D\u1ECBch v\u1EE5 AI t\u1EA1m th\u1EDDi \u0111\u1EA1t gi\u1EDBi h\u1EA1n l\u01B0u l\u01B0\u1EE3ng (429). Vui l\xF2ng th\u1EED l\u1EA1i sau \xEDt ph\xFAt.",
      ...debugExtras
    };
  }
  if (msg.includes("NOT_FOUND") || msg.includes("404")) {
    const activeProvidersList = [
      configuredProviders.mistral ? "Mistral AI" : "",
      configuredProviders.groq ? "Groq" : "",
      configuredProviders.cloudflare ? "Cloudflare" : ""
    ].filter(Boolean).join(", ") || "Ch\u01B0a c\xF3 kh\xF3a n\xE0o";
    const hasSecondaryAuthErr = msg.includes("PERMISSION_DENIED") || msg.includes("API_KEY_INVALID") || msg.includes("401") || msg.includes("403");
    return {
      status: 502,
      code: "MODEL_UNAVAILABLE",
      error: includeDebug ? hasSecondaryAuthErr ? `Model AI m\u1EB7c \u0111\u1ECBnh kh\xF4ng kh\u1EA3 d\u1EE5ng v\xE0 nh\xE0 cung c\u1EA5p d\u1EF1 ph\xF2ng g\u1EB7p l\u1ED7i x\xE1c th\u1EF1c/quy\u1EC1n truy c\u1EADp (Provider: ${activeProvidersList}). Chi ti\u1EBFt: ${msg.slice(0, 480)}` : `Kh\xF4ng t\xECm th\u1EA5y model AI kh\u1EA3 d\u1EE5ng tr\xEAn kh\xF3a hi\u1EC7n t\u1EA1i (Provider \u0111\xE3 c\u1EA5u h\xECnh: ${activeProvidersList}). Chi ti\u1EBFt k\u1EF9 thu\u1EADt: ${msg.slice(0, 480)}` : "D\u1ECBch v\u1EE5 m\xF4 h\xECnh AI t\u1EA1m th\u1EDDi kh\xF4ng kh\u1EA3 d\u1EE5ng. Vui l\xF2ng th\u1EED l\u1EA1i sau ho\u1EB7c b\xE1o qu\u1EA3n tr\u1ECB vi\xEAn.",
      ...debugExtras
    };
  }
  if (msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED") || msg.includes("403") || msg.includes("401")) {
    return {
      status: 502,
      code: "PROVIDER_AUTH_ERROR",
      error: includeDebug ? `Kh\xF3a API AI hi\u1EC7n t\u1EA1i kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c kh\xF4ng c\xF3 quy\u1EC1n truy c\u1EADp model. Chi ti\u1EBFt: ${msg.slice(0, 480)}` : "D\u1ECBch v\u1EE5 AI g\u1EB7p l\u1ED7i c\u1EA5u h\xECnh x\xE1c th\u1EF1c. Vui l\xF2ng li\xEAn h\u1EC7 qu\u1EA3n tr\u1ECB vi\xEAn.",
      ...debugExtras
    };
  }
  return {
    status: 500,
    code: "AI_PROCESSING_ERROR",
    error: includeDebug ? `Kh\xF4ng th\u1EC3 ho\xE0n t\u1EA5t x\u1EED l\xFD t\xE0i li\u1EC7u: ${msg.slice(0, 260)}` : "Kh\xF4ng th\u1EC3 ho\xE0n t\u1EA5t x\u1EED l\xFD t\xE0i li\u1EC7u do l\u1ED7i m\xE1y ch\u1EE7 t\u1EA1m th\u1EDDi. Vui l\xF2ng th\u1EED l\u1EA1i.",
    ...debugExtras
  };
}
function createApiApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "15mb" }));
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy-Report-Only",
      "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com https://*.firebaseapp.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; worker-src 'self' blob:; connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com"
    );
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").toLowerCase();
    if (req.secure || forwardedProto === "https" || process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
  const envAllowedOrigins = (process.env.ALLOWED_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(async (req, res, next) => {
    try {
      const origin = req.headers.origin;
      if (origin) {
        const cfg = await loadAuthoritativeAiConfig();
        const combined = Array.from(
          new Set([...envAllowedOrigins, ...cfg.allowedOrigins || []].map((o) => o.trim()).filter(Boolean))
        );
        const requestHost = String(req.headers["x-forwarded-host"] || req.headers.host || "");
        if (isAllowedCorsOrigin(origin, requestHost, combined)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Vary", "Origin");
          res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
        }
      }
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
    } catch (err) {
      console.warn("CORS middleware fallback:", err);
    }
    next();
  });
  app.get(["/api", "/api/index", "/api/health"], (_req, res) => {
    res.json({ ok: true, service: "StudyCheck AI Backend", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.get("/api/system/status", async (req, res) => {
    try {
      let token;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice(7).trim();
      }
      const cfg = await loadAuthoritativeAiConfig(token);
      res.json({
        enabled: cfg.enabled,
        maintenanceMessage: cfg.maintenanceMessage,
        disabledReason: cfg.disabledReason,
        rateLimitConfig: cfg.rateLimitConfig,
        adaptiveLongTextThresholdChars: cfg.adaptiveLongTextThresholdChars,
        configVersion: cfg.configVersion,
        updatedAt: cfg.updatedAt
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 \u0111\u1ECDc tr\u1EA1ng th\xE1i h\u1EC7 th\u1ED1ng." });
    }
  });
  app.post("/api/auth/session", async (req, res) => {
    try {
      const authUser = await verifyFirebaseRequest(req);
      if (authUser.emailVerified) {
        await hydrateSingleKeyForSuperAdmin(authUser.idToken);
      }
      res.json({
        uid: authUser.uid,
        email: authUser.email,
        emailVerified: authUser.emailVerified,
        isSuperAdmin: authUser.isSuperAdmin
      });
    } catch {
      res.status(401).json({ error: "Invalid Firebase ID token" });
    }
  });
  app.post("/api/ai/suggest-from-filename", requireAuth, async (req, res) => {
    const user = req.authUser;
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const rawNames = Array.isArray(req.body?.fileNames) ? req.body.fileNames : [];
      const fileNames = rawNames.map((n) => typeof n === "string" ? n.trim() : "").filter((n) => n.length > 0).slice(0, 25);
      const fallbackGrade = req.body?.defaultGrade === "11" || req.body?.defaultGrade === "12" ? req.body.defaultGrade : "10";
      if (fileNames.length === 0) {
        res.json({
          suggestedGrade: fallbackGrade,
          suggestedSubject: "auto",
          source: "empty"
        });
        return;
      }
      const cacheKey = buildFileNameSuggestionCacheKey(fileNames, fallbackGrade);
      const cached = filenameScopeServerCache.get(cacheKey);
      if (cached) {
        res.json({ ...cached, source: "cache" });
        return;
      }
      const heuristic = inferGradeAndSubjectFromFileNames(fileNames);
      if (heuristic.confidence === "high" && heuristic.grade && heuristic.subject) {
        const result = {
          suggestedGrade: heuristic.grade,
          suggestedSubject: heuristic.subject,
          source: "heuristic"
        };
        filenameScopeServerCache.set(cacheKey, result);
        res.json(result);
        return;
      }
      if (isGenericCameraFileNames(fileNames)) {
        const result = {
          suggestedGrade: heuristic.grade || fallbackGrade,
          suggestedSubject: heuristic.subject || "auto",
          source: "generic_filename"
        };
        filenameScopeServerCache.set(cacheKey, result);
        res.json(result);
        return;
      }
      const meaningfulText = fileNames.map((name) => name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").trim()).join(", ");
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: "detect"
      });
      if (!guard.allowed) {
        res.json({
          suggestedGrade: heuristic.grade || fallbackGrade,
          suggestedSubject: heuristic.subject || "auto",
          source: "heuristic_rate_limited"
        });
        return;
      }
      const aiScope = await SubjectDetectionService.detectScope(
        `T\xEAn t\u1EC7p t\xE0i li\u1EC7u h\u1ECDc t\u1EADp THPT: ${meaningfulText}`,
        tokens,
        { config: guard.config, idToken: user.idToken }
      );
      const finalResult = {
        suggestedGrade: heuristic.grade || aiScope.suggestedGrade || fallbackGrade,
        suggestedSubject: heuristic.subject || (aiScope.suggestedSubject && aiScope.suggestedSubject !== "khac" ? aiScope.suggestedSubject : "auto"),
        source: "ai"
      };
      if (filenameScopeServerCache.size >= 200) {
        const firstKey = filenameScopeServerCache.keys().next().value;
        if (firstKey) filenameScopeServerCache.delete(firstKey);
      }
      filenameScopeServerCache.set(cacheKey, finalResult);
      res.json(finalResult);
    } catch {
      const rawNames = Array.isArray(req.body?.fileNames) ? req.body.fileNames : [];
      const heuristic = inferGradeAndSubjectFromFileNames(
        rawNames.filter((n) => typeof n === "string")
      );
      res.json({
        suggestedGrade: heuristic.grade || "10",
        suggestedSubject: heuristic.subject || "auto",
        source: "heuristic_fallback"
      });
    }
  });
  app.post("/api/ai/extract", requireAuth, upload.array("files", 25), async (req, res) => {
    const user = req.authUser;
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: "ocr"
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }
      const uploadedFiles = (req.files || []).map((f) => ({
        ...f,
        originalname: repairUtf8Mojibake(f.originalname)
      }));
      if (uploadedFiles.length === 0) {
        res.status(400).json({ error: "Vui l\xF2ng ch\u1ECDn \xEDt nh\u1EA5t m\u1ED9t t\xE0i li\u1EC7u h\u1EE3p l\u1EC7." });
        return;
      }
      const adminMaxFileMb = guard.config.rateLimitConfig.maximumFileSizeMb;
      for (const f of uploadedFiles) {
        if (!ALLOWED_UPLOAD_MIMES.has(f.mimetype)) {
          res.status(400).json({
            error: `\u0110\u1ECBnh d\u1EA1ng file "${f.originalname}" (${f.mimetype}) kh\xF4ng \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3. Ch\u1EC9 ch\u1EA5p nh\u1EADn PDF, DOCX, JPG, PNG, WEBP.`
          });
          return;
        }
        const sizeCheck = validateUploadFileSize(
          { name: f.originalname, size: f.size, type: f.mimetype },
          adminMaxFileMb
        );
        if (!sizeCheck.ok) {
          res.status(413).json({
            code: "PAYLOAD_TOO_LARGE",
            error: sizeCheck.error
          });
          return;
        }
        if (!hasValidMagicSignature(f.buffer, f.mimetype)) {
          res.status(400).json({
            error: `File "${f.originalname}" c\xF3 ch\u1EEF k\xFD nh\u1ECB ph\xE2n kh\xF4ng kh\u1EDBp \u0111\u1ECBnh d\u1EA1ng khai b\xE1o ho\u1EB7c b\u1ECB h\u1ECFng.`
          });
          return;
        }
      }
      const bodyParams = req.body || {};
      const pageOffset = Math.max(0, Number(bodyParams.pageOffset) || 0);
      const skipScope = bodyParams.skipScope === "true";
      const previousText = (bodyParams.previousText || "").trim();
      const presetGrade = bodyParams.presetGrade === "11" || bodyParams.presetGrade === "12" ? bodyParams.presetGrade : "10";
      const rawPresetSubject = (bodyParams.presetSubject || "").trim();
      const presetSubject = rawPresetSubject && rawPresetSubject in SUBJECT_LABELS ? rawPresetSubject : "khac";
      const pages = [];
      const first = uploadedFiles[0];
      const pendingImages = [];
      const flushPendingImages = async () => {
        if (pendingImages.length === 0) return;
        const batch = pendingImages.splice(0, pendingImages.length);
        const extractedImgs = await DocumentExtractionService.extractFromImageBuffers(
          batch,
          tokens,
          {
            config: guard.config,
            idToken: user.idToken,
            pageOffset: pageOffset + pages.length
          }
        );
        pages.push(...extractedImgs);
      };
      for (const file of uploadedFiles) {
        if (file.mimetype === "application/pdf") {
          await flushPendingImages();
          const pdfPages = await DocumentExtractionService.extractFromPdfBuffer(file.buffer, tokens, {
            config: guard.config,
            idToken: user.idToken
          });
          const baseOffset = pageOffset + pages.length;
          for (let i = 0; i < pdfPages.length; i += 1) {
            const pageNum = baseOffset + i + 1;
            const p = pdfPages[i];
            pages.push({
              ...p,
              pageNumber: pageNum,
              blocks: p.blocks.map((b, bIdx) => ({
                ...b,
                blockId: `p${pageNum}_b${bIdx + 1}`,
                pageNumber: pageNum
              }))
            });
          }
        } else if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          await flushPendingImages();
          const docxPages = await DocumentExtractionService.extractFromDocxBuffer(file.buffer);
          const baseOffset = pageOffset + pages.length;
          for (let i = 0; i < docxPages.length; i += 1) {
            const pageNum = baseOffset + i + 1;
            const p = docxPages[i];
            pages.push({
              ...p,
              pageNumber: pageNum,
              blocks: p.blocks.map((b, bIdx) => ({
                ...b,
                blockId: `p${pageNum}_b${bIdx + 1}`,
                pageNumber: pageNum
              }))
            });
          }
        } else {
          pendingImages.push({
            buffer: file.buffer,
            mimeType: file.mimetype,
            originalName: file.originalname
          });
        }
      }
      await flushPendingImages();
      if (pages.length + pageOffset > guard.config.rateLimitConfig.maximumPagesPerAnalysis) {
        res.status(400).json({
          error: `T\xE0i li\u1EC7u c\xF3 ${pages.length + pageOffset} trang, v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n ${guard.config.rateLimitConfig.maximumPagesPerAnalysis} trang cho m\u1ED7i l\u1EA7n ph\xE2n t\xEDch.`
        });
        return;
      }
      const combinedForScope = [previousText, ...pages.map((p) => p.rawText)].filter(Boolean).join("\n");
      const heuristicScope = inferGradeAndSubjectFromFileNames([first.originalname]);
      const contentHeuristic = inferScopeFromContentHeuristic(combinedForScope, first.originalname);
      const fallbackScopeSuggestion = {
        suggestedGrade: presetGrade || heuristicScope.grade || contentHeuristic.suggestedGrade || "10",
        suggestedSubject: presetSubject !== "khac" ? presetSubject : heuristicScope.subject || contentHeuristic.suggestedSubject || "khac",
        suggestedChapters: contentHeuristic.suggestedChapters,
        suggestedTitle: first.originalname.replace(/\.[^.]+$/, "") || contentHeuristic.suggestedTitle
      };
      let scopeSuggestion = fallbackScopeSuggestion;
      if (!skipScope && combinedForScope.trim().length > 15) {
        try {
          scopeSuggestion = await callWithTimeout(
            () => SubjectDetectionService.detectScope(combinedForScope, tokens, {
              config: guard.config,
              idToken: user.idToken
            }),
            8500
          );
        } catch (scopeErr) {
          console.warn("Non-fatal scope detection fallback during /api/ai/extract:", scopeErr);
        }
      }
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "ocr",
        outcome: "success",
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json({ pages, scopeSuggestion, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err, user.isSuperAdmin);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "ocr",
        outcome: "failed",
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429
      });
      res.status(mapped.status).json(mapped);
    }
  });
  app.post("/api/ai/analyze", requireAuth, async (req, res) => {
    const user = req.authUser;
    const {
      idempotencyKey,
      pages,
      grade,
      subject,
      textbookReferenceId,
      textbookTitle,
      selectedChapters,
      scope,
      referenceChunks,
      enableWebGrounding,
      strictModelLock,
      ocrConfirmed,
      ocrTextHash
    } = req.body;
    if (idempotencyKey) {
      const cached = getIdempotentResult(`${user.uid}:analyze:${idempotencyKey}`);
      if (cached) {
        res.json(cached);
        return;
      }
    }
    if (!Array.isArray(pages) || pages.length === 0) {
      res.status(400).json({ error: "Thi\u1EBFu d\u1EEF li\u1EC7u trang t\xE0i li\u1EC7u \u0111\xE3 x\xE1c nh\u1EADn OCR." });
      return;
    }
    let jobStarted = false;
    let guardPassed = false;
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const preCfg = await loadAuthoritativeAiConfig(user.idToken);
      if (pages.length > preCfg.rateLimitConfig.maximumPagesPerAnalysis) {
        res.status(400).json({
          error: `S\u1ED1 trang (${pages.length}) v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n t\u1ED1i \u0111a (${preCfg.rateLimitConfig.maximumPagesPerAnalysis}).`
        });
        return;
      }
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: "analysis"
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }
      guardPassed = true;
      incrementConcurrentJob(user.uid);
      jobStarted = true;
      const result = await KnowledgeAnalysisService.runFullVerification({
        pages,
        grade: grade || "10",
        subject: subject || "khac",
        textbookReferenceId: textbookReferenceId || "",
        textbookTitle: textbookTitle || "",
        selectedChapters: selectedChapters || [],
        scope: scope || "",
        referenceChunks: referenceChunks || [],
        enableWebGrounding: enableWebGrounding === true,
        strictModelLock: strictModelLock === true,
        ocrConfirmed: ocrConfirmed === true,
        ...typeof ocrTextHash === "string" && ocrTextHash.trim() ? { ocrTextHash: ocrTextHash.trim().slice(0, 64) } : {},
        tokensOut: tokens,
        config: guard.config,
        idToken: user.idToken
      });
      const payload = { ...result, tokenUsage: tokens };
      if (idempotencyKey) {
        setIdempotentResult(`${user.uid}:analyze:${idempotencyKey}`, payload);
      }
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "analysis",
        outcome: "success",
        webGrounded: result.usedWebGrounding,
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json(payload);
    } catch (err) {
      if (guardPassed) {
        rollbackAiRequestGuard(user.uid, "analysis");
      }
      const mapped = mapGeminiErrorResponse(err, user.isSuperAdmin);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "analysis",
        outcome: "failed",
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.status(mapped.status).json(mapped);
    } finally {
      if (jobStarted) {
        decrementConcurrentJob(user.uid);
      }
    }
  });
  app.post("/api/ai/quiz", requireAuth, async (req, res) => {
    const user = req.authUser;
    const {
      idempotencyKey,
      subject,
      grade,
      textbookTitle,
      claims,
      coverageItems,
      referenceChunks,
      count,
      difficulty,
      scope,
      chapterFilter,
      advancedEnabled,
      advancedCount
    } = req.body;
    if (idempotencyKey) {
      const cached = getIdempotentResult(`${user.uid}:quiz:${idempotencyKey}`);
      if (cached) {
        res.json(cached);
        return;
      }
    }
    const safeCount = Math.min(20, Math.max(5, Number(count) || 5));
    const safeAdvancedCount = advancedEnabled ? Math.min(6, Math.max(1, Number(advancedCount) || 2)) : 0;
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: "quiz"
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }
      const generated = await QuizGenerationService.generateQuiz({
        subject,
        grade,
        textbookTitle,
        claims: claims || [],
        coverageItems: coverageItems || [],
        referenceChunks: referenceChunks || [],
        count: safeCount,
        difficulty: difficulty || "mixed",
        scope: scope || "all",
        chapterFilter,
        advancedEnabled: Boolean(advancedEnabled),
        advancedCount: safeAdvancedCount,
        tokensOut: tokens,
        config: guard.config,
        idToken: user.idToken
      });
      const payload = { ...generated, tokenUsage: tokens };
      if (idempotencyKey) {
        setIdempotentResult(`${user.uid}:quiz:${idempotencyKey}`, payload);
      }
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "quiz",
        outcome: "success",
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json(payload);
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err, user.isSuperAdmin);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "quiz",
        outcome: "failed",
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.status(mapped.status).json(mapped);
    }
  });
  app.post("/api/ai/flashcards", requireAuth, async (req, res) => {
    const user = req.authUser;
    const { subject, grade, textbookTitle, claims, coverageItems, count } = req.body || {};
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: "quiz"
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 503).json({ code: guard.code, error: guard.message });
        return;
      }
      const cards = await FlashcardGenerationService.generateFromAnalysis({
        ownerUid: user.uid,
        subject: subject || "khac",
        grade: grade || "10",
        textbookTitle: textbookTitle || "SGK chu\u1EA9n",
        claims: claims || [],
        coverageItems: coverageItems || [],
        count: count || 6,
        tokensOut: tokens,
        config: guard.config,
        idToken: user.idToken
      });
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "quiz",
        outcome: "success",
        promptTokens: tokens.promptTokens,
        candidateTokens: tokens.candidateTokens,
        totalTokens: tokens.totalTokens
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json({ cards, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err, user.isSuperAdmin);
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "quiz",
        outcome: "failed",
        providerError: mapped.status >= 500,
        quotaBlocked: mapped.status === 429
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.status(mapped.status).json(mapped);
    }
  });
  app.post("/api/feedback/classify", requireAuth, async (req, res) => {
    const user = req.authUser;
    const { targetType, category, note } = req.body || {};
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const guard = await checkAiRequestGuard({
        uid: user.uid,
        email: user.email,
        idToken: user.idToken,
        requestType: "detect"
      });
      if (!guard.allowed) {
        res.status(guard.httpStatus || 429).json({ code: guard.code, error: guard.message });
        return;
      }
      const safeTargetType = targetType === "claim" || targetType === "quiz_question" || targetType === "exam_question" ? targetType : "claim";
      const classification = await FeedbackAnalysisService.classifyFeedback({
        targetType: safeTargetType,
        category: typeof category === "string" ? category.slice(0, 120) : "",
        note: typeof note === "string" ? note.slice(0, 1500) : "",
        tokensOut: tokens,
        config: guard.config,
        idToken: user.idToken
      });
      res.json({ classification });
    } catch {
      res.json({ classification: "C\u1EA7n Admin \u0111\u1ED1i chi\u1EBFu th\xEAm v\u1EDBi t\xE0i li\u1EC7u ngu\u1ED3n." });
    }
  });
  app.get("/api/admin/overview", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const [config, usageStats, auditLogs, mistralStatus, providerKeys] = await Promise.all([
        loadAuthoritativeAiConfig(user.idToken),
        getUsageStatistics(user.idToken).catch(() => ({
          today: {
            date: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            requestCount: 0,
            successfulCount: 0,
            failedCount: 0,
            blockedCount: 0,
            analysisCount: 0,
            quizGenerationCount: 0,
            ocrCount: 0,
            webGroundedCount: 0,
            actualPromptTokens: 0,
            actualCandidateTokens: 0,
            actualTotalTokens: 0,
            quotaExceededEvents: 0,
            providerErrorEvents: 0,
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          },
          dailySeries: [],
          perUserToday: []
        })),
        getAuditLogs(user.idToken).catch(() => []),
        getMistralKeyStatus(user.idToken).catch(() => ({
          configured: false,
          source: "none",
          maskedKey: "",
          label: "",
          hasEnvFallbackKey: false,
          lastTestStatus: "Untested"
        })),
        getProviderKeysStatus(user.idToken).catch(() => ({
          mistral: {
            configured: false,
            source: "none",
            maskedKey: "",
            label: "",
            hasEnvFallbackKey: false,
            lastTestStatus: "Untested"
          },
          groq: {
            configured: false,
            source: "none",
            maskedKey: "",
            label: "",
            hasEnvFallbackKey: false,
            lastTestStatus: "Untested"
          },
          cloudflare: {
            configured: false,
            source: "none",
            maskedAccountId: "",
            maskedKey: "",
            label: "",
            hasEnvFallbackKey: false,
            lastTestStatus: "Untested"
          }
        }))
      ]);
      res.json({
        config,
        usageStats,
        auditLogs,
        singleKeyStatus: mistralStatus,
        providerKeys,
        coldStartReadiness: evaluateColdStartReadiness(config.activeModel),
        mistralConfigured: isMistralConfigured(),
        groqConfigured: isGroqConfigured(),
        cloudflareConfigured: isCloudflareConfigured(),
        executionLogs: getRecentExecutionLogs(),
        modelCatalog: MODEL_CATALOG
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c d\u1EEF li\u1EC7u t\u1ED5ng quan qu\u1EA3n tr\u1ECB." });
    }
  });
  app.patch("/api/admin/ai-service", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const {
        enabled,
        disabledReason,
        maintenanceMessage,
        rateLimitConfig,
        activeModel,
        allowedOrigins,
        taskModels,
        adaptiveLongTextThresholdChars
      } = req.body || {};
      const parsedThreshold = adaptiveLongTextThresholdChars !== void 0 && adaptiveLongTextThresholdChars !== null ? clampAdaptiveThresholdChars(adaptiveLongTextThresholdChars) : void 0;
      const updated = await updateAuthoritativeAiConfig(
        {
          ...typeof enabled === "boolean" ? { enabled } : {},
          ...typeof disabledReason === "string" ? { disabledReason: disabledReason.slice(0, 300) } : {},
          ...typeof maintenanceMessage === "string" ? { maintenanceMessage: maintenanceMessage.slice(0, 400) } : {},
          ...rateLimitConfig ? { rateLimitConfig } : {},
          ...typeof activeModel === "string" ? { activeModel } : {},
          ...Array.isArray(allowedOrigins) ? { allowedOrigins } : {},
          ...taskModels && typeof taskModels === "object" ? { taskModels } : {},
          ...parsedThreshold !== void 0 ? { adaptiveLongTextThresholdChars: parsedThreshold } : {}
        },
        user.uid,
        user.email,
        user.idToken
      );
      res.json({
        config: updated,
        coldStartReadiness: evaluateColdStartReadiness(updated.activeModel)
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 c\u1EADp nh\u1EADt c\u1EA5u h\xECnh d\u1ECBch v\u1EE5 AI." });
    }
  });
  app.post("/api/admin/models/override", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { taskType, modelId } = req.body || {};
      if (!taskType) {
        res.status(400).json({ error: "Thi\u1EBFu taskType." });
        return;
      }
      const updated = await setOneTimeTaskOverride({
        taskType,
        modelId: modelId || null,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      res.json({ config: updated });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 \u0111\u1EB7t model override." });
    }
  });
  app.post("/api/admin/models/test", requireSuperAdmin, async (req, res) => {
    try {
      const { modelId } = req.body || {};
      const targetModel = (modelId || MISTRAL_PRIMARY_MODEL).trim();
      const result = await testModelConnectivity(targetModel);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        modelId: String(req.body?.modelId || MISTRAL_PRIMARY_MODEL),
        latencyMs: 0,
        message: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 ki\u1EC3m tra k\u1EBFt n\u1ED1i model."
      });
    }
  });
  app.get("/api/admin/debug/snapshot", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const [config, mistralStatus, providerKeys] = await Promise.all([
        loadAuthoritativeAiConfig(user.idToken),
        getMistralKeyStatus(user.idToken),
        getProviderKeysStatus(user.idToken)
      ]);
      const taskTypes = [
        "subject_classification",
        "curriculum_extraction",
        "claim_validation",
        "knowledge_analysis",
        "completeness_analysis",
        "quiz_blueprint",
        "quiz_generation",
        "feedback_analysis"
      ];
      const taskRouting = taskTypes.map((t) => resolveModelForTask(t, config));
      res.json({
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        adminEmail: user.email,
        activeModel: config.activeModel,
        adaptiveLongTextThresholdChars: config.adaptiveLongTextThresholdChars,
        enabled: config.enabled,
        configuredProviders: {
          mistral: isMistralConfigured(),
          groq: isGroqConfigured(),
          cloudflare: isCloudflareConfigured()
        },
        singleKeyStatus: mistralStatus,
        providerKeys,
        taskRouting,
        executionLogs: getRecentExecutionLogs().slice(0, 40)
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 t\u1EA3i snapshot debug h\u1EC7 th\u1ED1ng."
      });
    }
  });
  app.post("/api/admin/debug/diagnostics", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const config = await loadAuthoritativeAiConfig(user.idToken);
      const checks = [];
      if (isMistralConfigured()) {
        const targetMistral = config.activeModel.startsWith("mistral:") ? config.activeModel : MISTRAL_PRIMARY_MODEL;
        const mStart = Date.now();
        try {
          const mistralResp = await callWithTimeout(
            (signal) => callMistralChatCompletion({
              modelId: targetMistral,
              prompt: 'Tr\u1EA3 v\u1EC1 JSON \u0111\xFAng chu\u1EA9n: {"status":"OK","provider":"mistral"}',
              jsonMode: true,
              jsonSchemaHint: '{"status":"OK","provider":"mistral"}',
              maxOutputTokens: 256,
              signal
            }),
            15e3
          );
          const parsed = JSON.parse(mistralResp.text || "{}");
          checks.push({
            provider: "mistral",
            mode: "json_schema",
            configured: true,
            ok: Boolean(parsed && typeof parsed === "object"),
            requestedModel: targetMistral,
            resolvedModel: mistralResp.resolvedModel || targetMistral,
            latencyMs: Date.now() - mStart,
            detail: `JSON Mode th\xE0nh c\xF4ng tr\xEAn ${mistralResp.resolvedModel} (${mistralResp.text.slice(0, 90)})`
          });
        } catch (err) {
          checks.push({
            provider: "mistral",
            mode: "json_schema",
            configured: true,
            ok: false,
            requestedModel: targetMistral,
            resolvedModel: targetMistral,
            latencyMs: Date.now() - mStart,
            detail: err instanceof Error ? err.message : String(err)
          });
        }
      } else {
        checks.push({
          provider: "mistral",
          mode: "json_schema",
          configured: false,
          ok: false,
          requestedModel: MISTRAL_PRIMARY_MODEL,
          resolvedModel: "-",
          latencyMs: 0,
          detail: "Ch\u01B0a c\u1EA5u h\xECnh Mistral AI API Key."
        });
      }
      if (isGroqConfigured()) {
        const groqKey = getGroqApiKey();
        const availableGroq = await fetchAvailableGroqChatModels(groqKey, void 0, true);
        const targetGroq = config.activeModel.startsWith("groq:") ? config.activeModel : "groq:openai/gpt-oss-120b";
        const tStart = Date.now();
        try {
          const jsonResp = await callWithTimeout(
            (signal) => callGroqChatCompletion({
              modelId: targetGroq,
              prompt: 'Ki\u1EC3m tra JSON mode cho h\u1EC7 th\u1ED1ng Ki\u1EC3m \u0111\u1ECBnh: tr\u1EA3 v\u1EC1 {"status":"OK","subject":"vat_ly"}',
              jsonMode: true,
              jsonSchemaHint: '{"status":"OK","subject":"vat_ly"}',
              maxOutputTokens: 256,
              signal
            }),
            15e3
          );
          const parsed = JSON.parse(jsonResp.text || "{}");
          checks.push({
            provider: "groq",
            mode: "json_schema",
            configured: true,
            ok: Boolean(parsed && typeof parsed === "object"),
            requestedModel: targetGroq,
            resolvedModel: jsonResp.resolvedModel || targetGroq,
            latencyMs: Date.now() - tStart,
            detail: `JSON Mode th\xE0nh c\xF4ng (${jsonResp.text.slice(0, 90)})`,
            availableModels: availableGroq.slice(0, 12)
          });
        } catch (err) {
          checks.push({
            provider: "groq",
            mode: "json_schema",
            configured: true,
            ok: false,
            requestedModel: targetGroq,
            resolvedModel: targetGroq,
            latencyMs: Date.now() - tStart,
            detail: err instanceof Error ? err.message : String(err),
            availableModels: availableGroq.slice(0, 12)
          });
        }
      } else {
        checks.push({
          provider: "groq",
          mode: "json_schema",
          configured: false,
          ok: false,
          requestedModel: "groq:openai/gpt-oss-120b",
          resolvedModel: "-",
          latencyMs: 0,
          detail: "Ch\u01B0a c\u1EA5u h\xECnh Groq API Key."
        });
      }
      if (isCloudflareConfigured()) {
        const targetCf = config.activeModel.startsWith("cf:") ? config.activeModel : "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast";
        const cStart = Date.now();
        try {
          const cfResp = await callWithTimeout(
            (signal) => callCloudflareChatCompletion({
              modelId: targetCf,
              prompt: 'Tr\u1EA3 v\u1EC1 JSON h\u1EE3p l\u1EC7: {"status":"OK","provider":"cloudflare"}',
              jsonMode: true,
              jsonSchemaHint: '{"status":"OK","provider":"cloudflare"}',
              maxOutputTokens: 256,
              signal
            }),
            15e3
          );
          const parsed = JSON.parse(cfResp.text || "{}");
          checks.push({
            provider: "cloudflare",
            mode: "json_schema",
            configured: true,
            ok: Boolean(parsed && typeof parsed === "object"),
            requestedModel: targetCf,
            resolvedModel: cfResp.resolvedModel || targetCf,
            latencyMs: Date.now() - cStart,
            detail: `JSON Mode th\xE0nh c\xF4ng (${cfResp.text.slice(0, 90)})`
          });
        } catch (err) {
          checks.push({
            provider: "cloudflare",
            mode: "json_schema",
            configured: true,
            ok: false,
            requestedModel: targetCf,
            resolvedModel: targetCf,
            latencyMs: Date.now() - cStart,
            detail: err instanceof Error ? err.message : String(err)
          });
        }
      } else {
        checks.push({
          provider: "cloudflare",
          mode: "json_schema",
          configured: false,
          ok: false,
          requestedModel: "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          resolvedModel: "-",
          latencyMs: 0,
          detail: "Ch\u01B0a c\u1EA5u h\xECnh Cloudflare Workers AI."
        });
      }
      res.json({
        ranAt: (/* @__PURE__ */ new Date()).toISOString(),
        activeModel: config.activeModel,
        checks,
        executionLogs: getRecentExecutionLogs().slice(0, 20)
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "L\u1ED7i khi ch\u1EA1y ch\u1EA9n \u0111o\xE1n AI."
      });
    }
  });
  app.get("/api/admin/roles", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const admins = await firestoreRestList(
        "admins",
        user.idToken,
        100
      );
      res.json({
        admins,
        protectedEmails: Array.from(PROTECTED_SUPER_ADMIN_EMAILS)
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c danh s\xE1ch Admin." });
    }
  });
  app.post("/api/admin/roles", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    const { identifier } = req.body;
    const clean = (identifier || "").trim();
    if (!clean) {
      res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp UID ho\u1EB7c Email t\xE0i kho\u1EA3n c\u1EA7n c\u1EA5p quy\u1EC1n Super Admin." });
      return;
    }
    try {
      let targetUid = clean;
      if (clean.includes("@")) {
        let resolvedFromAdmin = "";
        const adminAuth = await getAdminAuth();
        if (adminAuth) {
          try {
            const fbUser = await adminAuth.getUserByEmail(clean);
            resolvedFromAdmin = fbUser.uid;
          } catch {
          }
        }
        if (resolvedFromAdmin) {
          targetUid = resolvedFromAdmin;
        } else {
          const usersList = await firestoreRestList("users", user.idToken, 200);
          const matchedUser = usersList.find((u) => (u.email || "").trim().toLowerCase() === clean.toLowerCase());
          if (!matchedUser?.uid) {
            throw new Error(
              `Kh\xF4ng t\xECm th\u1EA5y t\xE0i kho\u1EA3n c\xF3 email "${clean}". Ng\u01B0\u1EDDi d\xF9ng c\u1EA7n \u0111\u0103ng nh\u1EADp \xEDt nh\u1EA5t 1 l\u1EA7n tr\u01B0\u1EDBc khi c\u1EA5p quy\u1EC1n theo Email, ho\u1EB7c h\xE3y nh\u1EADp tr\u1EF1c ti\u1EBFp UID.`
            );
          }
          targetUid = matchedUser.uid;
        }
      }
      if (!isValidFirestoreDocId(targetUid)) {
        res.status(400).json({ error: "UID t\xE0i kho\u1EA3n kh\xF4ng h\u1EE3p l\u1EC7." });
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const record = {
        uid: targetUid,
        role: "super_admin",
        grantedAt: now
      };
      await firestoreRestSet(`admins/${targetUid}`, record, user.idToken);
      invalidateVerifiedTokenCacheForUid(targetUid);
      await recordAuditLog(
        {
          actorUid: user.uid,
          actorEmail: user.email,
          action: "SUPER_ADMIN_GRANTED",
          resourceType: "admins",
          resourceId: targetUid,
          status: "success",
          metadata: { identifier: clean }
        },
        user.idToken
      );
      res.json({ ok: true, admin: record });
    } catch (err) {
      res.status(400).json({
        error: `Kh\xF4ng t\xECm th\u1EA5y ho\u1EB7c kh\xF4ng c\u1EA5p \u0111\u01B0\u1EE3c quy\u1EC1n: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  });
  app.delete("/api/admin/roles/:uid", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    const targetUid = req.params.uid;
    if (!targetUid || !isValidFirestoreDocId(targetUid)) {
      res.status(400).json({ error: "UID c\u1EA7n thu h\u1ED3i kh\xF4ng h\u1EE3p l\u1EC7." });
      return;
    }
    if (targetUid === user.uid) {
      res.status(400).json({ error: "Kh\xF4ng th\u1EC3 t\u1EF1 thu h\u1ED3i quy\u1EC1n Super Admin c\u1EE7a ch\xEDnh m\xECnh." });
      return;
    }
    try {
      const existingAdmins = await firestoreRestList("admins", user.idToken, 50);
      if (existingAdmins.length <= 1 && PROTECTED_SUPER_ADMIN_EMAILS.size === 0) {
        res.status(400).json({ error: "Ph\u1EA3i gi\u1EEF l\u1EA1i \xEDt nh\u1EA5t 1 t\xE0i kho\u1EA3n Super Admin trong h\u1EC7 th\u1ED1ng." });
        return;
      }
      const userDoc = await firestoreRestGet(`users/${targetUid}`, user.idToken);
      if (userDoc?.email && PROTECTED_SUPER_ADMIN_EMAILS.has(userDoc.email.toLowerCase())) {
        res.status(400).json({ error: "Kh\xF4ng th\u1EC3 thu h\u1ED3i quy\u1EC1n c\u1EE7a t\xE0i kho\u1EA3n ch\u1EE7 s\u1EDF h\u1EEFu m\u1EB7c \u0111\u1ECBnh." });
        return;
      }
      await firestoreRestDelete(`admins/${targetUid}`, user.idToken);
      invalidateVerifiedTokenCacheForUid(targetUid);
      await recordAuditLog(
        {
          actorUid: user.uid,
          actorEmail: user.email,
          action: "SUPER_ADMIN_REVOKED",
          resourceType: "admins",
          resourceId: targetUid,
          status: "success",
          metadata: {}
        },
        user.idToken
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 thu h\u1ED3i quy\u1EC1n Admin."
      });
    }
  });
  app.get("/api/admin/key", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const singleKeyStatus = await getMistralKeyStatus(user.idToken);
      const cfg = getAuthoritativeAiConfigSnapshot();
      res.json({
        singleKeyStatus,
        coldStartReadiness: evaluateColdStartReadiness(cfg.activeModel)
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng ki\u1EC3m tra \u0111\u01B0\u1EE3c tr\u1EA1ng th\xE1i API key." });
    }
  });
  app.post("/api/admin/key", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey, label } = req.body || {};
      if (!apiKey || typeof apiKey !== "string") {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp Mistral AI API key." });
        return;
      }
      const result = await setMistralApiKey({
        rawKey: apiKey,
        label,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      clearProviderCooldown("mistral");
      const cfg = getAuthoritativeAiConfigSnapshot();
      res.json({
        singleKeyStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        mistralConfigured: isMistralConfigured(),
        coldStartReadiness: evaluateColdStartReadiness(cfg.activeModel)
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 l\u01B0u Mistral AI API key." });
    }
  });
  app.post("/api/admin/key/test", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey } = req.body || {};
      const result = await testMistralApiKey({
        rawKeyOverride: typeof apiKey === "string" ? apiKey : void 0,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: "Temporary provider error",
        message: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 ki\u1EC3m tra Mistral AI API key.",
        testedSource: "none",
        testedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  });
  app.delete("/api/admin/key", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const result = await clearMistralApiKey({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      const cfg = getAuthoritativeAiConfigSnapshot();
      res.json({
        singleKeyStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        mistralConfigured: isMistralConfigured(),
        coldStartReadiness: evaluateColdStartReadiness(cfg.activeModel)
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 x\xF3a Mistral AI API key." });
    }
  });
  app.get("/api/admin/provider-keys", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const providerKeys = await getProviderKeysStatus(user.idToken);
      const cfg = getAuthoritativeAiConfigSnapshot();
      res.json({
        providerKeys,
        coldStartReadiness: evaluateColdStartReadiness(cfg.activeModel),
        mistralConfigured: isMistralConfigured(),
        groqConfigured: isGroqConfigured(),
        cloudflareConfigured: isCloudflareConfigured()
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c tr\u1EA1ng th\xE1i API key."
      });
    }
  });
  app.post("/api/admin/provider-keys/mistral", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey, label } = req.body || {};
      if (!apiKey || typeof apiKey !== "string") {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp Mistral AI API Key." });
        return;
      }
      const result = await setMistralApiKey({
        rawKey: apiKey,
        label,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      clearProviderCooldown("mistral");
      const cfg = getAuthoritativeAiConfigSnapshot();
      res.json({
        mistralStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        mistralConfigured: isMistralConfigured(),
        coldStartReadiness: evaluateColdStartReadiness(cfg.activeModel)
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 l\u01B0u Mistral AI API Key."
      });
    }
  });
  app.post("/api/admin/provider-keys/mistral/test", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey } = req.body || {};
      const result = await testMistralApiKey({
        rawKeyOverride: typeof apiKey === "string" ? apiKey : void 0,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      if (result.status === "Connected") {
        clearProviderCooldown("mistral");
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: "Temporary provider error",
        message: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 ki\u1EC3m tra Mistral AI API Key.",
        testedSource: "none",
        testedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  });
  app.delete("/api/admin/provider-keys/mistral", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const result = await clearMistralApiKey({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      const cfg = getAuthoritativeAiConfigSnapshot();
      res.json({
        mistralStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        mistralConfigured: isMistralConfigured(),
        coldStartReadiness: evaluateColdStartReadiness(cfg.activeModel)
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 g\u1EE1 Mistral AI API Key."
      });
    }
  });
  app.post("/api/admin/provider-keys/groq", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey, label } = req.body || {};
      if (!apiKey || typeof apiKey !== "string") {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp Groq API Key (b\u1EAFt \u0111\u1EA7u b\u1EB1ng gsk_...)." });
        return;
      }
      const result = await setGroqApiKey({
        rawKey: apiKey,
        label,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      clearProviderCooldown("groq");
      res.json({
        groqStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        groqConfigured: isGroqConfigured()
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 l\u01B0u Groq API Key."
      });
    }
  });
  app.post("/api/admin/provider-keys/groq/test", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey } = req.body || {};
      const result = await testGroqApiKey({
        rawKeyOverride: typeof apiKey === "string" ? apiKey : void 0,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      if (result.status === "Connected") {
        clearProviderCooldown("groq");
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: "Temporary provider error",
        message: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 ki\u1EC3m tra Groq API Key.",
        testedSource: "none",
        testedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  });
  app.delete("/api/admin/provider-keys/groq", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const result = await clearGroqApiKey({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      clearProviderCooldown("groq");
      res.json({
        groqStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        groqConfigured: isGroqConfigured()
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 g\u1EE1 Groq API Key."
      });
    }
  });
  app.post("/api/admin/provider-keys/cloudflare", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { accountId, apiToken, label } = req.body || {};
      if (!accountId || typeof accountId !== "string" || !apiToken || typeof apiToken !== "string") {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp \u0111\u1EA7y \u0111\u1EE7 Cloudflare Account ID v\xE0 API Token." });
        return;
      }
      const result = await setCloudflareCredentials({
        accountId,
        apiToken,
        label,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }
      clearProviderCooldown("cloudflare");
      res.json({
        cloudflareStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        cloudflareConfigured: isCloudflareConfigured()
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 l\u01B0u th\xF4ng tin Cloudflare Workers AI."
      });
    }
  });
  app.post("/api/admin/provider-keys/cloudflare/test", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { accountId, apiToken } = req.body || {};
      const result = await testCloudflareCredentials({
        accountIdOverride: typeof accountId === "string" ? accountId : void 0,
        apiTokenOverride: typeof apiToken === "string" ? apiToken : void 0,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      if (result.status === "Connected") {
        clearProviderCooldown("cloudflare");
      }
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: "Temporary provider error",
        message: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 ki\u1EC3m tra Cloudflare Workers AI.",
        testedSource: "none",
        testedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  });
  app.delete("/api/admin/provider-keys/cloudflare", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const result = await clearCloudflareCredentials({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      clearProviderCooldown("cloudflare");
      res.json({
        cloudflareStatus: result.status,
        providerKeys: await getProviderKeysStatus(user.idToken),
        cloudflareConfigured: isCloudflareConfigured()
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 g\u1EE1 th\xF4ng tin Cloudflare Workers AI."
      });
    }
  });
  app.post("/api/admin/references/ingest-url", requireSuperAdmin, async (req, res) => {
    const { url, referenceId, grade, subject, textbookSeries } = req.body;
    try {
      const result = await ingestReferenceFromUrl({
        url,
        referenceId,
        grade,
        subject,
        textbookSeries
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });
  app.post("/api/admin/references/ingest-pdf", requireSuperAdmin, upload.single("file"), async (req, res) => {
    const file = req.file;
    const { referenceId, grade, subject, textbookSeries } = req.body;
    if (!file || file.mimetype !== "application/pdf" || !hasValidMagicSignature(file.buffer, "application/pdf")) {
      res.status(400).json({ error: "Vui l\xF2ng t\u1EA3i l\xEAn t\u1EC7p PDF h\u1EE3p l\u1EC7." });
      return;
    }
    try {
      const result = await ingestReferenceFromPdfBuffer({
        buffer: file.buffer,
        referenceId,
        grade: grade || "10",
        subject: subject || "khac",
        textbookSeries: textbookSeries || "S\xE1ch gi\xE1o khoa"
      });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: msg });
    }
  });
  app.post("/api/admin/references/ingest-docx", requireSuperAdmin, upload.single("file"), async (req, res) => {
    const file = req.file;
    const { referenceId, grade, subject, textbookSeries } = req.body;
    const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (!file || file.mimetype !== docxMime || !hasValidMagicSignature(file.buffer, docxMime)) {
      res.status(400).json({ error: "Vui l\xF2ng t\u1EA3i l\xEAn t\u1EC7p DOCX h\u1EE3p l\u1EC7." });
      return;
    }
    try {
      const result = await ingestReferenceFromDocxBuffer({
        buffer: file.buffer,
        referenceId,
        grade: grade || "10",
        subject: subject || "khac",
        textbookSeries: textbookSeries || "T\xE0i li\u1EC7u gi\xE1o vi\xEAn"
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.post("/api/admin/references/ingest-text", requireSuperAdmin, async (req, res) => {
    const { mode, content, referenceId, grade, subject, textbookSeries } = req.body;
    try {
      const result = ingestReferenceFromTextOrJson({
        mode: mode === "json" ? "json" : "text",
        content,
        referenceId,
        grade: grade || "10",
        subject: subject || "khac",
        textbookSeries: textbookSeries || "T\xE0i li\u1EC7u tham chi\u1EBFu"
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.post("/api/admin/references/synthesize-outline", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    const { grade, subject, textbookSeries, title, customTocHint } = req.body;
    const tokensOut = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const result = await TextbookSynthesisService.synthesizeOutline({
        grade: grade || "10",
        subject: subject || "hoa_hoc",
        textbookSeries: textbookSeries || "K\u1EBFt n\u1ED1i tri th\u1EE9c v\u1EDBi cu\u1ED9c s\u1ED1ng",
        title,
        customTocHint,
        tokensOut,
        config: cfg,
        idToken: user.idToken
      });
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "analysis",
        outcome: "success",
        promptTokens: tokensOut.promptTokens,
        candidateTokens: tokensOut.candidateTokens,
        totalTokens: tokensOut.totalTokens
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json(result);
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.error });
    }
  });
  app.post("/api/admin/references/synthesize-chapter", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    const {
      referenceId,
      grade,
      subject,
      textbookSeries,
      chapterIndex,
      chapterTitle,
      lessons,
      estimatedPageStart
    } = req.body;
    if (!referenceId || !chapterTitle) {
      res.status(400).json({ error: "Thi\u1EBFu m\xE3 s\xE1ch tham chi\u1EBFu (referenceId) ho\u1EB7c t\xEAn ch\u01B0\u01A1ng (chapterTitle)." });
      return;
    }
    const tokensOut = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const chunks = await TextbookSynthesisService.synthesizeChapterChunks({
        referenceId,
        grade: grade || "10",
        subject: subject || "hoa_hoc",
        textbookSeries: textbookSeries || "K\u1EBFt n\u1ED1i tri th\u1EE9c v\u1EDBi cu\u1ED9c s\u1ED1ng",
        chapterIndex: Math.max(1, Number(chapterIndex) || 1),
        chapterTitle,
        lessons: Array.isArray(lessons) ? lessons : [],
        estimatedPageStart: Math.max(1, Number(estimatedPageStart) || 1),
        tokensOut,
        config: cfg,
        idToken: user.idToken
      });
      recordUsageEvent({
        uid: user.uid,
        email: user.email,
        requestType: "analysis",
        outcome: "success",
        promptTokens: tokensOut.promptTokens,
        candidateTokens: tokensOut.candidateTokens,
        totalTokens: tokensOut.totalTokens
      });
      void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
      res.json({ chunks });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json({ code: mapped.code, error: mapped.error });
    }
  });
  app.post(
    "/api/admin/references/ocr-pages",
    requireSuperAdmin,
    upload.array("files", 4),
    async (req, res) => {
      const user = req.authUser;
      const rawFiles = req.files || [];
      if (rawFiles.length === 0) {
        res.status(400).json({ error: "Kh\xF4ng c\xF3 trang \u1EA3nh n\xE0o \u0111\u01B0\u1EE3c g\u1EEDi l\xEAn \u0111\u1EC3 \u0111\u1ECDc OCR." });
        return;
      }
      const allowedImageMimes = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp"]);
      for (const f of rawFiles) {
        if (!allowedImageMimes.has(f.mimetype) || !hasValidMagicSignature(f.buffer, f.mimetype)) {
          res.status(400).json({
            error: "Ch\u1EC9 ch\u1EA5p nh\u1EADn t\u1EC7p \u1EA3nh JPG, PNG ho\u1EB7c WEBP h\u1EE3p l\u1EC7 khi \u0111\u1ECDc OCR s\xE1ch tham chi\u1EBFu."
          });
          return;
        }
      }
      const { pageNumbers: rawPageNumbers, grade, subject, textbookSeries } = req.body;
      let parsedPageNums = [];
      try {
        if (rawPageNumbers) {
          const arr = JSON.parse(rawPageNumbers);
          if (Array.isArray(arr)) parsedPageNums = arr.map((n) => Number(n) || 1);
        }
      } catch {
        parsedPageNums = [];
      }
      const tokensOut = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
      try {
        const cfg = await loadAuthoritativeAiConfig(user.idToken);
        const pages = await TextbookSynthesisService.ocrScannedTextbookPages({
          files: rawFiles.map((f, idx) => ({
            buffer: f.buffer,
            mimeType: f.mimetype || "image/jpeg",
            pageNumber: parsedPageNums[idx] || idx + 1
          })),
          grade: grade || "10",
          subject: subject || "hoa_hoc",
          textbookSeries: textbookSeries || "S\xE1ch gi\xE1o khoa",
          tokensOut,
          config: cfg,
          idToken: user.idToken
        });
        recordUsageEvent({
          uid: user.uid,
          email: user.email,
          requestType: "ocr",
          outcome: "success",
          promptTokens: tokensOut.promptTokens,
          candidateTokens: tokensOut.candidateTokens,
          totalTokens: tokensOut.totalTokens
        });
        void persistUsageSnapshot(user.idToken, user.isSuperAdmin, user.uid);
        res.json({ pages });
      } catch (err) {
        const mapped = mapGeminiErrorResponse(err);
        res.status(mapped.status).json({ code: mapped.code, error: mapped.error });
      }
    }
  );
  app.post("/api/admin/exams/blueprint", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    const {
      title,
      grade,
      subject,
      textbookSeries,
      examType,
      academicYear,
      semester,
      chapters,
      durationMinutes,
      totalScore,
      referenceChunks
    } = req.body;
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const blueprint = await ExamPipelineService.generateBlueprint({
        title,
        grade: grade || "10",
        subject: subject || "toan",
        textbookSeries: textbookSeries || "K\u1EBFt n\u1ED1i tri th\u1EE9c v\u1EDBi cu\u1ED9c s\u1ED1ng",
        examType: examType || "giua_ky_1",
        academicYear: academicYear || "2026-2027",
        semester: semester === "2" ? "2" : "1",
        chapters: Array.isArray(chapters) ? chapters : [],
        durationMinutes: Math.max(15, Math.min(180, Number(durationMinutes) || 45)),
        totalScore: Math.max(1, Math.min(100, Number(totalScore) || 10)),
        referenceChunks: referenceChunks || [],
        actorUid: user.uid,
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken
      });
      res.json({ blueprint, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });
  app.post("/api/admin/exams/generate", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    const { blueprint, referenceChunks } = req.body;
    if (!blueprint || !Array.isArray(blueprint.rows) || blueprint.rows.length === 0) {
      res.status(400).json({ error: "C\u1EA7n c\xF3 ma tr\u1EADn \u0111\u1EC1 h\u1EE3p l\u1EC7 tr\u01B0\u1EDBc khi sinh \u0111\u1EC1 thi." });
      return;
    }
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const generated = await ExamPipelineService.generateExamFromBlueprint({
        blueprint,
        referenceChunks: referenceChunks || [],
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken
      });
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const exam = {
        examId: `exam_${Date.now()}_${crypto7.randomBytes(3).toString("hex")}`,
        blueprintId: blueprint.blueprintId,
        title: blueprint.title,
        description: `\u0110\u1EC1 ki\u1EC3m tra \u0111\u01B0\u1EE3c sinh t\u1EEB ma tr\u1EADn "${blueprint.title}".`,
        grade: blueprint.grade,
        subject: blueprint.subject,
        textbookSeries: blueprint.textbookSeries,
        examType: blueprint.examType,
        academicYear: blueprint.academicYear,
        semester: blueprint.semester,
        chapters: blueprint.chapters || [],
        durationMinutes: blueprint.durationMinutes,
        totalScore: blueprint.totalScore,
        allowRetake: true,
        published: false,
        validationStatus: generated.validationStatus,
        questions: generated.questions.slice(0, 60),
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now
      };
      res.json({ exam, ...generated, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });
  app.post("/api/admin/exams/import-sample", requireSuperAdmin, upload.array("files", 25), async (req, res) => {
    const user = req.authUser;
    const uploadedFiles = (req.files || []).map((f) => ({
      ...f,
      originalname: repairUtf8Mojibake(f.originalname)
    }));
    if (uploadedFiles.length === 0) {
      res.status(400).json({ error: "Vui l\xF2ng ch\u1ECDn file \u0111\u1EC1 m\u1EABu (PDF, DOCX ho\u1EB7c \u1EA3nh)." });
      return;
    }
    const body = req.body || {};
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const maxBytes = (cfg.rateLimitConfig?.maximumFileSizeMb || 20) * 1024 * 1024;
      for (const f of uploadedFiles) {
        if (!ALLOWED_UPLOAD_MIMES.has(f.mimetype)) {
          res.status(400).json({
            error: `\u0110\u1ECBnh d\u1EA1ng file "${f.originalname}" kh\xF4ng \u0111\u01B0\u1EE3c h\u1ED7 tr\u1EE3. Ch\u1EC9 ch\u1EA5p nh\u1EADn PDF, DOCX, JPG, PNG, WEBP.`
          });
          return;
        }
        if (f.size > maxBytes) {
          res.status(400).json({
            error: `File "${f.originalname}" v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n ${cfg.rateLimitConfig?.maximumFileSizeMb || 20}MB.`
          });
          return;
        }
        if (!hasValidMagicSignature(f.buffer, f.mimetype)) {
          res.status(400).json({
            error: `File "${f.originalname}" c\xF3 ch\u1EEF k\xFD nh\u1ECB ph\xE2n kh\xF4ng kh\u1EDBp \u0111\u1ECBnh d\u1EA1ng ho\u1EB7c b\u1ECB h\u1ECFng.`
          });
          return;
        }
      }
      const result = await ExamPipelineService.extractQuestionsFromSampleExam({
        files: uploadedFiles.map((f) => ({
          buffer: f.buffer,
          mimeType: f.mimetype,
          originalName: f.originalname
        })),
        title: body.title,
        grade: body.grade === "11" || body.grade === "12" ? body.grade : "10",
        subject: body.subject || "toan",
        textbookSeries: body.textbookSeries || "K\u1EBFt n\u1ED1i tri th\u1EE9c v\u1EDBi cu\u1ED9c s\u1ED1ng",
        examType: body.examType || "giua_ky_1",
        academicYear: body.academicYear || "2026-2027",
        semester: body.semester === "2" ? "2" : "1",
        durationMinutes: Math.max(15, Math.min(180, Number(body.durationMinutes) || 45)),
        totalScore: Math.max(1, Math.min(100, Number(body.totalScore) || 10)),
        includeTrueFalse: body.includeTrueFalse === "true",
        actorUid: user.uid,
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken
      });
      res.json({ ...result, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });
  app.post("/api/admin/exams/rewrite-question", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    const { question, instruction, grade, subject, textbookSeries } = req.body;
    if (!question) {
      res.status(400).json({ error: "Thi\u1EBFu d\u1EEF li\u1EC7u c\xE2u h\u1ECFi c\u1EA7n vi\u1EBFt l\u1EA1i." });
      return;
    }
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const updatedQuestion = await ExamPipelineService.rewriteSingleQuestion({
        question,
        instruction,
        grade: grade || "10",
        subject: subject || "toan",
        textbookSeries: textbookSeries || "K\u1EBFt n\u1ED1i tri th\u1EE9c v\u1EDBi cu\u1ED9c s\u1ED1ng",
        tokensOut: tokens,
        config: cfg,
        idToken: user.idToken
      });
      res.json({ question: updatedQuestion, tokenUsage: tokens });
    } catch (err) {
      const mapped = mapGeminiErrorResponse(err);
      res.status(mapped.status).json(mapped);
    }
  });
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          code: "PAYLOAD_TOO_LARGE",
          error: "T\u1EC7p t\u1EA3i l\xEAn v\u01B0\u1EE3t qu\xE1 dung l\u01B0\u1EE3ng cho ph\xE9p. Vui l\xF2ng ch\u1ECDn \u1EA3nh \u2264 5MB ho\u1EB7c PDF/DOCX \u2264 4MB."
        });
        return;
      }
      if (err.code === "LIMIT_FILE_COUNT") {
        res.status(400).json({
          code: "TOO_MANY_FILES",
          error: "S\u1ED1 l\u01B0\u1EE3ng t\u1EC7p g\u1EEDi l\xEAn v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n cho ph\xE9p m\u1ED7i l\u01B0\u1EE3t."
        });
        return;
      }
      res.status(400).json({
        code: "UPLOAD_ERROR",
        error: `L\u1ED7i ti\u1EBFp nh\u1EADn t\u1EC7p t\u1EA3i l\xEAn (${err.code}). Vui l\xF2ng th\u1EED l\u1EA1i.`
      });
      return;
    }
    const bodyErr = err;
    if (bodyErr && (bodyErr.type === "entity.too.large" || bodyErr.status === 413 || bodyErr.statusCode === 413)) {
      res.status(413).json({
        code: "PAYLOAD_TOO_LARGE",
        error: "G\xF3i d\u1EEF li\u1EC7u g\u1EEDi l\xEAn v\u01B0\u1EE3t qu\xE1 gi\u1EDBi h\u1EA1n m\xE1y ch\u1EE7 (413). H\xE3y n\xE9n t\u1EC7p nh\u1ECF h\u01A1n ho\u1EB7c chia \xEDt trang h\u01A1n."
      });
      return;
    }
    console.error("Unhandled Express API error:", err);
    res.status(500).json({
      error: "L\u1ED7i m\xE1y ch\u1EE7 n\u1ED9i b\u1ED9. Vui l\xF2ng th\u1EED l\u1EA1i sau."
    });
  });
  return app;
}

// src/server/vercelHandler.ts
var cachedApp = null;
var initError = null;
function getOrInitApp() {
  if (cachedApp || initError) {
    return cachedApp;
  }
  try {
    cachedApp = createApiApp();
  } catch (err) {
    initError = err;
    console.error("Failed to initialize StudyCheck AI API app:", err);
  }
  return cachedApp;
}
function handler(req, res) {
  const app = getOrInitApp();
  if (!app) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        code: "API_INIT_FAILED",
        error: "M\xE1y ch\u1EE7 API hi\u1EC7n ch\u01B0a s\u1EB5n s\xE0ng. Vui l\xF2ng th\u1EED l\u1EA1i sau \xEDt ph\xFAt."
      })
    );
    return;
  }
  try {
    app(req, res);
  } catch (err) {
    console.error("Unhandled StudyCheck AI serverless invocation error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          code: "API_INVOCATION_ERROR",
          error: "L\u1ED7i th\u1EF1c thi m\xE1y ch\u1EE7 API. Vui l\xF2ng th\u1EED l\u1EA1i sau."
        })
      );
    }
  }
}
export {
  handler as default
};
