export function formatValidationProof(data: any): string {
  const lines: string[] = [];

  function formatValue(val: any, indent: string, key?: string): void {
    if (Array.isArray(val)) {
      if (val.every(v => typeof v === 'number')) {
        lines.push(`${indent}${key ? key + ': ' : ''}[${val.join(', ')}]`);
      } else if (val.every(v => typeof v === 'object' && v !== null && ('hash' in v || 'isRightSibling' in v))) {
        lines.push(`${indent}${key ? key + ': ' : ''}[`);
        val.forEach((item, i) => {
          lines.push(`${indent}  { hash: [${item.hash.join(', ')}], isRightSibling: ${item.isRightSibling} }${i < val.length - 1 ? ',' : ''}`);
        });
        lines.push(`${indent}]`);
      } else {
        lines.push(`${indent}${key ? key + ': ' : ''}${JSON.stringify(val)}`);
      }
    } else if (typeof val === 'object' && val !== null) {
      lines.push(`${indent}${key ? key + ': ' : ''}{`);
      Object.entries(val).forEach(([k, v], idx, arr) => {
        formatValue(v, `${indent}  `, k);
        if (idx < arr.length - 1) lines[lines.length - 1] += ',';
      });
      lines.push(`${indent}}`);
    } else {
      lines.push(`${indent}${key ? key + ': ' : ''}${JSON.stringify(val)}`);
    }
  }

  formatValue(data, '');
  return lines.join('\n');
}
