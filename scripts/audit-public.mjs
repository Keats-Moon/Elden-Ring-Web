/**
 * 仓库公开前的私人内容审计。
 *
 * 审计三个层面（只看当前提交是不够的，历史同样会暴露）：
 *   1. 工作区/已提交的文件内容
 *   2. Git 历史中的每一个 blob（历史提交里的旧版本）
 *   3. 提交元数据（作者名与邮箱会公开显示在每次提交上）
 *
 * 输出只报告"位置 + 类型 + 是否像真实值"，**不打印完整敏感值**，
 * 避免审计脚本自己变成泄漏源。
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from './env.mjs';

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

/** 遮蔽：只保留首尾少量字符，足以人工核对但不足以复用 */
function mask(s) {
  if (s.length <= 8) return '*'.repeat(s.length);
  return s.slice(0, 4) + '…' + s.slice(-3) + ` (${s.length} 字符)`;
}

console.log('仓库公开前审计');
console.log('='.repeat(72));

/* ── 0. 仓库基本信息 ── */
console.log('');
console.log('[0] 仓库基本信息');
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
const commits = git(['log', '--oneline']).trim().split('\n');
console.log(`  当前分支 : ${branch}`);
console.log(`  提交数   : ${commits.length}`);
commits.forEach((c) => console.log(`    ${c}`));

const remote = git(['remote', 'get-url', 'origin']).trim();
console.log(`  远程     : ${remote}`);

/* ── 1. 提交者身份（会公开显示）── */
console.log('');
console.log('[1] 提交者身份（每次提交都会公开显示在 GitHub 上）');
const authors = git(['log', '--format=%an <%ae>']).trim().split('\n');
const uniqAuthors = [...new Set(authors)];
uniqAuthors.forEach((a) => console.log(`  ${a}`));
console.log('  ⚠ 邮箱会随提交公开。若不希望公开真实邮箱，需要改用 noreply 邮箱并重写历史。');

/* ── 2. 全部历史 blob 中的敏感模式 ── */
console.log('');
console.log('[2] 扫描 Git 历史中的每一个文件版本');

// 列出所有历史中曾出现过的文件路径（含已删除的）
const allPaths = git(['log', '--all', '--pretty=format:', '--name-only'])
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);
const uniqPaths = [...new Set(allPaths)];
console.log(`  历史中出现过的文件路径共 ${uniqPaths.length} 个`);

// 用 git grep 扫所有历史版本
// 用 git grep -E（POSIX ERE）。
// ⚠️ 注意：POSIX ERE **不支持** `\b` 词边界，写了会静默不匹配 ——
// 这个审计脚本最初就因此漏报过，所以这里一律用 `[^...]` 显式界定字符。
const PATTERNS = [
  { name: 'Steam API Key（32 位十六进制）', re: '[0-9A-Fa-f]{32}' },
  { name: 'GitHub Token', re: '(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}' },
  { name: 'AWS Access Key', re: 'AKIA[0-9A-Z]{16}' },
  { name: '私钥文件头', re: 'BEGIN [A-Z ]*PRIVATE KEY' },
  { name: 'SteamID64（17 位数字）', re: '7656119[0-9]{9}' },
  { name: '邮箱地址', re: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}' },
  { name: '疑似硬编码密钥赋值', re: '(api[_-]?key|secret|token|password)["\x27]?[ \t]*[:=][ \t]*["\x27][^"\x27 \t]{20,}' },
];

const findings = [];
for (const { name, re } of PATTERNS) {
  let out = '';
  try {
    out = git(['grep', '-n', '-I', '-E', '-e', re, '--all', '--', '.']);
  } catch {
    // git grep 无命中时返回非零
    continue;
  }
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    // 格式：<rev>:<path>:<lineno>:<content>
    const m = /^([0-9a-f]+):([^:]+):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const [, rev, file, lineno, content] = m;
    const valueMatch = new RegExp(re).exec(content);
    findings.push({
      pattern: name,
      rev: rev.slice(0, 7),
      file,
      lineno,
      sample: valueMatch ? valueMatch[0] : content.trim().slice(0, 40),
    });
  }
}

if (findings.length === 0) {
  console.log('  ✓ 历史中未命中任何敏感模式');
} else {
  // 按 文件 + 模式 聚合，避免同一处被多个提交重复计数
  const grouped = new Map();
  for (const f of findings) {
    const key = `${f.file}||${f.pattern}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(f);
  }
  console.log(`  命中 ${findings.length} 处（涉及 ${grouped.size} 个「文件+模式」组合）：`);
  console.log('');
  for (const [key, list] of grouped) {
    const [file, pattern] = key.split('||');
    const revs = [...new Set(list.map((f) => f.rev))];
    console.log(`  · ${file}`);
    console.log(`      模式   : ${pattern}`);
    console.log(`      行号   : ${[...new Set(list.map((f) => f.lineno))].join(', ')}`);
    console.log(`      涉及版本: ${revs.length > 6 ? revs.length + ' 个提交' : revs.join(', ')}`);
    console.log(`      样例   : ${mask(list[0].sample)}`);
  }
}

/* ── 3. 暂存区与工作区是否有未提交的敏感文件 ── */
console.log('');
console.log('[3] 工作区状态');
const status = git(['status', '--porcelain']).trim();
console.log(status ? `  有未提交改动：\n${status.split('\n').map((l) => '    ' + l).join('\n')}` : '  ✓ 工作区干净');

for (const f of ['.env.local', 'ER0000.sl2', '.next']) {
  const abs = resolve(projectRoot, f);
  const exists = existsSync(abs);
  let ignored = false;
  try {
    git(['check-ignore', '-q', f]);
    ignored = true;
  } catch {
    ignored = false;
  }
  console.log(`  ${f.padEnd(14)} 存在=${exists ? '是' : '否'}  被忽略=${ignored ? '是' : '否'}`);
}

/* ── 4. 结论 ── */
console.log('');
console.log('='.repeat(72));
console.log('审计完成。');
console.log('');
console.log('重要提醒：历史中的内容**无法通过删除文件清除**，必须重写历史。');
console.log('最彻底且最简单的做法：创建一个无历史的新分支作为公开版本。');
