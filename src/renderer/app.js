const $ = (id) => document.getElementById(id);
const jobsEl = $('jobs');
const rows = new Map(); // job id -> { li, refs }
let toolsReady = false;
let igLoggedIn = false;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// --- iş listesi ---------------------------------------------------------------
function buildRow(job) {
  const li = el('li', 'job');
  const url = el('div', 'url');
  const st = el('div', 'st');
  const actions = el('div', 'actions');
  const bar = el('div', 'bar');
  bar.appendChild(el('div'));
  li.append(url, actions, st, bar);
  const refs = { li, url, st, actions, bar, details: null };
  rows.set(job.id, refs);
  jobsEl.appendChild(li);
  return refs;
}

const STATUS_LABEL = {
  waiting: 'Bekliyor',
  running: 'İndiriliyor',
  done: 'Tamamlandı',
  partial: 'Kısmen tamamlandı',
  login: 'Giriş gerekiyor',
  failed: 'Başarısız',
  cancelled: 'İptal edildi',
};

function renderJob(job) {
  const r = rows.get(job.id) || buildRow(job);
  r.li.className = 'job ' + job.status;
  r.url.textContent = job.url && job.url !== job.input ? job.url : job.input;
  r.url.title = job.input;
  const label = STATUS_LABEL[job.status];
  r.st.textContent = !job.text ? label : job.text.startsWith(label) ? job.text : `${label} — ${job.text}`;

  // ilerleme çubuğu: gerçek yüzde varsa göster, yoksa sadece çalışırken belirsiz çubuk
  const inner = r.bar.firstChild;
  const showBar = job.status === 'running';
  r.bar.classList.toggle('hidden', !showBar);
  const real = job.stage === 'indiriliyor' && job.percent > 0 && !job.total;
  r.bar.classList.toggle('indeterminate', showBar && !real && !(job.total > 1));
  if (job.total > 1) inner.style.width = Math.round((job.done / job.total) * 100) + '%';
  else if (real) inner.style.width = job.percent + '%';
  else inner.style.width = '';

  // butonlar
  r.actions.textContent = '';
  if (job.status === 'login') {
    const b = el('button', 'small', 'Instagram’a giriş yap');
    b.onclick = async () => { if (await window.odt.igLogin()) window.odt.retry(job.id); };
    r.actions.appendChild(b);
  }
  if (['failed', 'partial', 'login', 'cancelled'].includes(job.status)) {
    const b = el('button', 'small', 'Tekrar dene');
    b.onclick = () => window.odt.retry(job.id);
    r.actions.appendChild(b);
  }
  if (job.status === 'done' && job.files && job.files.length) {
    const b = el('button', 'small ghost', 'Göster');
    b.onclick = () => window.odt.revealFile(job.files[0]);
    r.actions.appendChild(b);
  }

  // Ayrıntılar (kopyalanabilir, çerezsiz log)
  if (r.details) { r.details.remove(); r.details = null; }
  if (job.log && job.log.length && ['failed', 'partial', 'login'].includes(job.status)) {
    const d = el('details');
    d.appendChild(el('summary', null, 'Ayrıntılar'));
    d.appendChild(el('pre', null, job.log.join('\n')));
    r.li.appendChild(d);
    r.details = d;
  }
  updateButtons();
}

function updateButtons() {
  const active = [...rows.values()].some((r) => r.li.classList.contains('running') || r.li.classList.contains('waiting'));
  $('cancel-btn').classList.toggle('hidden', !active);
  $('download-btn').disabled = !toolsReady || !$('links').value.trim();
}

// --- araç kurulumu bandı ----------------------------------------------------
function renderTools(t) {
  toolsReady = t.ready;
  const banner = $('setup');
  const show = !t.ready;
  banner.classList.toggle('hidden', !show);
  banner.classList.toggle('error', !!t.error);
  $('setup-text').textContent = t.error || t.text || 'Hazırlanıyor…';
  const bar = banner.querySelector('.bar');
  bar.classList.toggle('hidden', !!t.error);
  const inner = $('setup-bar');
  if (t.total > 0) { bar.classList.remove('indeterminate'); inner.style.width = Math.round((t.received / t.total) * 100) + '%'; }
  else { bar.classList.add('indeterminate'); inner.style.width = ''; }
  $('setup-retry').classList.toggle('hidden', !t.error);
  updateButtons();
}

// --- Instagram durumu -------------------------------------------------------
function renderIg(s) {
  igLoggedIn = s.loggedIn;
  $('ig-status').textContent = s.loggedIn ? (s.username ? `Giriş yapıldı: @${s.username}` : 'Giriş yapıldı') : 'Instagram: giriş yapılmadı';
  $('ig-btn').textContent = s.loggedIn ? 'Yeniden giriş' : 'Instagram’a giriş yap';
  $('ig-btn').classList.toggle('hidden', s.loggedIn);
}

function renderFolder(p) {
  $('folder-path').textContent = p;
  $('folder-path').title = p;
}

function renderUpdate(info) {
  if (!info) return;
  $('update').classList.remove('hidden');
  $('update-text').textContent = `Yeni sürüm (v${info.version}) hazır → İndir. İndirdikten sonra .dmg’yi açıp programı Uygulamalar klasörüne sürükle ve “Değiştir” de.`;
}
$('update-btn').onclick = () => window.odt.openUpdate();
$('update-check').onclick = async () => {
  $('update-result').textContent = 'Kontrol ediliyor…';
  const info = await window.odt.checkUpdate();
  $('update-result').textContent = info ? `Yeni sürüm var: v${info.version}` : 'Program güncel (ya da kontrol edilemedi).';
};
window.odt.onUpdate(renderUpdate);

// --- olaylar ----------------------------------------------------------------
$('links').addEventListener('input', updateButtons);
$('download-btn').onclick = async () => {
  const text = $('links').value;
  const n = await window.odt.addLinks(text);
  if (n) $('links').value = '';
  updateButtons();
};
$('cancel-btn').onclick = () => window.odt.cancel();
$('clear-btn').onclick = async () => {
  const left = await window.odt.clearFinished();
  const keep = new Set(left.map((j) => j.id));
  for (const [id, r] of rows) if (!keep.has(id)) { r.li.remove(); rows.delete(id); }
  updateButtons();
};
$('ig-btn').onclick = () => window.odt.igLogin();
$('folder-open').onclick = () => window.odt.openFolder();
$('folder-change').onclick = async () => renderFolder(await window.odt.chooseFolder());
$('setup-retry').onclick = () => { renderTools({ ready: false, text: 'Tekrar deneniyor…', total: 0, received: 0 }); window.odt.retryTools(); };
document.querySelectorAll('input[name=format]').forEach((r) => {
  r.addEventListener('change', () => window.odt.setFormat(r.value));
});

$('settings-btn').onclick = async () => {
  $('ig-logout').disabled = !igLoggedIn;
  const t = $('versions');
  t.textContent = '';
  $('settings-dialog').showModal();
  const v = await window.odt.getVersions();
  const names = [['Program', v.app], ['gallery-dl', v['gallery-dl']], ['yt-dlp', v['yt-dlp']], ['ffmpeg', v.ffmpeg], ['deno', v.deno]];
  for (const [n, ver] of names) {
    const tr = el('tr');
    tr.append(el('td', null, n), el('td', null, ver || '—'));
    t.appendChild(tr);
  }
};
$('settings-close').onclick = () => $('settings-dialog').close();
$('ig-logout').onclick = async () => {
  await window.odt.igLogout();
  $('ig-logout').disabled = true;
};

window.odt.onJob(renderJob);
window.odt.onTools(renderTools);
window.odt.onIg(renderIg);

(async () => {
  const s = await window.odt.getState();
  renderFolder(s.settings.outDir);
  document.querySelector(`input[name=format][value=${s.settings.format}]`).checked = true;
  renderIg(s.ig);
  renderTools(s.tools);
  s.jobs.forEach(renderJob);
  renderUpdate(s.update);
})();
