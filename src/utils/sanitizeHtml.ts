const ALLOWED_TAGS = new Set([
  'a', 'b', 'br', 'div', 'em', 'i', 'li', 'ol', 'p', 'span', 'strong', 'table',
  'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
const ALLOWED_ATTRIBUTES = new Set(['href', 'title', 'colspan', 'rowspan']);

function safeHref(value: string) {
  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Sanitize stored email HTML before rendering it in the application shell. */
export function sanitizeHtml(value: string) {
  const parsed = new DOMParser().parseFromString(value || '', 'text/html');
  const output = document.createElement('div');

  const appendNode = (node: Node, parent: HTMLElement) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent || ''));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tagName = element.tagName.toLowerCase();
    if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math'].includes(tagName)) return;

    if (!ALLOWED_TAGS.has(tagName)) {
      Array.from(element.childNodes).forEach(child => appendNode(child, parent));
      return;
    }

    const cleanElement = document.createElement(tagName);
    Array.from(element.attributes).forEach(attribute => {
      const name = attribute.name.toLowerCase();
      if (!ALLOWED_ATTRIBUTES.has(name) || name.startsWith('on')) return;
      if (name === 'href') {
        const href = safeHref(attribute.value);
        if (href) cleanElement.setAttribute('href', href);
      } else if (/^\d+$/.test(attribute.value) || name === 'title') {
        cleanElement.setAttribute(name, attribute.value.slice(0, 200));
      }
    });
    if (tagName === 'a' && cleanElement.hasAttribute('href')) {
      cleanElement.setAttribute('target', '_blank');
      cleanElement.setAttribute('rel', 'noopener noreferrer');
    }
    Array.from(element.childNodes).forEach(child => appendNode(child, cleanElement));
    parent.appendChild(cleanElement);
  };

  Array.from(parsed.body.childNodes).forEach(node => appendNode(node, output));
  return output.innerHTML;
}
