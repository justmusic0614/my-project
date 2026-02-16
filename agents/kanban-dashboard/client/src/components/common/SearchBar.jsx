import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';

const TYPE_ICONS = { task: '📋', agent: '🤖', notification: '🔔' };
const TYPE_COLORS = { task: '#3b82f6', agent: '#10b981', notification: '#f59e0b' };

export default function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(-1);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const debounceRef = useRef(null);

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); return; }
    try {
      const data = await api.search(q);
      setResults(data.results || []);
      setSelected(-1);
    } catch (_) { setResults([]); }
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(query), 250);
    return () => clearTimeout(debounceRef.current);
  }, [query, doSearch]);

  // Keyboard shortcut: Ctrl+K or Cmd+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected(prev => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected(prev => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter' && selected >= 0) {
      const item = results[selected];
      if (item?.url) navigate(item.url);
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        background: 'var(--bg-secondary, #f3f4f6)', borderRadius: '8px',
        padding: '6px 12px', width: '280px'
      }}>
        <span style={{ color: '#9ca3af', fontSize: '14px' }}>&#128269;</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 200)}
          onKeyDown={handleKeyDown}
          placeholder="Search... (Ctrl+K)"
          style={{
            border: 'none', background: 'transparent', outline: 'none',
            fontSize: '14px', width: '100%', color: 'var(--text-primary, #1f2937)'
          }}
        />
        <kbd style={{
          fontSize: '11px', padding: '1px 5px', borderRadius: '3px',
          background: '#e5e7eb', color: '#6b7280', border: '1px solid #d1d5db'
        }}>⌘K</kbd>
      </div>

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          marginTop: '4px', background: 'white', borderRadius: '8px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.15)', zIndex: 1000,
          maxHeight: '320px', overflow: 'auto', border: '1px solid #e5e7eb'
        }}>
          {results.map((item, i) => (
            <div
              key={`${item.type}-${item.id}`}
              onClick={() => { navigate(item.url); setOpen(false); setQuery(''); }}
              style={{
                padding: '10px 14px', cursor: 'pointer', display: 'flex',
                alignItems: 'center', gap: '10px',
                background: selected === i ? '#f3f4f6' : 'transparent',
                borderBottom: i < results.length - 1 ? '1px solid #f3f4f6' : 'none'
              }}
            >
              <span style={{ fontSize: '16px' }}>{TYPE_ICONS[item.type]}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '14px', fontWeight: 500, color: '#1f2937',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}>{item.title}</div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>{item.subtitle}</div>
              </div>
              <span style={{
                fontSize: '11px', padding: '2px 6px', borderRadius: '4px',
                background: TYPE_COLORS[item.type] + '20', color: TYPE_COLORS[item.type]
              }}>{item.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
