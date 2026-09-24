/**
 * 让 Node 直接运行本项目里的 TS 模块（供自测脚本 import 真实代码用）。
 *
 * 解决两件事：
 *   1. tsconfig 里的 `@/*` → `./src/*` 路径别名，Node 原生不认识
 *   2. 无扩展名 / `.json` 的导入需要补齐
 *
 * 为什么不用 tsx / ts-node：为了跑一个自测脚本而往项目里塞一个带 postinstall
 * 的第三方包，供应链代价不值当。这里只用 Node 内置的 ESM loader 钩子。
 *
 * 用法：node --import ./scripts/ts-alias-loader.mjs scripts/xxx.mjs
 */

import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(new URL('./ts-alias-hooks.mjs', import.meta.url), pathToFileURL('./'));
