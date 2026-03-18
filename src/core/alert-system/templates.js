'use strict';

function buildFooter(source, severity, key) {
  return `[${source}][${severity}][${key}]`;
}

function renderAlertTemplate(payload) {
  const lines = [];

  // 標題 + 次數/持續時間
  if (payload.count > 1 && payload.durationText) {
    lines.push(`${payload.title} 連續 ${payload.count} 次（持續 ${payload.durationText}）。`);
  } else if (payload.count > 1) {
    lines.push(`${payload.title}（已發生 ${payload.count} 次）。`);
  } else {
    lines.push(`${payload.title}。`);
  }

  // 細節
  if (payload.details && payload.details.length > 0) {
    lines.push(payload.details.join('；') + '。');
  }

  // 建議
  if (payload.actionHint) {
    lines.push(payload.actionHint);
  }

  // footer
  const footer = payload.footer || buildFooter(payload.source, payload.severity, payload.eventKey);
  lines.push('');
  lines.push(footer);

  return lines.join('\n');
}

function renderRecoveryTemplate(payload) {
  const lines = [];

  if (payload.resolveMode === 'hard') {
    lines.push(`${payload.title} 已恢復正常（曾連續 ${payload.count} 次，持續 ${payload.durationText || '未知'}）。`);
  } else {
    lines.push(`${payload.title} 似乎已恢復。`);
  }

  const footer = payload.footer || buildFooter(payload.source, 'RESOLVED', payload.eventKey);
  lines.push('');
  lines.push(footer);

  return lines.join('\n');
}

module.exports = { renderAlertTemplate, renderRecoveryTemplate, buildFooter };
