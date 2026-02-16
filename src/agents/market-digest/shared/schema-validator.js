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
}

module.exports = SchemaValidator;
