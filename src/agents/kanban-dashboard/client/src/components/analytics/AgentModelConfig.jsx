import { useState, useEffect } from 'react';
import { api } from '../../api/client';

export default function AgentModelConfig() {
  const [config, setConfig] = useState(null);
  const [agentModels, setAgentModels] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    loadConfig();
  }, []);

  async function loadConfig() {
    try {
      setLoading(true);
      const [agentData, llmConfig] = await Promise.all([
        api.getAgentModels(),
        api.getLLMConfig()
      ]);

      setConfig(llmConfig);
      setAgentModels(agentData.agentModels);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleModelChange(agentName, modelId) {
    setSaving(prev => ({ ...prev, [agentName]: true }));

    try {
      await api.updateAgentModel(agentName, modelId === 'default' ? null : modelId);
      setAgentModels(prev => {
        const updated = { ...prev };
        if (modelId === 'default') {
          delete updated[agentName];
        } else {
          updated[agentName] = modelId;
        }
        return updated;
      });

      // 顯示成功訊息
      setTimeout(() => {
        setSaving(prev => {
          const updated = { ...prev };
          delete updated[agentName];
          return updated;
        });
      }, 1000);
    } catch (err) {
      alert(`Failed to update ${agentName}: ${err.message}`);
      setSaving(prev => {
        const updated = { ...prev };
        delete updated[agentName];
        return updated;
      });
    }
  }

  if (loading) {
    return <div style={styles.loading}>Loading agent configurations...</div>;
  }

  if (error) {
    return <div style={styles.error}>Error: {error}</div>;
  }

  const agents = [
    { name: 'knowledge-digest', label: 'Knowledge Digest', description: '每天 00:00 UTC（長期知識累積）' },
    { name: 'market-digest', label: 'Market Digest', description: '每天 00:00 UTC（市場摘要）' },
    { name: 'deploy-monitor', label: 'Deploy Monitor', description: '每 30 分鐘（監控任務）' },
    { name: 'optimization-advisor', label: 'Optimization Advisor', description: '每 2 小時（系統優化建議）' },
    { name: 'security-patrol', label: 'Security Patrol', description: '每小時（安全巡查）' }
  ];

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>🤖 Agent Model Configuration</h2>
        <p style={styles.subtitle}>
          Configure different AI models for each agent. Agents without specific models will use the global default.
        </p>
      </div>

      <div style={styles.globalDefault}>
        <span style={styles.globalLabel}>Global Default:</span>
        <span style={styles.globalModel}>
          {config?.models.find(m => m.id === config.currentModel)?.name || config?.currentModel}
        </span>
      </div>

      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Agent</th>
            <th style={styles.th}>Description</th>
            <th style={styles.th}>Model</th>
            <th style={styles.th}>Status</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(agent => {
            const currentModelId = agentModels[agent.name] || config.currentModel;
            const isSaving = saving[agent.name];
            const isCustom = !!agentModels[agent.name];

            return (
              <tr key={agent.name} style={styles.tr}>
                <td style={styles.td}>
                  <div style={styles.agentName}>{agent.label}</div>
                </td>
                <td style={styles.td}>
                  <div style={styles.agentDesc}>{agent.description}</div>
                </td>
                <td style={styles.td}>
                  <select
                    value={agentModels[agent.name] || 'default'}
                    onChange={(e) => handleModelChange(agent.name, e.target.value)}
                    disabled={isSaving}
                    style={styles.select}
                  >
                    <option value="default">
                      Use Global Default ({config.models.find(m => m.id === config.currentModel)?.name})
                    </option>
                    <optgroup label="Claude (Anthropic)">
                      {config.models.filter(m => m.provider === 'anthropic').map(model => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.costTier})
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="OpenAI">
                      {config.models.filter(m => m.provider === 'openai').map(model => (
                        <option key={model.id} value={model.id}>
                          {model.name} ({model.costTier})
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </td>
                <td style={styles.td}>
                  {isSaving ? (
                    <span style={styles.statusSaving}>Saving...</span>
                  ) : isCustom ? (
                    <span style={styles.statusCustom}>Custom</span>
                  ) : (
                    <span style={styles.statusDefault}>Default</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles = {
  container: {
    padding: '24px',
    maxWidth: '1200px',
    margin: '0 auto'
  },
  header: {
    marginBottom: '24px'
  },
  title: {
    margin: '0 0 8px 0',
    fontSize: '24px',
    fontWeight: '700',
    color: 'var(--text-primary)'
  },
  subtitle: {
    margin: 0,
    fontSize: '14px',
    color: 'var(--text-secondary)'
  },
  globalDefault: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 16px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    marginBottom: '24px'
  },
  globalLabel: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-secondary)'
  },
  globalModel: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--accent-blue)'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    overflow: 'hidden'
  },
  th: {
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '12px',
    fontWeight: '600',
    textTransform: 'uppercase',
    color: 'var(--text-secondary)',
    background: 'var(--bg-secondary)',
    borderBottom: '1px solid var(--border)'
  },
  tr: {
    borderBottom: '1px solid var(--border)'
  },
  td: {
    padding: '12px 16px',
    fontSize: '13px',
    color: 'var(--text-primary)'
  },
  agentName: {
    fontWeight: '600'
  },
  agentDesc: {
    color: 'var(--text-secondary)',
    fontSize: '12px'
  },
  select: {
    width: '100%',
    padding: '6px 10px',
    fontSize: '13px',
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    cursor: 'pointer'
  },
  statusSaving: {
    color: 'var(--accent-blue)',
    fontSize: '12px',
    fontWeight: '600'
  },
  statusCustom: {
    color: 'var(--accent-green)',
    fontSize: '12px',
    fontWeight: '600'
  },
  statusDefault: {
    color: 'var(--text-muted)',
    fontSize: '12px'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '400px',
    color: 'var(--text-secondary)'
  },
  error: {
    padding: '24px',
    color: 'var(--accent-red)',
    textAlign: 'center'
  }
};
