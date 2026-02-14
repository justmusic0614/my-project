/**
 * 根據 Cron 表達式判斷任務頻率
 * @param {string} cronExpression - Cron 表達式（如 "0 * * * *"）
 * @returns {'high-frequency' | 'low-frequency'}
 */
export function classifyAgentByFrequency(cronExpression) {
  if (!cronExpression) return 'low-frequency';

  const [minute, hour] = cronExpression.split(' ');

  // 每小時或更頻繁 → 高頻
  if (minute.startsWith('*/') && minute !== '*/60') {
    return 'high-frequency'; // deploy-monitor (*/30)
  }

  if (hour === '*') {
    return 'high-frequency'; // security-patrol (0 * * * *)
  }

  if (hour.includes('/') || hour.includes(',')) {
    return 'high-frequency'; // optimization-advisor (15 1-23/2)
  }

  // 每天一次或更少 → 低頻
  return 'low-frequency'; // knowledge-digest, market-digest
}

/**
 * 生成頻率描述文字
 */
export function getFrequencyDescription(cronExpression) {
  const [minute, hour] = cronExpression.split(' ');

  if (minute.startsWith('*/')) {
    const interval = minute.split('/')[1];
    return `Every ${interval} minutes`;
  }

  if (hour === '*') {
    return 'Hourly';
  }

  if (hour.includes('/')) {
    const match = hour.match(/\d+-\d+\/(\d+)/);
    if (match) {
      return `Every ${match[1]} hours`;
    }
  }

  return 'Daily';
}
