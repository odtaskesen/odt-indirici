// Alt süreç başlatıcı: kabuk yok, UTF-8, satır satır okuma, süreç ağacını kapatma.
// electron'a bağımlı değildir.
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const IS_WIN = process.platform === 'win32';

function lineSplitter(onLine) {
  const dec = new StringDecoder('utf8');
  let buf = '';
  return {
    write(chunk) {
      buf += dec.write(chunk);
      let i;
      while ((i = buf.search(/\r?\n|\r/)) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(buf[i] === '\r' && buf[i + 1] === '\n' ? i + 2 : i + 1);
        if (line) onLine(line);
      }
    },
    end() {
      buf += dec.end();
      if (buf) onLine(buf);
      buf = '';
    },
  };
}

// Çerez değerlerinin log'a sızmasını engelle
function redact(s) {
  return String(s)
    .replace(/\b(sessionid|csrftoken|ds_user_id|ig_did|datr)(\t|=|:\s*["']?)[^\s;"',]+/gi, '$1$2[gizli]')
    .replace(/#HttpOnly_\S+\s.*/g, '[gizli]');
}

// Dönen nesne: { promise, kill, pid }. promise -> { code, signal, killed }
function runProcess(bin, args, { env = {}, onStdout, onStderr, cwd } = {}) {
  const child = spawn(bin, args, {
    shell: false,
    windowsHide: true,
    detached: !IS_WIN, // Mac: kendi süreç grubu, iptalde grubun tamamı kapatılır
    cwd,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let killed = false;
  let exited = false;
  const out = lineSplitter((l) => onStdout && onStdout(l));
  const err = lineSplitter((l) => onStderr && onStderr(l));
  child.stdout.on('data', (d) => out.write(d));
  child.stderr.on('data', (d) => err.write(d));

  const promise = new Promise((resolve) => {
    child.on('error', (e) => {
      exited = true;
      resolve({ code: -1, signal: null, killed, spawnError: e });
    });
    child.on('close', (code, signal) => {
      exited = true;
      out.end();
      err.end();
      resolve({ code, signal, killed });
    });
  });

  function kill() {
    if (exited || killed) return;
    killed = true;
    if (IS_WIN) {
      // /T: alt süreçler dahil, /F: zorla
      spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      setTimeout(() => {
        if (!exited) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      }, 3000).unref();
    }
  }

  return { promise, kill, pid: child.pid };
}

module.exports = { runProcess, redact, IS_WIN };
