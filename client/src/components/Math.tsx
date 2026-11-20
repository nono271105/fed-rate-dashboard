import katex from "katex";

export function MathBlock({ formula }: { formula: string }) {
  const html = katex.renderToString(formula, {
    displayMode: true,
    throwOnError: false,
  });
  return <div className="math-block" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathInline({ formula }: { formula: string }) {
  const html = katex.renderToString(formula, {
    displayMode: false,
    throwOnError: false,
  });
  return <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
}
