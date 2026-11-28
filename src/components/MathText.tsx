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
      case 'vec':
        return (
          <span key={key} className="relative inline-block pt-[0.18em]">
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-[0.42em] left-0 right-0 text-center text-[0.62em] leading-none select-none"
            >
              →
            </span>
            {renderMathNodes(node.content, `${key}_v`)}
          </span>
        );
      case 'overline':
        return (
          <span key={key} className="border-t border-current leading-tight inline-block">
            {renderMathNodes(node.content, `${key}_o`)}
          </span>
        );
    }
  });
}

/**
 * Renders Vietnamese academic prose mixed with math, physics, and chemistry notation
 * (`F_{AB}`, `v_0`, `m/s^2`, `\vec{F}`, `\frac{a}{b}`, `\sqrt{2gh}`, `\Delta`, `$...$`)
 * using clean native typographic `<sub>`, `<sup>`, fractions, roots, and vectors.
 */
export const MathText: React.FC<MathTextProps> = ({ text, className }) => {
  const nodes = useMemo(() => parseMathNotation(text || ''), [text]);
  if (!text) return null;
  if (className) {
    return <span className={className}>{renderMathNodes(nodes, 'm')}</span>;
  }
  return <>{renderMathNodes(nodes, 'm')}</>;
};
