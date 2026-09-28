// 最小 lint：语法门（node --check）+ 两条文本规则（tab/空格混用、console.log 残留）。
// console.log 规则不扫 scripts/——那里是 CLI，打印就是它的输出。
// 不引 eslint：多 agent 并行阶段先拦"确定错"，风格靠 docs/CONVENTIONS.md 自律。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const roots = ['public', 'worker', 'test']; // scripts/ 是 CLI，console.log 合法，不扫
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (name.endsWith('.js')) files.push(path);
  }
};
roots.forEach(walk);

let bad = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    bad += 1;
    console.error(`✗ ${file}: 语法错误\n${error.stderr?.toString() ?? ''}`);
    continue;
  }
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (/^\t| \t/.test(line)) {
      bad += 1;
      console.error(`✗ ${file}:${i + 1}: tab/空格混用`);
    }
    if (/\bconsole\.log\(/.test(line)) {
      bad += 1;
      console.error(`✗ ${file}:${i + 1}: console.log 残留（worker 用 console.error）`);
    }
  });
}
console.log(bad ? `\n${bad} 处问题` : `✓ ${files.length} 个文件通过`);
process.exit(bad ? 1 : 0);
