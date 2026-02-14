import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

const TAIPEI_TIMEZONE = 'Asia/Taipei';

/**
 * 將 UTC 時間轉換為台北時間
 */
export function utcToTaipei(utcDate) {
  return toZonedTime(utcDate, TAIPEI_TIMEZONE);
}

/**
 * 格式化台北時間
 */
export function formatTaipeiTime(utcDate, formatStr) {
  return formatInTimeZone(utcDate, TAIPEI_TIMEZONE, formatStr);
}

/**
 * 取得台北時間的小時數（0-23）
 */
export function getTaipeiHour(utcDate) {
  return utcToTaipei(utcDate).getHours();
}
