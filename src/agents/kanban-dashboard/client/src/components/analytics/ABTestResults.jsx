import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';

export default function ABTestResults({ test, onRate, onNewTest }) {
  if (!test) return null;

  const successResults = test.results.filter(r => r.status === 'success');

  return (
    <div style={styles.container}>
      {/* Test Info */}
      <div style={styles.info}>
        <div style={styles.infoHeader}>
          <h3 style={styles.infoTitle}>Test #{test.id.slice(0, 8)}</h3>
          <span style={styles.timestamp}>
            {formatDistanceToNow(new Date(test.timestamp), { addSuffix: true })}
          </span>
        </div>
        <div style={styles.prompt}>
          <div style={styles.promptLabel}>Prompt:</div>
          <div style={styles.promptText}>{test.prompt}</div>
        </div>
        {test.winner && (
          <div style={styles.winner}>
            🏆 Winner: <code>{test.winner}</code>
          </div>
        )}
      </div>

      {/* Results Grid */}
      <div style={styles.resultsGrid}>
        {test.results.map((result, index) => (
          <ResultCard
            key={result.model}
            result={result}
            rank={index + 1}
            onRate={(rating) => onRate(result.model, rating)}
            isWinner={test.winner === result.model}
          />
        ))}
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        <button onClick={onNewTest} style={styles.newTestButton}>
          ✨ New Test
        </button>
      </div>
    </div>
  );
}

function ResultCard({ result, rank, onRate, isWinner }) {
  const [hoveredStar, setHoveredStar] = useState(0);

  function handleStarClick(rating) {
    onRate(rating);
  }

  return (
    <div style={{
      ...styles.card,
      ...(isWinner ? styles.cardWinner : {}),
      ...(result.status === 'error' ? styles.cardError : {})
    }}>
      {/* Header */}
      <div style={styles.cardHeader}>
        <div style={styles.cardRank}>#{rank}</div>
        <code style={styles.cardModel}>{result.model}</code>
        {isWinner && <span style={styles.winnerBadge}>🏆 Winner</span>}
      </div>

      {/* Status */}
      {result.status === 'error' ? (
        <div style={styles.error}>
          <div style={styles.errorIcon}>⚠️</div>
          <div style={styles.errorMessage}>{result.error}</div>
        </div>
      ) : (
        <>
          {/* Output */}
          <div style={styles.output}>
            <div style={styles.outputLabel}>Output:</div>
            <div style={styles.outputText}>{result.output}</div>
          </div>

          {/* Stats */}
          <div style={styles.stats}>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Tokens:</span>
              <span style={styles.statValue}>
                {result.usage.inputTokens}→{result.usage.outputTokens}
              </span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Cost:</span>
              <span style={{ ...styles.statValue, color: 'var(--accent-red)' }}>
                ${result.cost.toFixed(6)}
              </span>
            </div>
            <div style={styles.stat}>
              <span style={styles.statLabel}>Latency:</span>
              <span style={styles.statValue}>{result.latency}ms</span>
            </div>
          </div>

          {/* Rating */}
          <div style={styles.rating}>
            <div style={styles.ratingLabel}>Rate this response:</div>
            <div style={styles.stars}>
              {[1, 2, 3, 4, 5].map((star) => (
                <span
                  key={star}
                  onClick={() => handleStarClick(star)}
                  onMouseEnter={() => setHoveredStar(star)}
                  onMouseLeave={() => setHoveredStar(0)}
                  style={{
                    ...styles.star,
                    ...(star <= (hoveredStar || result.rating || 0) ? styles.starActive : {})
                  }}
                >
                  ★
                </span>
              ))}
            </div>
            {result.rating !== null && (
              <div style={styles.ratingValue}>
                Your rating: {result.rating}/5
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  },
  info: {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px'
  },
  infoHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px'
  },
  infoTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '600',
    color: 'var(--text-primary)'
  },
  timestamp: {
    fontSize: '12px',
    color: 'var(--text-muted)'
  },
  prompt: {
    marginBottom: '12px'
  },
  promptLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    marginBottom: '4px'
  },
  promptText: {
    fontSize: '14px',
    color: 'var(--text-primary)',
    lineHeight: '1.6',
    padding: '12px',
    background: 'var(--bg-tertiary)',
    borderRadius: '6px',
    whiteSpace: 'pre-wrap'
  },
  winner: {
    padding: '8px 12px',
    background: 'var(--accent-green)',
    color: 'white',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600'
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '20px'
  },
  card: {
    background: 'var(--bg-secondary)',
    border: '2px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  cardWinner: {
    borderColor: 'var(--accent-green)',
    background: 'var(--bg-primary)'
  },
  cardError: {
    borderColor: 'var(--accent-red)'
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  cardRank: {
    fontSize: '16px',
    fontWeight: '700',
    color: 'var(--text-secondary)'
  },
  cardModel: {
    fontSize: '13px',
    fontFamily: 'monospace',
    fontWeight: '600',
    color: 'var(--text-primary)',
    flex: 1
  },
  winnerBadge: {
    fontSize: '11px',
    padding: '4px 8px',
    background: 'var(--accent-green)',
    color: 'white',
    borderRadius: '12px',
    fontWeight: '600'
  },
  output: {},
  outputLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    marginBottom: '6px'
  },
  outputText: {
    fontSize: '13px',
    lineHeight: '1.6',
    color: 'var(--text-primary)',
    padding: '12px',
    background: 'var(--bg-tertiary)',
    borderRadius: '6px',
    whiteSpace: 'pre-wrap',
    maxHeight: '300px',
    overflowY: 'auto'
  },
  stats: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap'
  },
  stat: {
    display: 'flex',
    gap: '6px',
    fontSize: '12px'
  },
  statLabel: {
    color: 'var(--text-muted)',
    fontWeight: '600'
  },
  statValue: {
    color: 'var(--text-primary)',
    fontFamily: 'monospace'
  },
  rating: {
    paddingTop: '12px',
    borderTop: '1px solid var(--border)'
  },
  ratingLabel: {
    fontSize: '12px',
    fontWeight: '600',
    color: 'var(--text-secondary)',
    marginBottom: '8px'
  },
  stars: {
    display: 'flex',
    gap: '4px'
  },
  star: {
    fontSize: '24px',
    color: 'var(--border)',
    cursor: 'pointer',
    transition: 'all 0.2s',
    userSelect: 'none'
  },
  starActive: {
    color: 'var(--accent-yellow)'
  },
  ratingValue: {
    marginTop: '6px',
    fontSize: '11px',
    color: 'var(--text-muted)'
  },
  error: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '20px'
  },
  errorIcon: {
    fontSize: '32px'
  },
  errorMessage: {
    fontSize: '13px',
    color: 'var(--accent-red)',
    textAlign: 'center'
  },
  actions: {
    display: 'flex',
    justifyContent: 'center',
    paddingTop: '16px'
  },
  newTestButton: {
    padding: '12px 32px',
    fontSize: '14px',
    fontWeight: '600',
    color: 'white',
    background: 'var(--accent-blue)',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer'
  }
};
