/**
 * ESM 解析钩子：把 `@/xxx` 映射到 `<项目根>/src/xxx`，并补齐扩展名。
 * 由 ts-alias-loader.mjs 注册，不要直接运行本文件。
 */

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

/** 依次尝试补齐扩展名，返回第一个存在的文件 */
function tryExtensions(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mjs`,
    `${basePath}.js`,
    `${basePath}.json`,
    resolvePath(basePath, 'index.ts'),
    resolvePath(basePath, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = resolvePath(projectRoot, 'src', specifier.slice(2));
    const found = tryExtensions(base);
    if (!found) {
      throw new Error(`无法解析路径别名 ${specifier}（尝试的基准：${base}）`);
    }
    // JSON 需要带上 import 属性，否则 Node 会拒绝加载
    const isJson = found.endsWith('.json');
    return {
      url: pathToFileURL(found).href,
      shortCircuit: true,
      ...(isJson ? { importAttributes: { type: 'json' } } : {}),
    };
  }

  // 相对导入且没有扩展名时也补齐（TS 源码里常见）
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentPath = context.parentURL ? dirname(fileURLToPath(context.parentURL)) : projectRoot;
    const base = resolvePath(parentPath, specifier);
    if (!existsSync(base)) {
      const found = tryExtensions(base);
      if (found) {
        const isJson = found.endsWith('.json');
        return {
          url: pathToFileURL(found).href,
          shortCircuit: true,
          ...(isJson ? { importAttributes: { type: 'json' } } : {}),
        };
      }
    }
  }

  return nextResolve(specifier, context);
}

/**
 * JSON 导入必须声明 `type: "json"`，否则 Node 抛 ERR_IMPORT_ATTRIBUTE_MISSING。
 * 应用源码里写的是 `import map from './x.json'`（打包器会自动处理），
 * 所以在这里替 Node 补上这个属性。
 */
export async function load(url, context, nextLoad) {
  if (url.endsWith('.json')) {
    return nextLoad(url, {
      ...context,
      importAttributes: { ...(context.importAttributes ?? {}), type: 'json' },
    });
  }
  return nextLoad(url, context);
}
