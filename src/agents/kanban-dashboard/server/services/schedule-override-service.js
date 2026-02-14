const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '../../data');
const OVERRIDES_FILE = path.join(DATA_DIR, 'schedule-overrides.json');
const EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function readOverrides() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(OVERRIDES_FILE)) {
    fs.writeFileSync(OVERRIDES_FILE, '[]', 'utf8');
    return [];
  }
  return JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
}

function writeOverrides(overrides) {
  // Auto-clean expired overrides (>24hr)
  const now = Date.now();
  const valid = overrides.filter(o => now - new Date(o.createdAt).getTime() < EXPIRY_MS);
  fs.writeFileSync(OVERRIDES_FILE, JSON.stringify(valid, null, 2), 'utf8');
}

function getOverrides() {
  return readOverrides();
}

function addOverride(agent, originalStart, newStart) {
  const overrides = readOverrides();

  // Upsert: same agent + originalStart → update
  const key = `${agent}:${originalStart}`;
  const existing = overrides.findIndex(o => `${o.agent}:${o.originalStart}` === key);

  const override = {
    id: 'so_' + crypto.randomBytes(6).toString('hex'),
    agent,
    originalStart,
    newStart,
    createdAt: new Date().toISOString()
  };

  if (existing !== -1) {
    override.id = overrides[existing].id;
    overrides[existing] = override;
  } else {
    overrides.push(override);
  }

  writeOverrides(overrides);
  return override;
}

function removeOverride(id) {
  const overrides = readOverrides();
  const idx = overrides.findIndex(o => o.id === id);
  if (idx === -1) return false;
  overrides.splice(idx, 1);
  writeOverrides(overrides);
  return true;
}

function applyOverrides(schedule) {
  const overrides = readOverrides();
  if (overrides.length === 0) return schedule;

  return schedule.map(entry => {
    const override = overrides.find(
      o => o.agent === entry.agent && o.originalStart === entry.start
    );
    if (override) {
      return {
        ...entry,
        start: override.newStart,
        originalStart: override.originalStart,
        overrideId: override.id,
        type: 'override'
      };
    }
    return entry;
  }).sort((a, b) => new Date(a.start) - new Date(b.start));
}

module.exports = {
  getOverrides,
  addOverride,
  removeOverride,
  applyOverrides
};
