export const varsOf = (content) => [...new Set([...JSON.stringify(content).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((x) => x[1]))];
export const renderText = (s, data = {}) => String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => data[k] ?? `⟨missing: ${k}⟩`);
export const renderContent = (content, data = {}) =>
  Object.fromEntries(Object.entries(content ?? {}).map(([ch, v]) => [ch, {
    ...v, subject: v.subject ? renderText(v.subject, data) : undefined, body: renderText(v.body, data),
    header: v.header ? renderText(v.header, data) : undefined, footer: v.footer ? renderText(v.footer, data) : undefined,
  }]));
