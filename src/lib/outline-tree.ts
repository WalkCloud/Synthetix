interface OutlineSection {
  num: string;
  title: string;
  description?: string;
  keyPoints?: string[];
  estimatedWords?: number;
  writingRequirements?: string;
  retrievalQuery?: string;
  referenceHints?: string[];
  children?: OutlineSection[];
}

export function deepClone(sections: OutlineSection[]): OutlineSection[] {
  return sections.map(s => ({ ...s, children: s.children ? deepClone(s.children) : undefined }));
}

export function getByPath(sections: OutlineSection[], path: number[]): OutlineSection | undefined {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path;
  const node = sections[head];
  if (!node) return undefined;
  if (rest.length === 0) return node;
  return getByPath(node.children || [], rest);
}

export function updateByPath(sections: OutlineSection[], path: number[], updater: (s: OutlineSection) => OutlineSection): OutlineSection[] {
  if (path.length === 0) return sections;
  const [head, ...rest] = path;
  return sections.map((s, i) => {
    if (i !== head) return s;
    if (rest.length === 0) return updater(s);
    return { ...s, children: updateByPath(s.children || [], rest, updater) };
  });
}

export function removeByPath(sections: OutlineSection[], path: number[]): OutlineSection[] {
  if (path.length === 0) return sections;
  const [head, ...rest] = path;
  if (rest.length === 0) return sections.filter((_, i) => i !== head);
  return sections.map((s, i) => {
    if (i !== head) return s;
    return { ...s, children: removeByPath(s.children || [], rest) };
  });
}

export function addChildAtPath(sections: OutlineSection[], path: number[], defaults: { num: string; title: string; estimatedWords: number }): OutlineSection[] {
  if (path.length === 0) {
    return [...sections, defaults];
  }
  const [head, ...rest] = path;
  return sections.map((s, i) => {
    if (i !== head) return s;
    if (rest.length === 0) {
      const children = [...(s.children || []), defaults];
      return { ...s, children };
    }
    return { ...s, children: addChildAtPath(s.children || [], rest, defaults) };
  });
}

export function renumberSections(sections: OutlineSection[], prefix = ""): OutlineSection[] {
  return sections.map((s, i) => {
    const num = prefix ? `${prefix}.${i + 1}` : String(i + 1);
    return { ...s, num, children: s.children ? renumberSections(s.children, num) : undefined };
  });
}

export function numForPath(sections: OutlineSection[], path: number[]): string {
  if (path.length === 0) return "";
  const [head, ...rest] = path;
  if (rest.length === 0) return String(head + 1);
  const parentNum = String(head + 1);
  const childNum = numForPath(sections[head]?.children || [], rest.map(r => r));
  return `${parentNum}.${childNum}`;
}

export type { OutlineSection };
