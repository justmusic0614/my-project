const fs = require('fs');
const path = require('path');

const STALE_TIMEOUT = 5000;
const RETRY_DELAY = 100;
const MAX_RETRIES = 10;

function createMutex(filePath) {
  const lockDir = filePath + '.lock';

  function acquire() {
    for (let i = 0; i < MAX_RETRIES; i++) {
      try {
        fs.mkdirSync(lockDir);
        return true;
      } catch (err) {
        if (err.code === 'EEXIST') {
          // Check for stale lock
          try {
            const stat = fs.statSync(lockDir);
            if (Date.now() - stat.mtimeMs > STALE_TIMEOUT) {
              fs.rmdirSync(lockDir);
              continue;
            }
          } catch (_) {
            continue;
          }
          // Non-blocking sleep using Atomics
          const buffer = new SharedArrayBuffer(4);
          const view = new Int32Array(buffer);
          Atomics.wait(view, 0, 0, RETRY_DELAY);
        } else {
          throw err;
        }
      }
    }
    throw new Error(`Could not acquire lock for ${filePath} after ${MAX_RETRIES} retries`);
  }

  function release() {
    try {
      fs.rmdirSync(lockDir);
    } catch (_) {
      // Lock already released
    }
  }

  function withLock(fn) {
    acquire();
    try {
      return fn();
    } finally {
      release();
    }
  }

  return { acquire, release, withLock };
}

module.exports = { createMutex };
