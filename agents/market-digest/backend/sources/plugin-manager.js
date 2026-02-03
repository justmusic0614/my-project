// Plugin Manager
// 動態載入與管理資料源 plugins

const fs = require('fs');
const path = require('path');

class PluginManager {
  constructor(registryPath = null) {
    this.registryPath = registryPath || path.join(__dirname, 'registry.json');
    this.plugins = new Map();
    this.registry = null;
    this.loadRegistry();
  }

  /**
   * 載入註冊表
   */
  loadRegistry() {
    if (!fs.existsSync(this.registryPath)) {
      throw new Error(`Registry not found: ${this.registryPath}`);
    }
    
    this.registry = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
    console.log(`📋 Plugin registry loaded (v${this.registry.version})`);
  }

  /**
   * 載入 plugin
   */
  async loadPlugin(name) {
    if (this.plugins.has(name)) {
      return this.plugins.get(name);
    }
    
    const config = this.registry.plugins[name];
    
    if (!config) {
      throw new Error(`Plugin '${name}' not found in registry`);
    }
    
    if (!config.enabled) {
      console.log(`⚠️  Plugin '${name}' is disabled`);
      return null;
    }
    
    // 檢查 dependencies
    for (const dep of config.dependencies || []) {
      try {
        require.resolve(dep);
      } catch (err) {
        throw new Error(`Plugin '${name}' requires '${dep}' but it's not installed`);
      }
    }
    
    // 嘗試從 plugins 目錄載入
    const pluginDir = path.join(__dirname, 'plugins', name);
    const pluginPath = path.join(pluginDir, 'plugin.js');
    
    let PluginClass;
    
    if (fs.existsSync(pluginPath)) {
      // 從 plugins 目錄載入
      PluginClass = require(pluginPath);
    } else {
      // 回退到舊有的 adapter（向後相容）
      const legacyPath = path.join(__dirname, `${name.replace('-', '')}.js`);
      if (fs.existsSync(legacyPath)) {
        PluginClass = require(legacyPath);
      } else {
        throw new Error(`Plugin implementation not found for '${name}'`);
      }
    }
    
    // 驗證 schema
    await this.validateSchema(PluginClass, config.schema);
    
    const instance = new PluginClass(config.config);
    
    this.plugins.set(name, {
      instance,
      config
    });
    
    console.log(`✅ Plugin loaded: ${name}`);
    
    return instance;
  }

  /**
   * 驗證 schema
   */
  async validateSchema(PluginClass, schemaName) {
    const schema = this.registry.schemas[schemaName];
    
    if (!schema) {
      console.warn(`⚠️  Schema '${schemaName}' not found in registry`);
      return true;
    }
    
    // 簡易驗證：確認 plugin 有必要的方法
    const prototype = PluginClass.prototype || {};
    
    // 所有 plugin 都應該有這些方法
    const requiredMethods = ['fetch'];
    
    for (const method of requiredMethods) {
      if (typeof prototype[method] !== 'function' && typeof PluginClass[method] !== 'function') {
        throw new Error(`Plugin must implement method: ${method}`);
      }
    }
    
    return true;
  }

  /**
   * 載入所有 enabled plugins
   */
  async loadAllPlugins() {
    const pluginNames = Object.keys(this.registry.plugins);
    const results = [];
    
    for (const name of pluginNames) {
      try {
        const instance = await this.loadPlugin(name);
        if (instance) {
          results.push({ name, success: true, instance });
        }
      } catch (err) {
        console.error(`❌ Failed to load plugin '${name}':`, err.message);
        results.push({ name, success: false, error: err.message });
      }
    }
    
    return results;
  }

  /**
   * 取得指定類型的所有 plugins
   */
  getPluginsByType(type) {
    const results = [];
    
    for (const [name, { instance, config }] of this.plugins) {
      if (config.type === type) {
        results.push({ name, instance, config });
      }
    }
    
    return results;
  }

  /**
   * 執行所有指定類型的 plugins
   */
  async fetchAll(type) {
    const plugins = this.getPluginsByType(type);
    const results = [];
    
    for (const { name, instance, config } of plugins) {
      try {
        console.log(`📡 Fetching from ${name}...`);
        
        const data = await instance.fetch ? 
          instance.fetch() : 
          (instance.fetchNews ? instance.fetchNews() : instance.fetchMarketData());
        
        results.push({
          source: name,
          type: config.type,
          success: true,
          data
        });
      } catch (err) {
        console.error(`❌ [${name}] Failed:`, err.message);
        results.push({
          source: name,
          type: config.type,
          success: false,
          error: err.message
        });
      }
    }
    
    return results;
  }

  /**
   * 啟用 plugin
   */
  enablePlugin(name) {
    if (this.registry.plugins[name]) {
      this.registry.plugins[name].enabled = true;
      this.saveRegistry();
      console.log(`✅ Plugin '${name}' enabled`);
    } else {
      throw new Error(`Plugin '${name}' not found`);
    }
  }

  /**
   * 停用 plugin
   */
  disablePlugin(name) {
    if (this.registry.plugins[name]) {
      this.registry.plugins[name].enabled = false;
      this.saveRegistry();
      console.log(`🔴 Plugin '${name}' disabled`);
      
      // 從已載入的 plugins 中移除
      if (this.plugins.has(name)) {
        this.plugins.delete(name);
      }
    } else {
      throw new Error(`Plugin '${name}' not found`);
    }
  }

  /**
   * 儲存註冊表
   */
  saveRegistry() {
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf8');
  }

  /**
   * 列出所有 plugins
   */
  listPlugins() {
    const plugins = [];
    
    for (const [name, config] of Object.entries(this.registry.plugins)) {
      plugins.push({
        name,
        type: config.type,
        enabled: config.enabled,
        version: config.version,
        loaded: this.plugins.has(name)
      });
    }
    
    return plugins;
  }

  /**
   * 取得統計資訊
   */
  getStats() {
    const total = Object.keys(this.registry.plugins).length;
    const enabled = Object.values(this.registry.plugins).filter(p => p.enabled).length;
    const loaded = this.plugins.size;
    
    return {
      total,
      enabled,
      loaded,
      byType: this.getPluginsByTypeCount()
    };
  }

  /**
   * 按類型統計
   */
  getPluginsByTypeCount() {
    const counts = {};
    
    for (const config of Object.values(this.registry.plugins)) {
      counts[config.type] = (counts[config.type] || 0) + 1;
    }
    
    return counts;
  }
}

module.exports = PluginManager;
