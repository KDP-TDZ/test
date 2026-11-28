export type MathNode =
  | { type: 'text'; value: string }
  | { type: 'sub'; children: MathNode[] }
  | { type: 'sup'; children: MathNode[] }
  | { type: 'frac'; num: MathNode[]; den: MathNode[] }
  | { type: 'binom'; top: MathNode[]; bottom: MathNode[] }
  | { type: 'sqrt'; index?: MathNode[]; content: MathNode[] }
  | { type: 'vec'; content: MathNode[]; arrow?: 'right' | 'left' | 'both' }
  | { type: 'overline'; content: MathNode[] }
  | { type: 'underline'; content: MathNode[] }
  | { type: 'hat'; content: MathNode[]; accent?: '^' | '~' | '⌒' | '˙' | '¨' }
  | { type: 'boxed'; content: MathNode[] }
  | { type: 'cancel'; content: MathNode[] }
  | { type: 'overset'; top?: MathNode[]; bottom?: MathNode[]; base: MathNode[] }
  | { type: 'cases'; rows: MathNode[][] }
  | { type: 'matrix'; rows: MathNode[][]; bracket?: 'none' | 'paren' | 'bracket' | 'pipe' };

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
  varkappa: 'ϰ',
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
  varGamma: 'Γ',
  varDelta: 'Δ',
  varTheta: 'Θ',
  varLambda: 'Λ',
  varXi: 'Ξ',
  varPi: 'Π',
  varSigma: 'Σ',
  varOmega: 'Ω',
  // Number set shorthands
  R: 'ℝ',
  Z: 'ℤ',
  N: 'ℕ',
  Q: 'ℚ',
  C: 'ℂ',
  // Operators & relations
  times: '×',
  cdot: '·',
  centerdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  approx: '≈',
  thickapprox: '≈',
  neq: '≠',
  ne: '≠',
  not: '¬',
  leq: '≤',
  le: '≤',
  leqslant: '⩽',
  geq: '≥',
  ge: '≥',
  geqslant: '⩾',
  ll: '≪',
  gg: '≫',
  lessgtr: '≶',
  gtrless: '≷',
  prec: '≺',
  succ: '≻',
  preceq: '≼',
  succeq: '≽',
  equiv: '≡',
  nequiv: '≢',
  propto: '∝',
  varpropto: '∝',
  sim: '∼',
  thicksim: '∼',
  nsim: '≁',
  simeq: '≃',
  cong: '≅',
  ncong: '≇',
  doteq: '≐',
  infty: '∞',
  partial: '∂',
  nabla: '∇',
  sum: '∑',
  prod: '∏',
  coprod: '∐',
  int: '∫',
  iint: '∬',
  iiint: '∭',
  oint: '∮',
  // Arrows
  rightarrow: '→',
  to: '→',
  longrightarrow: '⟶',
  leftarrow: '←',
  gets: '←',
  longleftarrow: '⟵',
  leftrightarrow: '↔',
  longleftrightarrow: '⟷',
  Rightarrow: '⇒',
  Longrightarrow: '⟹',
  Leftarrow: '⇐',
  Longleftarrow: '⟸',
  Leftrightarrow: '⇔',
  Longleftrightarrow: '⟺',
  implies: '⇒',
  impliedby: '⇐',
  iff: '⇔',
  mapsto: '↦',
  longmapsto: '⟼',
  rightleftharpoons: '⇌',
  leftrightharpoons: '⇌',
  leftharpoons: '⇌',
  uparrow: '↑',
  downarrow: '↓',
  updownarrow: '↕',
  Uparrow: '⇑',
  Downarrow: '⇓',
  nearrow: '↗',
  searrow: '↘',
  swarrow: '↙',
  nwarrow: '↖',
  leadsto: '↝',
  // Geometry, physics, chemistry & sets
  circ: '°',
  degree: '°',
  celsius: '°C',
  degreeCelsius: '°C',
  angle: '∠',
  measuredangle: '∠',
  sphericalangle: '∢',
  perp: '⊥',
  bot: '⊥',
  top: '⊤',
  parallel: '∥',
  nparallel: '∦',
  triangle: '△',
  bigtriangleup: '△',
  vartriangle: '△',
  triangledown: '▽',
  triangleleft: '◁',
  triangleright: '▷',
  square: '□',
  Box: '□',
  diamond: '◊',
  lozenge: '◊',
  star: '⋆',
  ast: '∗',
  bullet: '•',
  bigcirc: '○',
  frown: '⌒',
  smile: '⌣',
  in: '∈',
  notin: '∉',
  ni: '∋',
  owns: '∋',
  subset: '⊂',
  subseteq: '⊆',
  nsubseteq: '⊈',
  subsetneq: '⊊',
  supset: '⊃',
  supseteq: '⊇',
  nsupseteq: '⊉',
  supsetneq: '⊋',
  cup: '∪',
  cap: '∩',
  bigcup: '⋃',
  bigcap: '⋂',
  setminus: '∖',
  backslash: '\\',
  oplus: '⊕',
  ominus: '⊖',
  otimes: '⊗',
  odot: '⊙',
  forall: '∀',
  exists: '∃',
  nexists: '∄',
  neg: '¬',
  lnot: '¬',
  land: '∧',
  wedge: '∧',
  lor: '∨',
  vee: '∨',
  therefore: '∴',
  because: '∵',
  emptyset: '∅',
  varnothing: '∅',
  cdots: '⋯',
  ldots: '…',
  dots: '…',
  vdots: '⋮',
  ddots: '⋱',
  prime: '′',
  backprime: '‵',
  ohm: 'Ω',
  mho: '℧',
  micro: 'μ',
  AA: 'Å',
  angstrom: 'Å',
  ell: 'ℓ',
  hbar: 'ℏ',
  Re: 'ℜ',
  Im: 'ℑ',
  wp: '℘',
  aleph: 'ℵ',
  permil: '‰',
  colon: ':',
  mid: '|',
  nmid: '∤',
  vert: '|',
  Vert: '‖',
  lfloor: '⌊',
  rfloor: '⌋',
  lceil: '⌈',
  rceil: '⌉',
  langle: '⟨',
  rangle: '⟩',
  // Spacing commands
  quad: ' ',
  qquad: '  ',
  enspace: ' ',
  thinspace: ' ',
  medspace: ' ',
  thickspace: ' ',
  space: ' ',
};

/**
 * Standard math/trig/calculus function names (\sin, \cos, \tan, \cot, \ln, \log, \lim, \max, \min, etc.)
 */
const LATEX_FUNCTION_NAMES: Record<string, string> = {
  sin: 'sin',
  cos: 'cos',
  tan: 'tan',
  cot: 'cot',
  tg: 'tan',
  cotg: 'cot',
  sec: 'sec',
  csc: 'csc',
  arcsin: 'arcsin',
  arccos: 'arccos',
  arctan: 'arctan',
  arccot: 'arccot',
  sinh: 'sinh',
  cosh: 'cosh',
  tanh: 'tanh',
  coth: 'coth',
  ln: 'ln',
  log: 'log',
  lg: 'lg',
  exp: 'exp',
  lim: 'lim',
  limsup: 'lim sup',
  liminf: 'lim inf',
  max: 'max',
  min: 'min',
  sup: 'sup',
  inf: 'inf',
  arg: 'arg',
  deg: 'deg',
  det: 'det',
  dim: 'dim',
  gcd: 'gcd',
  lcm: 'lcm',
  hom: 'hom',
  ker: 'ker',
  Pr: 'Pr',
  mod: ' mod ',
  bmod: ' mod ',
  sgn: 'sgn',
  rank: 'rank',
};

const BLACKBOARD_BOLD_MAP: Record<string, string> = {
  C: 'ℂ',
  E: '𝔼',
  F: '𝔽',
  H: 'ℍ',
  I: '𝕀',
  K: '𝕂',
  N: 'ℕ',
  P: 'ℙ',
  Q: 'ℚ',
  R: 'ℝ',
  Z: 'ℤ',
};

const TEXT_WRAPPER_COMMANDS = new Set([
  'text',
  'textrm',
  'textbf',
  'textit',
  'textsf',
  'texttt',
  'textup',
  'textnormal',
  'mbox',
  'hbox',
  'mathrm',
  'mathbf',
  'mathit',
  'mathsf',
  'mathtt',
  'mathcal',
  'mathscr',
  'mathfrak',
  'mathnormal',
  'operatorname',
  'boldsymbol',
  'bm',
  'rm',
  'bf',
  'it',
  'sf',
  'tt',
  'ce',
  'pu',
  'unit',
]);

/**
 * Formatting / sizing modifiers that take no brace argument and should be silently consumed.
 */
const NO_OP_MODIFIER_COMMANDS = new Set([
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
  'limits',
  'nolimits',
  'noindent',
  'allowbreak',
  'big',
  'Big',
  'bigg',
  'Bigg',
  'bigl',
  'bigr',
  'Bigl',
  'Bigr',
  'biggl',
  'biggr',
  'Biggl',
  'Biggr',
  'bgm',
  'bigm',
  'Bigm',
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
  'normalfont',
  'boldmath',
  'unboldmath',
  'relax',
]);

/**
 * Commands whose single `{...}` argument should be discarded (e.g. \hspace{1cm}, \phantom{x}).
 */
const DISCARD_ARG_COMMANDS = new Set([
  'hspace',
  'vspace',
  'phantom',
  'hphantom',
  'vphantom',
  'kern',
  'mkern',
  'mskip',
  'label',
  'tag',
]);

const KNOWN_TWO_LETTER_ELEMENTS = new Set([
  'He', 'Li', 'Be', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'Cl', 'Ar',
  'Ca', 'Sc', 'Ti', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Ag', 'Cd',
  'Sn', 'Sb', 'Te', 'Xe', 'Cs', 'Ba', 'Pt', 'Au', 'Hg', 'Pb', 'Ra',
]);

const URL_PATTERN = /https?:\/\/[^\s)]+/g;

/**
 * Repairs LaTeX commands that were accidentally corrupted into ASCII control characters
 * (\f = 0x0C, \b = 0x08, \t = 0x09, \r = 0x0D) when single-backslash LaTeX was parsed by JSON.parse.
 */
export function repairCorruptedLatexControlChars(input: string): string {
  if (!input) return '';
  let out = input;

  // \f (0x0C) + rac/orall -> \frac, \forall
  if (out.includes('\x0C')) {
    out = out.replace(/\x0C(rac|orall|box|lat|rown)/g, '\\f$1');
  }
  // \b (0x08) + eta/ar/egin/inom/ig/oxed/ullet/ackslash/ot/cancel -> \beta, \bar, \begin, \binom, etc.
  if (out.includes('\x08')) {
    out = out.replace(
      /\x08(eta|ar|egin|inom|ig|Big|oxed|ullet|ackslash|ot\b|f\b|m\b|mod\b|cancel|ackprime|igcup|igcap|igtriangleup)/g,
      '\\b$1'
    );
  }
  // \t (0x09) + heta/au/an/anh/imes/ext/frac/binom/o/op/riangle/ilde/hickapprox/herefore
  if (out.includes('\t')) {
    out = out.replace(
      /\t(heta|au\b|an\b|anh\b|imes\b|ext|extbf|extit|extrm|extsf|exttt|frac|binom|o\b|op\b|riangle|ilde|hickapprox|hicksim|herefore|iny\b)/g,
      '\\t$1'
    );
  }
  // \r (0x0D not followed by \n) + ightarrow/ight/ho/angle/ceil/floor
  if (out.includes('\r')) {
    out = out.replace(
      /\r(?!\n)(ightarrow|ightleftharpoons|ight|ho\b|angle|ceil|floor|m\b)/g,
      '\\r$1'
    );
  }
  // Inside inline math $...$, repair \n + eq/e/abla/u/otin/atural/eg/mid/i/exists/parallel/cong/sim/subseteq
  if (out.includes('\n') && out.includes('$')) {
    out = out.replace(
      /\n(eq\b|e\b|equiv\b|abla\b|u\b|otin\b|atural\b|eg\b|mid\b|i\b|exists\b|parallel\b|cong\b|sim\b|subseteq\b|supseteq\b|earrow\b|warrow\b)/g,
      '\\n$1'
    );
  }

  return out;
}

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
  while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i += 1;
  return i;
}

/**
 * Reads either a `{...}` balanced group OR a single unbraced TeX token (a `\command` or single char)
 * starting at `startIdx` (after skipping spaces). Used for `\frac12`, `\sqrt2`, `\vec F`, `\bar x`, etc.
 */
function readGroupOrSingleToken(
  src: string,
  startIdx: number
): { content: string; nextIndex: number } | null {
  const idx = skipInlineSpaces(src, startIdx);
  if (idx >= src.length) return null;
  if (src[idx] === '{') {
    return readBalancedGroup(src, idx, '{', '}');
  }
  if (src[idx] === '\\') {
    const cmdMatch = /^\\[a-zA-Z]+/.exec(src.slice(idx));
    if (cmdMatch) {
      return {
        content: cmdMatch[0],
        nextIndex: idx + cmdMatch[0].length,
      };
    }
    if (idx + 1 < src.length) {
      return {
        content: src.slice(idx, idx + 2),
        nextIndex: idx + 2,
      };
    }
  }
  // Single alphanumeric or Greek character
  if (/[a-zA-Z0-9\u0370-\u03FF]/.test(src[idx])) {
    return {
      content: src[idx],
      nextIndex: idx + 1,
    };
  }
  return null;
}

/**
 * Checks if an unbraced `_` at `underscoreIdx` is a genuine math/chemistry subscript
 * (e.g. `v_0`, `F_1`, `H_2O`, `CO_2`, `a_x`, `F_A`, `\int_0^1`, `x_\alpha`) rather than a snake_case identifier (`user_id`).
 */
function canParseUnbracedSubscript(
  src: string,
  underscoreIdx: number,
  inMathMode: boolean
): { token: string; nextIndex: number } | null {
  const prevIdx = underscoreIdx - 1;
  if (prevIdx < 0 && !inMathMode) return null;
  const prevChar = prevIdx >= 0 ? src[prevIdx] : '';
  const nextIdx = underscoreIdx + 1;
  if (nextIdx >= src.length) return null;

  if (!inMathMode) {
    const isPrevValidBase =
      /[a-zA-Z0-9)\]}|]/.test(prevChar) ||
      /[\u0370-\u03FF\u2200-\u22FF]/.test(prevChar); // Greek letters & math operators (∑, ∏, ∫)
    if (!isPrevValidBase) return null;

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

  // Case 0: LaTeX command subscript (e.g. `x_\alpha`, `v_\max`, `a_\text{tb}`)
  if (src[nextIdx] === '\\') {
    const cmdMatch = /^\\([a-zA-Z]+)/.exec(src.slice(nextIdx));
    if (cmdMatch) {
      const cmdEnd = nextIdx + cmdMatch[0].length;
      if (src[cmdEnd] === '{') {
        const grp = readBalancedGroup(src, cmdEnd, '{', '}');
        if (grp) {
          return { token: src.slice(nextIdx, grp.nextIndex), nextIndex: grp.nextIndex };
        }
      }
      return { token: cmdMatch[0], nextIndex: cmdEnd };
    }
  }

  // Case 1: digits (e.g., H_2O, CO_2, v_0, F_12, \int_0^1)
  const digitMatch = /^[+-]?\d+/.exec(src.slice(nextIdx));
  if (digitMatch) {
    return { token: digitMatch[0], nextIndex: nextIdx + digitMatch[0].length };
  }

  // Case 2: single letter/axis/label not followed by another lowercase letter (e.g., a_x, v_y, F_A, a_n, C_n^k)
  const singleLetterMatch = /^[a-zA-Z\u0370-\u03FF]/.exec(src.slice(nextIdx));
  if (singleLetterMatch) {
    const afterChar = src[nextIdx + 1] || '';
    if (!inMathMode && /[a-z0-9_]/.test(afterChar)) {
      return null;
    }
    return { token: singleLetterMatch[0], nextIndex: nextIdx + 1 };
  }

  return null;
}

/**
 * Checks if an unbraced `^` at `caretIdx` is a genuine superscript (`m/s^2`, `x^2`, `10^-5`, `H^+`, `90^\circ`, `2^\pi`).
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
  if (src[nextIdx] === '°') {
    return { token: '°', isDegree: true, nextIndex: nextIdx + 1 };
  }

  // LaTeX command exponent (e.g. `e^\pi`, `x^\alpha`, `A^\prime`)
  if (src[nextIdx] === '\\') {
    const cmdMatch = /^\\([a-zA-Z]+)/.exec(src.slice(nextIdx));
    if (cmdMatch) {
      const cmd = cmdMatch[1];
      const cmdEnd = nextIdx + cmdMatch[0].length;
      if (cmd === 'prime') {
        return { token: '′', isDegree: true, nextIndex: cmdEnd };
      }
      if (src[cmdEnd] === '{') {
        const grp = readBalancedGroup(src, cmdEnd, '{', '}');
        if (grp) {
          return { token: src.slice(nextIdx, grp.nextIndex), nextIndex: grp.nextIndex };
        }
      }
      return { token: cmdMatch[0], nextIndex: cmdEnd };
    }
  }

  // Signed exponent or ion charge: `10^-5`, `Fe^3+`, `SO_4^2-`, `H^+`, `Cl^-`, `x^2`, `a^n`
  const signedDigits = /^[+-]?\d+[+-]?/.exec(src.slice(nextIdx));
  if (signedDigits) {
    return { token: signedDigits[0], nextIndex: nextIdx + signedDigits[0].length };
  }

  const singleChargeOrVar = /^[a-zA-Z\u0370-\u03FF+-]/.exec(src.slice(nextIdx));
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

  for (let i = openAfter; i < src.length; i++) {
    if (src[i] === '\\' && i + 1 < src.length) {
      i += 1;
      continue;
    }
    if (!doubleDollar && src[i] === '\n') return -1;
    if (src.startsWith(delim, i)) {
      // Don't treat `$5 và $10` as a math span
      if (!doubleDollar) {
        const inner = src.slice(openAfter, i);
        if (/^\d[\d.,]*\s+[a-zA-Z\u00C0-\u1EFF]{2,}/.test(inner) && !/[\\_^=<>+\-*/()]/.test(inner)) {
          return -1;
        }
      }
      return i;
    }
  }
  return -1;
}

/**
 * Splits a LaTeX environment body (e.g. `\begin{cases} ... \end{cases}`) by unescaped `\\` row separators.
 */
function splitLatexEnvironmentRows(body: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let rowStart = 0;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }
    if (depth === 0 && ch === '\\' && body[i + 1] === '\\') {
      rows.push(body.slice(rowStart, i).trim());
      i += 2;
      // Optional row spacing `\\[4pt]`
      const sp = skipInlineSpaces(body, i);
      if (body[sp] === '[') {
        const opt = readBalancedGroup(body, sp, '[', ']');
        if (opt) i = opt.nextIndex;
      }
      rowStart = i;
      continue;
    }
    i += 1;
  }
  const tail = body.slice(rowStart).trim();
  if (tail) rows.push(tail);
  return rows.filter((r) => r.length > 0);
}

/**
 * Formats mhchem `\ce{...}` expressions into standard math/chemistry notation.
 */
function normalizeMhchemContent(raw: string): string {
  return raw
    .replace(/<=>/g, '\\rightleftharpoons ')
    .replace(/->/g, '\\rightarrow ')
    .replace(/<-/g, '\\leftarrow ')
    .replace(/([A-Z][a-z]?)(\d+)/g, '$1_$2')
    .replace(/\)\s*(\d+)/g, ')_$1');
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

      // LaTeX line break `\\` inside math
      if (nextCh === '\\') {
        pushText(nodes, ' ; ');
        i += 2;
        const sp = skipInlineSpaces(src, i);
        if (src[sp] === '[') {
          const opt = readBalancedGroup(src, sp, '[', ']');
          if (opt) i = opt.nextIndex;
        }
        continue;
      }

      // Escaped single-char LaTeX symbols: \, \; \: \! \  \% \_ \{ \} \| \$ \& \#
      if (nextCh === ',' || nextCh === ';' || nextCh === ':' || nextCh === ' ') {
        pushText(nodes, ' ');
        i += 2;
        continue;
      }
      if (nextCh === '!') {
        i += 2;
        continue;
      }
      if (
        nextCh === '%' ||
        nextCh === '_' ||
        nextCh === '{' ||
        nextCh === '}' ||
        nextCh === '|' ||
        nextCh === '$' ||
        nextCh === '&' ||
        nextCh === '#'
      ) {
        pushText(nodes, nextCh);
        i += 2;
        continue;
      }

      const cmdMatch = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (cmdMatch) {
        const cmd = cmdMatch[1];
        const afterCmd = i + 1 + cmd.length;

        // \begin{env} ... \end{env}
        if (cmd === 'begin') {
          const envStart = skipInlineSpaces(src, afterCmd);
          const envGroup = readBalancedGroup(src, envStart, '{', '}');
          if (envGroup) {
            const envName = envGroup.content.trim();
            const endTag = `\\end{${envName}}`;
            const endIdx = src.indexOf(endTag, envGroup.nextIndex);
            if (endIdx !== -1) {
              let body = src.slice(envGroup.nextIndex, endIdx).trim();
              // Strip optional column alignment spec for \begin{array}{lcr}
              if (envName === 'array' && body.startsWith('{')) {
                const colSpec = readBalancedGroup(body, 0, '{', '}');
                if (colSpec) {
                  body = body.slice(colSpec.nextIndex).trim();
                }
              }
              const rawRows = splitLatexEnvironmentRows(body);
              const parsedRows = rawRows.map((r) =>
                parseMathSegment(r.replace(/&/g, ' '), true)
              );
              if (envName === 'cases' || envName === 'dcases' || envName === 'rcases') {
                nodes.push({ type: 'cases', rows: parsedRows });
              } else {
                const bracket =
                  envName === 'pmatrix'
                    ? 'paren'
                    : envName === 'bmatrix'
                    ? 'bracket'
                    : envName === 'vmatrix' || envName === 'Vmatrix'
                    ? 'pipe'
                    : 'none';
                nodes.push({ type: 'matrix', rows: parsedRows, bracket });
              }
              i = endIdx + endTag.length;
              continue;
            }
          }
        }

        // \left and \right sizing prefixes (including \left\{ \begin{array} ... \right.)
        if (cmd === 'left' || cmd === 'right' || cmd === 'middle') {
          const delimIdx = skipInlineSpaces(src, afterCmd);
          const delimCh = src[delimIdx];
          if (delimCh === '.') {
            i = delimIdx + 1;
            continue;
          }
          if (delimCh === '\\') {
            const subCmd = /^\\([a-zA-Z]+|[{|}%])/.exec(src.slice(delimIdx));
            if (subCmd) {
              const s = subCmd[1];
              if (s === '{' || s === '}' || s === '|') {
                pushText(nodes, s);
                i = delimIdx + 2;
                continue;
              }
              if (Object.prototype.hasOwnProperty.call(LATEX_SYMBOLS, s)) {
                pushText(nodes, LATEX_SYMBOLS[s]);
                i = delimIdx + subCmd[0].length;
                continue;
              }
            }
          }
          if (delimCh && /[|()[\]{}<>/]/.test(delimCh)) {
            pushText(nodes, delimCh);
            i = delimIdx + 1;
            continue;
          }
          i = afterCmd;
          continue;
        }

        // \frac{num}{den}, \dfrac{num}{den}, \tfrac{num}{den}, \cfrac{num}{den}
        if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac' || cmd === 'cfrac') {
          const numGroup = readGroupOrSingleToken(src, afterCmd);
          if (numGroup) {
            const denGroup = readGroupOrSingleToken(src, numGroup.nextIndex);
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

        // \binom{n}{k}, \dbinom{n}{k}, \tbinom{n}{k}
        if (cmd === 'binom' || cmd === 'dbinom' || cmd === 'tbinom') {
          const topGroup = readGroupOrSingleToken(src, afterCmd);
          if (topGroup) {
            const botGroup = readGroupOrSingleToken(src, topGroup.nextIndex);
            if (botGroup) {
              nodes.push({
                type: 'binom',
                top: parseMathSegment(topGroup.content, true),
                bottom: parseMathSegment(botGroup.content, true),
              });
              i = botGroup.nextIndex;
              continue;
            }
          }
        }

        // \sqrt[n]{x} or \sqrt{x} or \sqrt2
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
          const bodyGroup = readGroupOrSingleToken(src, cursor);
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

        // \vec{F}, \overrightarrow{AB}, \overleftarrow{AB}, \overleftrightarrow{AB}
        if (
          cmd === 'vec' ||
          cmd === 'overrightarrow' ||
          cmd === 'overleftarrow' ||
          cmd === 'overleftrightarrow'
        ) {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            const arrow =
              cmd === 'overleftarrow'
                ? 'left'
                : cmd === 'overleftrightarrow'
                ? 'both'
                : 'right';
            nodes.push({
              type: 'vec',
              content: parseMathSegment(group.content, true),
              arrow,
            });
            i = group.nextIndex;
            continue;
          }
        }

        // \overline{v} or \bar{v}
        if (cmd === 'overline' || cmd === 'bar') {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            nodes.push({
              type: 'overline',
              content: parseMathSegment(group.content, true),
            });
            i = group.nextIndex;
            continue;
          }
        }

        // \underline{x}
        if (cmd === 'underline') {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            nodes.push({
              type: 'underline',
              content: parseMathSegment(group.content, true),
            });
            i = group.nextIndex;
            continue;
          }
        }

        // \hat{x}, \widehat{ABC}, \tilde{x}, \widetilde{x}, \arc{AB}, \wideparen{AB}, \dot{x}, \ddot{x}
        if (
          cmd === 'hat' ||
          cmd === 'widehat' ||
          cmd === 'tilde' ||
          cmd === 'widetilde' ||
          cmd === 'arc' ||
          cmd === 'overarc' ||
          cmd === 'wideparen' ||
          cmd === 'dot' ||
          cmd === 'ddot'
        ) {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            const accent =
              cmd === 'tilde' || cmd === 'widetilde'
                ? '~'
                : cmd === 'arc' || cmd === 'overarc' || cmd === 'wideparen'
                ? '⌒'
                : cmd === 'dot'
                ? '˙'
                : cmd === 'ddot'
                ? '¨'
                : '^';
            nodes.push({
              type: 'hat',
              content: parseMathSegment(group.content, true),
              accent,
            });
            i = group.nextIndex;
            continue;
          }
        }

        // \boxed{...}
        if (cmd === 'boxed' || cmd === 'fbox') {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            nodes.push({
              type: 'boxed',
              content: parseMathSegment(group.content, true),
            });
            i = group.nextIndex;
            continue;
          }
        }

        // \cancel{...}, \bcancel{...}, \xcancel{...}
        if (cmd === 'cancel' || cmd === 'bcancel' || cmd === 'xcancel') {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            nodes.push({
              type: 'cancel',
              content: parseMathSegment(group.content, true),
            });
            i = group.nextIndex;
            continue;
          }
        }

        // \xrightarrow[sub]{sup}, \xleftarrow[sub]{sup}, \xrightleftharpoons[sub]{sup}
        if (
          cmd === 'xrightarrow' ||
          cmd === 'xleftarrow' ||
          cmd === 'xleftrightarrow' ||
          cmd === 'xRightarrow' ||
          cmd === 'xrightleftharpoons'
        ) {
          let cursor = skipInlineSpaces(src, afterCmd);
          let bottomNodes: MathNode[] | undefined;
          if (src[cursor] === '[') {
            const optGroup = readBalancedGroup(src, cursor, '[', ']');
            if (optGroup) {
              bottomNodes = parseMathSegment(optGroup.content, true);
              cursor = skipInlineSpaces(src, optGroup.nextIndex);
            }
          }
          const topGroup = readBalancedGroup(src, cursor, '{', '}');
          const arrowSym =
            cmd === 'xleftarrow'
              ? '⟵'
              : cmd === 'xleftrightarrow'
              ? '⟷'
              : cmd === 'xRightarrow'
              ? '⟹'
              : cmd === 'xrightleftharpoons'
              ? '⇌'
              : '⟶';
          if (topGroup) {
            nodes.push({
              type: 'overset',
              top: topGroup.content.trim() ? parseMathSegment(topGroup.content, true) : undefined,
              bottom: bottomNodes,
              base: [{ type: 'text', value: arrowSym }],
            });
            i = topGroup.nextIndex;
            continue;
          }
        }

        // \overset{top}{base}, \stackrel{top}{base}, \underset{bot}{base}
        if (cmd === 'overset' || cmd === 'stackrel' || cmd === 'underset') {
          const firstGroup = readGroupOrSingleToken(src, afterCmd);
          if (firstGroup) {
            const secondGroup = readGroupOrSingleToken(src, firstGroup.nextIndex);
            if (secondGroup) {
              if (cmd === 'underset') {
                nodes.push({
                  type: 'overset',
                  bottom: parseMathSegment(firstGroup.content, true),
                  base: parseMathSegment(secondGroup.content, true),
                });
              } else {
                // Special case: \overset{\frown}{AB} -> arc over AB
                const topTrim = firstGroup.content.trim();
                if (topTrim === '\\frown' || topTrim === '\\smile' || topTrim === '⌒') {
                  nodes.push({
                    type: 'hat',
                    content: parseMathSegment(secondGroup.content, true),
                    accent: '⌒',
                  });
                } else {
                  nodes.push({
                    type: 'overset',
                    top: parseMathSegment(firstGroup.content, true),
                    base: parseMathSegment(secondGroup.content, true),
                  });
                }
              }
              i = secondGroup.nextIndex;
              continue;
            }
          }
        }

        // \mathbb{R}, \mathbb{Z}, \mathbb{N}, \mathbb{Q}, \mathbb{C}
        if (cmd === 'mathbb' || cmd === 'Bbb') {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            const rawContent = group.content.trim();
            const mapped = Array.from(rawContent)
              .map((c) => BLACKBOARD_BOLD_MAP[c] || c)
              .join('');
            pushText(nodes, mapped);
            i = group.nextIndex;
            continue;
          }
        }

        // \pmod{n} -> (mod n)
        if (cmd === 'pmod') {
          const group = readGroupOrSingleToken(src, afterCmd);
          if (group) {
            pushText(nodes, ' (mod ');
            for (const n of parseMathSegment(group.content, true)) {
              if (n.type === 'text') pushText(nodes, n.value);
              else nodes.push(n);
            }
            pushText(nodes, ')');
            i = group.nextIndex;
            continue;
          }
        }

        // Discard-argument commands (\hspace{...}, \phantom{...}, etc.)
        if (DISCARD_ARG_COMMANDS.has(cmd)) {
          let cursor = afterCmd;
          if (src[cursor] === '*') cursor += 1;
          cursor = skipInlineSpaces(src, cursor);
          if (src[cursor] === '{') {
            const grp = readBalancedGroup(src, cursor, '{', '}');
            if (grp) {
              i = grp.nextIndex;
              continue;
            }
          }
          i = cursor;
          continue;
        }

        // Text/font/chemistry wrappers: \text{...}, \mathrm{...}, \ce{...}, etc.
        if (TEXT_WRAPPER_COMMANDS.has(cmd)) {
          let cursor = afterCmd;
          if (src[cursor] === '*') cursor += 1;
          const groupStart = skipInlineSpaces(src, cursor);
          const group = readBalancedGroup(src, groupStart, '{', '}');
          if (group) {
            const contentToParse =
              cmd === 'ce' ? normalizeMhchemContent(group.content) : group.content;
            const innerMathMode =
              cmd === 'mathrm' ||
              cmd === 'mathbf' ||
              cmd === 'mathit' ||
              cmd === 'mathsf' ||
              cmd === 'mathtt' ||
              cmd === 'mathcal' ||
              cmd === 'mathscr' ||
              cmd === 'mathfrak' ||
              cmd === 'boldsymbol' ||
              cmd === 'bm' ||
              cmd === 'ce';
            const innerNodes = parseMathSegment(contentToParse, innerMathMode);
            for (const n of innerNodes) {
              if (n.type === 'text') pushText(nodes, n.value);
              else nodes.push(n);
            }
            i = group.nextIndex;
            continue;
          }
        }

        // Standard math/trig/log/limit functions (\sin, \cos, \tan, \cot, \ln, \log, \lim, \max, \min)
        if (Object.prototype.hasOwnProperty.call(LATEX_FUNCTION_NAMES, cmd)) {
          const fnName = LATEX_FUNCTION_NAMES[cmd];
          pushText(nodes, fnName);
          // If followed by a space and then an argument (e.g. `\sin x`, `\cos 2x`), keep a thin space unless followed by `_`, `^`, `(`, `[`
          const nextNonSpace = skipInlineSpaces(src, afterCmd);
          const nextChar = src[nextNonSpace] || '';
          if (nextNonSpace > afterCmd && nextChar && !/[_^([{\s.,;:!?)]/.test(nextChar)) {
            pushText(nodes, ' ');
            i = nextNonSpace;
          } else {
            i = afterCmd;
          }
          continue;
        }

        // No-op modifier commands (\displaystyle, \limits, \large, \bf, etc.)
        if (NO_OP_MODIFIER_COMMANDS.has(cmd)) {
          i = skipInlineSpaces(src, afterCmd);
          continue;
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

        // Fallback for any other unknown \command: if followed by {group}, unwrap the group; otherwise strip the backslash
        const fallbackGroupStart = skipInlineSpaces(src, afterCmd);
        if (src[fallbackGroupStart] === '{') {
          const grp = readBalancedGroup(src, fallbackGroupStart, '{', '}');
          if (grp) {
            const innerNodes = parseMathSegment(grp.content, inMathMode);
            for (const n of innerNodes) {
              if (n.type === 'text') pushText(nodes, n.value);
              else nodes.push(n);
            }
            i = grp.nextIndex;
            continue;
          }
        }
        pushText(nodes, cmd);
        i = afterCmd;
        continue;
      }
    }

    // 3. Subscripts: _{...} or unbraced _x
    if (src[i] === '_') {
      const braceIdx = skipInlineSpaces(src, i + 1);
      if (src[braceIdx] === '{') {
        const group = readBalancedGroup(src, braceIdx, '{', '}');
        if (group) {
          if (group.content.length > 0) {
            nodes.push({
              type: 'sub',
              children: parseMathSegment(group.content, true),
            });
          }
          i = group.nextIndex;
          continue;
        }
      } else {
        const unbraced = canParseUnbracedSubscript(src, i, inMathMode);
        if (unbraced) {
          nodes.push({
            type: 'sub',
            children: parseMathSegment(unbraced.token, true),
          });
          i = unbraced.nextIndex;
          continue;
        }
      }
    }

    // 4. Superscripts: ^{...} or unbraced ^2 / ^+ / ^\circ
    if (src[i] === '^') {
      const braceIdx = skipInlineSpaces(src, i + 1);
      if (src[braceIdx] === '{') {
        const group = readBalancedGroup(src, braceIdx, '{', '}');
        if (group) {
          if (group.content.length > 0) {
            const trimmed = group.content.trim();
            if (trimmed === '\\circ' || trimmed === '\\degree' || trimmed === '°') {
              pushText(nodes, '°');
            } else if (trimmed === '\\prime' || trimmed === "'") {
              pushText(nodes, '′');
            } else {
              nodes.push({
                type: 'sup',
                children: parseMathSegment(group.content, true),
              });
            }
          }
          i = group.nextIndex;
          continue;
        }
      } else {
        const unbraced = canParseUnbracedSuperscript(src, i);
        if (unbraced) {
          if (unbraced.isDegree) {
            pushText(nodes, unbraced.token);
          } else {
            nodes.push({
              type: 'sup',
              children: parseMathSegment(unbraced.token, true),
            });
          }
          i = unbraced.nextIndex;
          continue;
        }
      }
    }

    // 5. Unescaped grouping braces `{...}` inside math mode: unwrap instead of printing literal `{` and `}`
    if (inMathMode && src[i] === '{') {
      const group = readBalancedGroup(src, i, '{', '}');
      if (group) {
        const innerNodes = parseMathSegment(group.content, true);
        for (const n of innerNodes) {
          if (n.type === 'text') pushText(nodes, n.value);
          else nodes.push(n);
        }
        i = group.nextIndex;
        continue;
      }
    }
    if (inMathMode && src[i] === '}') {
      i += 1;
      continue;
    }

    // 6. Tilde `~` in math mode is a non-breaking space in LaTeX
    if (inMathMode && src[i] === '~') {
      pushText(nodes, ' ');
      i += 1;
      continue;
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

  const repaired = repairCorruptedLatexControlChars(text);

  // Quick check: if text has none of the notation triggers, return a single text node
  if (!/[\\_^$]/.test(repaired)) {
    return [{ type: 'text', value: repaired }];
  }

  // Split around URLs so underscores inside URLs are never altered
  const nodes: MathNode[] = [];
  let lastIndex = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_PATTERN.exec(repaired)) !== null) {
    const before = repaired.slice(lastIndex, match.index);
    if (before) {
      for (const n of parseMathSegment(before, false)) {
        if (n.type === 'text') pushText(nodes, n.value);
        else nodes.push(n);
      }
    }
    pushText(nodes, match[0]);
    lastIndex = match.index + match[0].length;
  }

  const tail = repaired.slice(lastIndex);
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
        case 'binom': {
          const top = renderNodesToPlainText(node.top);
          const bot = renderNodesToPlainText(node.bottom);
          return `C(${top}, ${bot})`;
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
        case 'underline':
        case 'boxed':
        case 'cancel':
          return renderNodesToPlainText(node.content);
        case 'hat': {
          const inner = renderNodesToPlainText(node.content);
          return node.accent === '^' && inner.length > 1 ? `∠${inner}` : inner;
        }
        case 'overset': {
          const base = renderNodesToPlainText(node.base);
          const top = node.top ? renderNodesToPlainText(node.top) : '';
          const bot = node.bottom ? renderNodesToPlainText(node.bottom) : '';
          if (top && bot) return `${base}(${top}, ${bot})`;
          if (top) return `${base}(${top})`;
          if (bot) return `${base}(${bot})`;
          return base;
        }
        case 'cases': {
          const rows = node.rows.map((r) => renderNodesToPlainText(r));
          return `{ ${rows.join(' ; ')} }`;
        }
        case 'matrix': {
          const rows = node.rows.map((r) => renderNodesToPlainText(r));
          return `[ ${rows.join(' ; ')} ]`;
        }
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
