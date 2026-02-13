/**
 * Lightweight cron expression parser.
 * Handles standard 5-field cron: minute hour day-of-month month day-of-week
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseCronField(field, min, max) {
  if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => i + min);

  const values = new Set();

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2]) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (range === '*') {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map(Number);
      for (let i = a; i <= b; i += step) values.add(i);
    } else {
      values.add(parseInt(range));
    }
  }

  return [...values].sort((a, b) => a - b);
}

function parseCron(expression) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minuteF, hourF, domF, monthF, dowF] = parts;

  return {
    minutes: parseCronField(minuteF, 0, 59),
    hours: parseCronField(hourF, 0, 23),
    daysOfMonth: parseCronField(domF, 1, 31),
    months: parseCronField(monthF, 1, 12),
    daysOfWeek: parseCronField(dowF, 0, 6)
  };
}

function getNextRun(expression, from = new Date()) {
  const cron = parseCron(expression);
  if (!cron) return null;

  const d = new Date(from);
  d.setSeconds(0);
  d.setMilliseconds(0);
  d.setMinutes(d.getMinutes() + 1);

  for (let i = 0; i < 525600; i++) { // max 1 year
    if (
      cron.months.includes(d.getMonth() + 1) &&
      cron.daysOfMonth.includes(d.getDate()) &&
      cron.daysOfWeek.includes(d.getDay()) &&
      cron.hours.includes(d.getHours()) &&
      cron.minutes.includes(d.getMinutes())
    ) {
      return d;
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

function humanReadable(expression) {
  const cron = parseCron(expression);
  if (!cron) return expression;

  const timeStr = cron.hours.length <= 3
    ? cron.hours.map(h => `${String(h).padStart(2, '0')}:${String(cron.minutes[0] || 0).padStart(2, '0')}`).join(', ')
    : `Every ${cron.hours.length === 24 ? '' : cron.hours.length + ' '}hour(s)`;

  const dowStr = cron.daysOfWeek.length === 7 ? 'Daily'
    : cron.daysOfWeek.length === 5 && !cron.daysOfWeek.includes(0) && !cron.daysOfWeek.includes(6) ? 'Weekdays'
    : cron.daysOfWeek.map(d => DAY_NAMES[d]).join(', ');

  return `${dowStr} at ${timeStr}`;
}

function expandForWeek(expression, weekStart) {
  const cron = parseCron(expression);
  if (!cron) return [];

  const runs = [];
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);

  for (let day = 0; day < 7; day++) {
    const d = new Date(start);
    d.setDate(d.getDate() + day);

    if (!cron.daysOfWeek.includes(d.getDay())) continue;
    if (!cron.months.includes(d.getMonth() + 1)) continue;
    if (!cron.daysOfMonth.includes(d.getDate())) continue;

    for (const hour of cron.hours) {
      for (const minute of cron.minutes) {
        const run = new Date(d);
        run.setHours(hour, minute, 0, 0);
        runs.push(run);
      }
    }
  }

  return runs.sort((a, b) => a - b);
}

module.exports = { parseCron, getNextRun, humanReadable, expandForWeek };
