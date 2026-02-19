/**
 * 統一日誌系統
 * 目的：替換分散在各模組的 console.log
 * 
 * 功能：
 * - 結構化日誌（JSON 格式）
 * - 日誌級別（DEBUG/INFO/WARN/ERROR）
 * - 時間戳
 * - 組件標識
 * - 環境變數控制
 * - 便於解析和監控
 */

class Logger {
  constructor(component, options = {}) {
    this.component = component;
    this.format = options.format || process.env.LOG_FORMAT || 'pretty';
    this.level = options.level || process.env.LOG_LEVEL || 'info';
    this.output = options.output || process.stderr;
    this.errorOutput = options.errorOutput || process.stderr;
    
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    
    this.levelEmoji = {
      debug: '🔍',
      info: 'ℹ️',
      warn: '⚠️',
      error: '❌'
    };
  }

  /**
   * DEBUG 級別
   */
  debug(message, context = {}) {
    this.log('debug', message, context);
  }

  /**
   * INFO 級別
   */
  info(message, context = {}) {
    this.log('info', message, context);
  }

  /**
   * WARN 級別
   */
  warn(message, context = {}) {
    this.log('warn', message, context);
  }

  /**
   * ERROR 級別
   */
  error(message, contextOrError = {}, error = null) {
    let context = contextOrError;
    let stack = null;
    
    // 支援直接傳入 Error 物件
    if (contextOrError instanceof Error) {
      error = contextOrError;
      context = {};
    }
    
    if (error) {
      stack = error.stack;
      context = {
        ...context,
        errorName: error.name,
        errorMessage: error.message
      };
    }
    
    this.log('error', message, { ...context, stack });
  }

  /**
   * 核心日誌方法
   */
  log(level, message, context = {}) {
    // 檢查日誌級別
    if (this.levels[level] < this.levels[this.level]) {
      return;
    }
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      component: this.component,
      message,
      ...context
    };
    
    const output = level === 'error' ? this.errorOutput : this.output;
    
    if (this.format === 'json') {
      output.write(JSON.stringify(logEntry) + '\n');
    } else {
      output.write(this.formatPretty(logEntry) + '\n');
    }
  }

  /**
   * 美化格式輸出
   */
  formatPretty(logEntry) {
    const { timestamp, level, component, message, stack, ...rest } = logEntry;
    const time = new Date(timestamp).toLocaleTimeString('zh-TW', { hour12: false });
    const emoji = this.levelEmoji[level.toLowerCase()] || '';
    
    let output = `${emoji} [${time}] [${component}] ${message}`;
    
    // 附加上下文
    const contextKeys = Object.keys(rest).filter(k => k !== 'stack');
    if (contextKeys.length > 0) {
      const contextStr = contextKeys
        .map(k => `${k}=${rest[k]}`)
        .join(', ');
      output += ` (${contextStr})`;
    }
    
    // 附加堆疊追蹤
    if (stack) {
      output += `\n${stack}`;
    }
    
    return output;
  }

  /**
   * 測量執行時間
   */
  async time(label, fn) {
    const start = Date.now();
    this.debug(`開始：${label}`);
    
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.info(`完成：${label}`, { duration: `${duration}ms` });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(`失敗：${label}`, { duration: `${duration}ms` }, error);
      throw error;
    }
  }

  /**
   * 進度日誌
   */
  progress(current, total, message = '') {
    const percentage = ((current / total) * 100).toFixed(1);
    this.info(`進度：${message}`, { current, total, percentage: `${percentage}%` });
  }

  /**
   * 成功日誌（語法糖）
   */
  success(message, context = {}) {
    this.info(`✅ ${message}`, context);
  }

  /**
   * 建立子 Logger
   */
  child(subComponent) {
    return new Logger(`${this.component}:${subComponent}`, {
      format: this.format,
      level: this.level,
      output: this.output,
      errorOutput: this.errorOutput
    });
  }
}

/**
 * 建立 Logger 實例的工廠函式
 */
function createLogger(component, options = {}) {
  return new Logger(component, options);
}

module.exports = {
  Logger,
  createLogger,
  // 預設實例（用於快速測試）
  default: new Logger('default')
};
