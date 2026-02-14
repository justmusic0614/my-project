import { useState, useEffect } from 'react';
import { api } from '../../api/client';

export default function ABTestForm({ onRun, loading }) {
  const [prompt, setPrompt] = useState('');
  const [selectedModels, setSelectedModels] = useState([]);
  const [maxTokens, setMaxTokens] = useState(800);
  const [availableModels, setAvailableModels] = useState([]);

  useEffect(() => {
    loadModels();
  }, []);

  async function loadModels() {
    try {
      const config = await api.getLLMConfig();
      setAvailableModels(config.availableModels || []);

      // 預設選擇前兩個模型
      if (config.availableModels && config.availableModels.length >= 2) {
        setSelectedModels([
          config.availableModels[0].id,
          config.availableModels[1].id
        ]);
      }
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  }

  function toggleModel(modelId) {
    if (selectedModels.includes(modelId)) {
      setSelectedModels(selectedModels.filter(id => id !== modelId));
    } else {
      if (selectedModels.length < 4) {
        setSelectedModels([...selectedModels, modelId]);
      }
    }
  }

  function handleSubmit(e) {
    e.preventDefault();

    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }

    if (selectedModels.length < 2) {
      alert('Please select at least 2 models');
      return;
    }

    onRun(prompt, selectedModels, maxTokens);
  }

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      {/* Prompt */}
      <div style={styles.field}>
        <label style={styles.label}>
          Test Prompt
          <span style={styles.required}>*</span>
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt to test across different models..."
          style={styles.textarea}
          rows={8}
          disabled={loading}
        />
        <div style={styles.hint}>
          {prompt.length} characters
        </div>
      </div>

      {/* Model Selection */}
      <div style={styles.field}>
        <label style={styles.label}>
          Select Models (2-4)
          <span style={styles.required}>*</span>
        </label>
        <div style={styles.modelGrid}>
          {availableModels.map((model) => (
            <div
              key={model.id}
              onClick={() => !loading && toggleModel(model.id)}
              style={{
                ...styles.modelCard,
                ...(selectedModels.includes(model.id) ? styles.modelCardSelected : {}),
                ...(loading ? styles.modelCardDisabled : {})
              }}
            >
              <div style={styles.modelHeader}>
                <input
                  type="checkbox"
                  checked={selectedModels.includes(model.id)}
                  onChange={() => {}}
                  style={styles.checkbox}
                />
                <span style={styles.modelName}>{model.name}</span>
              </div>
              <div style={styles.modelMeta}>
                <span style={styles.provider}>{model.provider}</span>
                <span style={styles.cost}>{model.costTier}</span>
              </div>
              <div style={styles.modelDesc}>{model.description}</div>
            </div>
          ))}
        </div>
        <div style={styles.hint}>
          {selectedModels.length} model{selectedModels.length !== 1 ? 's' : ''} selected
        </div>
      </div>

      {/* Max Tokens */}
      <div style={styles.field}>
        <label style={styles.label}>
          Max Tokens: {maxTokens}
        </label>
        <input
          type="range"
          min={100}
          max={2000}
          step={100}
          value={maxTokens}
          onChange={(e) => setMaxTokens(parseInt(e.target.value))}
          style={styles.slider}
          disabled={loading}
        />
        <div style={styles.sliderMarks}>
          <span>100</span>
          <span>2000</span>
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || selectedModels.length < 2 || !prompt.trim()}
        style={{
          ...styles.submitButton,
          ...(loading || selectedModels.length < 2 || !prompt.trim() ? styles.submitButtonDisabled : {})
        }}
      >
        {loading ? '⏳ Running Test...' : '🚀 Run A/B Test'}
      </button>
    </form>
  );
}

const styles = {
  form: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '24px',
    maxWidth: '900px'
  },
  field: {
    marginBottom: '24px'
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  required: {
    color: 'var(--accent-red)',
    marginLeft: '4px'
  },
  textarea: {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    lineHeight: '1.5',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
    resize: 'vertical'
  },
  hint: {
    marginTop: '4px',
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  modelGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px'
  },
  modelCard: {
    padding: '12px',
    border: '2px solid var(--border)',
    borderRadius: '8px',
    background: 'var(--bg-tertiary)',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  modelCardSelected: {
    borderColor: 'var(--accent-blue)',
    background: 'var(--bg-primary)'
  },
  modelCardDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  },
  modelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px'
  },
  checkbox: {
    cursor: 'pointer'
  },
  modelName: {
    fontSize: '13px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  modelMeta: {
    display: 'flex',
    gap: '8px',
    marginBottom: '6px'
  },
  provider: {
    fontSize: '10px',
    textTransform: 'uppercase',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    background: 'var(--bg-secondary)',
    padding: '2px 6px',
    borderRadius: '3px'
  },
  cost: {
    fontSize: '10px',
    textTransform: 'uppercase',
    fontWeight: '600',
    color: 'var(--accent-green)',
    background: 'var(--bg-secondary)',
    padding: '2px 6px',
    borderRadius: '3px'
  },
  modelDesc: {
    fontSize: '11px',
    color: 'var(--text-secondary)',
    lineHeight: '1.4'
  },
  slider: {
    width: '100%',
    cursor: 'pointer'
  },
  sliderMarks: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '4px'
  },
  submitButton: {
    width: '100%',
    padding: '14px',
    fontSize: '15px',
    fontWeight: '600',
    color: 'white',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    transition: 'opacity 0.2s'
  },
  submitButtonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed'
  }
};
