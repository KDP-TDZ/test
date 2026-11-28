export type MathNode =
  | { type: 'text'; value: string }
  | { type: 'sub'; children: MathNode[] }
  | { type: 'sup'; children: MathNode[] }
  | { type: 'frac'; num: MathNode[]; den: MathNode[] }
  | { type: 'sqrt'; index?: MathNode[]; content: MathNode[] }
  | { type: 'vec'; content: MathNode[] }
  | { type: 'overline'; content: MathNode[] };

const LATEX_SYMBOLS: Record<string, string> = {
  // Greek lowercase
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  varepsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  vartheta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  pi: 'π',
  varpi: 'π',
  rho: 'ρ',
  varrho: 'ρ',
  sigma: 'σ',
  varsigma: 'ς',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  varphi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  // Greek uppercase
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Xi: 'Ξ',
  Pi: 'Π',
  Sigma: 'Σ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Psi: 'Ψ',
  Omega: 'Ω',
  // Operators & relations
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  approx: '≈',
  neq: '≠',
  ne: '≠',
  leq: '≤',
  le: '≤',
  geq: '≥',
  ge: '≥',
  equiv: '≡',
  propto: '∝',
  sim: '∼',
  simeq: '≃',
  cong: '≅',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  sum: '∑',
  prod: '∏',
  int: '∫',
  oint: '∮',
  // Arrows
  rightarrow: '→',
  to: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
  Rightarrow: '⇒',
  Leftarrow: '⇐',
  Leftrightarrow: '⇔',
  implies: '⇒',
  iff: '⇔',
  rightleftharpoons: '⇌',
  uparrow: '↑',
  downarrow: '↓',
  // Geometry & sets & misc
  circ: '°',
  degree: '°',
  angle: '∠',
  perp: '⊥',
  parallel: '∥',
  triangle: '△',
  in: '∈',
  notin: '∉',
  subset: '⊂',
  subseteq: '⊆',
  supset: '⊃',
  supseteq: '⊇',
  cup: '∪',
  cap: '∩',
  forall: '∀',
  exists: '∃',
  emptyset: '∅',
  varnothing: '∅',
  cdots: '⋯',
  ldots: '…',
  dots: '…',
  prime: '′',
  ohm: 'Ω',
  // Spacing commands
  quad: ' ',
  qquad: ' ',
  enspace: ' ',
  thinspace: ' ',
};

const TEXT_WRAPPER_COMMANDS = new Set([
  'text',
  'textrm',
  'textbf',
  'textit',
  'mathrm',
  'mathbf',
  'mathit',
  'mathsf',
  'mathtt',
  'operatorname',
  'boldsymbol',
  'bm',
  'rm',
]);

const KNOWN_TWO_LETTER_ELEMENTS = new Set([
  'He', 'Li', 'Be', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'Cl', 'Ar',
  'Ca', 'Sc', 'Ti', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Ag', 'Cd',
  'Sn', 'Sb', 'Te', 'Xe', 'Cs', 'Ba', 'Pt', 'Au', 'Hg', 'Pb', 'Ra',
]);

const URL_PATTERN = /https?:\/\/[^\s)]+/g;

function pushText(nodes: MathNode[], value: string): void {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last && last.type === 'text') {
    last.value += value;
  } else {
    nodes.push({ type: 'text', value });
  }
}

function readBalancedGroup(
  src: string,
  openIndex: number,
  openChar: '{' | '[' = '{',
  closeChar: '}' | ']' = '}'
): { content: string; nextIndex: number } | null {
  if (src[openIndex] !== openChar) return null;
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length) {
      i += 1;
      continue;
    }
    if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return {
          content: src.slice(openIndex + 1, i),
          nextIndex: i + 1,
        };
      }
    }
  }
  return null;
}

function skipInlineSpaces(src: string, idx: number): number {
  let i = idx;
  while (i < src.length && src[i] === ' ') i += 1;
  return i;
}

/**
 * Checks if an unbraced `_` at `underscoreIdx` is a genuine math/chemistry subscript
 * (e.g. `v_0`, `F_1`, `H_2O`, `CO_2`, `a_x`, `F_A`) rather than a snake_case identifier (`user_id`).
 */
function canParseUnbracedSubscript(
  src: string,
  underscoreIdx: number,
  inMathMode: boolean
): { token: string; nextIndex: number } | null {
  const prevIdx = underscoreIdx - 1;
  if (prevIdx < 0) return null;
  const prevChar = src[prevIdx];
  const nextIdx = underscoreIdx + 1;
  if (nextIdx >= src.length) return null;

  const isPrevValidBase =
    /[a-zA-Z0-9)\]]/.test(prevChar) ||
    /[\u0370-\u03FF]/.test(prevChar); // Greek letters
  if (!isPrevValidBase) return null;

  if (!inMathMode) {
    // Reject snake_case identifiers like `user_id` or `file_name`
    const prevPrevChar = prevIdx - 1 >= 0 ? src[prevIdx - 1] : '';
    if (/[a-z]/.test(prevChar) && /[a-z0-9_]/.test(prevPrevChar)) {
      return null;
    }
    if (/[a-z]/.test(prevChar) && /[A-Z]/.test(prevPrevChar)) {
      const twoChar = src.slice(prevIdx - 1, prevIdx + 1);
      if (!KNOWN_TWO_LETTER_ELEMENTS.has(twoChar)) {
        return null;
      }
    }
  }

  // Case 1: digits (e.g., H_2O, CO_2, v_0, F_12)
  const digitMatch = /^\d+/.exec(src.slice(nextIdx));
  if (digitMatch) {
    return { token: digitMatch[0], nextIndex: nextIdx + digitMatch[0].length };
  }

  // Case 2: single letter/axis/label not followed by another lowercase letter (e.g., a_x, v_y, F_A, a_n)
  const singleLetterMatch = /^[a-zA-Z]/.exec(src.slice(nextIdx));
  if (singleLetterMatch) {
    const afterChar = src[nextIdx + 1] || '';
    if (!inMathMode && /[a-z0-9_]/.test(afterChar)) {
      // Avoid turning `F_max`? Wait: `x_0`, `a_x`, `F_A` pass; `A_bcd` is snake_case unless braced.
      return null;
    }
    return { token: singleLetterMatch[0], nextIndex: nextIdx + 1 };
  }

  return null;
}

/**
 * Checks if an unbraced `^` at `caretIdx` is a genuine superscript (`m/s^2`, `x^2`, `10^-5`, `H^+`, `90^\circ`).
 */
function canParseUnbracedSuperscript(
  src: string,
  caretIdx: number
): { token: string; isDegree?: boolean; nextIndex: number } | null {
  const nextIdx = caretIdx + 1;
  if (nextIdx >= src.length) return null;

  // `^\circ` or `^\degree`
  if (src.startsWith('\\circ', nextIdx) && !/[a-zA-Z]/.test(src[nextIdx + 5] || '')) {
    return { token: '°', isDegree: true, nextIndex: nextIdx + 5 };
  }
  if (src.startsWith('\\degree', nextIdx) && !/[a-zA-Z]/.test(src[nextIdx + 7] || '')) {
    return { token: '°', isDegree: true, nextIndex: nextIdx + 7 };
  }

  // Signed exponent or ion charge: `10^-5`, `Fe^3+`, `SO_4^2-`, `H^+`, `Cl^-`, `x^2`, `a^n`
  const signedDigits = /^[+-]?\d+[+-]?/.exec(src.slice(nextIdx));
  if (signedDigits) {
    return { token: signedDigits[0], nextIndex: nextIdx + signedDigits[0].length };
  }

  const singleChargeOrVar = /^[a-zA-Z+-]/.exec(src.slice(nextIdx));
  if (singleChargeOrVar) {
    const afterChar = src[nextIdx + 1] || '';
    if (/[a-zA-Z]/.test(singleChargeOrVar[0]) && /[a-zA-Z]/.test(afterChar)) {
      return null;
    }
    return { token: singleChargeOrVar[0], nextIndex: nextIdx + 1 };
  }

  return null;
}

function findMatchingDollar(src: string, startIdx: number, doubleDollar: boolean): number {
  const delim = doubleDollar ? '$$' : '$';
  const step = doubleDollar ? 2 : 1;
  const openAfter = startIdx + step;
  if (openAfter >= src.length) return -1;
  // Single `$` followed by space is currency/prose, not math
  if (!doubleDollar && src[openAfter] === ' ') return -1;

  for (let i = openAfter; i < src.length; i++) {
    if (src[i] === '\\' && i + 1 < src.length) {
      i += 1;
      continue;
    }
    if (!doubleDollar && src[i] === '\n') return -1;
    if (src.startsWith(delim, i)) {
      if (!doubleDollar && i > openAfter && src[i - 1] === ' ') {
        continue;
      }
      // Don't treat `$5 và $10` as a math span
      if (!doubleDollar) {
        const inner = src.slice(openAfter, i);
        if (/^\d[\d.,]*\s+/.test(inner)) return -1;
      }
      return i;
    }
  }
  return -1;
}

function parseMathSegment(src: string, inMathMode: boolean): MathNode[] {
  const nodes: MathNode[] = [];
  let i = 0;

  while (i < src.length) {
    // 1. Inline / display math delimiters: $$...$$, $...$, \(...\), \[...\]
    if (!inMathMode && src[i] === '$') {
      const isDouble = src[i + 1] === '$';
      const closeIdx = findMatchingDollar(src, i, isDouble);
      if (closeIdx > i) {
        const step = isDouble ? 2 : 1;
        const inner = src.slice(i + step, closeIdx).trim();
        const innerNodes = parseMathSegment(inner, true);
        for (const n of innerNodes) {
          if (n.type === 'text') pushText(nodes, n.value);
          else nodes.push(n);
        }
        i = closeIdx + step;
        continue;
      }
    }

    if (!inMathMode && (src.startsWith('\\(', i) || src.startsWith('\\[', i))) {
      const closeDelim = src[i + 1] === '(' ? '\\)' : '\\]';
      const closeIdx = src.indexOf(closeDelim, i + 2);
      if (closeIdx > i + 1) {
        const inner = src.slice(i + 2, closeIdx).trim();
        const innerNodes = parseMathSegment(inner, true);
        for (const n of innerNodes) {
          if (n.type === 'text') pushText(nodes, n.value);
          else nodes.push(n);
        }
        i = closeIdx + 2;
        continue;
      }
    }

    // 2. Backslash LaTeX commands
    if (src[i] === '\\' && i + 1 < src.length) {
      const nextCh = src[i + 1];

      // Escaped single-char LaTeX symbols: \, \; \: \! \% \_ \{ \} \|
      if (nextCh === ',' || nextCh === ';' || nextCh === ':') {
        pushText(nodes, ' ');
        i += 2;
        continue;
      }
      if (nextCh === '!') {
        i += 2;
        continue;
      }
      if (nextCh === '%' || nextCh === '_' || nextCh === '{' || nextCh === '}' || nextCh === '|') {
        pushText(nodes, nextCh);
        i += 2;
        continue;
      }

      const cmdMatch = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (cmdMatch) {
        const cmd = cmdMatch[1];
        const afterCmd = i + 1 + cmd.length;

        // \left and \right sizing prefixes
        if (cmd === 'left' || cmd === 'right') {
          const delimIdx = skipInlineSpaces(src, afterCmd);
          const delimCh = src[delimIdx];
          if (delimCh === '.') {
            i = delimIdx + 1;
            continue;
          }
          if (delimCh === '\\' && (src[delimIdx + 1] === '{' || src[delimIdx + 1] === '}' || src[delimIdx + 1] === '|')) {
            pushText(nodes, src[delimIdx + 1]);
            i = delimIdx + 2;
            continue;
          }
          if (delimCh && /[|()[\]{}]/.test(delimCh)) {
            pushText(nodes, delimCh);
            i = delimIdx + 1;
            continue;
          }
          i = afterCmd;
          continue;
        }

        // \frac{num}{den}, \dfrac{num}{den}, \tfrac{num}{den}
        if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
          const numStart = skipInlineSpaces(src, afterCmd);
          const numGroup = readBalancedGroup(src, numStart, '{', '}');
          if (numGroup) {
            const denStart = skipInlineSpaces(src, numGroup.nextIndex);
            const denGroup = readBalancedGroup(src, denStart, '{', '}');
            if (denGroup) {
              nodes.push({
                type: 'frac',
                num: parseMathSegment(numGroup.content, true),
                den: parseMathSegment(denGroup.content, true),
              });
              i = denGroup.nextIndex;
              continue;
            }
          }
        }

        // \sqrt[n]{x} or \sqrt{x}
        if (cmd === 'sqrt') {
          let cursor = skipInlineSpaces(src, afterCmd);
          let indexNodes: MathNode[] | undefined;
          if (src[cursor] === '[') {
            const optGroup = readBalancedGroup(src, cursor, '[', ']');
            if (optGroup) {
              indexNodes = parseMathSegment(optGroup.content, true);
              cursor = skipInlineSpaces(src, optGroup.nextIndex);
            }
          }
          const bodyGroup = readBalancedGroup(src, cursor, '{', '}');
          if (bodyGroup) {
            nodes.push({
              type: 'sqrt',
              index: indexNodes,
              content: parseMathSegment(bodyGroup.content, true),
            });
            i = bodyGroup.nextIndex;
            continue;
          }
        }

        // \vec{F} or \overrightarrow{AB}
        if (cmd === 'vec' || cmd === 'overrightarrow') {
          const groupStart = skipInlineSpaces(src, afterCmd);
          const group = readBalancedGroup(src, groupStart, '{', '}');
          if (group) {
            nodes.push({
              type: 'vec',
              content: parseMathSegment(group.content, true),
            });
            i = group.nextIndex;
            continue;
          }
        }

        // \overline{v} or \bar{v}
        if (cmd === 'overline' || cmd === 'bar') {
          const groupStart = skipInlineSpaces(src, afterCmd);
          const group = readBalancedGroup(src, groupStart, '{', '}');
          if (group) {
            nodes.push({
              type: 'overline',
              content: parseMathSegment(group.content, true),
            });
            i = group.nextIndex;
            continue;
          }
        }

        // Text/font wrappers: \text{...}, \mathrm{...}, etc.
        if (TEXT_WRAPPER_COMMANDS.has(cmd)) {
          const groupStart = skipInlineSpaces(src, afterCmd);
          const group = readBalancedGroup(src, groupStart, '{', '}');
          if (group) {
            const innerNodes = parseMathSegment(group.content, false);
            for (const n of innerNodes) {
              if (n.type === 'text') pushText(nodes, n.value);
              else nodes.push(n);
            }
            i = group.nextIndex;
            continue;
          }
        }

        // Known symbol lookup
        if (Object.prototype.hasOwnProperty.call(LATEX_SYMBOLS, cmd)) {
          const sym = LATEX_SYMBOLS[cmd];
          pushText(nodes, sym);
          // In TeX, a single space after a letter/Greek command (e.g. `\Delta x`, `\omega t`)
          // terminates the command name rather than inserting a visible gap before a math variable.
          const isGreekOrLetterSym = /^[\u0370-\u03FF\u2100-\u214F]$/.test(sym);
          if (
            isGreekOrLetterSym &&
            src[afterCmd] === ' ' &&
            (src[afterCmd + 1] === '\\' ||
              (/[a-zA-Z]/.test(src[afterCmd + 1] || '') &&
                !/[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/.test(src[afterCmd + 2] || '')))
          ) {
            i = afterCmd + 1;
          } else {
            i = afterCmd;
          }
          continue;
        }
      }
    }

    // 3. Subscripts: _{...} or unbraced _x
    if (src[i] === '_') {
      if (src[i + 1] === '{') {
        const group = readBalancedGroup(src, i + 1, '{', '}');
        if (group && group.content.length > 0) {
          nodes.push({
            type: 'sub',
            children: parseMathSegment(group.content, true),
          });
          i = group.nextIndex;
          continue;
        }
      } else {
        const unbraced = canParseUnbracedSubscript(src, i, inMathMode);
        if (unbraced) {
          nodes.push({
            type: 'sub',
            children: [{ type: 'text', value: unbraced.token }],
          });
          i = unbraced.nextIndex;
          continue;
        }
      }
    }

    // 4. Superscripts: ^{...} or unbraced ^2 / ^+ / ^\circ
    if (src[i] === '^') {
      if (src[i + 1] === '{') {
        const group = readBalancedGroup(src, i + 1, '{', '}');
        if (group && group.content.length > 0) {
          const trimmed = group.content.trim();
          if (trimmed === '\\circ' || trimmed === '\\degree' || trimmed === '°') {
            pushText(nodes, '°');
          } else {
            nodes.push({
              type: 'sup',
              children: parseMathSegment(group.content, true),
            });
          }
          i = group.nextIndex;
          continue;
        }
      } else {
        const unbraced = canParseUnbracedSuperscript(src, i);
        if (unbraced) {
          if (unbraced.isDegree) {
            pushText(nodes, '°');
          } else {
            nodes.push({
              type: 'sup',
              children: [{ type: 'text', value: unbraced.token }],
            });
          }
          i = unbraced.nextIndex;
          continue;
        }
      }
    }

    // Default literal char
    pushText(nodes, src[i]);
    i += 1;
  }

  return nodes;
}

/**
 * Parses Vietnamese academic text containing inline math/physics/chemistry notation
 * (LaTeX commands, `F_{AB}`, `v_0`, `m/s^2`, `\vec{F}`, `\frac{a}{b}`, `$...$`) into
 * safe structured AST nodes while leaving URLs and snake_case identifiers untouched.
 */
export function parseMathNotation(text: string): MathNode[] {
  if (!text) return [];

  // Quick check: if text has none of the notation triggers, return a single text node
  if (!/[\\_^$]/.test(text)) {
    return [{ type: 'text', value: text }];
  }

  // Split around URLs so underscores inside URLs are never altered
  const nodes: MathNode[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_PATTERN.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) {
      for (const n of parseMathSegment(before, false)) {
        if (n.type === 'text') pushText(nodes, n.value);
        else nodes.push(n);
      }
    }
    pushText(nodes, match[0]);
    lastIndex = match.index + match[0].length;
  }

  const tail = text.slice(lastIndex);
  if (tail) {
    for (const n of parseMathSegment(tail, false)) {
      if (n.type === 'text') pushText(nodes, n.value);
      else nodes.push(n);
    }
  }

  return nodes;
}

const UNICODE_SUBSCRIPT_MAP: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ',
  l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ',
  s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

const UNICODE_SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾',
  n: 'ⁿ', i: 'ⁱ',
};

function convertAllChars(str: string, map: Record<string, string>): string | null {
  let out = '';
  for (const ch of str) {
    if (!Object.prototype.hasOwnProperty.call(map, ch)) return null;
    out += map[ch];
  }
  return out;
}

function renderNodesToPlainText(nodes: MathNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'sub': {
          const inner = renderNodesToPlainText(node.children);
          const unicode = convertAllChars(inner, UNICODE_SUBSCRIPT_MAP);
          return unicode ?? `_${inner}`;
        }
        case 'sup': {
          const inner = renderNodesToPlainText(node.children);
          const unicode = convertAllChars(inner, UNICODE_SUPERSCRIPT_MAP);
          return unicode ?? `^(${inner})`;
        }
        case 'frac': {
          const num = renderNodesToPlainText(node.num);
          const den = renderNodesToPlainText(node.den);
          return `(${num})/(${den})`;
        }
        case 'sqrt': {
          const content = renderNodesToPlainText(node.content);
          if (node.index && node.index.length > 0) {
            const idx = renderNodesToPlainText(node.index);
            return `${idx}√(${content})`;
          }
          return `√(${content})`;
        }
        case 'vec': {
          const inner = renderNodesToPlainText(node.content);
          return inner.length === 1 ? `${inner}\u20D7` : `vec(${inner})`;
        }
        case 'overline':
          return renderNodesToPlainText(node.content);
      }
    })
    .join('');
}

/**
 * Plain-text math/science formatter for print/DOCX/copy contexts where HTML `<sub>`/`<sup>`
 * cannot be rendered. Strips raw LaTeX braces/backslashes cleanly.
 */
export function formatMathNotationPlainText(text: string): string {
  if (!text) return '';
  return renderNodesToPlainText(parseMathNotation(text));
}
