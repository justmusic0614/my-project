const BASE_URL = '';

export async function apiFetch(path, options = {}) {
  const { body, method = 'GET', ...rest } = options;
  const config = { method, ...rest };

  if (body) {
    config.headers = { 'Content-Type': 'application/json', ...rest.headers };
    config.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, config);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || data.message || `API error: ${res.status}`);
  }

  return data;
}

export const api = {
  // Tasks
  getTasks: (params) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(`/api/tasks${qs ? '?' + qs : ''}`);
  },
  getTask: (id) => apiFetch(`/api/tasks/${id}`),
  createTask: (data) => apiFetch('/api/tasks', { method: 'POST', body: data }),
  updateTask: (id, data) => apiFetch(`/api/tasks/${id}`, { method: 'PUT', body: data }),
  deleteTask: (id, hard) => apiFetch(`/api/tasks/${id}${hard ? '?hard=true' : ''}`, { method: 'DELETE' }),
  moveTask: (id, column, order) => apiFetch(`/api/tasks/${id}/move`, { method: 'POST', body: { column, order } }),
  addComment: (id, text, parentId) => apiFetch(`/api/tasks/${id}/comments`, { method: 'POST', body: { text, parentId } }),

  // Agents
  getAgentsStatus: () => apiFetch('/api/agents/status'),
  getAgentSchedule: (week) => apiFetch(`/api/agents/schedule${week ? '?week=' + week : ''}`),
  getAgent: (name) => apiFetch(`/api/agents/${name}`),
  getAgentLogs: (name, lines) => apiFetch(`/api/agents/${name}/logs${lines ? '?lines=' + lines : ''}`),

  // Dashboard
  getSummary: () => apiFetch('/api/dashboard/summary'),

  // Notifications
  getNotifications: (unread) => apiFetch(`/api/notifications${unread ? '?unread=true' : ''}`),
  markRead: (id) => apiFetch(`/api/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () => apiFetch('/api/notifications/read-all', { method: 'PUT' }),

  // LLM Config
  getLLMConfig: () => apiFetch('/api/llm-config'),
  updateLLMModel: (modelId) => apiFetch('/api/llm-config/model', { method: 'PUT', body: { modelId } }),

  // Agent Models
  getAgentModels: () => apiFetch('/api/llm-config/agents'),
  updateAgentModel: (agentName, modelId) => apiFetch(`/api/llm-config/agents/${agentName}`, { method: 'PUT', body: { modelId } }),

  // API Usage (Cost Tracking)
  getUsageSummary: () => apiFetch('/api/api-usage/summary'),
  getDailyUsage: (days = 7) => apiFetch(`/api/api-usage/daily?days=${days}`),
  getModelComparison: () => apiFetch('/api/api-usage/by-model'),
  getRecentCalls: (limit = 50, offset = 0) => apiFetch(`/api/api-usage/calls?limit=${limit}&offset=${offset}`),

  // A/B Testing
  runABTest: (prompt, models, maxTokens = 800) => apiFetch('/api/ab-test/run', { method: 'POST', body: { prompt, models, maxTokens } }),
  getABTestHistory: (limit = 50, offset = 0) => apiFetch(`/api/ab-test/history?limit=${limit}&offset=${offset}`),
  getABTest: (id) => apiFetch(`/api/ab-test/${id}`),
  rateABTest: (id, modelId, rating) => apiFetch(`/api/ab-test/${id}/rate`, { method: 'PUT', body: { modelId, rating } }),
  getLeaderboard: () => apiFetch('/api/ab-test/stats/leaderboard'),
};
