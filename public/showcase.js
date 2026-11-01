// 首页示例：两条真实检查的存档，纯浏览器回放。访客先看到小镇会做什么，再决定写不写。
// 示例区是原生 details 抽屉（默认收起）+ 懒渲染（R22）：一张回放卡 = 一份完整报告
// （数据 ~60ms + DOM/canvas），收起时内容不进布局、IntersectionObserver 不会命中，
// 展开且滚到附近（rootMargin 300px）才渲染——抽屉与懒渲染互赢，未展开零成本。
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
  const render = (el, data) => renderCheck(el, replayToView(data));
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        io.unobserve(el);
        render(el, el.dataset.example === 'b' ? loaded[1].value : loaded[0].value);
      }
    }, { rootMargin: '300px 0px' });
    const a = host.querySelector('.example-a');
    const b = host.querySelector('.example-b');
    if (a) { a.dataset.example = 'a'; io.observe(a); }
    if (b && loaded[1].value) { b.dataset.example = 'b'; io.observe(b); }
  } else {
    renderCheck(host.querySelector('.example-a'), replayToView(loaded[0].value));
    if (loaded[1].value) renderCheck(host.querySelector('.example-b'), replayToView(loaded[1].value));
  }
}
