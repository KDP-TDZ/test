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
