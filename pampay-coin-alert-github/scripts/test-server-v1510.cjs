#!/usr/bin/env node
/**
 * scripts/test-server-v1510.cjs — smoke test بوت سرور v1.5.10
 *   1. سرور با RAILWAY_PUBLIC_DOMAIN بوت می‌شود → پیام فعال‌شدن keep-alive در لاگ.
 *   2. /ping پاسخ ok می‌دهد.
 *   3. /scan/status فیلد serverCode دارد (سرور جدید).
 *   4. بعد از اولین تیک self-ping (30s) پروسه زنده می‌ماند.
 */
const { spawn } = require('child_process');
const http = require('http');

const PORT = 3991;

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path, timeout: 8000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond) => {
    console.log(`  ${cond ? '✅' : '❌'} ${name}`);
    cond ? pass++ : fail++;
  };

  const proc = spawn('node', ['dist/index.js'], {
    cwd: __dirname + '/../server',
    env: { ...process.env, PORT: String(PORT), RAILWAY_PUBLIC_DOMAIN: 'pompay-production.up.railway.app' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });

  try {
    // wait for boot
    let up = false;
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try { up = (await get('/ping')).status === 200; } catch {}
    }
    check('server booted, /ping responded', up);

    const ping = await get('/ping').catch(() => null);
    check('/ping body has ok:true', !!ping && ping.body.includes('"ok"'));

    const st = await get('/scan/status').catch(() => null);
    check('/scan/status responds', !!st && st.status === 200);
    let serverCode = null;
    try { serverCode = JSON.parse(st.body).serverCode; } catch {}
    check('/scan/status has serverCode (new server)', typeof serverCode === 'string' || typeof serverCode === 'number');

    check('keep-alive enabled log present', /self-ping enabled/.test(log));

    // wait past the first self-ping tick (30s boot delay)
    console.log('  … waiting 32s for first keep-alive tick …');
    await new Promise((r) => setTimeout(r, 32000));
    check('process alive after first self-ping tick', !proc.killed && proc.exitCode === null);
    check('no keep-alive ping error in log', !/\[KeepAlive\] ping status (4|5)\d\d/.test(log));
  } finally {
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1000));
    proc.kill('SIGKILL');
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} PASS`);
  process.exit(fail === 0 ? 0 : 1);
})();
