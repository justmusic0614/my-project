import React from 'react';

// Lightweight markdown renderer (no dependencies)
function parseMarkdown(md) {
  if (!md) return '';

  let html = md
    // Code blocks (```)
    .replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code (`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Headers (# ## ###)
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold (**text**)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // Italic (*text*)
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // Links ([text](url))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Horizontal rule (---)
    .replace(/^---$/gim, '<hr />')
    // Unordered lists (- item)
    .replace(/^\- (.*)$/gim, '<li>$1</li>')
    // Tables (| col | col |)
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split('|').filter(Boolean).map(c => c.trim());
      return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    })
    // Paragraphs (double newline)
    .replace(/\n\n/g, '</p><p>');

  // Wrap lists
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Wrap tables
  html = html.replace(/(<tr>.*<\/tr>)/s, '<table>$1</table>');

  return `<div class="markdown-content"><p>${html}</p></div>`;
}

export default function MarkdownViewer({ content, onDownload }) {
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agent-spec.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="markdown-viewer">
      <div className="markdown-toolbar">
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
          📋 Agent Specification
        </h3>
        <button
          className="btn btn-primary"
          style={{ fontSize: '12px', padding: '6px 12px' }}
          onClick={onDownload || handleDownload}
        >
          ⬇ Download Markdown
        </button>
      </div>
      <div
        className="markdown-body"
        dangerouslySetInnerHTML={{ __html: parseMarkdown(content) }}
      />
    </div>
  );
}
