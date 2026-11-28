import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMathNotationPlainText, parseMathNotation } from './mathNotation';

test('parseMathNotation parses braced subscripts like |F_{AB}| = |F_{BA}| và F_{AB} = -F_{BA}', () => {
  const nodes = parseMathNotation('|F_{AB}| = |F_{BA}| và F_{AB} = -F_{BA}');
  const subs = nodes.filter((n) => n.type === 'sub');
  assert.equal(subs.length, 4);
  assert.deepEqual(
    subs.map((s) => (s.type === 'sub' && s.children[0]?.type === 'text' ? s.children[0].value : '')),
    ['AB', 'BA', 'AB', 'BA']
  );
  // No raw `{` or `}` leaked into text nodes
  assert.ok(nodes.every((n) => n.type !== 'text' || (!n.value.includes('{') && !n.value.includes('}'))));
});

test('parseMathNotation parses vectors, fractions, roots, Greek letters, and exponents', () => {
  const vecNodes = parseMathNotation('\\vec{F}_{AB} = -\\vec{F}_{BA}');
  assert.equal(vecNodes[0].type, 'vec');
  assert.equal(vecNodes[1].type, 'sub');

  const fracNodes = parseMathNotation('a = \\frac{v - v_0}{t} (\\Delta t \\ge 0)');
  const frac = fracNodes.find((n) => n.type === 'frac');
  assert.ok(frac && frac.type === 'frac');
  assert.ok(frac.num.some((n) => n.type === 'sub'));

  const sqrtNodes = parseMathNotation('v = \\sqrt{2gh} và g = 9,8 m/s^2');
  assert.ok(sqrtNodes.some((n) => n.type === 'sqrt'));
  assert.ok(sqrtNodes.some((n) => n.type === 'sup'));

  const plain = formatMathNotationPlainText('$v^2 - v_0^2 = 2as$, góc $90^\\circ$, $\\Delta x \\neq 0$');
  assert.equal(plain, 'v² - v₀² = 2as, góc 90°, Δx ≠ 0');
});

test('parseMathNotation parses chemical formulas and ions accurately', () => {
  const chem = formatMathNotationPlainText('H_2SO_4 + 2NaOH \\rightarrow Na_2SO_4 + 2H_2O, Fe^{3+}');
  assert.equal(chem, 'H₂SO₄ + 2NaOH → Na₂SO₄ + 2H₂O, Fe³⁺');
});

test('parseMathNotation preserves URLs, currency, and snake_case identifiers untouched', () => {
  const input = 'Xem tài liệu https://example.com/a_b_c hoặc file_name_test.pdf giá $5 và $10.';
  const nodes = parseMathNotation(input);
  assert.deepEqual(nodes, [{ type: 'text', value: input }]);
});

test('parseMathNotation renders trig, log, limits, blackboard bold sets, integrals, and unbraced tokens without raw backslashes', () => {
  const trig = formatMathNotationPlainText(
    'Hàm số $y = \\sin x + \\cos 2x$ xác định trên $\\mathbb{R}$ với $k \\in \\mathbb{Z}$ và $\\log_2 x \\ge 0$.'
  );
  assert.equal(
    trig,
    'Hàm số y = sin x + cos 2x xác định trên ℝ với k ∈ ℤ và log₂ x ≥ 0.'
  );
  assert.ok(!trig.includes('\\'));

  const calc = formatMathNotationPlainText(
    'Tính $I = \\int_0^1 x^2 dx$, $\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$, $\\widehat{ABC} = 60^\\circ$, $\\binom{n}{k}$, $\\frac12$, $\\sqrt2$, $\\vec F$.'
  );
  assert.ok(!calc.includes('\\'));
  assert.ok(calc.includes('∫₀¹'));
  assert.ok(calc.includes('(sin x)/(x)'));
  assert.ok(calc.includes('∠ABC = 60°'));
  assert.ok(calc.includes('C(n, k)'));
  assert.ok(calc.includes('(1)/(2)'));
  assert.ok(calc.includes('√(2)'));
  assert.ok(calc.includes('F\u20D7'));
});

test('parseMathNotation repairs corrupted control chars (\f -> \\frac, \b -> \\beta, \t -> \\theta/\\times) and parses cases & chemistry', () => {
  const corrupted = 'Ta có $\x0Crac{\x08eta + \theta}{2} \times 3 \neq 0$ và $\\begin{cases} x + y = 2 \\\\ x - y = 0 \\end{cases}$';
  const plain = formatMathNotationPlainText(corrupted);
  assert.ok(!plain.includes('\x0C'));
  assert.ok(!plain.includes('\x08'));
  assert.ok(plain.includes('(β + θ)/(2) × 3 ≠ 0'));
  assert.ok(plain.includes('{ x + y = 2 ; x - y = 0 }'));

  const chem = formatMathNotationPlainText('$\\ce{Fe2O3 + 3CO -> Fe + 3CO2}$ và $A \\xrightarrow{t^\\circ} B$');
  assert.ok(chem.includes('Fe₂O₃'));
  assert.ok(chem.includes('CO₂'));
  assert.ok(chem.includes('⟶(t°)'));
});

