import React, { useState, useEffect } from 'react';
import { api } from '../../api/client';

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
    padding: '12px 16px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)'
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    whiteSpace: 'nowrap'
  },
  select: {
    flex: 1,
    padding: '6px 10px',
    fontSize: '13px',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    outline: 'none'
  },
  status: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap'
  },
  statusSaving: {
    color: 'var(--accent-blue)'
  },
  statusSaved: {
    color: 'var(--accent-green)'
  },
  statusError: {
    color: 'var(--accent-red)'
  },
  ollamaStatus: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '20px',
    padding: '8px 16px',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    fontSize: '12px'
  },
  ollamaLabel: {
    fontWeight: 600,
    color: 'var(--text-secondary)'
  },
  ollamaAvailable: {
    color: 'var(--accent-green)',
    fontWeight: 600
  },
  ollamaUnavailable: {
    color: 'var(--text-muted)'
  },
  ollamaModels: {
    marginLeft: '6px',
    color: 'var(--text-secondary)',
    fontWeight: 'normal'
  }
};

export default function LLMSelector() {
  const [config, setConfig] = useState(null);
  const [currentModel, setCurrentModel] = useState('');
  const [status, setStatus] = useState(''); // '', 'saving', 'saved', 'error'
  const [error, setError] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const data = await api.getLLMConfig();
      setConfig(data);
      setCurrentModel(data.currentModel);
    } catch (err) {
      console.error('Failed to load LLM config:', err);
      setError('Failed to load configuration');
    }
  };

  const handleChange = async (e) => {
    const newModel = e.target.value;
    const previousModel = currentModel; // 儲存當前模型以便恢復
    setCurrentModel(newModel);
    setStatus('saving');
    setError('');

    try {
      await api.updateLLMModel(newModel);
      // 更新成功，同步 config
      setConfig(prev => ({ ...prev, currentModel: newModel }));
      setStatus('saved');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      console.error('Failed to update model:', err);
      setStatus('error');
      setError(err.message || 'Failed to update model');
      // Revert to previous model
      setCurrentModel(previousModel);
      setTimeout(() => {
        setStatus('');
        setError('');
      }, 3000);
    }
  };

  if (!config) {
    return (
      <div style={styles.container}>
        <div style={styles.label}>Loading...</div>
      </div>
    );
  }

  // 按 provider 分組模型
  const groupedModels = config.models.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {});

  const providerLabels = {
    anthropic: 'Claude (Anthropic)',
    openai: 'OpenAI',
    ollama: 'Ollama (Local)'
  };

  const getStatusStyle = () => {
    if (status === 'saving') return styles.statusSaving;
    if (status === 'saved') return styles.statusSaved;
    if (status === 'error') return styles.statusError;
    return styles.status;
  };

  const getStatusText = () => {
    if (status === 'saving') return 'Saving...';
    if (status === 'saved') return 'Saved ✓';
    if (status === 'error') return error || 'Error';
    return '';
  };

  return (
    <>
      <div style={styles.container}>
        <label style={styles.label}>AI Model:</label>
        <select
          style={styles.select}
          value={currentModel}
          onChange={handleChange}
          disabled={status === 'saving'}
        >
          {Object.entries(groupedModels).map(([provider, models]) => (
            <optgroup key={provider} label={providerLabels[provider] || provider}>
              {models.map(model => {
                const isAvailable = config.apiKeysAvailable[model.provider];
                const label = `${model.name} (${model.costTier})`;
                const fullLabel = isAvailable ? label : `${label} - API key missing`;

                return (
                  <option
                    key={model.id}
                    value={model.id}
                    disabled={!isAvailable}
                  >
                    {fullLabel}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </select>
        <span style={{ ...styles.status, ...getStatusStyle() }}>
          {getStatusText()}
        </span>
      </div>

      {/* Ollama Status Indicator - only show when available */}
      {config.apiKeysAvailable?.ollama && (
        <div style={styles.ollamaStatus}>
          <span style={styles.ollamaLabel}>Ollama:</span>
          <span style={styles.ollamaAvailable}>
            ✓ Running
            {config.ollamaInstalledModels && config.ollamaInstalledModels.length > 0 && (
              <span style={styles.ollamaModels}>
                ({config.ollamaInstalledModels.length} model{config.ollamaInstalledModels.length !== 1 ? 's' : ''})
              </span>
            )}
          </span>
        </div>
      )}
    </>
  );
}
