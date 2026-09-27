// 首页示例：两条真实检查的存档，纯浏览器回放。访客先看到小镇会做什么，再决定写不写。
import { renderCheck } from './render.js';
import { replayToView } from './shared/replay.js';

const loaded = await Promise.allSettled([
  fetch('/examples/iphone-listing-v1.json').then((res) => res.json()),
  fetch('/examples/iphone-listing-v2.json').then((res) => res.json()),
]);

const host = document.getElementById('showcase');
if (!loaded[0].value) {
  host?.remove(); // 示例缺失就不挡路：静态站也照样能用
} else {
  host.hidden = false;
  renderCheck(host.querySelector('.example-a'), replayToView(loaded[0].value));
  if (loaded[1].value) renderCheck(host.querySelector('.example-b'), replayToView(loaded[1].value));
}
