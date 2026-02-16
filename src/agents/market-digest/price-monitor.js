#!/usr/bin/env node
/**
 * Price Monitor - 股票价格异动监控
 * 自动检查watchlist中的股票，单日涨跌超过阈值时推播提醒
 */

const fs = require('fs').promises;
const path = require('path');

class PriceMonitor {
  constructor(config = {}) {
    this.threshold = config.threshold || 5;  // 默认5%
    this.dataDir = path.join(__dirname, 'data');
    this.cacheFile = path.join(this.dataDir, 'runtime', 'price-cache.json');
  }

  /**
   * 执行监控
   */
  async run() {
    console.log(`📊 启动价格监控（阈值：±${this.threshold}%）...`);

    try {
      // 1. 载入 watchlist
      const watchlist = await this.loadWatchlist();
      if (!watchlist || watchlist.length === 0) {
        console.log('⚠️  Watchlist 为空，跳过监控');
        return;
      }

      console.log(`📋 监控 ${watchlist.length} 档股票...`);

      // 2. 抓取当前价格
      const MarketDataFetcher = require('./backend/fetcher');
      const config = JSON.parse(await fs.readFile(path.join(__dirname, 'config.json'), 'utf8'));
      const fetcher = new MarketDataFetcher(config);

      // 3. 载入旧缓存（用于计算涨跌）
      const cache = await this.loadCache();

      // 4. 检查每档股票
      const alerts = [];
      
      for (const stock of watchlist) {
        const { code, name } = stock;
        
        try {
          // 使用 Yahoo Finance Plugin 抓取价格
          const YahooFinancePlugin = require('./backend/sources/plugins/yahoo-finance/plugin');
          const yahoo = new YahooFinancePlugin({
            baseUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/'
          });
          
          // 台股代号需要加 .TW 后缀
          const symbol = `${code}.TW`;
          const data = await yahoo.fetchMarketData(symbol);
          
          if (!data || !data.close) {
            console.log(`  ⚠️  ${code} ${name}: 无法取得价格`);
            continue;
          }

          const currentPrice = data.close;
          const changePercent = data.changePercent || 0;
          
          // 检查是否超过阈值
          if (Math.abs(changePercent) >= this.threshold) {
            const direction = changePercent > 0 ? '📈 上涨' : '📉 下跌';
            alerts.push({
              code,
              name,
              price: currentPrice,
              change: changePercent,
              direction,
              timestamp: new Date().toISOString()
            });
            
            console.log(`  🚨 ${code} ${name}: ${direction} ${Math.abs(changePercent).toFixed(2)}%`);
          } else {
            console.log(`  ✅ ${code} ${name}: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(2)}% (正常)`);
          }

          // 更新缓存
          cache[code] = {
            price: currentPrice,
            change: changePercent,
            updatedAt: new Date().toISOString()
          };

          // 避免过度请求
          await this.sleep(500);

        } catch (error) {
          console.error(`  ❌ ${code} ${name}: ${error.message}`);
        }
      }

      // 5. 保存缓存
      await this.saveCache(cache);

      // 6. 推播异常提醒
      if (alerts.length > 0) {
        await this.sendAlert(alerts);
      } else {
        console.log('✅ 无异常价格变动');
      }

    } catch (error) {
      console.error('❌ 监控失败:', error.message);
      throw error;
    }
  }

  /**
   * 载入 watchlist
   */
  async loadWatchlist() {
    const filePath = path.join(this.dataDir, 'watchlist.json');
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      return data.stocks || [];
    } catch (error) {
      console.error('⚠️  Watchlist 读取失败:', error.message);
      return [];
    }
  }

  /**
   * 载入价格缓存
   */
  async loadCache() {
    try {
      const content = await fs.readFile(this.cacheFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return {};
    }
  }

  /**
   * 保存价格缓存
   */
  async saveCache(cache) {
    await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
    await fs.writeFile(this.cacheFile, JSON.stringify(cache, null, 2), 'utf8');
  }

  /**
   * 推播异常提醒
   */
  async sendAlert(alerts) {
    console.log(`\n🚨 发现 ${alerts.length} 档异常变动，准备推播...`);

    let message = `🚨 *价格异动提醒*（阈值：±${this.threshold}%）\n\n`;

    alerts.forEach((alert, index) => {
      message += `${index + 1}. *${alert.code} ${alert.name}*\n`;
      message += `   ${alert.direction} *${Math.abs(alert.change).toFixed(2)}%*\n`;
      message += `   当前价格：$${alert.price.toFixed(2)}\n\n`;
    });

    message += `_监控时间：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}_`;

    // 使用 clawdbot sessions send 推播（假设在主 session）
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      const clawdbot = spawn('clawdbot', [
        'sessions', 'send',
        '--message', message,
        '--timeout', '10'
      ]);

      let output = '';
      clawdbot.stdout.on('data', (data) => {
        output += data.toString();
      });

      clawdbot.on('close', (code) => {
        if (code === 0) {
          console.log('✅ 推播成功');
          resolve();
        } else {
          console.error('❌ 推播失败');
          reject(new Error('推播失败'));
        }
      });
    });
  }

  /**
   * 延迟函数
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// CLI 执行
if (require.main === module) {
  const args = process.argv.slice(2);
  const threshold = args.includes('--threshold') 
    ? parseFloat(args[args.indexOf('--threshold') + 1]) 
    : 5;

  const monitor = new PriceMonitor({ threshold });
  
  monitor.run()
    .then(() => {
      console.log('\n✅ 价格监控完成');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ 价格监控失败:', error.message);
      process.exit(1);
    });
}

module.exports = PriceMonitor;
