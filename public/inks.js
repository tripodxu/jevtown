// 面版墨水：LOOKS 的七个键 → 主题的 --face-* 变量名。
//
// 为什么要有这层映射（实测数字见 docs/MEMORY.md R30）：
//   六色反应墨水的亮度跨 15 倍，地图之所以能画全靠底板是深版（--map-well，
//   浅色两套主题也是暖近黑/冷钢灰）。但报告里大量图形与文字是直接落在
//   --card / --card-2 / --inset 上的——浅色主题里那些亮墨水全线隐形：
//   普查公报黄 1.10:1、绿 1.42:1、蓝 1.92:1、红 2.41:1，全线达不到
//   非文字图形 3:1，连文字的 4.5:1 差得更远。
//   --face-* 是同色相压暗一档的"面版"，四套主题各自算过：信号色全部 ≥3:1
//   （浅色两套最低 4.36），背景级三色（dark/scrolled/hollow）按"越不显眼越好"排。
//
// 分工：地图画布（grid.js）继续用 LOOKS 的字面色配深版底板；SVG 图表、条、
// 堆叠段、图例点、分享卡 KPI 这些直接压在卡片表面上的地方用 faceInk()。
import { LOOKS } from './shared/presets.js';

const FACE_OF = {
  dark: '--face-dark',
  scrolled: '--face-scrolled',
  hollow: '--face-hollow',
  stopped: '--face-stopped',
  glad: '--face-glad',
  spreads: '--face-spreads',
  sorry: '--face-sorry',
};

/** 某个 look 的面版墨水，作为 CSS 值直接塞进 style/stroke/fill。 */
export const faceInk = (look) => `var(${FACE_OF[look] ?? '--face-dark'})`;

/** 七色齐备的表：图表与图例按 look 取色时用这个，别再各处手写映射。 */
export const FACE_INKS = Object.fromEntries(Object.keys(LOOKS).map((look) => [look, faceInk(look)]));
