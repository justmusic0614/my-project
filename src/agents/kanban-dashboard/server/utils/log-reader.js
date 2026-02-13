const fs = require('fs');

function readLastLines(filePath, n = 200) {
  if (!fs.existsSync(filePath)) return [];

  const stat = fs.statSync(filePath);
  const bufSize = Math.min(stat.size, n * 500); // rough estimate: 500 bytes per line
  const buf = Buffer.alloc(bufSize);
  const fd = fs.openSync(filePath, 'r');

  fs.readSync(fd, buf, 0, bufSize, Math.max(0, stat.size - bufSize));
  fs.closeSync(fd);

  const lines = buf.toString('utf8').split('\n').filter(Boolean);
  return lines.slice(-n);
}

function watchAndStream(filePath, onLine) {
  if (!fs.existsSync(filePath)) return { close: () => {} };

  let offset = fs.statSync(filePath).size;

  const watcher = fs.watch(filePath, (eventType) => {
    if (eventType !== 'change') return;

    try {
      const newSize = fs.statSync(filePath).size;
      if (newSize <= offset) {
        offset = newSize; // file was truncated
        return;
      }

      const buf = Buffer.alloc(newSize - offset);
      const fd = fs.openSync(filePath, 'r');
      try {
        fs.readSync(fd, buf, 0, buf.length, offset);
      } finally {
        fs.closeSync(fd); // Always close fd even if readSync fails
      }
      offset = newSize;

      const lines = buf.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        onLine(line);
      }
    } catch (_) {
      // File may have been removed
    }
  });

  return { close: () => watcher.close() };
}

module.exports = { readLastLines, watchAndStream };
