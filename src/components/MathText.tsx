import React, { useMemo } from 'react';
import { parseMathNotation, type MathNode } from '../core/mathNotation';

interface MathTextProps {
  text?: string | null;
  className?: string;
}

function renderMathNodes(nodes: MathNode[], keyPrefix: string): React.ReactNode {
  return nodes.map((node, idx) => {
    const key = `${keyPrefix}_${idx}`;
    switch (node.type) {
      case 'text':
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case 'sub':
        return (
          <sub key={key} className="text-[0.75em] leading-none align-baseline relative top-[0.25em] font-normal">
            {renderMathNodes(node.children, key)}
          </sub>
        );
      case 'sup':
        return (
          <sup key={key} className="text-[0.75em] leading-none align-baseline relative -top-[0.42em] font-normal">
            {renderMathNodes(node.children, key)}
          </sup>
        );
      case 'frac':
        return (
          <span
            key={key}
            className="inline-flex flex-col items-center align-middle text-center leading-[1.05] mx-0.5 text-[0.84em]"
          >
            <span className="border-b border-current px-1 pb-[1px]">
              {renderMathNodes(node.num, `${key}_n`)}
            </span>
            <span className="px-1 pt-[1px]">
              {renderMathNodes(node.den, `${key}_d`)}
            </span>
          </span>
        );
      case 'binom':
        return (
          <span
            key={key}
            className="inline-flex items-center align-middle mx-0.5 text-[0.84em]"
          >
            <span aria-hidden="true" className="text-[1.25em] leading-none font-light">(</span>
            <span className="inline-flex flex-col items-center text-center leading-[1.05] px-0.5">
              <span>{renderMathNodes(node.top, `${key}_t`)}</span>
              <span>{renderMathNodes(node.bottom, `${key}_b`)}</span>
            </span>
            <span aria-hidden="true" className="text-[1.25em] leading-none font-light">)</span>
          </span>
        );
      case 'sqrt':
        return (
          <span key={key} className="inline-flex items-baseline">
            {node.index && node.index.length > 0 && (
              <sup className="text-[0.68em] leading-none mr-[1px]">
                {renderMathNodes(node.index, `${key}_i`)}
              </sup>
            )}
            <span aria-hidden="true">√</span>
            <span className="border-t border-current px-0.5 leading-tight">
              {renderMathNodes(node.content, `${key}_c`)}
            </span>
          </span>
        );
      case 'vec': {
        const arrowChar =
          node.arrow === 'left' ? '←' : node.arrow === 'both' ? '↔' : '→';
        return (
          <span key={key} className="relative inline-block pt-[0.18em]">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-[0.42em] left-0 right-0 text-center text-[0.62em] leading-none select-none"
            >
              {arrowChar}
            </span>
            {renderMathNodes(node.content, `${key}_v`)}
          </span>
        );
      }
      case 'overline':
        return (
          <span key={key} className="border-t border-current leading-tight inline-block">
            {renderMathNodes(node.content, `${key}_o`)}
          </span>
        );
      case 'underline':
        return (
          <span key={key} className="border-b border-current leading-tight inline-block">
            {renderMathNodes(node.content, `${key}_u`)}
          </span>
        );
      case 'hat': {
        const accentChar = node.accent || '^';
        return (
          <span key={key} className="relative inline-block pt-[0.2em]">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-[0.38em] left-0 right-0 text-center text-[0.68em] leading-none select-none"
            >
              {accentChar}
            </span>
            {renderMathNodes(node.content, `${key}_h`)}
          </span>
        );
      }
      case 'boxed':
        return (
          <span
            key={key}
            className="inline-block border border-current rounded px-1.5 py-0.5 mx-0.5"
          >
            {renderMathNodes(node.content, `${key}_bx`)}
          </span>
        );
      case 'cancel':
        return (
          <span key={key} className="line-through decoration-current">
            {renderMathNodes(node.content, `${key}_cx`)}
          </span>
        );
      case 'overset':
        return (
          <span
            key={key}
            className="inline-flex flex-col items-center align-middle text-center leading-none mx-0.5"
          >
            {node.top && node.top.length > 0 && (
              <span className="text-[0.68em] leading-none mb-[1px]">
                {renderMathNodes(node.top, `${key}_ot`)}
              </span>
            )}
            <span className="leading-none">
              {renderMathNodes(node.base, `${key}_ob`)}
            </span>
            {node.bottom && node.bottom.length > 0 && (
              <span className="text-[0.68em] leading-none mt-[1px]">
                {renderMathNodes(node.bottom, `${key}_od`)}
              </span>
            )}
          </span>
        );
      case 'cases':
        return (
          <span
            key={key}
            className="inline-flex items-center align-middle mx-1 my-0.5"
          >
            <span aria-hidden="true" className="text-[1.45em] leading-none mr-1 font-light">
              {'{'}
            </span>
            <span className="inline-flex flex-col items-start text-left leading-[1.35] border-l border-current/30 pl-1.5 space-y-0.5">
              {node.rows.map((row, rIdx) => (
                <span key={`${key}_r_${rIdx}`}>
                  {renderMathNodes(row, `${key}_r_${rIdx}`)}
                </span>
              ))}
            </span>
          </span>
        );
      case 'matrix': {
        const leftDelim =
          node.bracket === 'paren'
            ? '('
            : node.bracket === 'bracket'
            ? '['
            : node.bracket === 'pipe'
            ? '|'
            : '';
        const rightDelim =
          node.bracket === 'paren'
            ? ')'
            : node.bracket === 'bracket'
            ? ']'
            : node.bracket === 'pipe'
            ? '|'
            : '';
        return (
          <span
            key={key}
            className="inline-flex items-center align-middle mx-1 my-0.5"
          >
            {leftDelim && (
              <span aria-hidden="true" className="text-[1.3em] leading-none mr-1">
                {leftDelim}
              </span>
            )}
            <span className="inline-flex flex-col items-start text-left leading-[1.35] space-y-0.5">
              {node.rows.map((row, rIdx) => (
                <span key={`${key}_mr_${rIdx}`}>
                  {renderMathNodes(row, `${key}_mr_${rIdx}`)}
                </span>
              ))}
            </span>
            {rightDelim && (
              <span aria-hidden="true" className="text-[1.3em] leading-none ml-1">
                {rightDelim}
              </span>
            )}
          </span>
        );
      }
    }
  });
}

/**
 * Renders Vietnamese academic prose mixed with math, physics, and chemistry notation
 * (`F_{AB}`, `v_0`, `m/s^2`, `\vec{F}`, `\frac{a}{b}`, `\sqrt{2gh}`, `\Delta`, `$...$`)
 * using clean native typographic `<sub>`, `<sup>`, fractions, roots, vectors, hats, and systems of equations.
 */
export const MathText: React.FC<MathTextProps> = ({ text, className }) => {
  const nodes = useMemo(() => parseMathNotation(text || ''), [text]);
  if (!text) return null;
  if (className) {
    return <span className={className}>{renderMathNodes(nodes, 'm')}</span>;
  }
  return <>{renderMathNodes(nodes, 'm')}</>;
};
