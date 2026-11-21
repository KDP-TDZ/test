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
  const pageNumber = Math.max(0, Math.floor(Number(params.pageNumber) || idx));
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
      matchedKeywords: Array.from(new Set(matchedKeywords))
    };
  });
  return scored.filter((item) => item.lexicalScore > 0).sort((a, b) => b.lexicalScore - a.lexicalScore).slice(0, topK);
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
function isPrivateOrLoopbackHost(hostOrIp) {
  const hostname = hostOrIp.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname) return true;
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return true;
  }
  for (const regex of PRIVATE_IPV4_RANGES) {
    if (regex.test(hostname)) {
      return true;
    }
  }
  if (hostname.includes(":")) {
    if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.includes("127.0.0.1") || hostname.includes("169.254.")) {
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
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    return { valid: false, reason: "Kh\xF4ng \u0111\u01B0\u1EE3c ph\xE9p truy c\u1EADp \u0111\u1ECBa ch\u1EC9 n\u1ED9i b\u1ED9 ho\u1EB7c metadata endpoint." };
  }
  for (const regex of PRIVATE_IPV4_RANGES) {
    if (regex.test(hostname)) {
      return { valid: false, reason: "Kh\xF4ng \u0111\u01B0\u1EE3c ph\xE9p truy c\u1EADp d\u1EA3i IP n\u1ED9i b\u1ED9." };
    }
  }
  if (hostname.startsWith("[") || hostname.includes(":")) {
    const clean = hostname.replace(/^\[|\]$/g, "");
    if (clean === "::1" || clean.startsWith("fe80:") || clean.startsWith("fc") || clean.startsWith("fd") || clean.includes("127.0.0.1") || clean.includes("169.254.")) {
      return { valid: false, reason: "Kh\xF4ng \u0111\u01B0\u1EE3c ph\xE9p truy c\u1EADp \u0111\u1ECBa ch\u1EC9 IPv6 n\u1ED9i b\u1ED9." };
    }
  }
  return { valid: true, normalizedUrl: parsed.toString() };
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
    for (const rec of records) {
      if (isPrivateOrLoopbackHost(rec.address)) {
        throw new Error("T\u1EEB ch\u1ED1i k\u1EBFt n\u1ED1i: T\xEAn mi\u1EC1n ph\xE2n gi\u1EA3i v\u1EC1 IP n\u1ED9i b\u1ED9 ho\u1EB7c loopback (DNS Rebinding guard).");
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("T\u1EEB ch\u1ED1i k\u1EBFt n\u1ED1i")) {
      throw err;
    }
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
async function verifyTokenViaIdentityToolkit(idToken) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken })
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
    headers: { Authorization: `Bearer ${idToken}` }
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
    body: JSON.stringify({ fields })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`FIRESTORE_REST_SET_FAILED (${res.status}): ${txt}`);
  }
}
async function firestoreRestList(collectionPath, idToken, pageSize = 100) {
  const url = `${firestoreDocBaseUrl()}/${collectionPath}?pageSize=${pageSize}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${idToken}` }
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
    headers: { Authorization: `Bearer ${idToken}` }
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
    modelId: "gemini-4-hydrogen",
    displayName: "Gemini 4 Hydrogen (Google Free)",
    provider: "gemini",
    tier: "free",
    strengths: "\u01AFu ti\xEAn s\u1ED1 1 cho OCR \u1EA3nh/PDF c\xF4ng th\u1EE9c vi\u1EBFt tay ph\u1EE9c t\u1EA1p & ki\u1EC3m \u0111\u1ECBnh ki\u1EBFn th\u1EE9c chu\u1EA9n SGK.",
    supportsMultimodal: true,
    supportsGoogleSearch: true
  },
  {
    modelId: "gemini-3.1-flash-lite",
    displayName: "Gemini 3.1 Flash Lite (Google Free)",
    provider: "gemini",
    tier: "free",
    strengths: "T\u1ED1c \u0111\u1ED9 r\u1EA5t nhanh, h\u1EA1n m\u1EE9c RPM cao cho ph\xE2n lo\u1EA1i m\xF4n, ki\u1EC3m tra c\u1EA5u tr\xFAc, flashcard & ph\u1EA3n h\u1ED3i.",
    supportsMultimodal: true,
    supportsGoogleSearch: true
  },
  {
    modelId: "groq:openai/gpt-oss-120b",
    displayName: "Groq \xB7 GPT-OSS 120B (Groq Cloud Free)",
    provider: "groq",
    tier: "free",
    strengths: "Model s\u1EA3n xu\u1EA5t m\u1EA1nh nh\u1EA5t c\u1EE7a Groq (~500 tok/s, mi\u1EC5n ph\xED) \u2014 c\u1EF1c nhanh cho nh\xF3m 2\u20133 ng\u01B0\u1EDDi d\xF9ng song song khi x\u1EED l\xFD v\u0103n b\u1EA3n/JSON & d\u1EF1 ph\xF2ng Gemini 429.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  },
  {
    modelId: "groq:openai/gpt-oss-20b",
    displayName: "Groq \xB7 GPT-OSS 20B Fast (Groq Cloud Free)",
    provider: "groq",
    tier: "free",
    strengths: "T\u1ED1c \u0111\u1ED9 t\u1EE9c th\xEC (~1.000 tok/s), mi\u1EC5n ph\xED \u2014 t\u1ED1i \u01B0u cho ph\xE2n lo\u1EA1i m\xF4n, g\u1EE3i \xFD t\xEAn t\u1EC7p, flashcard & d\u1EF1 ph\xF2ng nh\u1EB9.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  },
  {
    modelId: "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    displayName: "Cloudflare \xB7 Llama 3.3 70B FP8 Fast (Workers AI Free)",
    provider: "cloudflare",
    tier: "free",
    strengths: "Mi\u1EC5n ph\xED (10.000 Neurons/ng\xE0y tr\xEAn h\u1EA1 t\u1EA7ng Edge Cloudflare) \u2014 t\u1EA7ng d\u1EF1 ph\xF2ng & chia t\u1EA3i th\u1EE9 3 cho ch\u1EA5m ki\u1EBFn th\u1EE9c, t\u1EA1o \u0111\u1EC1 tr\u1EAFc nghi\u1EC7m.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  },
  {
    modelId: "cf:@cf/meta/llama-3.1-8b-instruct-fast",
    displayName: "Cloudflare \xB7 Llama 3.1 8B Fast (Workers AI Free)",
    provider: "cloudflare",
    tier: "free",
    strengths: "Mi\u1EC5n ph\xED, ti\xEAu t\u1ED1n c\u1EF1c \xEDt Neuron tr\xEAn Cloudflare Edge \u2014 ph\xF9 h\u1EE3p cho ph\xE2n lo\u1EA1i m\xF4n, th\u1EA9m \u0111\u1ECBnh nhanh & flashcard.",
    supportsMultimodal: false,
    supportsGoogleSearch: false
  }
];
var DEFAULT_TASK_MODELS = {
  subject_classification: {
    defaultModel: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-4-hydrogen",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v3.0"
  },
  curriculum_extraction: {
    defaultModel: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-4-hydrogen",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.2"
  },
  knowledge_analysis: {
    defaultModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.1-flash-lite",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v3.0"
  },
  completeness_analysis: {
    defaultModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.1-flash-lite",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.1"
  },
  claim_validation: {
    defaultModel: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-4-hydrogen",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.2"
  },
  quiz_blueprint: {
    defaultModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.1-flash-lite",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.1"
  },
  quiz_generation: {
    defaultModel: "gemini-4-hydrogen",
    fallbackModel: "gemini-3.1-flash-lite",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.2"
  },
  quiz_validation: {
    defaultModel: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-4-hydrogen",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.1"
  },
  answer_explanation: {
    defaultModel: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-4-hydrogen",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.1"
  },
  flashcard_generation: {
    defaultModel: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-4-hydrogen",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.1"
  },
  feedback_analysis: {
    defaultModel: "gemini-3.1-flash-lite",
    fallbackModel: "gemini-4-hydrogen",
    enableFallback: true,
    oneTimeOverrideModel: null,
    promptVersion: "v2.0"
  }
};

// src/server/groqProvider.ts
import crypto3 from "node:crypto";

// src/server/singleKeyService.ts
import crypto2 from "node:crypto";
import fs2 from "node:fs";
import os from "node:os";
import path2 from "node:path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
var DATA_DIR = path2.resolve(process.cwd(), ".data");
var ENCRYPTED_KEY_FILE = path2.join(DATA_DIR, "single-gemini-key.enc");
var TMP_ENCRYPTED_KEY_FILE = path2.join(os.tmpdir(), "studycheck-single-gemini-key.enc");
var FIRESTORE_SECRET_DOC = "adminSecrets/primary";
var GROQ_ENCRYPTED_KEY_FILE = path2.join(DATA_DIR, "groq-api-key.enc");
var TMP_GROQ_ENCRYPTED_KEY_FILE = path2.join(os.tmpdir(), "studycheck-groq-api-key.enc");
var FIRESTORE_GROQ_DOC = "adminSecrets/groq";
var CF_ENCRYPTED_KEY_FILE = path2.join(DATA_DIR, "cloudflare-ai-key.enc");
var TMP_CF_ENCRYPTED_KEY_FILE = path2.join(os.tmpdir(), "studycheck-cloudflare-ai-key.enc");
var FIRESTORE_CF_DOC = "adminSecrets/cloudflare";
function deriveAesKey() {
  const seed = process.env.KEY_ENCRYPTION_SECRET || process.env.ADMIN_KEY_ENCRYPTION_SECRET || `${firebaseConfig.projectId}:${firebaseConfig.apiKey}:studycheck-single-key-v1`;
  return crypto2.createHash("sha256").update(seed).digest();
}
function encryptSecretPayload(rawValue) {
  const iv = crypto2.randomBytes(12);
  const cipher = crypto2.createCipheriv("aes-256-gcm", deriveAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(rawValue, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64")
  };
}
function decryptSecretPayload(payload) {
  const decipher = crypto2.createDecipheriv(
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
  if (trimmed.length < 20) {
    return { valid: false, reason: "API key qu\xE1 ng\u1EAFn (c\u1EA7n t\u1ED1i thi\u1EC3u 20 k\xFD t\u1EF1)." };
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
var cachedSingleKey = null;
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
  const geminiDoc = readLocalEncryptedRecord(ENCRYPTED_KEY_FILE, TMP_ENCRYPTED_KEY_FILE);
  if (geminiDoc) {
    try {
      const rawKey = decryptSecretPayload(geminiDoc);
      if (rawKey) {
        cachedSingleKey = {
          rawKey,
          maskedKey: geminiDoc.maskedIdentifier || maskApiKey(rawKey),
          label: geminiDoc.label || "Gemini API Key duy nh\u1EA5t",
          updatedAt: geminiDoc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
          updatedBy: geminiDoc.updatedBy || "admin",
          lastTestStatus: geminiDoc.lastTestStatus,
          lastTestAt: geminiDoc.lastTestAt,
          lastTestMessage: geminiDoc.lastTestMessage
        };
      }
    } catch {
      cachedSingleKey = null;
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
function getEnvFallbackKey() {
  const envKey = process.env.GEMINI_API_KEY?.trim();
  if (!envKey || envKey === "MY_GEMINI_API_KEY") return null;
  return envKey;
}
function getEnvFallbackGroqKey() {
  const envKey = process.env.GROQ_API_KEY?.trim();
  if (!envKey) return null;
  return envKey;
}
function getEnvFallbackCloudflareCredentials() {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const apiToken = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  if (!accountId || !apiToken) return null;
  return { accountId, apiToken };
}
async function hydrateGeminiSecretFromFirestore(idToken) {
  if (cachedSingleKey) return;
  try {
    const doc = await firestoreRestGet(FIRESTORE_SECRET_DOC, idToken);
    if (!doc || !doc.ciphertext || !doc.iv || !doc.authTag) return;
    const rawKey = decryptSecretPayload(doc);
    if (!rawKey) return;
    cachedSingleKey = {
      rawKey,
      maskedKey: doc.maskedIdentifier || maskApiKey(rawKey),
      label: doc.label || "Gemini API Key duy nh\u1EA5t",
      updatedAt: doc.updatedAt || (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: doc.updatedBy || "admin",
      lastTestStatus: doc.lastTestStatus,
      lastTestAt: doc.lastTestAt,
      lastTestMessage: doc.lastTestMessage
    };
    writeEncryptedSecretFiles(ENCRYPTED_KEY_FILE, TMP_ENCRYPTED_KEY_FILE, doc);
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
    hydrateGeminiSecretFromFirestore(idToken),
    hydrateGroqSecretFromFirestore(idToken),
    hydrateCloudflareSecretFromFirestore(idToken)
  ]);
}
async function hydrateSingleKeyForSuperAdmin(idToken) {
  await hydrateAllProviderKeysFromFirestore(idToken);
}
async function getSingleKeyStatus(idToken) {
  if (idToken && !cachedSingleKey) {
    await hydrateGeminiSecretFromFirestore(idToken);
  }
  const hasEnvFallbackKey = Boolean(getEnvFallbackKey());
  if (cachedSingleKey) {
    return {
      configured: true,
      source: "admin",
      maskedKey: cachedSingleKey.maskedKey,
      label: cachedSingleKey.label,
      hasEnvFallbackKey,
      lastTestStatus: cachedSingleKey.lastTestStatus || "Untested",
      lastTestAt: cachedSingleKey.lastTestAt,
      lastTestMessage: cachedSingleKey.lastTestMessage,
      updatedAt: cachedSingleKey.updatedAt,
      updatedBy: cachedSingleKey.updatedBy
    };
  }
  const envKey = getEnvFallbackKey();
  if (envKey) {
    return {
      configured: true,
      source: "server_env",
      maskedKey: maskApiKey(envKey),
      label: "Bi\u1EBFn m\xF4i tr\u01B0\u1EDDng m\xE1y ch\u1EE7 (GEMINI_API_KEY)",
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
  const [groq, cloudflare] = await Promise.all([
    getGroqKeyStatus(idToken),
    getCloudflareKeyStatus(idToken)
  ]);
  return { groq, cloudflare };
}
async function setSingleGeminiApiKey(params) {
  const { rawKey, label, actorUid, actorEmail, idToken } = params;
  const trimmed = rawKey.trim();
  const check = validateApiKeyInput(trimmed);
  if (!check.valid) {
    return { ok: false, error: check.reason || "API key kh\xF4ng h\u1EE3p l\u1EC7." };
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const maskedIdentifier = maskApiKey(trimmed).slice(0, 40);
  const encrypted = encryptSecretPayload(trimmed);
  const finalLabel = ((label || "").trim() || "Gemini API Key duy nh\u1EA5t").slice(0, 100);
  const storedDoc = {
    secretId: "primary",
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
  cachedSingleKey = {
    rawKey: trimmed,
    maskedKey: maskedIdentifier,
    label: finalLabel,
    updatedAt: now,
    updatedBy: storedDoc.updatedBy,
    lastTestStatus: "Untested"
  };
  writeEncryptedSecretFiles(ENCRYPTED_KEY_FILE, TMP_ENCRYPTED_KEY_FILE, storedDoc);
  try {
    await firestoreRestSet(
      FIRESTORE_SECRET_DOC,
      storedDoc,
      idToken
    );
  } catch (err) {
    console.warn("Could not persist encrypted key backup to Firestore:", err);
    if (process.env.VERCEL === "1") {
      return {
        ok: false,
        error: "Kh\xF4ng th\u1EC3 l\u01B0u kh\xF3a m\xE3 h\xF3a l\xEAn Cloud Firestore (adminSecrets/primary). Vui l\xF2ng ki\u1EC3m tra quy\u1EC1n Super Admin ho\u1EB7c k\u1EBFt n\u1ED1i Firestore \u0111\u1EC3 tr\xE1nh m\u1EA5t kh\xF3a khi Serverless cold-start."
      };
    }
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "SINGLE_API_KEY_SAVED",
      resourceType: "adminSecrets",
      resourceId: "primary",
      status: "success",
      metadata: {
        maskedIdentifier,
        label: finalLabel
      }
    },
    idToken
  );
  return { ok: true, status: await getSingleKeyStatus() };
}
async function clearSingleGeminiApiKey(params) {
  const { actorUid, actorEmail, idToken } = params;
  cachedSingleKey = null;
  removeEncryptedSecretFiles(ENCRYPTED_KEY_FILE, TMP_ENCRYPTED_KEY_FILE);
  try {
    await firestoreRestDelete(FIRESTORE_SECRET_DOC, idToken);
  } catch {
  }
  await recordAuditLog(
    {
      actorUid,
      actorEmail,
      action: "SINGLE_API_KEY_CLEARED",
      resourceType: "adminSecrets",
      resourceId: "primary",
      status: "success",
      metadata: {}
    },
    idToken
  );
  return { ok: true, status: await getSingleKeyStatus() };
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
async function testSingleGeminiKey(params) {
  const { rawKeyOverride, actorUid, actorEmail, idToken, activeModel } = params;
  const testedAt = (/* @__PURE__ */ new Date()).toISOString();
  if (!cachedSingleKey) {
    await hydrateGeminiSecretFromFirestore(idToken);
  }
  let keyToTest = "";
  let testedSource = "none";
  if (rawKeyOverride && rawKeyOverride.trim()) {
    keyToTest = rawKeyOverride.trim();
    testedSource = "preview_input";
  } else if (cachedSingleKey) {
    keyToTest = cachedSingleKey.rawKey;
    testedSource = "admin";
  } else {
    const envKey = getEnvFallbackKey();
    if (envKey) {
      keyToTest = envKey;
      testedSource = "server_env";
    }
  }
  if (!keyToTest) {
    return {
      status: "Invalid key",
      message: "Ch\u01B0a c\xF3 Gemini API key n\xE0o \u0111\u01B0\u1EE3c c\u1EA5u h\xECnh. Vui l\xF2ng nh\u1EADp API key \u1EDF b\xEAn d\u01B0\u1EDBi r\u1ED3i b\u1EA5m L\u01B0u.",
      testedSource: "none",
      testedAt,
      keyStatus: await getSingleKeyStatus()
    };
  }
  let resultStatus = "Connected";
  const modelToTest = activeModel || "gemini-4-hydrogen";
  let resultMessage = `K\u1EBFt n\u1ED1i Gemini API th\xE0nh c\xF4ng (${modelToTest} ph\u1EA3n h\u1ED3i b\xECnh th\u01B0\u1EDDng).`;
  try {
    const ai = new GoogleGenAI({
      apiKey: keyToTest,
      httpOptions: { headers: { "User-Agent": "aistudio-build" } }
    });
    const resp = await ai.models.generateContent({
      model: modelToTest,
      contents: "Tr\u1EA3 l\u1EDDi 1 t\u1EEB: OK",
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        maxOutputTokens: 128,
        abortSignal: AbortSignal.timeout(3e4)
      }
    });
    if (!resp.text) {
      resultStatus = "Temporary provider error";
      resultMessage = "Model ph\u1EA3n h\u1ED3i r\u1ED7ng.";
    }
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (rawMsg.includes("API_KEY_INVALID") || rawMsg.includes("400")) {
      resultStatus = "Invalid key";
      resultMessage = "API key kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 b\u1ECB thu h\u1ED3i.";
    } else if (rawMsg.includes("SERVICE_DISABLED") || rawMsg.includes("API has not been used")) {
      resultStatus = "API not enabled";
      resultMessage = "Generative Language API ch\u01B0a \u0111\u01B0\u1EE3c b\u1EADt cho key n\xE0y.";
    } else if (rawMsg.includes("RESOURCE_EXHAUSTED") || rawMsg.includes("429")) {
      resultStatus = "Quota exceeded";
      resultMessage = "Kh\xF3a API \u0111\xE3 h\u1EBFt h\u1EA1n m\u1EE9c (429 RESOURCE_EXHAUSTED).";
    } else if (rawMsg.includes("PERMISSION_DENIED") || rawMsg.includes("403")) {
      resultStatus = "Permission denied";
      resultMessage = "Kh\xF3a API b\u1ECB t\u1EEB ch\u1ED1i quy\u1EC1n truy c\u1EADp.";
    } else if (rawMsg.includes("NOT_FOUND") || rawMsg.includes("404")) {
      resultStatus = "Model unavailable";
      resultMessage = `Model ${modelToTest} kh\xF4ng kh\u1EA3 d\u1EE5ng v\u1EDBi kh\xF3a hi\u1EC7n t\u1EA1i.`;
    } else {
      resultStatus = "Temporary provider error";
      resultMessage = `L\u1ED7i t\u1EA1m th\u1EDDi t\u1EEB nh\xE0 cung c\u1EA5p: ${rawMsg.slice(0, 140)}`;
    }
  }
  if (testedSource === "admin" && cachedSingleKey) {
    cachedSingleKey.lastTestStatus = resultStatus;
    cachedSingleKey.lastTestAt = testedAt;
    cachedSingleKey.lastTestMessage = resultMessage.slice(0, 280);
    const encrypted = encryptSecretPayload(cachedSingleKey.rawKey);
    const updatedDoc = {
      secretId: "primary",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      maskedIdentifier: cachedSingleKey.maskedKey.slice(0, 40),
      label: cachedSingleKey.label.slice(0, 100),
      updatedAt: cachedSingleKey.updatedAt,
      updatedBy: cachedSingleKey.updatedBy,
      lastTestStatus: resultStatus,
      lastTestAt: testedAt,
      lastTestMessage: cachedSingleKey.lastTestMessage
    };
    writeEncryptedSecretFiles(ENCRYPTED_KEY_FILE, TMP_ENCRYPTED_KEY_FILE, updatedDoc);
    try {
      await firestoreRestSet(
        FIRESTORE_SECRET_DOC,
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
      action: "SINGLE_API_KEY_TESTED",
      resourceType: "adminSecrets",
      resourceId: "primary",
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
    keyStatus: await getSingleKeyStatus()
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
        "qwen/qwen3-32b",
        "meta-llama/llama-4-scout-17b-16e-instruct"
      ];
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
        resultMessage = `K\u1EBFt n\u1ED1i Groq Cloud th\xE0nh c\xF4ng (model ${chosenModel} ph\u1EA3n h\u1ED3i t\u1ED1t; ${availableModels.length} model v\u0103n b\u1EA3n kh\u1EA3 d\u1EE5ng).`;
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
  if (testedSource === "admin" && cachedGroqKey) {
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
    accountId = (accountIdOverride || "").trim();
    apiToken = (apiTokenOverride || "").trim();
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
  if (testedSource === "admin" && cachedCloudflareCreds) {
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
async function resolveActiveGeminiApiKey() {
  if (cachedSingleKey?.rawKey) {
    return cachedSingleKey.rawKey;
  }
  const envKey = getEnvFallbackKey();
  if (envKey) {
    return envKey;
  }
  throw new Error("GEMINI_API_KEY_UNCONFIGURED");
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

// src/server/groqProvider.ts
var GROQ_API_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
var GROQ_MODELS_ENDPOINT = "https://api.groq.com/openai/v1/models";
var GROQ_RESCUE_MODEL_STRONG = "groq:openai/gpt-oss-120b";
var GROQ_RESCUE_MODEL_FAST = "groq:openai/gpt-oss-20b";
var GROQ_PREFERRED_TEXT_MODELS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "qwen/qwen3-32b",
  "meta-llama/llama-4-scout-17b-16e-instruct"
];
var LEGACY_GROQ_MODEL_ALIASES = {
  "llama-3.3-70b-versatile": "openai/gpt-oss-120b",
  "llama-3.1-8b-instant": "openai/gpt-oss-20b",
  "llama3-70b-8192": "openai/gpt-oss-120b",
  "llama3-8b-8192": "openai/gpt-oss-20b",
  "mixtral-8x7b-32768": "openai/gpt-oss-120b",
  "gemma2-9b-it": "openai/gpt-oss-20b"
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
async function fetchAvailableGroqChatModels(apiKey, signal) {
  const cleanKey = apiKey.trim();
  if (!cleanKey) return [];
  const cacheKey = crypto3.createHash("sha256").update(cleanKey).digest("hex").slice(0, 16);
  const cached = availableModelsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
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
    if (!res.ok) return [];
    const data = await res.json();
    const models = (data.data || []).filter((item) => item && typeof item.id === "string" && item.active !== false).map((item) => item.id.trim()).filter((id) => isGroqChatModelId(id));
    availableModelsCache.set(cacheKey, {
      expiresAt: Date.now() + 10 * 60 * 1e3,
      models
    });
    return models;
  } catch {
    return [];
  }
}
function pickBestAvailableGroqModel(availableModels, excludeModel) {
  const excludedLower = (excludeModel || "").trim().toLowerCase();
  const candidates = availableModels.filter((m) => m.toLowerCase() !== excludedLower);
  if (candidates.length === 0) return null;
  for (const preferred of GROQ_PREFERRED_TEXT_MODELS) {
    const found = candidates.find((m) => m.toLowerCase() === preferred.toLowerCase());
    if (found) return found;
  }
  return candidates[0];
}
function extractJsonStringFromModelOutput(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "{}";
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}
async function executeGroqRequest(params) {
  const body = {
    model: params.groqModel,
    messages: params.messages,
    temperature: 0.15,
    max_tokens: params.maxTokens
  };
  if (params.jsonMode) {
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
  const rawText = msg?.content || (!params.jsonMode ? msg?.reasoning || "" : "");
  const text = params.jsonMode ? extractJsonStringFromModelOutput(rawText) : rawText.trim();
  return {
    ok: true,
    result: {
      text,
      promptTokens: data.usage?.prompt_tokens || 0,
      candidateTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
      resolvedModel: `groq:${params.groqModel}`
    }
  };
}
async function callGroqChatCompletion(params) {
  const apiKey = (params.apiKeyOverride || "").trim() || getGroqApiKey();
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY_UNCONFIGURED: Ch\u01B0a c\u1EA5u h\xECnh Groq API Key. Qu\u1EA3n tr\u1ECB vi\xEAn c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp trong Qu\u1EA3n tr\u1ECB h\u1EC7 th\u1ED1ng \u2192 API Key & B\u1EA3o m\u1EADt ho\u1EB7c bi\u1EBFn m\xF4i tr\u01B0\u1EDDng GROQ_API_KEY."
    );
  }
  const normalizedModelId = normalizeGroqModelId(params.modelId);
  const groqModel = stripGroqPrefix(normalizedModelId);
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
  if (systemParts.length > 0) {
    messages.push({ role: "system", content: systemParts.join("\n\n") });
  }
  messages.push({ role: "user", content: params.prompt });
  const maxTokens = Math.min(8192, Math.max(256, params.maxOutputTokens || 2048));
  const firstAttempt = await executeGroqRequest({
    apiKey,
    groqModel,
    messages,
    jsonMode: params.jsonMode,
    maxTokens,
    signal: params.signal
  });
  if (firstAttempt.ok) {
    return firstAttempt.result;
  }
  if (firstAttempt.status === 404 && !params.disableModelAutoFallback) {
    const availableModels = await fetchAvailableGroqChatModels(apiKey, params.signal);
    const fallbackGroqModel = pickBestAvailableGroqModel(availableModels, groqModel);
    if (fallbackGroqModel) {
      const retryAttempt = await executeGroqRequest({
        apiKey,
        groqModel: fallbackGroqModel,
        messages,
        jsonMode: params.jsonMode,
        maxTokens,
        signal: params.signal
      });
      if (retryAttempt.ok) {
        return retryAttempt.result;
      }
    }
  }
  const { status, errText } = firstAttempt;
  if (status === 429) {
    throw new Error(`429 RESOURCE_EXHAUSTED (Groq): ${errText.slice(0, 180)}`);
  }
  if (status === 401 || status === 403) {
    throw new Error(`PERMISSION_DENIED (Groq ${status}): Groq API Key kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 b\u1ECB thu h\u1ED3i.`);
  }
  if (status === 404) {
    const availableModels = await fetchAvailableGroqChatModels(apiKey, params.signal);
    const sampleHint = availableModels.length > 0 ? ` C\xE1c model kh\u1EA3 d\u1EE5ng tr\xEAn t\xE0i kho\u1EA3n Groq c\u1EE7a b\u1EA1n: ${availableModels.slice(0, 4).join(", ")}.` : " Vui l\xF2ng ki\u1EC3m tra m\u1EE5c Model Access tr\xEAn Groq Console.";
    throw new Error(`NOT_FOUND (Groq 404): Model "${groqModel}" kh\xF4ng kh\u1EA3 d\u1EE5ng tr\xEAn t\xE0i kho\u1EA3n Groq n\xE0y.${sampleHint}`);
  }
  if (status === 503 || status === 502) {
    throw new Error(`503 UNAVAILABLE (Groq): ${errText.slice(0, 180)}`);
  }
  throw new Error(`Groq API error (HTTP ${status}): ${errText.slice(0, 200)}`);
}

// src/server/modelRouter.ts
import crypto4 from "node:crypto";
import { GoogleGenAI as GoogleGenAI2, ThinkingLevel as ThinkingLevel2 } from "@google/genai";

// src/core/cache.ts
function buildDeterministicCacheKey(parts) {
  const canonical = JSON.stringify(parts, Object.keys(parts).sort());
  let h1 = 0xcbf29ce484222325n;
  let h2 = 0x84222325cbf29ce4n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < canonical.length; i += 1) {
    const code = BigInt(canonical.charCodeAt(i));
    h1 ^= code;
    h1 = h1 * prime & mask;
    h2 ^= code + BigInt(i % 251 + 1);
    h2 = h2 * prime & mask;
  }
  return `${h1.toString(16).padStart(16, "0")}${h2.toString(16).padStart(16, "0")}`;
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

// src/server/cloudflareProvider.ts
var CF_RESCUE_MODEL_STRONG = "cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast";
var CF_RESCUE_MODEL_FAST = "cf:@cf/meta/llama-3.1-8b-instruct-fast";
var CF_FALLBACK_ON_404 = {
  "@cf/meta/llama-3.1-8b-instruct-fast": "@cf/meta/llama-3.1-8b-instruct-fp8-fast",
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": "@cf/meta/llama-3.1-8b-instruct-fast"
};
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
  const body = {
    model: params.cfModel,
    messages: params.messages,
    temperature: 0.15,
    max_tokens: params.maxTokens
  };
  if (params.jsonMode) {
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
      resolvedModel: `cf:${params.cfModel}`
    }
  };
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
  const cfModel = stripCloudflarePrefix(params.modelId);
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
  if (systemParts.length > 0) {
    messages.push({ role: "system", content: systemParts.join("\n\n") });
  }
  messages.push({ role: "user", content: params.prompt });
  const maxTokens = Math.min(4096, Math.max(128, params.maxOutputTokens || 2048));
  const firstAttempt = await executeCloudflareRequest({
    accountId,
    apiToken,
    cfModel,
    messages,
    jsonMode: params.jsonMode,
    maxTokens,
    signal: params.signal
  });
  if (firstAttempt.ok) {
    return firstAttempt.result;
  }
  const fallbackModel = CF_FALLBACK_ON_404[cfModel];
  if (firstAttempt.status === 404 && fallbackModel) {
    const retryAttempt = await executeCloudflareRequest({
      accountId,
      apiToken,
      cfModel: fallbackModel,
      messages,
      jsonMode: params.jsonMode,
      maxTokens,
      signal: params.signal
    });
    if (retryAttempt.ok) {
      return retryAttempt.result;
    }
  }
  const { status, errText } = firstAttempt;
  if (status === 429) {
    throw new Error(`429 RESOURCE_EXHAUSTED (Cloudflare Workers AI): ${errText.slice(0, 180)}`);
  }
  if (status === 401 || status === 403) {
    throw new Error(
      `PERMISSION_DENIED (Cloudflare ${status}): Cloudflare Account ID ho\u1EB7c API Token kh\xF4ng h\u1EE3p l\u1EC7.`
    );
  }
  if (status === 503 || status === 502) {
    throw new Error(`503 UNAVAILABLE (Cloudflare Workers AI): ${errText.slice(0, 180)}`);
  }
  throw new Error(`Cloudflare Workers AI error (HTTP ${status}): ${errText.slice(0, 200)}`);
}

// src/server/modelRouter.ts
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
var aiResponseCache = new BoundedTtlCache(320, 6 * 60 * 60 * 1e3);
var inFlightTasks = /* @__PURE__ */ new Map();
var executionLogs = [];
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
var GEMINI_TIMEOUT_MS = 45e3;
async function callWithTimeout(operation, timeoutMs = GEMINI_TIMEOUT_MS) {
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
  return msg.includes("429") || msg.includes("503") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("UNAVAILABLE") || msg.includes("ECONNRESET");
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
function thinkingConfigForModel(modelId, tier) {
  const isLite = modelId.toLowerCase().includes("flash-lite");
  if (tier === "minimal") {
    return { thinkingLevel: isLite ? ThinkingLevel2.MINIMAL : ThinkingLevel2.LOW };
  }
  if (tier === "low") {
    return { thinkingLevel: ThinkingLevel2.LOW };
  }
  return { thinkingLevel: ThinkingLevel2.MEDIUM };
}
var cachedAiClient = null;
async function createServerAiClient() {
  const apiKey = await resolveActiveGeminiApiKey();
  if (cachedAiClient && cachedAiClient.apiKey === apiKey) {
    return cachedAiClient.client;
  }
  const client = new GoogleGenAI2({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build"
      }
    }
  });
  cachedAiClient = { apiKey, client };
  return client;
}
function resolveModelForTask(taskType, config, consumeOverride) {
  const taskCfg = config.taskModels?.[taskType] || DEFAULT_TASK_MODELS[taskType];
  const activeFallbackDefault = config.activeModel || "gemini-4-hydrogen";
  let modelId = (taskCfg.defaultModel || activeFallbackDefault).trim();
  let usedOverride = false;
  if (taskCfg.oneTimeOverrideModel && taskCfg.oneTimeOverrideModel.trim()) {
    modelId = taskCfg.oneTimeOverrideModel.trim();
    usedOverride = true;
    consumeOverride?.();
  }
  return {
    taskType,
    modelId,
    fallbackModelId: (taskCfg.fallbackModel || "gemini-3.1-flash-lite").trim(),
    enableFallback: Boolean(taskCfg.enableFallback),
    usedOverride,
    promptVersion: taskCfg.promptVersion || "v2.0",
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
    allowGroqRescue = false,
    groqRescueModelId,
    runWithModel
  } = params;
  let overrideConsumed = false;
  const decision = resolveModelForTask(taskType, config, () => {
    overrideConsumed = true;
  });
  const cacheKey = cacheInput && !bypassCache ? buildDeterministicCacheKey({
    taskType,
    modelId: decision.modelId,
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
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: "success",
        durationMs: 0,
        cached: true,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return {
        data: hit,
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        cached: true
      };
    }
    const pending = inFlightTasks.get(cacheKey);
    if (pending) {
      const shared = await pending;
      return {
        data: shared.data,
        modelId: shared.modelId,
        usedFallback: shared.usedFallback,
        usedOverride: shared.usedOverride,
        cached: true
      };
    }
  }
  const canFallback = decision.enableFallback && Boolean(decision.fallbackModelId) && decision.fallbackModelId !== decision.modelId;
  const executeTask = async () => {
    const start = Date.now();
    try {
      const primaryRetries = canFallback ? 0 : 1;
      const result = await withExponentialBackoff(() => runWithModel(decision.modelId), primaryRetries);
      if (overrideConsumed && consumeOneTimeOverride) {
        await consumeOneTimeOverride(taskType);
      }
      if (cacheKey) {
        aiResponseCache.set(cacheKey, result);
      }
      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
        taskType,
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: "success",
        durationMs: Date.now() - start,
        cached: false,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      return {
        data: result,
        modelId: decision.modelId,
        usedFallback: false,
        usedOverride: decision.usedOverride,
        cached: false
      };
    } catch (primaryErr) {
      let lastErr = primaryErr;
      if (canFallback) {
        try {
          const fbResult = await withExponentialBackoff(() => runWithModel(decision.fallbackModelId), 1);
          if (cacheKey) {
            aiResponseCache.set(cacheKey, fbResult);
          }
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
            taskType,
            modelId: decision.fallbackModelId,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: "success",
            durationMs: Date.now() - start,
            cached: false,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          return {
            data: fbResult,
            modelId: decision.fallbackModelId,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            cached: false
          };
        } catch (fbErr) {
          lastErr = fbErr;
        }
      }
      const rescueModel = groqRescueModelId || defaultGroqRescueModelForTask(taskType);
      const canGroqRescue = allowGroqRescue && isGroqConfigured() && !isGroqModelId(decision.modelId) && !(canFallback && isGroqModelId(decision.fallbackModelId));
      if (canGroqRescue) {
        try {
          const rescueResult = await withExponentialBackoff(() => runWithModel(rescueModel), 1);
          if (cacheKey) {
            aiResponseCache.set(cacheKey, rescueResult);
          }
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
            taskType,
            modelId: rescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: "success",
            durationMs: Date.now() - start,
            cached: false,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          return {
            data: rescueResult,
            modelId: rescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            cached: false
          };
        } catch (rescueErr) {
          lastErr = rescueErr;
        }
      }
      const cfRescueModel = defaultCloudflareRescueModelForTask(taskType);
      const canCloudflareRescue = allowGroqRescue && isCloudflareConfigured() && !isCloudflareModelId(decision.modelId) && !(canFallback && isCloudflareModelId(decision.fallbackModelId));
      if (canCloudflareRescue) {
        try {
          const cfResult = await withExponentialBackoff(() => runWithModel(cfRescueModel), 1);
          if (cacheKey) {
            aiResponseCache.set(cacheKey, cfResult);
          }
          appendExecutionLog({
            executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
            taskType,
            modelId: cfRescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            promptVersion: decision.promptVersion,
            configVersion: decision.configVersion,
            status: "success",
            durationMs: Date.now() - start,
            cached: false,
            timestamp: (/* @__PURE__ */ new Date()).toISOString()
          });
          return {
            data: cfResult,
            modelId: cfRescueModel,
            usedFallback: true,
            usedOverride: decision.usedOverride,
            cached: false
          };
        } catch (cfErr) {
          lastErr = cfErr;
        }
      }
      appendExecutionLog({
        executionId: `exec_${Date.now()}_${crypto4.randomBytes(2).toString("hex")}`,
        taskType,
        modelId: canFallback ? decision.fallbackModelId : decision.modelId,
        usedFallback: canFallback,
        usedOverride: decision.usedOverride,
        promptVersion: decision.promptVersion,
        configVersion: decision.configVersion,
        status: "failed",
        error: lastErr instanceof Error ? lastErr.message.slice(0, 180) : String(lastErr).slice(0, 180),
        durationMs: Date.now() - start,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      });
      throw lastErr;
    }
  };
  if (!cacheKey) {
    return executeTask();
  }
  const taskPromise = executeTask().finally(() => {
    inFlightTasks.delete(cacheKey);
  });
  inFlightTasks.set(
    cacheKey,
    taskPromise
  );
  return taskPromise;
}
async function testModelConnectivity(modelId) {
  const start = Date.now();
  try {
    if (isGroqModelId(modelId)) {
      if (!isGroqConfigured()) {
        return {
          ok: false,
          modelId,
          latencyMs: Date.now() - start,
          message: 'Ch\u01B0a c\u1EA5u h\xECnh Groq API Key. Super Admin c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp t\u1EA1i tab "API Key & B\u1EA3o m\u1EADt" trong web (kh\xF4ng c\u1EA7n s\u1EEDa bi\u1EBFn m\xF4i tr\u01B0\u1EDDng Vercel).'
        };
      }
      const resp2 = await callWithTimeout(
        (signal) => callGroqChatCompletion({
          modelId,
          prompt: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK",
          maxOutputTokens: 256,
          signal
        }),
        15e3
      );
      const text2 = (resp2.text || "").trim();
      const resolvedLabel = resp2.resolvedModel && resp2.resolvedModel !== modelId ? `${modelId} \u2192 t\u1EF1 \u0111\u1ED9ng ch\u1EA1y b\u1EB1ng ${resp2.resolvedModel}` : modelId;
      return {
        ok: Boolean(text2),
        modelId: resp2.resolvedModel || modelId,
        latencyMs: Date.now() - start,
        message: text2 ? `Model ${resolvedLabel} (Groq Cloud Free) ho\u1EA1t \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng (${Date.now() - start}ms).` : `Model ${modelId} tr\u1EA3 v\u1EC1 n\u1ED9i dung r\u1ED7ng.`
      };
    }
    if (isCloudflareModelId(modelId)) {
      if (!isCloudflareConfigured()) {
        return {
          ok: false,
          modelId,
          latencyMs: Date.now() - start,
          message: 'Ch\u01B0a c\u1EA5u h\xECnh Cloudflare Account ID & API Token. Super Admin c\xF3 th\u1EC3 th\xEAm tr\u1EF1c ti\u1EBFp t\u1EA1i tab "API Key & B\u1EA3o m\u1EADt" trong web (kh\xF4ng c\u1EA7n s\u1EEDa bi\u1EBFn m\xF4i tr\u01B0\u1EDDng Vercel).'
        };
      }
      const resp2 = await callWithTimeout(
        (signal) => callCloudflareChatCompletion({
          modelId,
          prompt: "Tr\u1EA3 l\u1EDDi duy nh\u1EA5t 1 t\u1EEB: OK",
          maxOutputTokens: 128,
          signal
        }),
        15e3
      );
      const text2 = (resp2.text || "").trim();
      const resolvedLabel = resp2.resolvedModel && resp2.resolvedModel !== modelId ? `${modelId} \u2192 t\u1EF1 \u0111\u1ED9ng ch\u1EA1y b\u1EB1ng ${resp2.resolvedModel}` : modelId;
      return {
        ok: Boolean(text2),
        modelId: resp2.resolvedModel || modelId,
        latencyMs: Date.now() - start,
        message: text2 ? `Model ${resolvedLabel} (Cloudflare Workers AI Free) ho\u1EA1t \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng (${Date.now() - start}ms).` : `Model ${modelId} tr\u1EA3 v\u1EC1 n\u1ED9i dung r\u1ED7ng.`
      };
    }
    const ai = await createServerAiClient();
    const resp = await callWithTimeout(
      (signal) => ai.models.generateContent({
        model: modelId,
        contents: "Tr\u1EA3 l\u1EDDi 1 t\u1EEB: OK",
        config: {
          thinkingConfig: thinkingConfigForModel(modelId, "minimal"),
          maxOutputTokens: 128,
          abortSignal: signal
        }
      })
    );
    const text = (resp.text || "").trim();
    return {
      ok: Boolean(text),
      modelId,
      latencyMs: Date.now() - start,
      message: text ? `Model ${modelId} ho\u1EA1t \u0111\u1ED9ng b\xECnh th\u01B0\u1EDDng (${Date.now() - start}ms).` : `Model ${modelId} tr\u1EA3 v\u1EC1 n\u1ED9i dung r\u1ED7ng.`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      modelId,
      latencyMs: Date.now() - start,
      message: `L\u1ED7i k\u1EBFt n\u1ED1i model ${modelId}: ${msg.slice(0, 220)}`
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
  maximumFileSizeMb: 20
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
  activeModel: "gemini-4-hydrogen",
  configVersion: 1,
  allowedOrigins: [],
  taskModels: cloneDefaultTaskModels()
};
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
function mergeTaskModels(base, patch) {
  const merged = {};
  for (const taskKey of Object.keys(DEFAULT_TASK_MODELS)) {
    const combined = {
      ...DEFAULT_TASK_MODELS[taskKey],
      ...base?.[taskKey] || {},
      ...patch?.[taskKey] || {}
    };
    merged[taskKey] = {
      ...combined,
      defaultModel: normalizeGroqModelId(combined.defaultModel),
      fallbackModel: normalizeGroqModelId(combined.fallbackModel),
      oneTimeOverrideModel: combined.oneTimeOverrideModel ? normalizeGroqModelId(combined.oneTimeOverrideModel) : null
    };
  }
  return merged;
}
var lastRemoteConfigSyncAt = 0;
var CONFIG_SYNC_TTL_MS = 6e4;
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
        authoritativeAiConfig = {
          ...authoritativeAiConfig,
          ...remote,
          configVersion: typeof remote.configVersion === "number" ? remote.configVersion : authoritativeAiConfig.configVersion,
          allowedOrigins: Array.isArray(remote.allowedOrigins) ? remote.allowedOrigins : authoritativeAiConfig.allowedOrigins,
          taskModels: mergeTaskModels(authoritativeAiConfig.taskModels, remote.taskModels),
          rateLimitConfig: {
            ...DEFAULT_RATE_LIMITS,
            ...remote.rateLimitConfig || {}
          }
        };
      }
    } catch {
    }
  }
  return authoritativeAiConfig;
}
async function consumeOneTimeModelOverride(taskType, idToken) {
  const cur = authoritativeAiConfig.taskModels[taskType];
  if (!cur?.oneTimeOverrideModel) return;
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
        authoritativeAiConfig,
        idToken
      );
    } catch {
    }
  }
}
async function setOneTimeTaskOverride(params) {
  const { taskType, modelId, actorUid, actorEmail, idToken } = params;
  const curTask = authoritativeAiConfig.taskModels[taskType] || DEFAULT_TASK_MODELS[taskType];
  const next = {
    ...authoritativeAiConfig,
    taskModels: {
      ...authoritativeAiConfig.taskModels,
      [taskType]: {
        ...curTask,
        oneTimeOverrideModel: modelId ? modelId.trim() : null
      }
    },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedBy: actorUid
  };
  authoritativeAiConfig = next;
  lastRemoteConfigSyncAt = Date.now();
  try {
    await firestoreRestSet("systemConfig/aiService", next, idToken);
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
  const shouldBumpVersion = Boolean(patch.taskModels || patch.activeModel || patch.allowedOrigins);
  if (patch.taskModels || patch.activeModel) {
    clearAiResponseCache();
  }
  const next = {
    ...authoritativeAiConfig,
    ...patch,
    configVersion: shouldBumpVersion ? (authoritativeAiConfig.configVersion || 1) + 1 : authoritativeAiConfig.configVersion || 1,
    allowedOrigins: Array.isArray(patch.allowedOrigins) ? patch.allowedOrigins.map((o) => o.trim()).filter(Boolean) : authoritativeAiConfig.allowedOrigins,
    taskModels: patch.taskModels ? mergeTaskModels(authoritativeAiConfig.taskModels, patch.taskModels) : authoritativeAiConfig.taskModels,
    rateLimitConfig: {
      ...authoritativeAiConfig.rateLimitConfig,
      ...patch.rateLimitConfig || {}
    },
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedBy: actorUid
  };
  authoritativeAiConfig = next;
  lastRemoteConfigSyncAt = Date.now();
  try {
    await firestoreRestSet("systemConfig/aiService", next, idToken);
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
import { Type } from "@google/genai";

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
function calculateCompletenessScore(coverageItems, hasValidScope) {
  if (!hasValidScope || coverageItems.length === 0) {
    return {
      completenessScore: null,
      coveredWeight: 0,
      totalRequiredWeight: 0,
      missingCount: 0,
      partialCount: 0,
      coveredCount: 0
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
    coveredCount
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

// src/server/geminiPipeline.ts
init_retrieval();

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
function accumulateTokens(acc, resp) {
  const meta = resp.usageMetadata;
  if (!meta) return;
  acc.promptTokens += meta.promptTokenCount || 0;
  acc.candidateTokens += meta.candidatesTokenCount || 0;
  acc.totalTokens += meta.totalTokenCount || 0;
}
function accumulateRawTokens(acc, usage) {
  acc.promptTokens += usage.promptTokens || 0;
  acc.candidateTokens += usage.candidateTokens || 0;
  acc.totalTokens += usage.totalTokens || 0;
}
async function generateJsonWithProvider(params) {
  if (isGroqModelId(params.modelId)) {
    const resp = await callWithTimeout(
      (signal) => callGroqChatCompletion({
        modelId: params.modelId,
        prompt: params.prompt,
        jsonMode: true,
        jsonSchemaHint: params.groqSchemaHint,
        maxOutputTokens: params.maxOutputTokens,
        signal
      }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp);
    return JSON.parse((resp.text || params.fallbackJson).trim());
  }
  if (isCloudflareModelId(params.modelId)) {
    const resp = await callWithTimeout(
      (signal) => callCloudflareChatCompletion({
        modelId: params.modelId,
        prompt: params.prompt,
        jsonMode: true,
        jsonSchemaHint: params.groqSchemaHint,
        maxOutputTokens: params.maxOutputTokens,
        signal
      }),
      params.timeoutMs
    );
    accumulateRawTokens(params.tokensOut, resp);
    return JSON.parse((resp.text || params.fallbackJson).trim());
  }
  const ai = await createServerAiClient();
  const response = await callWithTimeout(
    (signal) => ai.models.generateContent({
      model: params.modelId,
      contents: params.prompt,
      config: {
        thinkingConfig: thinkingConfigForModel(params.modelId, params.thinkingTier),
        maxOutputTokens: params.maxOutputTokens,
        abortSignal: signal,
        responseMimeType: "application/json",
        responseSchema: params.geminiSchema
      }
    }),
    params.timeoutMs
  );
  accumulateTokens(params.tokensOut, response);
  return JSON.parse((response.text || params.fallbackJson).trim());
}
async function generatePlainTextWithProvider(params) {
  if (isGroqModelId(params.modelId)) {
    const resp2 = await callWithTimeout(
      (signal) => callGroqChatCompletion({
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
  const ai = await createServerAiClient();
  const resp = await callWithTimeout(
    (signal) => ai.models.generateContent({
      model: params.modelId,
      contents: params.prompt,
      config: {
        thinkingConfig: thinkingConfigForModel(params.modelId, params.thinkingTier),
        maxOutputTokens: params.maxOutputTokens,
        abortSignal: signal
      }
    }),
    params.timeoutMs
  );
  accumulateTokens(params.tokensOut, resp);
  return (resp.text || "").trim();
}
async function runTaskWithRouter(params) {
  const cfg = params.config || getAuthoritativeAiConfigSnapshot();
  const res = await executeRoutedAiTask({
    taskType: params.taskType,
    config: cfg,
    consumeOneTimeOverride: (task) => consumeOneTimeModelOverride(task, params.idToken),
    cacheInput: params.cacheInput,
    bypassCache: params.bypassCache,
    allowGroqRescue: params.allowGroqRescue,
    runWithModel: params.runWithModel
  });
  return { data: res.data, modelId: res.modelId };
}
var DocumentExtractionService = class {
  static async extractFromImageBuffers(files, tokensOut, opts) {
    const ai = await createServerAiClient();
    const validTypes = /* @__PURE__ */ new Set(["paragraph", "heading", "formula", "table", "list", "handwriting"]);
    const pageOffset = Math.max(0, Number(opts?.pageOffset) || 0);
    const pages = [];
    for (let idx = 0; idx < files.length; idx += 1) {
      const file = files[idx];
      const pageNum = pageOffset + idx + 1;
      const contentHash = crypto6.createHash("sha256").update(file.buffer).digest("hex");
      const { data: parsed } = await runTaskWithRouter({
        taskType: "curriculum_extraction",
        config: opts?.config,
        idToken: opts?.idToken,
        cacheInput: { ocrKind: "image", mimeType: file.mimeType, sha256: contentHash },
        runWithModel: async (modelId) => {
          const visionModel = isGroqModelId(modelId) || isCloudflareModelId(modelId) ? "gemini-4-hydrogen" : modelId;
          const base64 = file.buffer.toString("base64");
          const response = await callWithTimeout(
            (signal) => ai.models.generateContent({
              model: visionModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: file.mimeType,
                      data: base64
                    }
                  },
                  {
                    text: [
                      "Tr\xEDch xu\u1EA5t to\xE0n b\u1ED9 v\u0103n b\u1EA3n, c\xF4ng th\u1EE9c, b\u1EA3ng bi\u1EC3u v\xE0 ch\u1EEF vi\u1EBFt tay t\u1EEB trang t\xE0i li\u1EC7u n\xE0y.",
                      "- Gi\u1EEF nguy\xEAn ch\xEDnh t\u1EA3 v\xE0 n\u1ED9i dung g\u1ED1c c\u1EE7a h\u1ECDc sinh, KH\xD4NG t\u1EF1 s\u1EEDa l\u1ED7i ki\u1EBFn th\u1EE9c, KH\xD4NG th\xEAm b\xECnh lu\u1EADn.",
                      "- Chia th\xE0nh c\xE1c kh\u1ED1i theo th\u1EE9 t\u1EF1 \u0111\u1ECDc v\xE0 ghi nh\u1EADn textType + confidence (0.0-1.0). N\u1EBFu ch\u1EEF m\u1EDD/kh\xF3 \u0111\u1ECDc \u0111\u1EB7t confidence < 0.65."
                    ].join("\n")
                  }
                ]
              },
              config: {
                thinkingConfig: thinkingConfigForModel(visionModel, "minimal"),
                maxOutputTokens: 2048,
                abortSignal: signal,
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    blocks: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          extractedText: { type: Type.STRING },
                          textType: {
                            type: Type.STRING,
                            description: "paragraph | heading | formula | table | list | handwriting"
                          },
                          confidence: { type: Type.NUMBER },
                          formulaText: { type: Type.STRING }
                        },
                        required: ["extractedText", "textType", "confidence"]
                      }
                    }
                  },
                  required: ["blocks"]
                }
              }
            })
          );
          accumulateTokens(tokensOut, response);
          return JSON.parse((response.text || '{"blocks":[]}').trim());
        }
      });
      const blocks = (parsed.blocks || []).filter((b) => b.extractedText && b.extractedText.trim().length > 0).map((b, bIdx) => ({
        blockId: `p${pageNum}_b${bIdx + 1}`,
        pageNumber: pageNum,
        extractedText: b.extractedText.trim(),
        textType: validTypes.has(b.textType) ? b.textType : "paragraph",
        confidence: Math.max(0, Math.min(1, Number(b.confidence) || 0.8)),
        readingOrder: bIdx + 1,
        ...b.formulaText ? { formulaText: b.formulaText } : {},
        boundingBox: null
      }));
      const avgConf = blocks.length > 0 ? Math.round(blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length * 100) / 100 : 0;
      pages.push({
        pageNumber: pageNum,
        rawText: blocks.map((b) => b.extractedText).join("\n"),
        blocks,
        ocrAverageConfidence: avgConf
      });
    }
    return pages;
  }
  static async extractFromPdfBuffer(buffer, tokensOut, opts) {
    try {
      const { extractPdfPagesFromBuffer: extractPdfPagesFromBuffer2 } = await Promise.resolve().then(() => (init_referenceIngestService(), referenceIngestService_exports));
      const textPages = await extractPdfPagesFromBuffer2(buffer);
      const totalChars = textPages.reduce((sum, p) => sum + p.text.trim().length, 0);
      if (totalChars >= 80) {
        return textPages.map((p) => {
          const paragraphs = p.text.split(/\n+/).map((t) => t.trim()).filter(Boolean);
          const blocks = paragraphs.map((line, i) => ({
            blockId: `p${p.pageNumber}_b${i + 1}`,
            pageNumber: p.pageNumber,
            extractedText: line,
            textType: i === 0 && line.length < 90 ? "heading" : "paragraph",
            confidence: 0.98,
            readingOrder: i + 1,
            boundingBox: null
          }));
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
    const ai = await createServerAiClient();
    const pdfHash = crypto6.createHash("sha256").update(buffer).digest("hex");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "curriculum_extraction",
      config: opts?.config,
      idToken: opts?.idToken,
      cacheInput: { ocrKind: "pdf_scan", sha256: pdfHash },
      runWithModel: async (modelId) => {
        const visionModel = isGroqModelId(modelId) || isCloudflareModelId(modelId) ? "gemini-4-hydrogen" : modelId;
        const base64 = buffer.toString("base64");
        const response = await callWithTimeout(
          (signal) => ai.models.generateContent({
            model: visionModel,
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: "application/pdf",
                    data: base64
                  }
                },
                {
                  text: "Tr\xEDch xu\u1EA5t v\u0103n b\u1EA3n, c\xF4ng th\u1EE9c v\xE0 b\u1EA3ng bi\u1EC3u theo t\u1EEBng trang c\u1EE7a file PDF h\u1ECDc t\u1EADp n\xE0y. Gi\u1EEF nguy\xEAn n\u1ED9i dung g\u1ED1c (kh\xF4ng t\u1EF1 s\u1EEDa l\u1ED7i ki\u1EBFn th\u1EE9c, kh\xF4ng th\xEAm b\xECnh lu\u1EADn). Tr\u1EA3 v\u1EC1 danh s\xE1ch trang v\xE0 t\u1EEBng \u0111o\u1EA1n v\u0103n b\u1EA3n k\xE8m \u0111\u1ED9 tin c\u1EADy OCR."
                }
              ]
            },
            config: {
              thinkingConfig: thinkingConfigForModel(visionModel, "minimal"),
              maxOutputTokens: 4096,
              abortSignal: signal,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  pages: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        pageNumber: { type: Type.INTEGER },
                        blocks: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              extractedText: { type: Type.STRING },
                              textType: { type: Type.STRING },
                              confidence: { type: Type.NUMBER },
                              formulaText: { type: Type.STRING }
                            },
                            required: ["extractedText", "textType", "confidence"]
                          }
                        }
                      },
                      required: ["pageNumber", "blocks"]
                    }
                  }
                },
                required: ["pages"]
              }
            }
          })
        );
        accumulateTokens(tokensOut, response);
        return JSON.parse((response.text || '{"pages":[]}').trim());
      }
    });
    const validTypes = /* @__PURE__ */ new Set(["paragraph", "heading", "formula", "table", "list", "handwriting"]);
    return (parsed.pages || []).map((p, idx) => {
      const pageNum = p.pageNumber || idx + 1;
      const blocks = (p.blocks || []).map((b, bIdx) => ({
        blockId: `p${pageNum}_b${bIdx + 1}`,
        pageNumber: pageNum,
        extractedText: b.extractedText.trim(),
        textType: validTypes.has(b.textType) ? b.textType : "paragraph",
        confidence: Math.max(0, Math.min(1, Number(b.confidence) || 0.78)),
        readingOrder: bIdx + 1,
        ...b.formulaText ? { formulaText: b.formulaText } : {},
        boundingBox: null
      }));
      const avgConf = blocks.length > 0 ? Math.round(blocks.reduce((s, b) => s + b.confidence, 0) / blocks.length * 100) / 100 : 0.75;
      return {
        pageNumber: pageNum,
        rawText: blocks.map((b) => b.extractedText).join("\n"),
        blocks,
        ocrAverageConfidence: avgConf
      };
    });
  }
  static async extractFromDocxBuffer(buffer) {
    const mammothMod = await import("mammoth");
    const mammothApi = mammothMod.default || mammothMod;
    const result = await mammothApi.extractRawText({ buffer });
    const raw = (result.value || "").trim();
    if (!raw) {
      throw new Error("File DOCX kh\xF4ng c\xF3 v\u0103n b\u1EA3n \u0111\u1ECDc \u0111\u01B0\u1EE3c ho\u1EB7c b\u1ECB h\u1ECFng.");
    }
    const paragraphs = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const pageSize = 18;
    const pages = [];
    for (let i = 0; i < paragraphs.length; i += pageSize) {
      const pageNum = Math.floor(i / pageSize) + 1;
      const slice = paragraphs.slice(i, i + pageSize);
      const blocks = slice.map((text, idx) => ({
        blockId: `p${pageNum}_b${idx + 1}`,
        pageNumber: pageNum,
        extractedText: text,
        textType: idx === 0 && text.length < 90 ? "heading" : "paragraph",
        confidence: 0.99,
        readingOrder: idx + 1,
        boundingBox: null
      }));
      pages.push({
        pageNumber: pageNum,
        rawText: slice.join("\n"),
        blocks,
        ocrAverageConfidence: 0.99
      });
    }
    return pages;
  }
};
var SubjectDetectionService = class {
  static async detectScope(sampleText, tokensOut, opts) {
    const scopePrompt = [
      "Ph\xE2n t\xEDch \u0111o\u1EA1n ghi ch\xE9p h\u1ECDc t\u1EADp sau \u0111\u1EC3 x\xE1c \u0111\u1ECBnh \u0110\xDANG l\u1EDBp (10, 11 ho\u1EB7c 12), m\xF4n h\u1ECDc THPT, ti\xEAu \u0111\u1EC1 ng\u1EAFn v\xE0 t\u1ED1i \u0111a 3 ch\u01B0\u01A1ng/ch\u1EE7 \u0111\u1EC1 ph\xF9 h\u1EE3p.",
      'L\u01AFU \xDD QUAN TR\u1ECCNG: X\xE1c \u0111\u1ECBnh ch\u1EE7 \u0111\u1EC1 d\u1EF1a tr\xEAn KH\xC1I NI\u1EC6M/\u0110\u1ED0I T\u01AF\u1EE2NG CH\xCDNH m\xE0 t\xE0i li\u1EC7u \u0111ang tr\xECnh b\xE0y ho\u1EB7c \u0111\u1ECBnh ngh\u0129a (v\xED d\u1EE5: n\u1EBFu \u0111o\u1EA1n v\u0103n vi\u1EBFt "Chuy\u1EC3n \u0111\u1ED9ng th\u1EB3ng \u0111\u1EC1u l\xE0..." nh\u01B0ng h\u1ECDc sinh vi\u1EBFt nh\u1EA7m chi ti\u1EBFt b\xEAn trong th\xE0nh "t\u1ED1c \u0111\u1ED9 thay \u0111\u1ED5i", ch\u1EE7 \u0111\u1EC1 V\u1EAAN L\xC0 "Chuy\u1EC3n \u0111\u1ED9ng th\u1EB3ng \u0111\u1EC1u", TUY\u1EC6T \u0110\u1ED0I KH\xD4NG b\u1ECB l\u1ED7i sai c\u1EE7a h\u1ECDc sinh \u0111\xE1nh l\u1EEBa sang ch\u01B0\u01A1ng kh\xE1c nh\u01B0 "Chuy\u1EC3n \u0111\u1ED9ng bi\u1EBFn \u0111\u1ED5i").',
      "",
      sampleText.slice(0, 1800)
    ].join("\n");
    const { data: parsed } = await runTaskWithRouter({
      taskType: "subject_classification",
      config: opts?.config,
      idToken: opts?.idToken,
      allowGroqRescue: true,
      cacheInput: { sample: sampleText.slice(0, 1500), rev: "v3_topic_strict" },
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt: scopePrompt,
        thinkingTier: "low",
        maxOutputTokens: 384,
        tokensOut,
        fallbackJson: "{}",
        groqSchemaHint: '{"suggestedGrade":"10|11|12","suggestedSubject":"toan|vat_ly|hoa_hoc|sinh_hoc|ngu_van|lich_su|dia_ly|tieng_anh|tin_hoc|gdkt_pl|khac","suggestedChapters":["..."],"suggestedTitle":"..."}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedGrade: { type: Type.STRING, description: "10 | 11 | 12" },
            suggestedSubject: {
              type: Type.STRING,
              description: "toan | vat_ly | hoa_hoc | sinh_hoc | ngu_van | lich_su | dia_ly | tieng_anh | tin_hoc | gdkt_pl | khac"
            },
            suggestedChapters: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            },
            suggestedTitle: { type: Type.STRING }
          },
          required: ["suggestedGrade", "suggestedSubject", "suggestedChapters", "suggestedTitle"]
        }
      })
    });
    const grade = parsed.suggestedGrade === "11" || parsed.suggestedGrade === "12" ? parsed.suggestedGrade : "10";
    const subject = parsed.suggestedSubject && parsed.suggestedSubject in SUBJECT_LABELS ? parsed.suggestedSubject : "khac";
    return {
      suggestedGrade: grade,
      suggestedSubject: subject,
      suggestedChapters: (parsed.suggestedChapters || []).slice(0, 5),
      suggestedTitle: parsed.suggestedTitle || "T\xE0i li\u1EC7u \xF4n t\u1EADp"
    };
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
      tokensOut,
      config,
      idToken
    } = params;
    const subjectName = SUBJECT_LABELS[subject];
    const formattedStudentBlocks = pages.map((p) => {
      const blocksStr = p.blocks.map(
        (b) => `[blockId=${b.blockId} | page=${p.pageNumber} | ocrConf=${b.confidence}] ${b.extractedText}`
      ).join("\n");
      return `--- TRANG ${p.pageNumber} ---
${blocksStr}`;
    }).join("\n\n");
    const fullText = pages.map((p) => p.rawText).join("\n");
    const retrievedHits = retrieveRelevantChunks(fullText, referenceChunks, {
      referenceId: textbookReferenceId || void 0,
      selectedChapters: selectedChapters.length > 0 ? selectedChapters : void 0,
      topK: 10
    });
    const textbookContext = retrievedHits.length > 0 ? retrievedHits.map(
      (h) => `[chunkId=${h.chunk.chunkId} | Trang ${h.chunk.pageNumber} | ${h.chunk.chapter} - ${h.chunk.lesson} | ${h.chunk.sectionTitle}]
${h.chunk.content}`
    ).join("\n\n") : "Kh\xF4ng c\xF3 \u0111o\u1EA1n tr\xEDch s\xE1ch gi\xE1o khoa \u0111\u01B0\u1EE3c l\u1EADp ch\u1EC9 m\u1EE5c trong kho tham chi\u1EBFu cho ph\u1EA1m vi n\xE0y.";
    let webSources = [];
    let webGroundingSummary = "";
    let usedWebGrounding = false;
    let webGroundingNotice;
    if (enableWebGrounding === true) {
      try {
        const ai = await createServerAiClient();
        const searchPrompt = [
          `Ki\u1EC3m ch\u1EE9ng c\xE1c kh\xE1i ni\u1EC7m n\xE2ng cao ho\u1EB7c n\u1ED9i dung ch\u01B0a c\xF3 \u0111\u1EE7 trong s\xE1ch gi\xE1o khoa \u0111\u1ED1i v\u1EDBi m\xF4n ${subjectName} l\u1EDBp ${grade}, ph\u1EA1m vi: ${scope || selectedChapters.join(", ") || "T\u1ED5ng h\u1EE3p"}.`,
          "\u01AFu ti\xEAn ngu\u1ED3n ch\xEDnh th\u1ED1ng (B\u1ED9 GD&\u0110T, NXB Gi\xE1o d\u1EE5c, \u0111\u1EA1i h\u1ECDc). T\xF3m t\u1EAFt th\u1EADt s\xFAc t\xEDch t\u1ED1i \u0111a 6 g\u1EA1ch \u0111\u1EA7u d\xF2ng ki\u1EBFn th\u1EE9c chu\u1EA9n k\xE8m tr\xEDch d\u1EABn \u0111\u1EC3 \u0111\u1ED1i chi\u1EBFu v\u1EDBi b\xE0i ghi sau:",
          fullText.slice(0, 3500)
        ].join("\n\n");
        const { data: groundResp } = await runTaskWithRouter({
          taskType: "claim_validation",
          config,
          idToken,
          cacheInput: { webSearchText: fullText.slice(0, 2e3), grade, subject, scope },
          runWithModel: async (modelId) => {
            const searchModel = isGroqModelId(modelId) || isCloudflareModelId(modelId) ? "gemini-3.1-flash-lite" : modelId;
            const resp = await callWithTimeout(
              (signal) => ai.models.generateContent({
                model: searchModel,
                contents: searchPrompt,
                config: {
                  thinkingConfig: thinkingConfigForModel(searchModel, "minimal"),
                  maxOutputTokens: 1024,
                  abortSignal: signal,
                  tools: [{ googleSearch: {} }]
                }
              })
            );
            accumulateTokens(tokensOut, resp);
            return resp;
          }
        });
        const gChunks = groundResp.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        const nowIso = (/* @__PURE__ */ new Date()).toISOString();
        const extractedWeb = [];
        for (let i = 0; i < gChunks.length; i++) {
          const web = gChunks[i]?.web;
          if (web?.uri) {
            let domain = "";
            try {
              domain = new URL(web.uri).hostname;
            } catch {
              domain = "";
            }
            extractedWeb.push({
              evidenceId: `web_${i + 1}`,
              sourceType: "web",
              title: web.title || domain || "Ngu\u1ED3n h\u1ECDc thu\u1EADt",
              url: web.uri,
              domain,
              excerpt: (groundResp.text || "").slice(0, 420),
              accessedAt: nowIso
            });
          }
        }
        if (extractedWeb.length > 0) {
          webSources = extractedWeb.slice(0, 8);
          webGroundingSummary = groundResp.text || "";
          usedWebGrounding = true;
        } else {
          webGroundingNotice = "Google Search Grounding kh\xF4ng tr\u1EA3 v\u1EC1 ngu\u1ED3n web tr\xEDch d\u1EABn c\u1EE5 th\u1EC3 cho n\u1ED9i dung n\xE0y; h\u1EC7 th\u1ED1ng \u0111\xE1nh gi\xE1 d\u1EF1a tr\xEAn kho s\xE1ch tham chi\u1EBFu.";
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        webGroundingNotice = `Kh\xF4ng th\u1EC3 truy v\u1EA5n Google Search Grounding (${msg.slice(0, 90)}). \u0110\xE1nh gi\xE1 d\u1EF1a tr\xEAn kho s\xE1ch tham chi\u1EBFu.`;
      }
    }
    const hasIndexedTextbookChunks = retrievedHits.length > 0;
    const analysisPrompt = [
      "B\u1EA1n l\xE0 chuy\xEAn gia ki\u1EC3m \u0111\u1ECBnh ki\u1EBFn th\u1EE9c gi\xE1o d\u1EE5c THPT Vi\u1EC7t Nam c\u1EE7a StudyCheck AI. H\xE3y ch\u1EA5m c\u1EF1c k\u1EF3 ch\xEDnh x\xE1c, ch\u1EB7t ch\u1EBD, nh\u1EA5t qu\xE1n tuy\u1EC7t \u0111\u1ED1i gi\u1EEFa tr\u1EA1ng th\xE1i, l\u1EDDi gi\u1EA3i th\xEDch v\xE0 \u0111\xE1p \xE1n s\u1EEDa chu\u1EA9n.",
      `M\xF4n h\u1ECDc: ${subjectName} | L\u1EDBp: ${grade} | S\xE1ch tham chi\u1EBFu: ${textbookTitle || "Chu\u1EA9n ch\u01B0\u01A1ng tr\xECnh GDPT 2018 & ki\u1EBFn th\u1EE9c khoa h\u1ECDc ph\u1ED5 th\xF4ng"} | Ph\u1EA1m vi: ${scope || selectedChapters.join(", ") || "Theo \u0111\xFAng ch\u1EE7 \u0111\u1EC1 ch\xEDnh trong t\xE0i li\u1EC7u"}`,
      "",
      "NGU\u1ED2N C\u0102N C\u1EE8 \u0110\u1ED0I CHI\u1EBEU:",
      hasIndexedTextbookChunks ? "- \u01AFu ti\xEAn \u0111\u1ED1i chi\u1EBFu tr\u1EF1c ti\u1EBFp c\xE1c \u0111o\u1EA1n tr\xEDch SGK b\xEAn d\u01B0\u1EDBi v\xE0 g\u1EAFn \u0111\xFAng matchedChunkId, matchedPage. V\u1EDBi ki\u1EBFn th\u1EE9c khoa h\u1ECDc ph\u1ED5 th\xF4ng kh\xF4ng xu\u1EA5t hi\u1EC7n tr\u1EF1c ti\u1EBFp trong \u0111o\u1EA1n tr\xEDch nh\u01B0ng thu\u1ED9c chu\u1EA9n GDPT 2018, v\u1EABn ki\u1EC3m \u0111\u1ECBnh chu\u1EA9n x\xE1c theo khoa h\u1ECDc ph\u1ED5 th\xF4ng." : '- Hi\u1EC7n ch\u01B0a c\xF3 \u0111o\u1EA1n tr\xEDch SGK trong kho cho b\xE0i n\xE0y. B\u1EAET BU\u1ED8C d\xF9ng chu\u1EA9n ki\u1EBFn th\u1EE9c khoa h\u1ECDc ch\xEDnh th\u1ED1ng v\xE0 ch\u01B0\u01A1ng tr\xECnh GDPT 2018 c\u1EE7a B\u1ED9 GD&\u0110T \u0111\u1EC3 ki\u1EC3m \u0111\u1ECBnh d\u1EE9t kho\xE1t m\u1ECDi \u0111\u1ECBnh ngh\u0129a, \u0111\u1ECBnh lu\u1EADt, c\xF4ng th\u1EE9c, t\xEDnh ch\u1EA5t v\xE0 \u0111\u01A1n v\u1ECB \u0111o. TUY\u1EC6T \u0110\u1ED0I KH\xD4NG \u0111\xE1nh UNVERIFIED v\u1EDBi l\u1ED7i sai ki\u1EBFn th\u1EE9c hay sai c\xF4ng th\u1EE9c ph\u1ED5 th\xF4ng r\xF5 r\xE0ng (v\xED d\u1EE5: sai "t\u1ED1c \u0111\u1ED9 thay \u0111\u1ED5i" trong chuy\u1EC3n \u0111\u1ED9ng th\u1EB3ng \u0111\u1EC1u, sai "t\u1EC9 l\u1EC7 ngh\u1ECBch", sai ph\xE9p to\xE1n "s = v + t").',
      "",
      "QUY TR\xCCNH KI\u1EC2M \u0110\u1ECANH 4 L\u1EDAP B\u1EAET BU\u1ED8C:",
      "L\u1EDAP 1 \u2014 T\xC1CH M\u1EC6NH \u0110\u1EC0 & R\xC0 T\u1EEANG C\xC2U / T\u1EEANG V\u1EBE:",
      '- T\xE1ch t\xE0i li\u1EC7u h\u1ECDc sinh th\xE0nh t\u1EEBng \u0111\u01A1n v\u1ECB ki\u1EBFn th\u1EE9c \u0111\u1ED9c l\u1EADp theo \u0111\xFAng t\u1EEBng c\xE2u, t\u1EEBng c\xF4ng th\u1EE9c v\xE0 t\u1EEBng \u0111o\u1EA1n gi\u1EA3i th\xEDch "Trong \u0111\xF3..." (kh\xF4ng g\u1ED9p nhi\u1EC1u l\u1ED7i kh\xE1c nhau v\xE0o chung 1 claim).',
      '- Ki\u1EC3m tra k\u1EF9 m\u1ECDi t\u1EEB kh\xF3a mang t\xEDnh b\u1EA3n ch\u1EA5t: "kh\xF4ng \u0111\u1ED5i" vs "thay \u0111\u1ED5i", "t\u1EC9 l\u1EC7 thu\u1EADn" vs "t\u1EC9 l\u1EC7 ngh\u1ECBch", "t\u0103ng" vs "gi\u1EA3m", "c\xF9ng chi\u1EC1u" vs "ng\u01B0\u1EE3c chi\u1EC1u", "b\u1EA3o to\xE0n" vs "kh\xF4ng b\u1EA3o to\xE0n", \u0111i\u1EC1u ki\u1EC7n \xE1p d\u1EE5ng.',
      "- \u0110\u1ED1i chi\u1EBFu theo ngh\u0129a h\u1ECDc thu\u1EADt (kh\xF4ng b\u1EAFt b\u1EBB c\xE1ch di\u1EC5n \u0111\u1EA1t t\u01B0\u01A1ng \u0111\u01B0\u01A1ng n\u1EBFu \u0111\xFAng b\u1EA3n ch\u1EA5t).",
      "",
      "L\u1EDAP 2 \u2014 SOI T\u1EEANG C\xD4NG TH\u1EE8C & PH\xC9P TO\xC1N:",
      "- Ki\u1EC3m tra t\u1EEBng d\u1EA5u ph\xE9p to\xE1n (+, -, \xD7, ., /, ^), d\u1EA5u \xE2m/d\u01B0\u01A1ng, h\u1EC7 s\u1ED1, ch\u1EC9 s\u1ED1 d\u01B0\u1EDBi v\xE0 ki\u1EC3m tra th\u1EE9 nguy\xEAn v\u1EADt l\xFD/to\xE1n h\u1ECDc (v\xED d\u1EE5: v [m/s] kh\xF4ng th\u1EC3 c\u1ED9ng v\u1EDBi t [s] trong s = v + t; c\xF4ng th\u1EE9c \u0111\xFAng ph\u1EA3i l\xE0 s = v.t).",
      '- T\xE1ch ri\xEAng claim cho c\xF4ng th\u1EE9c v\xE0 claim cho ph\u1EA7n ch\xFA th\xEDch "Trong \u0111\xF3..." \u0111i k\xE8m \u0111\u1EC3 ph\xE2n bi\u1EC7t r\xF5: c\xF4ng th\u1EE9c \u0111\xFAng nh\u01B0ng thi\u1EBFu gi\u1EA3i th\xEDch bi\u1EBFn s\u1ED1 kh\xE1c v\u1EDBi c\xF4ng th\u1EE9c vi\u1EBFt sai.',
      "",
      "L\u1EDAP 3 \u2014 KI\u1EC2M TRA \u0110\u1ED8 \u0110\u1EA6Y \u0110\u1EE6 CH\xDA TH\xCDCH K\xDD HI\u1EC6U & \u0110\u01A0N V\u1ECA C\u1EE6A M\u1ECCI C\xD4NG TH\u1EE8C:",
      '- V\u1EDBi M\u1ECCI c\xF4ng th\u1EE9c xu\u1EA5t hi\u1EC7n trong t\xE0i li\u1EC7u (v\xED d\u1EE5 s = v.t, x = x0 + v.t, F = m.a...), li\u1EC7t k\xEA T\u1EA4T C\u1EA2 c\xE1c k\xFD hi\u1EC7u/bi\u1EBFn s\u1ED1 c\xF3 m\u1EB7t trong c\xF4ng th\u1EE9c \u0111\xF3 v\xE0 \u0111\u1ED1i chi\u1EBFu v\u1EDBi ph\u1EA7n gi\u1EA3i th\xEDch ("Trong \u0111\xF3...") ngay k\u1EBF ti\u1EBFp.',
      "- N\u1EBFu h\u1ECDc sinh B\u1ECE S\xD3T gi\u1EA3i th\xEDch \xFD ngh\u0129a HO\u1EB6C thi\u1EBFu \u0111\u01A1n v\u1ECB \u0111o c\u1EE7a b\u1EA5t k\u1EF3 k\xFD hi\u1EC7u n\xE0o (v\xED d\u1EE5: vi\u1EBFt s v\xE0 v nh\u01B0ng kh\xF4ng gi\u1EA3i th\xEDch th\u1EDDi gian t v\xE0 \u0111\u01A1n v\u1ECB gi\xE2y s; ho\u1EB7c vi\u1EBFt x0 v\xE0 x nh\u01B0ng kh\xF4ng gi\u1EA3i th\xEDch v\u1EADn t\u1ED1c v trong ph\u01B0\u01A1ng tr\xECnh chuy\u1EC3n \u0111\u1ED9ng):",
      "  + \u0110\xE1nh gi\xE1 ph\u1EA7n gi\u1EA3i th\xEDch \u0111\xF3 l\xE0 PARTIALLY_CORRECT (Thi\u1EBFu th\xF4ng tin / \u0110i\u1EC1u ki\u1EC7n), n\xEAu \u0110\xCDCH DANH k\xFD hi\u1EC7u v\xE0 \u0111\u01A1n v\u1ECB c\xF2n thi\u1EBFu trong explanation, v\xE0 vi\u1EBFt tr\u1ECDn b\u1ED9 ch\xFA th\xEDch \u0111\u1EA7y \u0111\u1EE7 trong suggestedFix.",
      '  + B\u1EAET BU\u1ED8C th\xEAm t\u1EEBng m\u1EE5c thi\u1EBFu \u0111\xF3 v\xE0o coverageItems v\u1EDBi status = "MISSING" (ho\u1EB7c "PARTIALLY_COVERED") v\xE0 v\xE0o weaknesses \u0111\u1EC3 hi\u1EC3n th\u1ECB r\xF5 trong danh s\xE1ch "Thi\u1EBFu th\xF4ng tin".',
      "",
      "L\u1EDAP 4 \u2014 T\u1EF0 KI\u1EC2M CH\xC9O NH\u1EA4T QU\xC1N TR\u01AF\u1EDAC KHI TR\u1EA2 K\u1EBET QU\u1EA2:",
      "- Ph\xE2n lo\u1EA1i tr\u1EA1ng th\xE1i chu\u1EA9n:",
      "  + CORRECT: ho\xE0n to\xE0n \u0111\xFAng b\u1EA3n ch\u1EA5t, kh\xF4ng thi\u1EBFu k\xFD hi\u1EC7u hay \u0111i\u1EC1u ki\u1EC7n quan tr\u1ECDng.",
      "  + INCORRECT: sai b\u1EA3n ch\u1EA5t ki\u1EBFn th\u1EE9c, sai quan h\u1EC7, sai c\xF4ng th\u1EE9c/ph\xE9p to\xE1n.",
      "  + PARTIALLY_CORRECT: c\xF3 ph\u1EA7n \u0111\xFAng nh\u01B0ng thi\u1EBFu th\xF4ng tin quan tr\u1ECDng (thi\u1EBFu gi\u1EA3i th\xEDch k\xFD hi\u1EC7u/\u0111\u01A1n v\u1ECB, thi\u1EBFu \u0111i\u1EC1u ki\u1EC7n \xE1p d\u1EE5ng, ph\xE1t bi\u1EC3u ch\u01B0a tr\u1ECDn v\u1EB9n).",
      "  + UNVERIFIED: CH\u1EC8 d\xF9ng khi th\xF4ng tin ri\xEAng l\u1EBB/m\u01A1 h\u1ED3/kh\xF4ng \u0111\u1EE7 ng\u1EEF c\u1EA3nh \u0111\u1EC3 x\xE1c minh. KH\xD4NG d\xF9ng cho \u0111\u1ECBnh ngh\u0129a/c\xF4ng th\u1EE9c ph\u1ED5 th\xF4ng.",
      "  + OCR_UNCERTAIN: \u0111\u1ED9 tin c\u1EADy OCR < 0.65.",
      "  + OUT_OF_SCOPE: n\u1ED9i dung l\u1EA1c \u0111\u1EC1 ho\xE0n to\xE0n kh\u1ECFi m\xF4n h\u1ECDc.",
      "- KI\u1EC2M TRA CH\xC9O: N\u1EBFu explanation ch\u1EC9 ra h\u1ECDc sinh vi\u1EBFt sai \u2192 evaluationStatus B\u1EAET BU\u1ED8C l\xE0 INCORRECT. N\u1EBFu explanation ch\u1EC9 ra h\u1ECDc sinh vi\u1EBFt thi\u1EBFu k\xFD hi\u1EC7u/\u0111\u01A1n v\u1ECB/\u0111i\u1EC1u ki\u1EC7n \u2192 evaluationStatus B\u1EAET BU\u1ED8C l\xE0 PARTIALLY_CORRECT. C\u1EA4M TUY\u1EC6T \u0110\u1ED0I vi\u1EC7c gi\u1EA3i th\xEDch 1 \u0111\u1EB1ng m\xE0 ch\u1EA5m tr\u1EA1ng th\xE1i 1 n\u1EBBo.",
      "- G\xE1n tr\u1ECDng s\u1ED1 importanceWeight: 3 (c\u1ED1t l\xF5i), 2 (h\u1ED7 tr\u1EE3/ch\xFA th\xEDch k\xFD hi\u1EC7u), 1 (chi ti\u1EBFt m\u1EDF r\u1ED9ng).",
      "- Tuy\u1EC7t \u0111\u1ED1i KH\xD4NG b\u1ECBa URL hay s\u1ED1 trang SGK n\u1EBFu kh\xF4ng c\xF3 trong ng\u1EEF c\u1EA3nh.",
      "- Vi\u1EBFt r\xF5 r\xE0ng, tr\u1EF1c di\u1EC7n, s\xFAc t\xEDch (m\u1ED7i explanation/correctKnowledge/suggestedFix t\u1ED1i \u0111a 2-3 c\xE2u ng\u1EAFn g\u1ECDn \u0111i th\u1EB3ng v\xE0o \u0111i\u1EC3m sai ho\u1EB7c \u0111i\u1EC3m thi\u1EBFu; weaknesses t\u1ED1i \u0111a 8 \xFD; coverageItems t\u1ED1i \u0111a 10 \xFD; strengths t\u1ED1i \u0111a 4 \xFD; suggestions t\u1ED1i \u0111a 4 \xFD).",
      "",
      "=== T\xC0I LI\u1EC6U C\u1EE6A H\u1ECCC SINH ===",
      formattedStudentBlocks.slice(0, 22e3),
      "",
      "=== \u0110O\u1EA0N TR\xCDCH S\xC1CH GI\xC1O KHOA THAM CHI\u1EBEU ===",
      textbookContext.slice(0, 14e3),
      "",
      webGroundingSummary ? `=== T\u1ED4NG H\u1EE2P NGU\u1ED2N INTERNET \u0110\xC3 GROUNDING ===
${webGroundingSummary.slice(0, 3500)}` : ""
    ].join("\n");
    const { data: rawEval, modelId: modelUsed } = await runTaskWithRouter({
      taskType: "knowledge_analysis",
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        promptRev: "v3_audit4layer",
        studentText: formattedStudentBlocks.slice(0, 12e3),
        textbookRef: textbookReferenceId,
        grade,
        subject,
        scope,
        chunksDigest: retrievedHits.map((h) => h.chunk.chunkId).join(",")
      },
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt: analysisPrompt,
        thinkingTier: "medium",
        maxOutputTokens: 6144,
        timeoutMs: 45e3,
        tokensOut,
        fallbackJson: '{"claims":[],"coverageItems":[],"strengths":[],"weaknesses":[],"suggestions":[]}',
        groqSchemaHint: '{"claims":[{"blockId":"...","sourcePage":1,"sourceText":"...","chapter":"...","concept":"...","importanceWeight":1|2|3,"knowledgeType":"textbook_core|advanced_extension|insufficient_evidence","evaluationStatus":"CORRECT|PARTIALLY_CORRECT|INCORRECT|MISSING|UNVERIFIED|AMBIGUOUS|OCR_UNCERTAIN|OUT_OF_SCOPE","explanation":"...","correctKnowledge":"...","suggestedFix":"..."}],"coverageItems":[{"concept":"...","chapter":"...","importanceWeight":1|2|3,"status":"COVERED|PARTIALLY_COVERED|MISSING|OUT_OF_SCOPE","suggestedAddition":"...","referenceExcerpt":"...","referencePage":1}],"strengths":[{"title":"...","detail":"...","sourceExcerpt":"...","pageNumber":1}],"weaknesses":[{"title":"...","detail":"...","pageNumber":1}],"suggestions":[{"priority":1,"title":"...","description":"..."}]}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            claims: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  blockId: { type: Type.STRING },
                  sourcePage: { type: Type.INTEGER },
                  sourceText: { type: Type.STRING },
                  chapter: { type: Type.STRING },
                  concept: { type: Type.STRING },
                  importanceWeight: { type: Type.INTEGER, description: "1 | 2 | 3" },
                  knowledgeType: {
                    type: Type.STRING,
                    description: "textbook_core | advanced_extension | insufficient_evidence"
                  },
                  evaluationStatus: {
                    type: Type.STRING,
                    description: "CORRECT | PARTIALLY_CORRECT | INCORRECT | MISSING | UNVERIFIED | AMBIGUOUS | OCR_UNCERTAIN | OUT_OF_SCOPE"
                  },
                  explanation: { type: Type.STRING },
                  correctKnowledge: { type: Type.STRING },
                  suggestedFix: { type: Type.STRING },
                  matchedChunkId: { type: Type.STRING },
                  matchedExcerpt: { type: Type.STRING },
                  matchedPage: { type: Type.INTEGER }
                },
                required: [
                  "sourcePage",
                  "sourceText",
                  "chapter",
                  "concept",
                  "importanceWeight",
                  "evaluationStatus",
                  "explanation",
                  "correctKnowledge"
                ]
              }
            },
            coverageItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  concept: { type: Type.STRING },
                  chapter: { type: Type.STRING },
                  importanceWeight: { type: Type.INTEGER },
                  status: {
                    type: Type.STRING,
                    description: "COVERED | PARTIALLY_COVERED | MISSING | OUT_OF_SCOPE"
                  },
                  suggestedAddition: { type: Type.STRING },
                  referenceExcerpt: { type: Type.STRING },
                  referencePage: { type: Type.INTEGER }
                },
                required: [
                  "concept",
                  "chapter",
                  "importanceWeight",
                  "status",
                  "suggestedAddition",
                  "referenceExcerpt"
                ]
              }
            },
            strengths: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  sourceExcerpt: { type: Type.STRING },
                  pageNumber: { type: Type.INTEGER }
                },
                required: ["title", "detail", "sourceExcerpt", "pageNumber"]
              }
            },
            weaknesses: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  detail: { type: Type.STRING },
                  pageNumber: { type: Type.INTEGER }
                },
                required: ["title", "detail"]
              }
            },
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  priority: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  description: { type: Type.STRING }
                },
                required: ["priority", "title", "description"]
              }
            }
          },
          required: ["claims", "coverageItems", "strengths", "weaknesses", "suggestions"]
        }
      })
    });
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
    const claims = (rawEval.claims || []).map((c, idx) => {
      const matchedBlock = c.blockId ? blockMap.get(c.blockId) : void 0;
      const ocrConf = matchedBlock ? matchedBlock.confidence : 0.9;
      let status = validStatuses.has(c.evaluationStatus) ? c.evaluationStatus : "UNVERIFIED";
      if (ocrConf < 0.65 && status === "INCORRECT") {
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
      if (usedWebGrounding && c.knowledgeType === "advanced_extension" && webSources.length > 0) {
        evidences.push(webSources[0]);
      }
      const resolvedSuggestedFix = c.suggestedFix && c.suggestedFix.trim() ? c.suggestedFix.trim() : status !== "CORRECT" && c.correctKnowledge ? c.correctKnowledge : null;
      return {
        claimId: `claim_${idx + 1}_${crypto6.randomBytes(2).toString("hex")}`,
        sourceText: c.sourceText,
        normalizedMeaning: c.sourceText,
        subject,
        chapter: c.chapter || selectedChapters[0] || "T\u1ED5ng h\u1EE3p",
        concept: c.concept || "Kh\xE1i ni\u1EC7m ch\xEDnh",
        importanceLevel: importanceWeight === 3 ? "core" : importanceWeight === 1 ? "detail" : "supporting",
        importanceWeight,
        sourcePage: c.sourcePage || matchedBlock?.pageNumber || 1,
        ...matchedBlock?.blockId ? { blockId: matchedBlock.blockId } : {},
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
    const coverageItems = (rawEval.coverageItems || []).map((item, idx) => {
      const wRaw = Number(item.importanceWeight);
      const importanceWeight = wRaw === 3 ? 3 : wRaw === 1 ? 1 : 2;
      const validCov = item.status === "COVERED" || item.status === "PARTIALLY_COVERED" || item.status === "MISSING" || item.status === "OUT_OF_SCOPE" ? item.status : "PARTIALLY_COVERED";
      return {
        itemId: `cov_${idx + 1}`,
        concept: item.concept,
        chapter: item.chapter,
        importanceWeight,
        status: validCov,
        suggestedAddition: item.suggestedAddition,
        referenceExcerpt: item.referenceExcerpt,
        ...typeof item.referencePage === "number" && item.referencePage > 0 ? { referencePage: item.referencePage } : {}
      };
    });
    const hasTextbook = Boolean(textbookReferenceId && referenceChunks.length > 0);
    const hasValidScope = Boolean(
      hasTextbook || selectedChapters.length > 0 || scope.trim().length > 0 || coverageItems.length > 0
    );
    const accuracyBreakdown = calculateAccuracyScore(claims, hasTextbook);
    const completenessBreakdown = calculateCompletenessScore(coverageItems, hasValidScope);
    const annotations = [];
    for (const claim of claims) {
      if (claim.evaluationStatus === "MISSING" || claim.evaluationStatus === "OUT_OF_SCOPE") continue;
      const color = claim.evaluationStatus === "INCORRECT" ? "red" : claim.evaluationStatus === "PARTIALLY_CORRECT" ? "orange" : claim.evaluationStatus === "UNVERIFIED" || claim.evaluationStatus === "OCR_UNCERTAIN" || claim.evaluationStatus === "AMBIGUOUS" ? "yellow" : "green";
      annotations.push({
        annotationId: `ann_${claim.claimId}`,
        pageNumber: claim.sourcePage,
        ...claim.blockId ? { blockId: claim.blockId } : {},
        textExcerpt: claim.sourceText,
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
      completenessBreakdown
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
    let targetClaims = claims;
    if (scope === "incorrect") {
      targetClaims = claims.filter((c) => c.evaluationStatus === "INCORRECT");
    } else if (scope === "partial") {
      targetClaims = claims.filter((c) => c.evaluationStatus === "PARTIALLY_CORRECT");
    } else if (scope === "chapter" && chapterFilter) {
      targetClaims = claims.filter((c) => c.chapter.toLowerCase().includes(chapterFilter.toLowerCase()));
    }
    const missingItems = scope === "missing" || scope === "all" ? coverageItems.filter((i) => i.status === "MISSING" || i.status === "PARTIALLY_COVERED") : [];
    const distinctUploadConcepts = new Set([
      ...targetClaims.map((c) => (c.concept || c.sourceText.slice(0, 35)).toLowerCase()),
      ...missingItems.map((m) => (m.concept || "").toLowerCase())
    ].filter(Boolean));
    const needsTextbookSupplement = distinctUploadConcepts.size < 5;
    const safeAdvancedExtra = advancedEnabled ? Math.min(6, Math.max(1, Number(advancedCount) || 2)) : 0;
    const baseTargetCount = Math.min(20, Math.max(5, Number(count) || 5));
    const supplementChunks = needsTextbookSupplement ? referenceChunks.filter((rc) => rc.grade === grade && rc.subject === subject).slice(0, 8) : [];
    const contextLines = [
      ...targetClaims.map(
        (c) => `[UploadClaim ${c.claimId} | ${c.evaluationStatus} | ${c.chapter} | ${c.concept}] H\u1ECDc sinh vi\u1EBFt: "${c.sourceText}" | Chu\u1EA9n: "${c.correctKnowledge}" | Gi\u1EA3i th\xEDch: "${c.explanation}"`
      ),
      ...missingItems.map(
        (m) => `[UploadMissing | ${m.chapter} | ${m.concept}] G\u1EE3i \xFD: "${m.suggestedAddition}" | Tr\xEDch d\u1EABn: "${m.referenceExcerpt}"`
      ),
      ...supplementChunks.map(
        (ch) => `[TextbookSupplement | ${ch.chapter} - ${ch.lesson} | Tr.${ch.pageNumber}] ${ch.content.slice(0, 450)}`
      )
    ];
    const effectiveContext = contextLines.length > 0 ? contextLines.join("\n") : claims.map((c) => `${c.concept}: ${c.correctKnowledge}`).join("\n");
    const diffLabel = difficulty === "basic" ? "C\u01A1 b\u1EA3n (Nh\u1EADn bi\u1EBFt, Th\xF4ng hi\u1EC3u)" : difficulty === "medium" ? "Trung b\xECnh (Th\xF4ng hi\u1EC3u, V\u1EADn d\u1EE5ng)" : difficulty === "advanced" ? "N\xE2ng cao (V\u1EADn d\u1EE5ng, V\u1EADn d\u1EE5ng cao)" : "H\u1ED7n h\u1EE3p c\xE2n b\u1EB1ng (Nh\u1EADn bi\u1EBFt 30% - Th\xF4ng hi\u1EC3u 30% - V\u1EADn d\u1EE5ng 25% - V\u1EADn d\u1EE5ng cao 15%)";
    const prompt = [
      `So\u1EA1n ${baseTargetCount} c\xE2u h\u1ECFi tr\u1EAFc nghi\u1EC7m ABCD c\u1ED1t l\xF5i cho h\u1ECDc sinh l\u1EDBp ${grade}, m\xF4n ${SUBJECT_LABELS[subject]}.`,
      needsTextbookSupplement ? `L\u01AFU \xDD \u0110\u1EB6C BI\u1EC6T: N\u1ED9i dung t\u1EA3i l\xEAn ch\u1EC9 c\xF3 ${distinctUploadConcepts.size} \u0111\u01A1n v\u1ECB ki\u1EBFn th\u1EE9c kh\xE1c nhau (< 5). H\xE3y t\u1EA1o t\u1ED1i \u0111a s\u1ED1 c\xE2u h\u1ECFi b\xE1m s\xE1t n\u1ED9i dung t\u1EA3i l\xEAn, V\xC0 T\u1EF0 \u0110\u1ED8NG B\u1ED4 SUNG ph\u1EA7n c\xF2n l\u1EA1i t\u1EEB ki\u1EBFn th\u1EE9c \u0111\xE3 ho\xE0n thi\u1EC7n c\u1EE7a ch\u01B0\u01A1ng/s\xE1ch gi\xE1o khoa (${textbookTitle || SUBJECT_LABELS[subject] + " l\u1EDBp " + grade}) \u0111\u1EC3 \u0111\u1EE7 ${baseTargetCount} c\xE2u ch\u1EA5t l\u01B0\u1EE3ng kh\xF4ng tr\xF9ng l\u1EB7p.` : `T\u1EA5t c\u1EA3 ${baseTargetCount} c\xE2u c\u1ED1t l\xF5i b\xE1m s\xE1t n\u1ED9i dung \u0111\xE3 t\u1EA3i l\xEAn v\xE0 ph\u1EA7n ki\u1EBFn th\u1EE9c c\u1EA7n c\u1EE7ng c\u1ED1.`,
      safeAdvancedExtra > 0 ? `Y\xCAU C\u1EA6U M\u1EDE R\u1ED8NG N\xC2NG CAO: Ngo\xE0i ${baseTargetCount} c\xE2u tr\xEAn, H\xC3Y T\u1EA0O TH\xCAM \u0110\xDANG ${safeAdvancedExtra} c\xE2u h\u1ECFi N\xC2NG CAO B\xCAN NGO\xC0I (isExternalAdvanced = true, m\u1EE9c V\u1EADn d\u1EE5ng / V\u1EADn d\u1EE5ng cao) ki\u1EC3m tra t\u01B0 duy s\xE2u h\u01A1n \u1EDF c\xF9ng ch\u1EE7 \u0111\u1EC1 m\xF4n h\u1ECDc.` : "",
      `\u0110\u1ED9 kh\xF3: ${diffLabel}. Ngu\u1ED3n tham chi\u1EBFu: ${textbookTitle || "Ki\u1EBFn th\u1EE9c chu\u1EA9n GDPT 2018"}.`,
      "Y\xCAU C\u1EA6U CH\u1EA4T L\u01AF\u1EE2NG NGHI\xCAM NG\u1EB6T:",
      "- M\u1ED7i c\xE2u CH\u1EC8 C\xD3 DUY NH\u1EA4T 1 \u0111\xE1p \xE1n \u0111\xFAng (A, B, C ho\u1EB7c D).",
      "- \u0110\u1ED9 d\xE0i 4 l\u1EF1a ch\u1ECDn A/B/C/D t\u01B0\u01A1ng \u0111\u1ED3ng h\u1EE3p l\xFD, kh\xF4ng l\u1ED9 \u0111\xE1p \xE1n \u0111\xFAng b\u1EB1ng \u0111\u1ED9 d\xE0i qu\xE1 v\u01B0\u1EE3t tr\u1ED9i.",
      "- Ph\xE2n lo\u1EA1i \u0111\xFAng cognitiveLevel (nhan_biet | thong_hieu | van_dung | van_dung_cao) v\xE0 knowledgeUnitType (concept | mechanism | condition | characteristic | formula | problem_type).",
      "- Vi\u1EBFt th\u1EADt ng\u1EAFn g\u1ECDn: explanation t\u1ED1i \u0111a 2 c\xE2u; m\u1ED7i distractorA/B/C/D t\u1ED1i \u0111a 1 c\xE2u ng\u1EAFn gi\u1EA3i th\xEDch v\xEC sao l\u1EF1a ch\u1ECDn \u0111\xF3 \u0111\xFAng/sai.",
      "",
      "NG\u1EEE C\u1EA2NH KI\u1EBEN TH\u1EE8C:",
      effectiveContext.slice(0, 18e3)
    ].filter(Boolean).join("\n");
    const totalWanted = baseTargetCount + safeAdvancedExtra;
    const quizMaxTokens = Math.min(4096, Math.max(1536, totalWanted * 220));
    const { data: parsed, modelId: modelUsed } = await runTaskWithRouter({
      taskType: "quiz_generation",
      config,
      idToken,
      allowGroqRescue: true,
      cacheInput: {
        subject,
        grade,
        baseTargetCount,
        safeAdvancedExtra,
        difficulty,
        scope,
        chapterFilter: chapterFilter || "",
        ctx: effectiveContext.slice(0, 8e3)
      },
      runWithModel: async (modelId) => generateJsonWithProvider({
        modelId,
        prompt,
        thinkingTier: "low",
        maxOutputTokens: quizMaxTokens,
        tokensOut,
        fallbackJson: '{"questions":[]}',
        groqSchemaHint: '{"questions":[{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","explanation":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","chapter":"...","concept":"...","sourceReference":"..."}]}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionText: { type: Type.STRING },
                  optionA: { type: Type.STRING },
                  optionB: { type: Type.STRING },
                  optionC: { type: Type.STRING },
                  optionD: { type: Type.STRING },
                  correctAnswer: { type: Type.STRING, description: "A | B | C | D" },
                  explanation: { type: Type.STRING },
                  distractorA: { type: Type.STRING },
                  distractorB: { type: Type.STRING },
                  distractorC: { type: Type.STRING },
                  distractorD: { type: Type.STRING },
                  cognitiveLevel: {
                    type: Type.STRING,
                    description: "nhan_biet | thong_hieu | van_dung | van_dung_cao"
                  },
                  knowledgeUnitType: {
                    type: Type.STRING,
                    description: "concept | mechanism | condition | characteristic | formula | problem_type"
                  },
                  chapter: { type: Type.STRING },
                  concept: { type: Type.STRING },
                  sourceReference: { type: Type.STRING },
                  isExternalAdvanced: { type: Type.BOOLEAN }
                },
                required: [
                  "questionText",
                  "optionA",
                  "optionB",
                  "optionC",
                  "optionD",
                  "correctAnswer",
                  "explanation",
                  "cognitiveLevel",
                  "chapter",
                  "concept",
                  "sourceReference"
                ]
              }
            }
          },
          required: ["questions"]
        }
      })
    });
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const mapped = (parsed.questions || []).slice(0, totalWanted + 2).map((q, idx) => {
      const ans = q.correctAnswer === "A" || q.correctAnswer === "B" || q.correctAnswer === "C" || q.correctAnswer === "D" ? q.correctAnswer : "A";
      const fallbackDiff = difficulty === "basic" || difficulty === "advanced" ? difficulty : "medium";
      const cog = normalizeCognitiveLevel(q.cognitiveLevel, fallbackDiff);
      const diff = cog === "nhan_biet" ? "basic" : cog === "thong_hieu" ? "medium" : "advanced";
      const unitTypes = /* @__PURE__ */ new Set([
        "concept",
        "mechanism",
        "condition",
        "characteristic",
        "formula",
        "problem_type"
      ]);
      return {
        questionId: `q_${Date.now()}_${idx + 1}_${crypto6.randomBytes(2).toString("hex")}`,
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
        sourceType: q.isExternalAdvanced ? "external_extension" : "textbook_reference",
        modelId: modelUsed,
        isExternalAdvanced: Boolean(q.isExternalAdvanced),
        createdAt: now
      };
    });
    const validation = validateQuizQuestionSet(mapped);
    return {
      questions: validation.questions.slice(0, totalWanted),
      supplementedFromTextbook: needsTextbookSupplement,
      supplementNotice: needsTextbookSupplement ? `N\u1ED9i dung t\u1EA3i l\xEAn ch\u1EC9 t\u1EA1o \u0111\u01B0\u1EE3c \xEDt h\u01A1n 5 c\xE2u h\u1ECFi kh\xE1c nhau (${distinctUploadConcepts.size} \xFD). H\u1EC7 th\u1ED1ng \u0111\xE3 t\u1EF1 \u0111\u1ED9ng b\u1ED5 sung th\xEAm t\u1EEB ki\u1EBFn th\u1EE9c s\xE1ch gi\xE1o khoa / tham chi\u1EBFu chu\u1EA9n \u0111\u1EC3 \u0111\u1EE7 ${Math.min(validation.questions.length, baseTargetCount)} c\xE2u.` : void 0,
      modelUsed
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
        groqSchemaHint: '{"title":"...","rows":[{"chapter":"...","topic":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","questionType":"abcd|true_false|short_answer","questionCount":2,"scorePerQuestion":0.25,"learningOutcome":"..."}]}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            rows: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  chapter: { type: Type.STRING },
                  topic: { type: Type.STRING },
                  cognitiveLevel: {
                    type: Type.STRING,
                    description: "nhan_biet | thong_hieu | van_dung | van_dung_cao"
                  },
                  questionType: {
                    type: Type.STRING,
                    description: "abcd | true_false | short_answer"
                  },
                  questionCount: { type: Type.INTEGER },
                  scorePerQuestion: { type: Type.NUMBER },
                  learningOutcome: { type: Type.STRING }
                },
                required: [
                  "chapter",
                  "topic",
                  "cognitiveLevel",
                  "questionType",
                  "questionCount",
                  "scorePerQuestion",
                  "learningOutcome"
                ]
              }
            }
          },
          required: ["title", "rows"]
        }
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
        groqSchemaHint: '{"questions":[{"chapterId":"...","conceptId":"...","cognitiveLevel":"nhan_biet|thong_hieu|van_dung|van_dung_cao","questionType":"abcd|true_false|short_answer","scoreWeight":0.25,"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","trueFalseStatements":[{"label":"a","text":"...","isTrue":true}],"shortAnswerAccepted":["..."],"explanation":"...","sourceReference":"..."}]}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  chapterId: { type: Type.STRING },
                  conceptId: { type: Type.STRING },
                  cognitiveLevel: { type: Type.STRING },
                  questionType: { type: Type.STRING },
                  scoreWeight: { type: Type.NUMBER },
                  questionText: { type: Type.STRING },
                  optionA: { type: Type.STRING },
                  optionB: { type: Type.STRING },
                  optionC: { type: Type.STRING },
                  optionD: { type: Type.STRING },
                  correctAnswer: { type: Type.STRING },
                  trueFalseStatements: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        label: { type: Type.STRING },
                        text: { type: Type.STRING },
                        isTrue: { type: Type.BOOLEAN }
                      },
                      required: ["label", "text", "isTrue"]
                    }
                  },
                  shortAnswerAccepted: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  explanation: { type: Type.STRING },
                  sourceReference: { type: Type.STRING }
                },
                required: [
                  "chapterId",
                  "conceptId",
                  "cognitiveLevel",
                  "questionType",
                  "scoreWeight",
                  "questionText",
                  "explanation",
                  "sourceReference"
                ]
              }
            }
          },
          required: ["questions"]
        }
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
        groqSchemaHint: '{"questionText":"...","optionA":"...","optionB":"...","optionC":"...","optionD":"...","correctAnswer":"A|B|C|D","shortAnswerAccepted":["..."],"explanation":"...","sourceReference":"..."}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            questionText: { type: Type.STRING },
            optionA: { type: Type.STRING },
            optionB: { type: Type.STRING },
            optionC: { type: Type.STRING },
            optionD: { type: Type.STRING },
            correctAnswer: { type: Type.STRING },
            shortAnswerAccepted: { type: Type.ARRAY, items: { type: Type.STRING } },
            explanation: { type: Type.STRING },
            sourceReference: { type: Type.STRING }
          },
          required: ["questionText", "explanation"]
        }
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
    const ai = await createServerAiClient();
    const { data: parsed } = await runTaskWithRouter({
      taskType: "curriculum_extraction",
      config,
      idToken,
      bypassCache: true,
      runWithModel: async (modelId) => {
        const safeModel = isGroqModelId(modelId) || isCloudflareModelId(modelId) ? "gemini-4-hydrogen" : modelId;
        const contents = inlineParts.length > 0 ? { parts: [...inlineParts, { text: promptText }] } : promptText;
        const resp = await callWithTimeout(
          (signal) => ai.models.generateContent({
            model: safeModel,
            contents,
            config: {
              thinkingConfig: thinkingConfigForModel(safeModel, "minimal"),
              maxOutputTokens: 6144,
              abortSignal: signal,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  detectedTitle: { type: Type.STRING },
                  questions: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        questionType: {
                          type: Type.STRING,
                          description: includeTrueFalse ? "abcd | short_answer | true_false" : "abcd | short_answer"
                        },
                        questionText: { type: Type.STRING },
                        optionA: { type: Type.STRING },
                        optionB: { type: Type.STRING },
                        optionC: { type: Type.STRING },
                        optionD: { type: Type.STRING },
                        correctAnswer: { type: Type.STRING, description: "A | B | C | D" },
                        ...includeTrueFalse ? {
                          trueFalseStatements: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                label: { type: Type.STRING },
                                text: { type: Type.STRING },
                                isTrue: { type: Type.BOOLEAN }
                              },
                              required: ["label", "text", "isTrue"]
                            }
                          }
                        } : {},
                        shortAnswerAccepted: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING }
                        },
                        scoreWeight: { type: Type.NUMBER },
                        answerFromSource: { type: Type.BOOLEAN },
                        explanation: { type: Type.STRING },
                        chapter: { type: Type.STRING },
                        cognitiveLevel: {
                          type: Type.STRING,
                          description: "nhan_biet | thong_hieu | van_dung | van_dung_cao"
                        }
                      },
                      required: ["questionType", "questionText"]
                    }
                  }
                },
                required: ["questions"]
              }
            }
          })
        );
        accumulateTokens(tokensOut, resp);
        return JSON.parse((resp.text || '{"questions":[]}').trim());
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
        groqSchemaHint: '{"cards":[{"front":"...","back":"...","chapter":"...","concept":"...","cardType":"concept|formula|condition|mistake_fix|example","sourceReference":"..."}]}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            cards: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  front: { type: Type.STRING },
                  back: { type: Type.STRING },
                  chapter: { type: Type.STRING },
                  concept: { type: Type.STRING },
                  cardType: {
                    type: Type.STRING,
                    description: "concept | formula | condition | mistake_fix | example"
                  },
                  sourceReference: { type: Type.STRING }
                },
                required: ["front", "back", "chapter", "concept", "cardType"]
              }
            }
          },
          required: ["cards"]
        }
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
    let webTocContext = "";
    if (!customTocHint || customTocHint.trim().length < 20) {
      try {
        const ai = await createServerAiClient();
        const searchQuery = `M\u1EE5c l\u1EE5c c\xE1c ch\u01B0\u01A1ng v\xE0 b\xE0i h\u1ECDc s\xE1ch gi\xE1o khoa ${subjectName} l\u1EDBp ${grade} b\u1ED9 s\xE1ch ${textbookSeries} ch\u01B0\u01A1ng tr\xECnh GDPT 2018`;
        const searchResp = await callWithTimeout(
          (signal) => ai.models.generateContent({
            model: "gemini-3.1-flash-lite",
            contents: searchQuery,
            config: {
              thinkingConfig: thinkingConfigForModel("gemini-3.1-flash-lite", "minimal"),
              maxOutputTokens: 1024,
              abortSignal: signal,
              tools: [{ googleSearch: {} }]
            }
          }),
          16e3
        );
        accumulateTokens(tokensOut, searchResp);
        webTocContext = (searchResp.text || "").trim().slice(0, 4e3);
      } catch {
      }
    }
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
        groqSchemaHint: '{"bookTitle":"...","chapters":[{"chapterIndex":1,"chapterTitle":"Ch\u01B0\u01A1ng 1: ...","lessons":["B\xE0i 1: ...","B\xE0i 2: ..."],"estimatedPageStart":6}]}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            bookTitle: { type: Type.STRING },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  chapterIndex: { type: Type.INTEGER },
                  chapterTitle: { type: Type.STRING },
                  lessons: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  estimatedPageStart: { type: Type.INTEGER }
                },
                required: ["chapterIndex", "chapterTitle", "lessons", "estimatedPageStart"]
              }
            }
          },
          required: ["bookTitle", "chapters"]
        }
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
        groqSchemaHint: '{"chunks":[{"lesson":"B\xE0i 1: ...","pageNumber":10,"sectionTitle":"1. Kh\xE1i ni\u1EC7m & C\xF4ng th\u1EE9c","content":"...","keywords":["..."],"learningObjectives":["..."],"conceptTags":["..."]}]}',
        geminiSchema: {
          type: Type.OBJECT,
          properties: {
            chunks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  lesson: { type: Type.STRING },
                  pageNumber: { type: Type.INTEGER },
                  sectionTitle: { type: Type.STRING },
                  content: { type: Type.STRING },
                  keywords: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  learningObjectives: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  conceptTags: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  }
                },
                required: ["lesson", "pageNumber", "sectionTitle", "content", "keywords", "learningObjectives"]
              }
            }
          },
          required: ["chunks"]
        }
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
  return clean.every(
    (name) => /^(img|dsc|screenshot|image|photo|page|trang|scan|cam|whatsapp|viber|zalo|pxl|mvimg|z\d+)[\s_\-\d().a-f]*(\.[a-z0-9]+)?$/i.test(
      name
    ) || /^[\d_\-\s().]+(\.[a-z0-9]+)?$/i.test(name)
  );
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

// src/server/app.ts
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
    await hydrateSingleKeyForSuperAdmin(authUser.idToken);
    req.authUser = authUser;
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    res.status(401).json({
      code: "UNAUTHORIZED",
      error: "Phi\xEAn \u0111\u0103ng nh\u1EADp kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c \u0111\xE3 h\u1EBFt h\u1EA1n. Vui l\xF2ng \u0111\u0103ng nh\u1EADp l\u1EA1i.",
      detail: msg
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
function mapGeminiErrorResponse(err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("v\u01B0\u1EE3t qu\xE1 th\u1EDDi gian ch\u1EDD") || msg.includes("AbortError") || msg.includes("timed out")) {
    return {
      status: 504,
      code: "AI_TIMEOUT",
      error: "AI ph\u1EA3n h\u1ED3i qu\xE1 45 gi\xE2y n\xEAn h\u1EC7 th\u1ED1ng \u0111\xE3 t\u1EF1 \u0111\u1ED9ng ng\u1EAFt \u0111\u1EC3 b\u1EA3o v\u1EC7 k\u1EBFt n\u1ED1i. Vui l\xF2ng th\u1EED l\u1EA1i."
    };
  }
  if (msg.includes("GEMINI_API_KEY_UNCONFIGURED")) {
    return {
      status: 503,
      code: "GEMINI_KEY_MISSING",
      error: "H\u1EC7 th\u1ED1ng ch\u01B0a c\xF3 Gemini API key. Qu\u1EA3n tr\u1ECB vi\xEAn vui l\xF2ng v\xE0o Qu\u1EA3n tr\u1ECB h\u1EC7 th\u1ED1ng \u2192 API Key duy nh\u1EA5t \u0111\u1EC3 th\xEAm key."
    };
  }
  if (msg.includes("RESOURCE_EXHAUSTED") || msg.includes("429")) {
    return {
      status: 429,
      code: "PROVIDER_QUOTA_EXCEEDED",
      error: "D\u1ECBch v\u1EE5 AI t\u1EA1m th\u1EDDi \u0111\u1EA1t gi\u1EDBi h\u1EA1n l\u01B0u l\u01B0\u1EE3ng (429). Vui l\xF2ng th\u1EED l\u1EA1i sau \xEDt ph\xFAt."
    };
  }
  if (msg.includes("API_KEY_INVALID") || msg.includes("PERMISSION_DENIED") || msg.includes("403")) {
    return {
      status: 502,
      code: "PROVIDER_AUTH_ERROR",
      error: "Kh\xF3a API AI hi\u1EC7n t\u1EA1i kh\xF4ng h\u1EE3p l\u1EC7 ho\u1EB7c kh\xF4ng c\xF3 quy\u1EC1n truy c\u1EADp model."
    };
  }
  if (msg.includes("NOT_FOUND") || msg.includes("404")) {
    return {
      status: 502,
      code: "MODEL_UNAVAILABLE",
      error: "Model AI \u0111\u01B0\u1EE3c c\u1EA5u h\xECnh hi\u1EC7n kh\xF4ng kh\u1EA3 d\u1EE5ng."
    };
  }
  return {
    status: 500,
    code: "AI_PROCESSING_ERROR",
    error: `Kh\xF4ng th\u1EC3 ho\xE0n t\u1EA5t x\u1EED l\xFD t\xE0i li\u1EC7u: ${msg.slice(0, 180)}`
  };
}
function createApiApp() {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  const envAllowedOrigins = (process.env.ALLOWED_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(async (req, res, next) => {
    try {
      const origin = req.headers.origin;
      const cfg = await loadAuthoritativeAiConfig();
      const combined = Array.from(
        new Set([...envAllowedOrigins, ...cfg.allowedOrigins || []].map((o) => o.trim()).filter(Boolean))
      );
      if (origin && (combined.length === 0 || combined.includes("*") || combined.includes(origin))) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
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
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      if (!cfg.enabled) {
        res.json({
          suggestedGrade: heuristic.grade || fallbackGrade,
          suggestedSubject: heuristic.subject || "auto",
          source: "heuristic"
        });
        return;
      }
      const aiScope = await SubjectDetectionService.detectScope(
        `T\xEAn t\u1EC7p t\xE0i li\u1EC7u h\u1ECDc t\u1EADp THPT: ${meaningfulText}`,
        tokens,
        { config: cfg, idToken: user.idToken }
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
      const uploadedFiles = req.files || [];
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
      const scopeSuggestion = !skipScope && combinedForScope.trim().length > 15 ? await SubjectDetectionService.detectScope(combinedForScope, tokens, {
        config: guard.config,
        idToken: user.idToken
      }) : {
        suggestedGrade: presetGrade,
        suggestedSubject: presetSubject,
        suggestedChapters: [],
        suggestedTitle: first.originalname.replace(/\.[^.]+$/, "")
      };
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
      const mapped = mapGeminiErrorResponse(err);
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
      enableWebGrounding
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
      const mapped = mapGeminiErrorResponse(err);
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
      const mapped = mapGeminiErrorResponse(err);
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
      const mapped = mapGeminiErrorResponse(err);
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
    const { targetType, category, note } = req.body;
    const tokens = { promptTokens: 0, candidateTokens: 0, totalTokens: 0 };
    try {
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const classification = await FeedbackAnalysisService.classifyFeedback({
        targetType: targetType || "claim",
        category: category || "",
        note: note || "",
        tokensOut: tokens,
        config: cfg,
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
      const [config, usageStats, auditLogs, singleKeyStatus, providerKeys] = await Promise.all([
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
        getSingleKeyStatus(user.idToken).catch(() => ({
          configured: false,
          source: "none",
          maskedKey: "",
          label: "",
          hasEnvFallbackKey: false,
          lastTestStatus: "Untested"
        })),
        getProviderKeysStatus(user.idToken).catch(() => ({
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
        singleKeyStatus,
        providerKeys,
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
        taskModels
      } = req.body || {};
      const updated = await updateAuthoritativeAiConfig(
        {
          ...typeof enabled === "boolean" ? { enabled } : {},
          ...typeof disabledReason === "string" ? { disabledReason: disabledReason.slice(0, 300) } : {},
          ...typeof maintenanceMessage === "string" ? { maintenanceMessage: maintenanceMessage.slice(0, 400) } : {},
          ...rateLimitConfig ? { rateLimitConfig } : {},
          ...typeof activeModel === "string" ? { activeModel } : {},
          ...Array.isArray(allowedOrigins) ? { allowedOrigins } : {},
          ...taskModels && typeof taskModels === "object" ? { taskModels } : {}
        },
        user.uid,
        user.email,
        user.idToken
      );
      res.json({ config: updated });
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
      const targetModel = (modelId || "gemini-4-hydrogen").trim();
      const result = await testModelConnectivity(targetModel);
      res.json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        modelId: String(req.body?.modelId || "gemini-4-hydrogen"),
        latencyMs: 0,
        message: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 ki\u1EC3m tra k\u1EBFt n\u1ED1i model."
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
    if (!targetUid) {
      res.status(400).json({ error: "Thi\u1EBFu UID c\u1EA7n thu h\u1ED3i." });
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
      const singleKeyStatus = await getSingleKeyStatus(user.idToken);
      res.json({ singleKeyStatus });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng ki\u1EC3m tra \u0111\u01B0\u1EE3c tr\u1EA1ng th\xE1i API key." });
    }
  });
  app.post("/api/admin/key", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey, label } = req.body || {};
      if (!apiKey || typeof apiKey !== "string") {
        res.status(400).json({ error: "Vui l\xF2ng nh\u1EADp Gemini API key." });
        return;
      }
      const result = await setSingleGeminiApiKey({
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
      res.json({ singleKeyStatus: result.status });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 l\u01B0u Gemini API key." });
    }
  });
  app.post("/api/admin/key/test", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const { apiKey } = req.body || {};
      const cfg = await loadAuthoritativeAiConfig(user.idToken);
      const result = await testSingleGeminiKey({
        rawKeyOverride: apiKey,
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken,
        activeModel: cfg.activeModel
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({
        status: "Temporary provider error",
        message: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 ki\u1EC3m tra Gemini API key.",
        testedSource: "none",
        testedAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  });
  app.delete("/api/admin/key", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const result = await clearSingleGeminiApiKey({
        actorUid: user.uid,
        actorEmail: user.email,
        idToken: user.idToken
      });
      res.json({ singleKeyStatus: result.status });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Kh\xF4ng th\u1EC3 x\xF3a Gemini API key." });
    }
  });
  app.get("/api/admin/provider-keys", requireSuperAdmin, async (req, res) => {
    const user = req.authUser;
    try {
      const providerKeys = await getProviderKeysStatus(user.idToken);
      res.json({
        providerKeys,
        groqConfigured: isGroqConfigured(),
        cloudflareConfigured: isCloudflareConfigured()
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : "Kh\xF4ng t\u1EA3i \u0111\u01B0\u1EE3c tr\u1EA1ng th\xE1i API key d\u1EF1 ph\xF2ng."
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
      const cfg = await loadAuthoritativeAiConfig();
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
        isError: false,
        promptTokens: tokensOut.promptTokens,
        candidateTokens: tokensOut.candidateTokens,
        totalTokens: tokensOut.totalTokens
      });
      void persistUsageSnapshot(user.idToken);
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
      const cfg = await loadAuthoritativeAiConfig();
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
        isError: false,
        promptTokens: tokensOut.promptTokens,
        candidateTokens: tokensOut.candidateTokens,
        totalTokens: tokensOut.totalTokens
      });
      void persistUsageSnapshot(user.idToken);
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
        const cfg = await loadAuthoritativeAiConfig();
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
          isError: false,
          promptTokens: tokensOut.promptTokens,
          candidateTokens: tokensOut.candidateTokens,
          totalTokens: tokensOut.totalTokens
        });
        void persistUsageSnapshot(user.idToken);
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
    const uploadedFiles = req.files || [];
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
      error: err instanceof Error ? err.message : "L\u1ED7i m\xE1y ch\u1EE7 n\u1ED9i b\u1ED9."
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
    const detail = initError instanceof Error ? initError.message : String(initError || "Unknown server initialization error");
    res.end(
      JSON.stringify({
        code: "API_INIT_FAILED",
        error: `M\xE1y ch\u1EE7 API ch\u01B0a th\u1EC3 kh\u1EDFi t\u1EA1o: ${detail}`
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
          error: err instanceof Error ? err.message : "L\u1ED7i th\u1EF1c thi m\xE1y ch\u1EE7 API."
        })
      );
    }
  }
}
export {
  handler as default
};
