// 主题切换：四套视觉世界，localStorage 记忆，切换后重绘所有地图（画布颜色取自 CSS 变量）。
import { redrawMaps } from './grid.js';

const KEY = 'jevtown.theme';
export const THEMES = ['night', 'bulletin', 'instrument', 'classic'];

function apply(id) {
  document.documentElement.dataset.theme = id;
  for (const btn of document.querySelectorAll('.theme-btn')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === id));
  }
  redrawMaps();
}

export function initThemeSwitcher() {
  const saved = localStorage.getItem(KEY);
  apply(THEMES.includes(saved) ? saved : 'night');
  for (const btn of document.querySelectorAll('.theme-btn')) {
    btn.addEventListener('click', () => {
      localStorage.setItem(KEY, btn.dataset.theme);
      apply(btn.dataset.theme);
    });
  }
}
