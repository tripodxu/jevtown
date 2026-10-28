// 主题令牌 → 字面值：canvas 不认 var()，画地图与分享卡时只能取 computed 值。
// 此前 grid.js 与 sharecard.js 各写一份同名同实现的 cssVar——这里收成唯一一份。
export const cssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};
