// 编排层（app.js）的顶层初始化核对。
//
// 为什么需要它：`scripts/lint.mjs` 只有语法门，`test/render.test.js` 只覆盖纯字符串视图，
// 所以「顶层引用了不存在的变量」这类事故两边都看不见。2026-10-28 的实例：
// `syncComposeForPreset()` 重写时删掉了 `const placeholder = …` 却留着引用，
// 函数在 app.js 末尾被顶层调用一次 → `ReferenceError` → 其后的 updateTextCount /
// refreshComposeMode / initThemeSwitcher / loadFeed / 深链全不执行，
// 主题按钮、feed、深链、样例 chips、预设切换一起停摆——lint 绿、217 个用例全绿。
//
// 做法：装一套最小 DOM 桩件，把整个模块图导入一次，再看初始化链有没有真的跑完。
// **新增浏览器 API（ResizeObserver / IntersectionObserver / Element.animate / dialog 等）
// 时在这里补一行桩，不要删断言**——桩件缺了会红在「不是函数」上，那是桩的问题不是代码的问题。
//
// 每个测试文件由 node --test 单独起进程，这里的全局桩件不会污染别的用例。
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** 一个什么都能接住的假元素：读属性给默认值，写属性/调用方法都当无事发生。 */
function fakeElement(id = '') {
  return {
    id,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    value: '',
    checked: false,
    hidden: false,
    open: false,
    disabled: false,
    maxLength: 2000,
    clientWidth: 820,
    clientHeight: 600,
    textContent: '',
    innerHTML: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    append() {},
    prepend() {},
    after() {},
    before() {},
    remove() {},
    replaceChildren() {},
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() {},
    blur() {},
    click() {},
    showModal() {},
    close() {},
    scrollIntoView() {},
    setSelectionRange() {},
    getBoundingClientRect: () => ({ width: 820, height: 600, top: 0, left: 0 }),
    getContext: () => null,
  };
}

test('app.js 顶层初始化跑得完：模块图导入不抛错，初始化链走到 loadFeed', async () => {
  const nodes = new Map();
  const fetched = [];
  let failure = null;
  const onFailure = (error) => { failure = error; };

  globalThis.document = {
    documentElement: fakeElement('html'),
    body: fakeElement('body'),
    head: fakeElement('head'),
    // 同一 id 要拿到同一份节点：app.js 会写 #statusLine 再读回来。
    getElementById: (id) => {
      if (!nodes.has(id)) nodes.set(id, fakeElement(id));
      return nodes.get(id);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => fakeElement(tag),
    createTextNode: () => ({}),
    addEventListener() {},
  };
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.dispatchEvent = () => true;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.localStorage = {
    store: new Map(),
    getItem(key) { return this.store.get(key) ?? null; },
    setItem(key, value) { this.store.set(key, String(value)); },
    removeItem(key) { this.store.delete(key); },
  };
  globalThis.location = { search: '', href: 'http://localhost:5191/', origin: 'http://localhost:5191' };
  // Node 22 自带 navigator 的 getter，只能 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node', clipboard: undefined },
    configurable: true,
    writable: true,
  });
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.scrollTo = () => {};
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    return { ok: true, status: 200, json: async () => ({ posts: [] }), text: async () => '{}' };
  };

  process.on('uncaughtException', onFailure);
  process.on('unhandledRejection', onFailure);

  try {
    await import('../public/app.js');
  } catch (error) {
    assert.fail(`导入 app.js 时抛错：${error?.stack ?? error}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  process.off('uncaughtException', onFailure);
  process.off('unhandledRejection', onFailure);

  assert.equal(failure, null, `初始化后仍有未捕获错误：${failure?.stack ?? failure}`);
  // loadFeed 是 app.js 顶层初始化的最后一步：它被调到，说明前面的语句全都跑过了。
  assert.deepEqual(fetched, ['/api/feed'], '初始化期只该打一次 /api/feed，不该有别的请求');
  // initThemeSwitcher 也在这条链上：没跑通的话主题不会落到默认值。
  assert.equal(globalThis.document.documentElement.dataset.theme, 'instrument', '默认主题该是 instrument');
});
