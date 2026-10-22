// Sıralı indirme kuyruğu. electron'a bağımlı değildir; bağımlılıklar dışarıdan verilir.
const { classify, splitInput } = require('./urls');
const ytdlp = require('./ytdlp');
const gallerydl = require('./gallerydl');

const IG_GAP_RANGE = [1, 3]; // art arda iki Instagram işi arasında saniye

class Queue {
  // deps: {
  //   binDir, getOutDir(), getFormat(), configFile,
  //   instagram: { isLoggedIn(), promptLogin(), resolveShare(url), makeCookieFile() -> {file, cleanup} },
  //   onUpdate(job)
  // }
  constructor(deps) {
    this.d = deps;
    this.jobs = [];
    this.nextId = 1;
    this.running = false;
    this.current = null; // { job, kill }
    this.cancelled = false;
    this.loginDeclined = false;
    this.lastWasInstagram = false;
    this.sleepTimer = null;
  }

  get busy() { return this.running; }

  snapshot() { return this.jobs.map((j) => this.view(j)); }

  view(j) {
    const { id, input, url, status, text, stage, percent, done, total, files, log } = j;
    return { id, input, url, status, text, stage, percent, done, total, files, log };
  }

  _emit(job) { this.d.onUpdate(this.view(job)); }

  add(text) {
    const lines = splitInput(text);
    const added = lines.map((input) => {
      const job = { id: this.nextId++, input, url: input, status: 'waiting', text: 'Bekliyor', stage: '', percent: 0, done: 0, total: 0, files: [], log: [] };
      this.jobs.push(job);
      this._emit(job);
      return job;
    });
    if (added.length) { this.cancelled = false; this.loginDeclined = false; this._loop(); }
    return added.length;
  }

  retry(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status === 'running' || job.status === 'waiting' || job.status === 'done') return;
    Object.assign(job, { status: 'waiting', text: 'Bekliyor', stage: '', percent: 0, done: 0, total: 0, files: [], log: [] });
    this.cancelled = false;
    this.loginDeclined = false;
    this._emit(job);
    this._loop();
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === 'waiting' || j.status === 'running');
  }

  // Aktif işi ve bekleyenleri iptal eder; alt süreç ağacı kapatılır.
  cancelAll() {
    this.cancelled = true;
    if (this.sleepTimer) { clearTimeout(this.sleepTimer.t); this.sleepTimer.resolve(); }
    if (this.current) this.current.kill();
    for (const j of this.jobs) {
      if (j.status === 'waiting') this._set(j, { status: 'cancelled', text: 'İptal edildi' });
    }
  }

  _set(job, patch) { Object.assign(job, patch); this._emit(job); }

  async _loop() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const job = this.jobs.find((j) => j.status === 'waiting');
        if (!job) break;
        try {
          await this._runJob(job);
        } catch (e) {
          this._set(job, { status: 'failed', text: 'Beklenmeyen hata: ' + String(e.message || e).slice(0, 160) });
        }
        this.current = null;
      }
    } finally {
      this.running = false;
      this.lastWasInstagram = false;
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.sleepTimer = null; resolve(); }, ms);
      this.sleepTimer = { t, resolve };
    });
  }

  async _runJob(job) {
    const { instagram } = this.d;
    let c = classify(job.input);
    job.url = c.url;
    if (c.kind === 'invalid' || c.kind === 'unsupported') {
      return this._set(job, { status: 'failed', text: c.message });
    }

    if (c.kind === 'instagram-share') {
      this._set(job, { status: 'running', text: 'Link çözülüyor…' });
      if (!(await instagram.isLoggedIn())) {
        if (this.loginDeclined || !(await instagram.promptLogin())) {
          this.loginDeclined = true;
          return this._set(job, { status: 'login', text: 'Instagram girişi gerekiyor.' });
        }
      }
      const real = await instagram.resolveShare(c.url);
      c = real ? classify(real) : { kind: 'unsupported', message: 'Paylaşım linki çözülemedi. Gönderiyi açıp normal linkini kopyala.' };
      if (c.kind !== 'instagram') {
        return this._set(job, { status: 'failed', text: c.message || 'Paylaşım linki bir gönderiye çıkmıyor.' });
      }
      job.url = c.url;
    }

    if (this.cancelled) return this._set(job, { status: 'cancelled', text: 'İptal edildi' });

    if (c.kind === 'instagram') return this._runInstagram(job, c.url);
    this.lastWasInstagram = false;
    return this._runYtdlp(job, c.url);
  }

  async _runInstagram(job, url) {
    const { instagram } = this.d;
    if (!(await instagram.isLoggedIn())) {
      if (this.loginDeclined || !(await instagram.promptLogin())) {
        this.loginDeclined = true;
        return this._set(job, { status: 'login', text: 'Instagram girişi gerekiyor.' });
      }
    }

    // Art arda Instagram işleri arasında bekleme (hesap koruması)
    if (this.lastWasInstagram) {
      this._set(job, { status: 'running', text: 'Instagram için kısa bekleme…' });
      const secs = IG_GAP_RANGE[0] + Math.random() * (IG_GAP_RANGE[1] - IG_GAP_RANGE[0]);
      await this._sleep(secs * 1000);
      if (this.cancelled) return this._set(job, { status: 'cancelled', text: 'İptal edildi' });
    }
    this.lastWasInstagram = true;

    this._set(job, { status: 'running', text: 'İndiriliyor…', stage: 'indiriliyor' });
    const cookie = await instagram.makeCookieFile();
    try {
      const h = gallerydl.download(url, {
        binDir: this.d.binDir,
        outDir: this.d.getOutDir(),
        configFile: this.d.configFile,
        cookiesFile: cookie.file,
        onProgress: ({ done, total }) => this._set(job, { done, total, text: `${done}/${total} dosya` }),
      });
      this.current = { job, kill: h.kill };
      const r = await h.promise;
      this._finish(job, r, r.status === 'done' ? `Tamamlandı (${r.done} dosya)` : r.message);
    } finally {
      await cookie.cleanup();
    }
  }

  async _runYtdlp(job, url) {
    this._set(job, { status: 'running', text: 'İndiriliyor…', stage: 'indiriliyor', percent: 0 });
    const h = ytdlp.download(url, {
      binDir: this.d.binDir,
      outDir: this.d.getOutDir(),
      format: this.d.getFormat(),
      onProgress: ({ stage, percent }) => {
        this._set(job, { stage, percent, text: stage === 'birleştiriliyor' ? 'Birleştiriliyor…' : `İndiriliyor %${Math.round(percent)}` });
      },
    });
    this.current = { job, kill: h.kill };
    const r = await h.promise;
    const ext = r.files && r.files[0] ? (r.files[0].match(/\.([A-Za-z0-9]+)$/) || [])[1] : '';
    const label = ext ? `Tamamlandı (${ext.toUpperCase()})` : 'Tamamlandı';
    this._finish(job, r, r.status === 'done' ? label : r.message);
  }

  _finish(job, r, text) {
    const status = r.status === 'cancelled' ? 'cancelled' : r.status;
    this._set(job, { status, text, files: r.files || [], log: r.log || [], done: r.done ?? job.done, total: r.total ?? job.total, percent: status === 'done' ? 100 : job.percent });
  }
}

module.exports = { Queue, IG_GAP_RANGE };
