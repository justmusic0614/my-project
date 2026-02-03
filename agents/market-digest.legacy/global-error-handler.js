// Global Error Handler - SRE Edition
// 提供全局錯誤捕獲、分類、記錄與優雅關閉

const fs = require('fs');
const path = require('path');

class GlobalErrorHandler {
  constructor(options = {}) {
    this.appName = options.appName || 'market-digest';
    this.logDir = options.logDir || path.join(__dirname, 'logs');
    this.notifyChannel = options.notifyChannel || null;
    this.maxErrorRate = options.maxErrorRate || 10; // 每分鐘最多 10 個錯誤
    this.gracefulShutdownTimeout = options.gracefulShutdownTimeout || 5000; // 5 秒
    
    this.errorCounts = {
      uncaughtException: 0,
      unhandledRejection: 0,
      recoverable: 0,
      fatal: 0
    };
    
    this.errorHistory = []; // 記錄最近 100 個錯誤
    this.maxHistorySize = 100;
    
    this.isShuttingDown = false;
    
    // 確保日誌目錄存在
    this.ensureLogDir();
  }

  /**
   * 初始化全局錯誤處理器
   */
  install() {
    // 捕獲未處理的異常
    process.on('uncaughtException', (err, origin) => {
      this.handleUncaughtException(err, origin);
    });

    // 捕獲未處理的 Promise rejection
    process.on('unhandledRejection', (reason, promise) => {
      this.handleUnhandledRejection(reason, promise);
    });

    // 優雅關閉
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));

    // 警告：偵測到多個監聽器
    process.on('warning', (warning) => {
      this.logWarning(warning);
    });

    console.log(`✅ 全局錯誤處理器已安裝 [${this.appName}]`);
  }

  /**
   * 處理 uncaughtException
   */
  handleUncaughtException(err, origin) {
    this.errorCounts.uncaughtException++;
    this.errorCounts.fatal++;

    const errorReport = this.buildErrorReport('UNCAUGHT_EXCEPTION', err, {
      origin,
      fatal: true
    });

    this.logError(errorReport);
    this.recordErrorHistory(errorReport);
    
    // 通知（如果有配置）
    if (this.notifyChannel) {
      this.sendNotification(errorReport);
    }

    // uncaughtException 通常是 fatal，需要重啟
    console.error('🔴 FATAL: Uncaught Exception detected. Exiting...');
    
    // 給予短暫時間寫入日誌，然後退出
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }

  /**
   * 處理 unhandledRejection
   */
  handleUnhandledRejection(reason, promise) {
    this.errorCounts.unhandledRejection++;
    
    // 判斷是否為 recoverable
    const isRecoverable = this.isRecoverableError(reason);
    
    if (isRecoverable) {
      this.errorCounts.recoverable++;
    } else {
      this.errorCounts.fatal++;
    }

    const errorReport = this.buildErrorReport('UNHANDLED_REJECTION', reason, {
      promise: promise.toString(),
      recoverable: isRecoverable
    });

    this.logError(errorReport);
    this.recordErrorHistory(errorReport);

    // 如果是 recoverable，只記錄不退出
    if (isRecoverable) {
      console.warn('⚠️  Recovered from unhandled rejection');
      return;
    }

    // Fatal rejection：通知並退出
    if (this.notifyChannel) {
      this.sendNotification(errorReport);
    }

    console.error('🔴 FATAL: Unhandled Rejection. Exiting...');
    
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }

  /**
   * 判斷錯誤是否可恢復
   */
  isRecoverableError(err) {
    const recoverablePatterns = [
      /ECONNREFUSED/,      // 連線被拒絕（API 暫時無法連線）
      /ETIMEDOUT/,         // 超時
      /ENOTFOUND/,         // DNS 查詢失敗
      /socket hang up/,    // Socket 斷線
      /429/,               // Rate limit
      /503/,               // Service unavailable
      /502/,               // Bad gateway
    ];

    const errString = err.toString();
    
    return recoverablePatterns.some(pattern => pattern.test(errString));
  }

  /**
   * 建立錯誤報告
   */
  buildErrorReport(type, err, metadata = {}) {
    return {
      timestamp: new Date().toISOString(),
      type,
      message: err.message || err.toString(),
      stack: err.stack || null,
      metadata,
      errorCounts: { ...this.errorCounts },
      processInfo: {
        pid: process.pid,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cwd: process.cwd()
      }
    };
  }

  /**
   * 記錄錯誤到日誌檔案
   */
  logError(errorReport) {
    const logFile = path.join(this.logDir, `error-${this.getDateStr()}.log`);
    const logEntry = `${JSON.stringify(errorReport, null, 2)}\n${'='.repeat(80)}\n`;

    try {
      fs.appendFileSync(logFile, logEntry, 'utf8');
    } catch (writeErr) {
      console.error('❌ 無法寫入錯誤日誌:', writeErr.message);
    }

    // 同時輸出到 stderr
    console.error(`\n🔴 ERROR REPORT [${errorReport.type}]`);
    console.error(`   Message: ${errorReport.message}`);
    console.error(`   Time: ${errorReport.timestamp}`);
    if (errorReport.stack) {
      console.error(`   Stack:\n${errorReport.stack}`);
    }
  }

  /**
   * 記錄警告
   */
  logWarning(warning) {
    const logFile = path.join(this.logDir, `warning-${this.getDateStr()}.log`);
    const logEntry = `[${new Date().toISOString()}] ${warning.name}: ${warning.message}\n`;
    
    try {
      fs.appendFileSync(logFile, logEntry, 'utf8');
    } catch (writeErr) {
      console.error('❌ 無法寫入警告日誌:', writeErr.message);
    }
  }

  /**
   * 記錄錯誤歷史（用於錯誤率計算）
   */
  recordErrorHistory(errorReport) {
    this.errorHistory.push({
      timestamp: Date.now(),
      type: errorReport.type,
      message: errorReport.message
    });

    // 保持歷史記錄大小
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift();
    }

    // 檢查錯誤率
    this.checkErrorRate();
  }

  /**
   * 檢查錯誤率（每分鐘）
   */
  checkErrorRate() {
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentErrors = this.errorHistory.filter(e => e.timestamp > oneMinuteAgo);

    if (recentErrors.length > this.maxErrorRate) {
      console.error(`🚨 ERROR RATE EXCEEDED: ${recentErrors.length} errors in last minute (max: ${this.maxErrorRate})`);
      
      // 可選：自動觸發降級模式或發送告警
      if (this.notifyChannel) {
        this.sendNotification({
          type: 'ERROR_RATE_ALERT',
          message: `Error rate exceeded: ${recentErrors.length} errors in last minute`,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  /**
   * 發送通知（預留介面）
   */
  sendNotification(errorReport) {
    // TODO: 整合 Telegram / Email / PagerDuty
    console.log('📤 [通知] 錯誤報告已準備發送（未實作）');
  }

  /**
   * 優雅關閉
   */
  async gracefulShutdown(signal) {
    if (this.isShuttingDown) {
      console.log('⚠️  Already shutting down...');
      return;
    }

    this.isShuttingDown = true;
    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    // 記錄關閉事件
    const shutdownLog = {
      timestamp: new Date().toISOString(),
      signal,
      uptime: process.uptime(),
      errorCounts: { ...this.errorCounts }
    };

    this.logError({
      type: 'GRACEFUL_SHUTDOWN',
      message: `Process shutting down (signal: ${signal})`,
      metadata: shutdownLog
    });

    // 給予時間完成清理工作
    setTimeout(() => {
      console.log('✅ Graceful shutdown complete.');
      process.exit(0);
    }, this.gracefulShutdownTimeout);
  }

  /**
   * 確保日誌目錄存在
   */
  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
      console.log(`📁 建立日誌目錄: ${this.logDir}`);
    }
  }

  /**
   * 取得日期字串 (YYYY-MM-DD)
   */
  getDateStr() {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * 取得健康狀態報告
   */
  getHealthReport() {
    const oneMinuteAgo = Date.now() - 60 * 1000;
    const recentErrors = this.errorHistory.filter(e => e.timestamp > oneMinuteAgo);

    return {
      status: this.isShuttingDown ? 'SHUTTING_DOWN' : 'HEALTHY',
      uptime: process.uptime(),
      errorCounts: { ...this.errorCounts },
      recentErrorRate: recentErrors.length,
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  }
}

// 單例模式
let instance = null;

function install(options = {}) {
  if (!instance) {
    instance = new GlobalErrorHandler(options);
    instance.install();
  }
  return instance;
}

function getHandler() {
  return instance;
}

module.exports = {
  install,
  getHandler,
  GlobalErrorHandler
};
