'use strict';

const REQUIRED_FIELDS = ['key', 'type', 'source', 'component', 'title'];

function normalizeEvent(input) {
  if (!input || typeof input !== 'object') return null;

  return {
    key: input.key || '',
    type: input.type || '',
    source: input.source || '',
    component: input.component || '',
    title: input.title || '',
    data: input.data || {},
    tags: Array.isArray(input.tags) ? input.tags : [],
    occurredAt: typeof input.occurredAt === 'number' ? input.occurredAt : Date.now(),
    status: input.status || 'active'
  };
}

function validateEvent(event) {
  if (!event) return { valid: false, reason: 'event is null' };

  for (const field of REQUIRED_FIELDS) {
    if (!event[field] || typeof event[field] !== 'string' || event[field].trim() === '') {
      return { valid: false, reason: `missing or empty field: ${field}` };
    }
  }

  return { valid: true, reason: null };
}

module.exports = { normalizeEvent, validateEvent };
