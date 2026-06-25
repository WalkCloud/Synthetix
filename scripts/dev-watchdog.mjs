#!/usr/bin/env node
/**
 * dev-watchdog.mjs — Turbopack dev server 内存守护
 *
 * 背景:Next.js 16 + Turbopack 在 Apple Silicon 上存在内存泄漏,dev server
 * 运行一段时间后内存暴涨(可达 5GB+)、CPU 占满、卡死无响应(根因见 Vercel
 * issue #81161 / #87796,非应用代码问题)。webpack 模式因 Node 内置模块解析
 * 缺陷不可用,故采用"监控 + 主动重启"策略。
 *
 * 用法:node scripts/dev-watchdog.mjs
 *   环境变量(可选):
 *     DEV_MAX_RSS_MB    触发重启的内存阈值,默认 2500(MB)
 *     DEV_CHECK_INTERVAL_MS  检查间隔,默认 30000(30秒)
 *     DEV_HEALTH_URL    健康检查 URL,默认 http://localhost:3000/login
 *
 * 行为:
 *   1. 若 dev server 未运行,自动用 `pnpm dev` 启动。
 *   2. 周期性检查 next-server 进程 RSS 与健康 URL 响应。
 *   3. 内存超阈值 或 健康检查连续失败 → 优雅杀掉并重启。
 *   4. 重启后日志保留在 tmp/dev-server.log。
 */

import { spawn, exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, appendFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const exec = promisify(execCb);

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LOG_DIR = resolve(PROJECT_ROOT, "tmp");
const LOG_FILE = resolve(LOG_DIR, "dev-server.log");

const MAX_RSS_MB = Number(process.env.DEV_MAX_RSS_MB ?? 2500);
const CHECK_INTERVAL_MS = Number(process.env.DEV_CHECK_INTERVAL_MS ?? 30000);
const HEALTH_URL = process.env.DEV_HEALTH_URL ?? "http://localhost:3000/login";
const HEALTH_FAIL_THRESHOLD = 3; // 连续失败次数

mkdirSync(LOG_DIR, { recursive: true });

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
}

/** 找到 next-server 进程,返回 {pid, rssMb} 或 null */
async function findDevServer() {
  try {
    const { stdout } = await exec("ps aux | grep -E '[n]ext-server' | head -1");
    const line = stdout.trim();
    if (!line) return null;
    const parts = line.split(/\s+/);
    const pid = Number(parts[1]);
    const rssKb = Number(parts[5]);
    return { pid, rssMb: Math.round(rssKb / 1024) };
  } catch {
    return null;
  }
}

/** 启动 dev server */
function startDevServer() {
  log("▶ 启动 dev server (pnpm dev)…");
  // 使用 pnpm 的绝对路径 + 参数数组,避免 shell:true 带来的 DEP0190 警告
  const child = spawn("pnpm", ["dev"], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "ignore", "ignore"],
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  child.unref();
  appendFileSync(LOG_FILE, `\n[watchdog] === 启动 dev server (PID ${child.pid}) ${new Date().toISOString()} ===\n`);
  return child.pid;
}

/** 停止 dev server(连同子进程) */
async function stopDevServer() {
  log("■ 停止 dev server…");
  // next-server 是 pnpm→next→next-server 进程树,逐个杀
  try { await exec("pkill -9 -f 'next-server'"); } catch {}
  try { await exec("pkill -9 -f 'next dev'"); } catch {}
  await new Promise((r) => setTimeout(r, 2000));
}

/** 健康检查 */
async function healthCheck() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok || res.status === 307; // 307=未登录跳转,也算正常
  } catch {
    return false;
  }
}

let healthFails = 0;

async function tick() {
  const proc = await findDevServer();

  // 1. 进程不在 → 启动
  if (!proc) {
    log("⚠ dev server 未运行,启动中…");
    startDevServer();
    return;
  }

  // 2. 内存超阈值 → 重启
  if (proc.rssMb > MAX_RSS_MB) {
    log(`⚠ 内存超阈值 ${proc.rssMb}MB > ${MAX_RSS_MB}MB,主动重启(防泄漏卡死)`);
    await stopDevServer();
    startDevServer();
    healthFails = 0;
    return;
  }

  // 3. 健康检查
  const ok = await healthCheck();
  if (!ok) {
    healthFails++;
    log(`✗ 健康检查失败 (${healthFails}/${HEALTH_FAIL_THRESHOLD}) PID ${proc.pid} ${proc.rssMb}MB`);
    if (healthFails >= HEALTH_FAIL_THRESHOLD) {
      log(`⚠ 连续 ${HEALTH_FAIL_THRESHOLD} 次健康检查失败,重启 dev server`);
      await stopDevServer();
      startDevServer();
      healthFails = 0;
    }
  } else {
    if (healthFails > 0) log(`✓ 恢复正常 PID ${proc.pid} ${proc.rssMb}MB`);
    healthFails = 0;
  }
}

log(`Turbopack dev 守护启动 | 阈值 ${MAX_RSS_MB}MB | 检查间隔 ${CHECK_INTERVAL_MS / 1000}s`);
log(`项目: ${PROJECT_ROOT}`);
log(`日志: ${LOG_FILE}`);

// 确保有一个 dev server 在跑
if (!(await findDevServer())) {
  startDevServer();
}

setInterval(tick, CHECK_INTERVAL_MS);

// 优雅退出
process.on("SIGINT", () => {
  log("守护退出(保留 dev server 运行)");
  process.exit(0);
});
process.on("SIGTERM", () => process.exit(0));
