/**
 * Schema Validator - JSON Schema 驗證器
 * 功能：
 * - 驗證資料是否符合定義的 schema
 * - 提供詳細的錯誤訊息
 * - 支援型別檢查、必填欄位、格式驗證
 */

const newsSchema = require('./schemas/news.schema');
const marketDataSchema = require('./schemas/market-data.schema');
const financialSchema = require('./schemas/financial.schema');
const chipSchema = require('./schemas/chip.schema');
const watchlistSchema = require('./schemas/watchlist.schema');
const phaseEngineResultSchema = require('./schemas/phase-engine.result.schema.json');
const phaseEngineStateSchema = require('./schemas/phase-engine.state.schema.json');
const historySeriesSchema = require('./schemas/market-history.series.schema.json');
const fs = require('fs');

class SchemaValidator {
  constructor(options = {}) {
    this.strict = options.strict !== false; // 預設嚴格模式
    this.logger = options.logger || console;
  }

  /**
   * 驗證新聞資料
   */
  validateNews(data) {
    return this.validate(data, newsSchema.container, 'news');
  }

  /**
   * 驗證市場資料
   */
  validateMarketData(data) {
    return this.validate(data, marketDataSchema.container, 'market-data');
  }

  /**
   * 驗證財報資料
   */
  validateFinancial(data) {
    return this.validate(data, financialSchema.container, 'financial');
  }

  /**
   * 驗證籌碼資料
   */
  validateChip(data) {
    return this.validate(data, chipSchema.container, 'chip');
  }

  /**
   * 驗證追蹤清單
   */
  validateWatchlist(data) {
    return this.validate(data, watchlistSchema.container, 'watchlist');
  }

  /**
   * 核心驗證方法
   */
  validate(data, schemaDefinition, schemaName = 'unknown') {
    const errors = [];
    
    // 檢查資料是否存在
    if (!data || typeof data !== 'object') {
      errors.push({
        field: 'root',
        message: 'Data must be an object',
        value: data
      });
      return { valid: false, errors };
    }

    // 驗證每個欄位
    for (const [field, rules] of Object.entries(schemaDefinition)) {
      const value = data[field];
      
      // 必填欄位檢查
      if (rules.required && (value === undefined || value === null)) {
        errors.push({
          field,
          message: `Required field '${field}' is missing`,
          expected: rules.type
        });
        continue;
      }

      // 跳過選填且未提供的欄位
      if (!rules.required && (value === undefined || value === null)) {
        continue;
      }

      // 型別檢查
      const typeError = this.validateType(value, rules.type, field);
      if (typeError) {
        errors.push(typeError);
        continue;
      }

      // 格式檢查
      if (rules.format) {
        const formatError = this.validateFormat(value, rules.format, field);
        if (formatError) {
          errors.push(formatError);
        }
      }

      // 列舉值檢查
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({
          field,
          message: `Invalid value for '${field}'`,
          value,
          expected: rules.enum
        });
      }

      // 長度檢查
      if (rules.maxLength && typeof value === 'string' && value.length > rules.maxLength) {
        errors.push({
          field,
          message: `Field '${field}' exceeds max length`,
          value: value.length,
          expected: rules.maxLength
        });
      }

      // Pattern 檢查
      if (rules.pattern && typeof value === 'string') {
        const regex = new RegExp(rules.pattern);
        if (!regex.test(value)) {
          errors.push({
            field,
            message: `Field '${field}' does not match pattern`,
            pattern: rules.pattern,
            value
          });
        }
      }

      // 陣列項目檢查
      if (rules.type === 'array' && Array.isArray(value)) {
        // 簡單型別陣列
        if (typeof rules.items === 'string') {
          for (let i = 0; i < value.length; i++) {
            const itemError = this.validateType(value[i], rules.items, `${field}[${i}]`);
            if (itemError) {
              errors.push(itemError);
            }
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      schemaName
    };
  }

  /**
   * 型別驗證
   */
  validateType(value, expectedType, field) {
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    
    if (expectedType === 'array' && !Array.isArray(value)) {
      return {
        field,
        message: `Expected array, got ${actualType}`,
        value: actualType
      };
    }

    if (expectedType === 'object' && actualType !== 'object') {
      return {
        field,
        message: `Expected object, got ${actualType}`,
        value: actualType
      };
    }

    if (expectedType === 'string' && actualType !== 'string') {
      return {
        field,
        message: `Expected string, got ${actualType}`,
        value: actualType
      };
    }

    if (expectedType === 'number' && actualType !== 'number') {
      return {
        field,
        message: `Expected number, got ${actualType}`,
        value: actualType
      };
    }

    if (expectedType === 'boolean' && actualType !== 'boolean') {
      return {
        field,
        message: `Expected boolean, got ${actualType}`,
        value: actualType
      };
    }

    return null;
  }

  /**
   * 格式驗證
   */
  validateFormat(value, format, field) {
    switch (format) {
      case 'iso8601':
        if (!this.isISO8601(value)) {
          return {
            field,
            message: `Invalid ISO 8601 date format`,
            value
          };
        }
        break;

      case 'url':
        if (!this.isURL(value)) {
          return {
            field,
            message: `Invalid URL format`,
            value
          };
        }
        break;

      case 'YYYY-MM-DD':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
          return {
            field,
            message: `Invalid date format, expected YYYY-MM-DD`,
            value
          };
        }
        break;
    }

    return null;
  }

  /**
   * ISO 8601 日期驗證
   */
  isISO8601(value) {
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    return iso8601Regex.test(value);
  }

  /**
   * URL 驗證
   */
  isURL(value) {
    try {
      new URL(value);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 格式化錯誤訊息
   */
  formatErrors(validationResult) {
    if (validationResult.valid) {
      return 'No errors';
    }

    const lines = [`Validation failed for '${validationResult.schemaName}':`];
    validationResult.errors.forEach((err, i) => {
      lines.push(`  ${i + 1}. [${err.field}] ${err.message}`);
      if (err.value !== undefined) {
        lines.push(`     Value: ${JSON.stringify(err.value)}`);
      }
      if (err.expected !== undefined) {
        lines.push(`     Expected: ${JSON.stringify(err.expected)}`);
      }
    });

    return lines.join('\n');
  }
  /**
   * 驗證 Phase Engine evaluate() 輸出結果
   * @param {object} data - PhaseEngine.evaluate() 回傳值
   * @returns {{ valid: boolean, errors: Array }}
   */
  validatePhaseEngineResult(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
      errors.push({ field: 'root', message: 'Data must be an object' });
      return { valid: false, errors, schemaName: 'phase-engine-result' };
    }

    for (const field of phaseEngineResultSchema.required) {
      if (data[field] === undefined || data[field] === null) {
        errors.push({ field, message: `Required field '${field}' is missing` });
      }
    }

    if (data.phase && !phaseEngineResultSchema.phase_enum.includes(data.phase)) {
      errors.push({
        field: 'phase',
        message: `Invalid phase value`,
        value: data.phase,
        expected: phaseEngineResultSchema.phase_enum
      });
    }

    if (data.confidence && !phaseEngineResultSchema.confidence_enum.includes(data.confidence)) {
      errors.push({
        field: 'confidence',
        message: `Invalid confidence value`,
        value: data.confidence,
        expected: phaseEngineResultSchema.confidence_enum
      });
    }

    return { valid: errors.length === 0, errors, schemaName: 'phase-engine-result' };
  }

  /**
   * 驗證 Phase Engine 持久化狀態
   * @param {object} data - phase-engine-state.json 內容
   * @returns {{ valid: boolean, errors: Array }}
   */
  validatePhaseEngineState(data) {
    const errors = [];

    if (!data || typeof data !== 'object') {
      errors.push({ field: 'root', message: 'Data must be an object' });
      return { valid: false, errors, schemaName: 'phase-engine-state' };
    }

    for (const field of phaseEngineStateSchema.required) {
      if (data[field] === undefined || data[field] === null) {
        errors.push({ field, message: `Required field '${field}' is missing` });
      }
    }

    return { valid: errors.length === 0, errors, schemaName: 'phase-engine-state' };
  }

  /**
   * 驗證歷史時間序列
   * 規則：必須有 date + close，允許額外 OHLCV 欄位，date 升冪、無重複
   * @param {Array} data - [{date, close, ...}]
   * @returns {{ valid: boolean, errors: Array }}
   */
  validateHistorySeries(data) {
    const errors = [];

    if (!Array.isArray(data)) {
      errors.push({ field: 'root', message: 'Data must be an array' });
      return { valid: false, errors, schemaName: 'history-series' };
    }

    const allowedKeys = new Set([
      ...historySeriesSchema.required,
      ...historySeriesSchema.allowed_extra
    ]);
    let prevDate = null;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const prefix = `[${i}]`;

      if (!row || typeof row !== 'object') {
        errors.push({ field: prefix, message: 'Row must be an object' });
        continue;
      }

      // 必填欄位
      if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
        errors.push({ field: `${prefix}.date`, message: 'date must be YYYY-MM-DD string', value: row.date });
      }
      if (typeof row.close !== 'number' || isNaN(row.close)) {
        errors.push({ field: `${prefix}.close`, message: 'close must be a number', value: row.close });
      }

      // 升冪 + 無重複
      if (prevDate !== null && row.date <= prevDate) {
        errors.push({
          field: `${prefix}.date`,
          message: row.date === prevDate ? 'Duplicate date' : 'Dates not in ascending order',
          value: row.date
        });
      }
      prevDate = row.date;

      // 額外欄位白名單（只警告，不拒絕）
      for (const key of Object.keys(row)) {
        if (!allowedKeys.has(key)) {
          // 靜默忽略未知欄位（未來擴展用）
        }
      }
    }

    return { valid: errors.length === 0, errors, schemaName: 'history-series' };
  }

  /**
   * 安全驗證：失敗時 rename 原檔為 .corrupt-<timestamp>
   * 僅用於「讀檔」路徑（寫入路徑失敗應 throw，不 rename）
   * @param {*} data - 待驗證資料
   * @param {Function} validatorFn - 驗證方法（回傳 {valid, errors}）
   * @param {string} sourceFilePath - 原始檔案路徑（rename 用）
   * @param {object} [log] - logger 實例
   * @returns {*} 驗證通過回傳 data；失敗回傳 null
   */
  static safeValidateOrCorrupt(data, validatorFn, sourceFilePath, log) {
    const result = validatorFn(data);
    if (result.valid) {
      return data;
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const corruptPath = `${sourceFilePath}.corrupt-${ts}`;

    try {
      fs.renameSync(sourceFilePath, corruptPath);
      if (log) {
        log.warn(`Validation failed for ${sourceFilePath}, renamed to ${corruptPath}`, {
          errors: result.errors
        });
      }
    } catch (renameErr) {
      if (log) {
        log.error(`Failed to rename corrupt file ${sourceFilePath}: ${renameErr.message}`);
      }
    }

    return null;
  }
}

module.exports = SchemaValidator;
