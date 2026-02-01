# HTTP 429 Rate Limit 错误研究

## 问题描述
```
HTTP 429: rate_limit_error
组织限制：30,000 input tokens/分钟
模型：claude-sonnet-4-5-20250929
组织 ID：b2ef187e-57aa-495e-883e-0bf6a61b352e
```

## 初步分析（2026-02-01 18:22）

### 触发场景
1. Clawdbot 使用 Claude API
2. 当前项目（Market Digest Agent）涉及多次 API 调用
3. 超过组织级速率限制

### 可能原因
1. **单次请求 token 过多**
   - 当前 session token usage: ~120K/200K
   - 如果短时间多次调用会累积

2. **并发请求**
   - 多个 session 同时使用
   - 后台任务 + 人工对话

3. **大型上下文**
   - 项目文件多（30+ 文件）
   - RUNTIME_PIPELINE.yaml (16KB)
   - 每次调用都加载

### 待研究方向
- [ ] Clawdbot 的 token 管理策略
- [ ] 如何优化上下文大小
- [ ] 是否可以分批处理
- [ ] Rate limit 监控机制
- [ ] Fallback 策略（降级到其他模型）

### 解决方案草案
**短期（立即可用）：**
1. 减少单次请求的上下文
2. 增加请求间隔
3. 使用 IDEMPOTENCY 避免重复调用

**中期（需配置）：**
1. 实现请求队列
2. Token 使用监控
3. 智能降级（超限时用 GPT-4）

**长期（需申请）：**
1. 联系 Anthropic 提升 rate limit
2. 升级组织套餐

## 研究进度
- [x] 记录问题
- [ ] 分析 Clawdbot token 使用模式
- [ ] 测试优化方案
- [ ] 准备完整解决方案文档

## 预计完成时间
2026-02-02 08:00（明天早上）

如需更多时间会立即告知。
