'use strict';

/* =========================================================
 *  Muscle Manager - 筋トレ記録アプリ
 *  データはすべて localStorage に保存（サーバー不要）
 * ========================================================= */

const STORAGE_KEY = 'mm-data-v1';
const DRAFT_KEY = 'mm-draft-v1';
const SW_KEY = 'mm-stopwatch-v1';
const REST_KEY = 'mm-rest-v1';

const PARTS = ['胸', '背中', '肩', '腕', '脚', '腹', '全身', 'その他'];

const DEFAULT_EXERCISES = [
  ['ベンチプレス', '胸', 120],
  ['ダンベルフライ', '胸', 90],
  ['スクワット', '脚', 150],
  ['レッグプレス', '脚', 120],
  ['デッドリフト', '背中', 180],
  ['ラットプルダウン', '背中', 90],
  ['ショルダープレス', '肩', 90],
  ['サイドレイズ', '肩', 60],
  ['バーベルカール', '腕', 60],
  ['トライセプスプレスダウン', '腕', 60],
  ['クランチ', '腹', 45],
];

/* ---------- utils ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function pad(n, len = 2) { return String(n).padStart(len, '0'); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayStr() { return toDateStr(new Date()); }
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
}
function fmtNum(n) {
  if (!isFinite(n)) return '-';
  return (Math.round(n * 10) / 10).toLocaleString('ja-JP');
}
function fmtSec(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m === 0) return `${s}秒`;
  return s ? `${m}分${s}秒` : `${m}分`;
}
function fmtClock(ms, withCs = true) {
  ms = Math.max(0, ms);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10);
  let out = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  if (withCs) out += `.${pad(cs)}`;
  return out;
}
/** Epley式による推定1RM */
function e1rm(w, r) {
  if (!w || !r) return 0;
  return r === 1 ? w : w * (1 + r / 30);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function loadJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { toast('保存に失敗しました（ストレージ容量を確認してください）'); }
}

/* ---------- data ---------- */
let db = loadJSON(STORAGE_KEY, null);
if (!db || !Array.isArray(db.exercises)) {
  db = {
    exercises: DEFAULT_EXERCISES.map(([name, part, rest]) => ({ id: uid(), name, part, rest, target: null })),
    records: [],
    bodyweights: {},
  };
  saveJSON(STORAGE_KEY, db);
}
db.records ||= [];
db.bodyweights ||= {};

function persist() { saveJSON(STORAGE_KEY, db); }
function exById(id) { return db.exercises.find((e) => e.id === id); }
function exName(id) { return exById(id)?.name ?? '(削除済みメニュー)'; }

function recordStats(rec) {
  let max = 0, maxReps = 0, volume = 0, best1rm = 0, reps = 0;
  for (const s of rec.sets) {
    if (s.w > max || (s.w === max && s.r > maxReps)) { max = s.w; maxReps = s.r; }
    volume += s.w * s.r;
    reps += s.r;
    best1rm = Math.max(best1rm, e1rm(s.w, s.r));
  }
  return { max, maxReps, volume, best1rm, reps, sets: rec.sets.length };
}

function sortedRecords(list = db.records) {
  return [...list].sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1));
}

/** 各記録が自己ベスト更新だったかを判定（過去記録の最大重量を上回ったもの） */
function computePrIds() {
  const best = {};
  const ids = new Set();
  for (const r of sortedRecords()) {
    const { max } = recordStats(r);
    if (r.exerciseId in best && max > best[r.exerciseId]) ids.add(r.id);
    best[r.exerciseId] = Math.max(best[r.exerciseId] ?? -Infinity, max);
  }
  return ids;
}

function bestFor(exerciseId, excludeId) {
  let best = null;
  for (const r of db.records) {
    if (r.exerciseId !== exerciseId || r.id === excludeId) continue;
    const st = recordStats(r);
    if (!best || st.max > best.max || (st.max === best.max && st.maxReps > best.maxReps)) {
      best = { ...st, date: r.date };
    }
  }
  return best;
}
function lastFor(exerciseId, excludeId) {
  const list = sortedRecords(db.records.filter((r) => r.exerciseId === exerciseId && r.id !== excludeId));
  return list[list.length - 1] || null;
}

/* ---------- tabs ---------- */
function showTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${name}`));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'history') renderHistory();
  if (name === 'stats') renderStats();
  if (name === 'menu') renderExerciseList();
  window.scrollTo(0, 0);
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#header-timer').addEventListener('click', () => showTab('timer'));

/* =========================================================
 *  記録タブ
 * ========================================================= */
const logDate = $('#log-date');
const logExercise = $('#log-exercise');
const setsBox = $('#log-sets');
let editingId = null;

function fillExerciseSelect(select, { includeAll = false } = {}) {
  const current = select.value;
  const groups = PARTS.map((p) => {
    const items = db.exercises.filter((e) => e.part === p);
    if (!items.length) return '';
    return `<optgroup label="${esc(p)}">${items.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</optgroup>`;
  }).join('');
  select.innerHTML = (includeAll ? '<option value="">すべてのメニュー</option>' : '') + groups;
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function addSetRow(w = '', r = '') {
  const idx = setsBox.children.length;
  const row = document.createElement('div');
  row.className = 'set-row';
  row.innerHTML = `
    <div class="set-no">${idx + 1}</div>
    <input type="number" class="set-w" inputmode="decimal" step="0.25" min="0" value="${esc(w)}">
    <input type="number" class="set-r" inputmode="numeric" step="1" min="0" value="${esc(r)}">
    <button type="button" class="icon-btn" title="削除">✕</button>`;
  row.querySelector('button').addEventListener('click', () => {
    row.remove();
    renumberSets();
    saveDraft();
  });
  row.querySelectorAll('input').forEach((i) => i.addEventListener('input', saveDraft));
  setsBox.appendChild(row);
  applySetPlaceholders();
  return row;
}
function renumberSets() {
  [...setsBox.children].forEach((row, i) => { row.querySelector('.set-no').textContent = i + 1; });
  applySetPlaceholders();
}
/** 前回記録の値をプレースホルダーとして表示 */
function applySetPlaceholders() {
  const last = lastFor(logExercise.value, editingId);
  [...setsBox.children].forEach((row, i) => {
    const s = last?.sets[Math.min(i, last.sets.length - 1)];
    row.querySelector('.set-w').placeholder = s ? s.w : 'kg';
    row.querySelector('.set-r').placeholder = s ? s.r : '回';
  });
}
function readSets() {
  return [...setsBox.children].map((row) => {
    const wi = row.querySelector('.set-w'), ri = row.querySelector('.set-r');
    const w = wi.value === '' ? parseFloat(wi.placeholder) : parseFloat(wi.value);
    const r = ri.value === '' ? parseInt(ri.placeholder, 10) : parseInt(ri.value, 10);
    return { w: isFinite(w) ? w : NaN, r: isFinite(r) ? r : NaN, touched: wi.value !== '' || ri.value !== '' };
  });
}
function resetSets(n = 3) {
  setsBox.innerHTML = '';
  for (let i = 0; i < n; i++) addSetRow();
}

function renderPrevInfo() {
  const box = $('#log-prev');
  const id = logExercise.value;
  if (!id) { box.innerHTML = ''; return; }
  const last = lastFor(id, editingId);
  const best = bestFor(id, editingId);
  const ex = exById(id);
  const parts = [];
  if (last) {
    parts.push(`<div>前回 (${fmtDate(last.date)}): ${last.sets.map((s) => `${fmtNum(s.w)}kg×${s.r}`).join(', ')}
      <button type="button" class="btn small secondary" id="btn-copy-last">前回をコピー</button></div>`);
  }
  if (best) parts.push(`<div>自己ベスト: <b>${fmtNum(best.max)}kg × ${best.maxReps}回</b> (${fmtDate(best.date)}) / 推定1RM ${fmtNum(bestFor1rm(id))}kg</div>`);
  if (ex?.target) parts.push(`<div>目標: ${fmtNum(ex.target)}kg ${best && best.max >= ex.target ? '✅ 達成済み' : best ? `(あと ${fmtNum(ex.target - best.max)}kg)` : ''}</div>`);
  if (!last) parts.push('<div>この種目の初めての記録です</div>');
  box.innerHTML = parts.join('');
  $('#btn-copy-last')?.addEventListener('click', () => {
    setsBox.innerHTML = '';
    last.sets.forEach((s) => addSetRow(s.w, s.r));
    if (last.rest) $('#log-rest').value = last.rest;
    saveDraft();
  });
}
function bestFor1rm(id) {
  let best = 0;
  for (const r of db.records) if (r.exerciseId === id && r.id !== editingId) best = Math.max(best, recordStats(r).best1rm);
  return best;
}

function onExerciseChange() {
  const ex = exById(logExercise.value);
  if (ex && !editingId) $('#log-rest').value = ex.rest ?? 90;
  renderPrevInfo();
  applySetPlaceholders();
  saveDraft();
}

function saveDraft() {
  if (editingId) return;
  saveJSON(DRAFT_KEY, {
    exerciseId: logExercise.value,
    sets: [...setsBox.children].map((row) => [row.querySelector('.set-w').value, row.querySelector('.set-r').value]),
    rest: $('#log-rest').value,
    rpe: $('#log-rpe').value,
    note: $('#log-note').value,
  });
}
function restoreDraft() {
  const d = loadJSON(DRAFT_KEY, null);
  if (d && exById(d.exerciseId)) logExercise.value = d.exerciseId;
  setsBox.innerHTML = '';
  if (d?.sets?.length) d.sets.forEach(([w, r]) => addSetRow(w, r));
  else resetSets();
  const ex = exById(logExercise.value);
  $('#log-rest').value = d?.rest || ex?.rest || 90;
  $('#log-rpe').value = d?.rpe || '';
  $('#log-note').value = d?.note || '';
  renderPrevInfo();
  applySetPlaceholders();
}

function clearForm() {
  editingId = null;
  $('#log-form-title').textContent = 'トレーニングを記録';
  $('#btn-save-log').textContent = '保存';
  $('#btn-cancel-edit').classList.add('hidden');
  resetSets();
  $('#log-note').value = '';
  $('#log-rpe').value = '';
  const ex = exById(logExercise.value);
  $('#log-rest').value = ex?.rest ?? 90;
  localStorage.removeItem(DRAFT_KEY);
  renderPrevInfo();
}

function startEdit(id) {
  const rec = db.records.find((r) => r.id === id);
  if (!rec) return;
  editingId = id;
  showTab('log');
  logDate.value = rec.date;
  renderBodyweight();
  logExercise.value = rec.exerciseId;
  setsBox.innerHTML = '';
  rec.sets.forEach((s) => addSetRow(s.w, s.r));
  $('#log-rest').value = rec.rest ?? '';
  $('#log-rpe').value = rec.rpe ?? '';
  $('#log-note').value = rec.note ?? '';
  $('#log-form-title').textContent = `記録を編集 (${fmtDate(rec.date)})`;
  $('#btn-save-log').textContent = '更新';
  $('#btn-cancel-edit').classList.remove('hidden');
  renderPrevInfo();
  renderDay();
  $('#log-form').scrollIntoView({ behavior: 'smooth' });
}

function deleteRecord(id) {
  if (!confirm('この記録を削除しますか？')) return;
  db.records = db.records.filter((r) => r.id !== id);
  persist();
  if (editingId === id) clearForm();
  renderDay();
  renderHistory();
  renderPrevInfo();
  toast('削除しました');
}

$('#log-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const exerciseId = logExercise.value;
  if (!exerciseId) { toast('メニューを選択してください'); return; }
  const raw = readSets();
  // 未入力（プレースホルダーのみ）の行は、何かしら入力された行が1つもない場合のみ前回値として採用
  const anyTouched = raw.some((s) => s.touched);
  const sets = raw
    .filter((s) => (anyTouched ? s.touched : true))
    .filter((s) => isFinite(s.w) && isFinite(s.r) && s.r > 0)
    .map(({ w, r }) => ({ w, r }));
  if (!sets.length) { toast('重量と回数を入力してください'); return; }

  const restVal = parseInt($('#log-rest').value, 10);
  const data = {
    date: logDate.value || todayStr(),
    exerciseId,
    sets,
    rest: isFinite(restVal) ? restVal : null,
    rpe: $('#log-rpe').value ? Number($('#log-rpe').value) : null,
    note: $('#log-note').value.trim(),
  };

  const prevBest = bestFor(exerciseId, editingId);
  const newMax = Math.max(...sets.map((s) => s.w));

  if (editingId) {
    const rec = db.records.find((r) => r.id === editingId);
    Object.assign(rec, data);
    toast('更新しました');
  } else {
    db.records.push({ id: uid(), createdAt: Date.now(), ...data });
    if (prevBest && newMax > prevBest.max) toast(`🎉 自己ベスト更新！ ${fmtNum(newMax)}kg`);
    else toast('保存しました');
  }
  persist();
  clearForm();
  renderDay();
});

$('#btn-cancel-edit').addEventListener('click', () => { clearForm(); restoreDraft(); renderDay(); });
$('#btn-add-set').addEventListener('click', () => { addSetRow(); saveDraft(); });
$('#btn-copy-set').addEventListener('click', () => {
  const rows = [...setsBox.children];
  const last = rows[rows.length - 1];
  const w = last?.querySelector('.set-w').value ?? '';
  const r = last?.querySelector('.set-r').value ?? '';
  addSetRow(w, r);
  saveDraft();
});
logExercise.addEventListener('change', onExerciseChange);
['#log-rest', '#log-rpe', '#log-note'].forEach((s) => $(s).addEventListener('input', saveDraft));
logDate.addEventListener('change', () => { renderBodyweight(); renderDay(); });

/* 体重 */
function renderBodyweight() {
  const v = db.bodyweights[logDate.value];
  $('#log-bodyweight').value = v ?? '';
}
$('#log-bodyweight').addEventListener('change', (e) => {
  const v = parseFloat(e.target.value);
  if (isFinite(v) && v > 0) db.bodyweights[logDate.value] = v;
  else delete db.bodyweights[logDate.value];
  persist();
  toast('体重を保存しました');
});

function recordHtml(rec, prIds, { showDate = false } = {}) {
  const st = recordStats(rec);
  const ex = exById(rec.exerciseId);
  const meta = [
    `${st.sets}セット`,
    `総${st.reps}回`,
    `ボリューム ${fmtNum(st.volume)}kg`,
    rec.rest != null ? `休憩 ${fmtSec(rec.rest)}` : null,
    rec.rpe ? `RPE ${rec.rpe}` : null,
  ].filter(Boolean).join(' / ');
  return `
    <div class="record">
      <div class="record-head">
        <div>
          ${ex ? `<span class="part-tag">${esc(ex.part)}</span>` : ''}
          <span class="record-title">${esc(exName(rec.exerciseId))}</span>
          ${prIds.has(rec.id) ? '<span class="pr-badge">PR</span>' : ''}
          ${showDate ? `<span class="record-meta"> ${fmtDate(rec.date)}</span>` : ''}
        </div>
        <div class="record-actions">
          <button class="btn small ghost" data-edit="${rec.id}">編集</button>
          <button class="btn small ghost" data-del="${rec.id}">削除</button>
        </div>
      </div>
      <div class="record-sets">最大 <b>${fmtNum(st.max)}kg</b>　${rec.sets.map((s) => `${fmtNum(s.w)}×${s.r}`).join(' , ')}</div>
      <div class="record-meta">${meta}</div>
      ${rec.note ? `<div class="record-meta">📝 ${esc(rec.note)}</div>` : ''}
    </div>`;
}
function bindRecordActions(container) {
  container.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => startEdit(b.dataset.edit)));
  container.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => deleteRecord(b.dataset.del)));
}

function renderDay() {
  const date = logDate.value;
  const list = sortedRecords(db.records.filter((r) => r.date === date));
  const box = $('#day-records');
  const prIds = computePrIds();
  if (!list.length) {
    box.innerHTML = '<div class="empty">まだ記録がありません</div>';
    $('#day-summary').textContent = '';
    return;
  }
  let sets = 0, volume = 0;
  list.forEach((r) => { const s = recordStats(r); sets += s.sets; volume += s.volume; });
  const exCount = new Set(list.map((r) => r.exerciseId)).size;
  $('#day-summary').textContent = `${exCount}種目 / ${sets}セット / 総ボリューム ${fmtNum(volume)}kg`;
  box.innerHTML = list.map((r) => recordHtml(r, prIds)).join('');
  bindRecordActions(box);
}

/* =========================================================
 *  タイマー（休憩タイマー＆ストップウォッチ）
 *  時刻ベースで計算するので、画面を閉じても・リロードしてもズレない
 * ========================================================= */
let audioCtx = null;
function unlockAudio() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* 音が出せない環境 */ }
}
function beep(times = 3) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  for (let i = 0; i < times; i++) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain); gain.connect(audioCtx.destination);
    const t = now + i * 0.35;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.start(t); osc.stop(t + 0.3);
  }
}

/* --- 休憩タイマー --- */
let rest = loadJSON(REST_KEY, { duration: 90, endAt: null, remaining: 90 * 1000, notified: false });
function saveRest() { saveJSON(REST_KEY, rest); }
function restRemaining() {
  return rest.endAt ? rest.endAt - Date.now() : rest.remaining;
}
function startRest(sec) {
  unlockAudio();
  if (sec != null) { rest.duration = sec; rest.remaining = sec * 1000; }
  if (rest.remaining <= 0) rest.remaining = rest.duration * 1000;
  rest.endAt = Date.now() + rest.remaining;
  rest.notified = false;
  saveRest();
  renderTimers();
}
function pauseRest() {
  rest.remaining = Math.max(0, restRemaining());
  rest.endAt = null;
  saveRest();
  renderTimers();
}
function resetRest(sec = rest.duration) {
  rest.duration = sec;
  rest.remaining = sec * 1000;
  rest.endAt = null;
  rest.notified = false;
  saveRest();
  renderTimers();
}
function adjustRest(deltaSec) {
  if (rest.endAt) {
    rest.endAt = Math.max(Date.now(), rest.endAt + deltaSec * 1000);
    rest.notified = rest.endAt <= Date.now() ? rest.notified : false;
  } else {
    rest.remaining = Math.max(0, rest.remaining + deltaSec * 1000);
  }
  rest.duration = Math.max(5, rest.duration + deltaSec);
  saveRest();
  renderTimers();
}

$('#rest-start').addEventListener('click', () => {
  if (rest.endAt && restRemaining() > 0) pauseRest();
  else if (rest.endAt) resetRest();
  else startRest();
});
$('#rest-reset').addEventListener('click', () => resetRest());
$('#rest-minus').addEventListener('click', () => adjustRest(-15));
$('#rest-plus').addEventListener('click', () => adjustRest(15));
$$('#rest-presets .chip').forEach((c) => c.addEventListener('click', () => startRest(Number(c.dataset.sec))));

/* 記録フォームから休憩開始 */
const restQuick = document.createElement('button');
restQuick.type = 'button';
restQuick.className = 'btn secondary';
restQuick.textContent = '⏱ 休憩開始';
restQuick.addEventListener('click', () => {
  const sec = parseInt($('#log-rest').value, 10);
  startRest(isFinite(sec) && sec > 0 ? sec : 90);
  toast(`休憩タイマー開始 (${fmtSec(rest.duration)})`);
});
$('#log-rest').closest('.row').appendChild(restQuick);

/* --- ストップウォッチ --- */
let sw = loadJSON(SW_KEY, { startAt: null, elapsed: 0, laps: [] });
function saveSw() { saveJSON(SW_KEY, sw); }
function swElapsed() { return sw.elapsed + (sw.startAt ? Date.now() - sw.startAt : 0); }

$('#sw-start').addEventListener('click', () => {
  if (sw.startAt) { sw.elapsed = swElapsed(); sw.startAt = null; }
  else sw.startAt = Date.now();
  saveSw();
  renderTimers();
  renderLaps();
});
$('#sw-lap').addEventListener('click', () => {
  sw.laps.push(swElapsed());
  saveSw();
  renderLaps();
});
$('#sw-reset').addEventListener('click', () => {
  sw = { startAt: null, elapsed: 0, laps: [] };
  saveSw();
  renderTimers();
  renderLaps();
});
function renderLaps() {
  const ol = $('#sw-laps');
  let prev = 0;
  const items = sw.laps.map((t, i) => {
    const split = t - prev; prev = t;
    return `<li><span>ラップ ${i + 1}</span><span>${fmtClock(split)}</span><span>${fmtClock(t)}</span></li>`;
  });
  ol.innerHTML = items.reverse().join('');
}

function renderTimers() {
  // 休憩タイマー
  const remain = restRemaining();
  const restEl = $('#rest-display');
  const running = !!rest.endAt;
  restEl.textContent = fmtClock(Math.max(0, remain) + (remain > 0 ? 999 : 0), false);
  const done = running && remain <= 0;
  restEl.classList.toggle('done', done);
  $('#rest-progress').style.width = `${Math.min(100, Math.max(0, (1 - remain / (rest.duration * 1000)) * 100))}%`;
  $('#rest-start').textContent = done ? 'リセット' : running ? '一時停止' : (remain < rest.duration * 1000 && remain > 0 ? '再開' : 'スタート');

  if (done && !rest.notified) {
    rest.notified = true;
    saveRest();
    if ($('#rest-sound').checked) {
      beep();
      navigator.vibrate?.([300, 150, 300, 150, 300]);
    }
    toast('⏰ 休憩終了！次のセットへ');
  }

  // ストップウォッチ
  $('#sw-display').textContent = fmtClock(swElapsed());
  $('#sw-start').textContent = sw.startAt ? 'ストップ' : (sw.elapsed ? '再開' : 'スタート');
  $('#sw-lap').disabled = !sw.startAt;

  // ヘッダーのミニ表示
  const head = $('#header-timer');
  if (running) {
    head.textContent = done ? '⏰ 休憩終了' : `⏳ ${fmtClock(remain + 999, false)}`;
    head.classList.remove('hidden');
  } else if (sw.startAt) {
    head.textContent = `⏱ ${fmtClock(swElapsed(), false)}`;
    head.classList.remove('hidden');
  } else {
    head.classList.add('hidden');
  }
}
setInterval(renderTimers, 50);
document.addEventListener('visibilitychange', renderTimers);

/* =========================================================
 *  履歴タブ
 * ========================================================= */
let calMonth = new Date(); calMonth.setDate(1);

function renderCalendar() {
  const y = calMonth.getFullYear(), m = calMonth.getMonth();
  $('#cal-title').textContent = `${y}年${m + 1}月`;
  const counts = {};
  db.records.forEach((r) => {
    counts[r.date] ||= new Set();
    counts[r.date].add(r.exerciseId);
  });
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const today = todayStr();
  let html = '日月火水木金土'.split('').map((d) => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++) html += '<div class="day blank"></div>';
  let trainDays = 0;
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`;
    const c = counts[ds]?.size || 0;
    if (c) trainDays++;
    html += `<div class="day${c ? ' has' : ''}${ds === today ? ' today' : ''}" data-date="${ds}">${d}${c ? `<small>${c}種目</small>` : ''}</div>`;
  }
  const cal = $('#calendar');
  cal.innerHTML = html;
  $('#cal-title').textContent += `（${trainDays}日）`;
  cal.querySelectorAll('[data-date]').forEach((el) => el.addEventListener('click', () => {
    logDate.value = el.dataset.date;
    renderBodyweight();
    renderDay();
    showTab('log');
  }));
}
$('#cal-prev').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() - 1); renderCalendar(); });
$('#cal-next').addEventListener('click', () => { calMonth.setMonth(calMonth.getMonth() + 1); renderCalendar(); });

function renderHistory() {
  renderCalendar();
  fillExerciseSelect($('#history-filter'), { includeAll: true });
  const filter = $('#history-filter').value;
  const list = sortedRecords(db.records.filter((r) => !filter || r.exerciseId === filter)).reverse();
  const box = $('#history-list');
  if (!list.length) { box.innerHTML = '<div class="empty">記録がありません</div>'; return; }
  const prIds = computePrIds();
  let html = '', lastDate = null;
  for (const r of list.slice(0, 200)) {
    if (r.date !== lastDate) {
      const bw = db.bodyweights[r.date];
      html += `<div class="date-head">${fmtDate(r.date)} ${r.date.slice(0, 4)}${bw ? `　体重 ${fmtNum(bw)}kg` : ''}</div>`;
      lastDate = r.date;
    }
    html += recordHtml(r, prIds);
  }
  if (list.length > 200) html += '<div class="empty">直近200件を表示しています</div>';
  box.innerHTML = html;
  bindRecordActions(box);
}
$('#history-filter').addEventListener('change', renderHistory);

/* =========================================================
 *  統計タブ
 * ========================================================= */
function weekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7; // 月曜始まり
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return [toDateStr(start), toDateStr(end)];
}

function renderStats() {
  const [ws, we] = weekRange();
  const week = db.records.filter((r) => r.date >= ws && r.date <= we);
  const days = new Set(week.map((r) => r.date)).size;
  let sets = 0, volume = 0;
  const partSets = {};
  week.forEach((r) => {
    const st = recordStats(r);
    sets += st.sets; volume += st.volume;
    const part = exById(r.exerciseId)?.part ?? 'その他';
    partSets[part] = (partSets[part] || 0) + st.sets;
  });
  $('#week-stats').innerHTML = `
    <div class="stat"><b>${days}</b><span>トレーニング日数</span></div>
    <div class="stat"><b>${sets}</b><span>総セット数</span></div>
    <div class="stat"><b>${volume >= 10000 ? `${fmtNum(volume / 1000)}t` : `${fmtNum(volume)}kg`}</b><span>総ボリューム</span></div>`;
  const maxPart = Math.max(1, ...Object.values(partSets));
  $('#part-volume').innerHTML = `<div class="hint" style="margin-bottom:6px">部位別セット数（今週）</div>` +
    PARTS.map((p) => `
      <div class="bar-row"><span>${p}</span>
        <div><div class="bar" style="width:${((partSets[p] || 0) / maxPart) * 100}%"></div></div>
        <span class="val">${partSets[p] || 0}セット</span></div>`).join('');

  // PR一覧
  const rows = db.exercises.map((ex) => {
    const best = bestFor(ex.id);
    if (!best) return null;
    const oneRm = bestFor1rm(ex.id);
    const reached = ex.target && best.max >= ex.target;
    return `<tr>
      <td>${esc(ex.name)}${reached ? ' ✅' : ''}</td>
      <td class="num">${fmtNum(best.max)}kg×${best.maxReps}</td>
      <td class="num">${fmtNum(oneRm)}kg</td>
      <td class="num">${fmtDate(best.date)}</td></tr>`;
  }).filter(Boolean);
  $('#pr-table').innerHTML = rows.length
    ? `<table><thead><tr><th>種目</th><th class="num">最大重量</th><th class="num">推定1RM</th><th class="num">日付</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    : '<div class="empty">記録するとここに自己ベストが表示されます</div>';

  fillExerciseSelect($('#chart-exercise'));
  drawChart();
}

let chartMetric = 'max';
$$('#chart-metric .chip').forEach((c) => c.addEventListener('click', () => {
  $$('#chart-metric .chip').forEach((x) => x.classList.toggle('active', x === c));
  chartMetric = c.dataset.metric;
  drawChart();
}));
$('#chart-exercise').addEventListener('change', drawChart);
window.addEventListener('resize', () => { if ($('#tab-stats').classList.contains('active')) drawChart(); });

function chartData() {
  if (chartMetric === 'bodyweight') {
    return Object.entries(db.bodyweights).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, v }));
  }
  const id = $('#chart-exercise').value;
  const byDate = {};
  for (const r of db.records) {
    if (r.exerciseId !== id) continue;
    const st = recordStats(r);
    const v = chartMetric === 'max' ? st.max : chartMetric === 'e1rm' ? st.best1rm : st.volume;
    byDate[r.date] = chartMetric === 'volume' ? (byDate[r.date] || 0) + v : Math.max(byDate[r.date] || 0, v);
  }
  return Object.entries(byDate).sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, v]) => ({ date, v }));
}

function drawChart() {
  const canvas = $('#chart');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300, h = 220;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const cText = css.getPropertyValue('--muted').trim();
  const cLine = css.getPropertyValue('--primary').trim();
  const cGrid = css.getPropertyValue('--border').trim();
  ctx.font = '11px sans-serif';
  ctx.fillStyle = cText;

  const data = chartData();
  if (!data.length) {
    ctx.textAlign = 'center';
    ctx.fillText('データがありません', w / 2, h / 2);
    return;
  }
  const pl = 44, pr = 12, pt = 12, pb = 26;
  const vals = data.map((d) => d.v);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min -= 5; max += 5; }
  const span = max - min; min -= span * 0.1; max += span * 0.1;
  if (min < 0 && Math.min(...vals) >= 0) min = 0;
  const t0 = parseDate(data[0].date).getTime(), t1 = parseDate(data[data.length - 1].date).getTime();
  const x = (d) => (data.length === 1 || t1 === t0 ? pl + (w - pl - pr) / 2 : pl + ((parseDate(d.date).getTime() - t0) / (t1 - t0)) * (w - pl - pr));
  const y = (v) => pt + (1 - (v - min) / (max - min)) * (h - pt - pb);

  // grid
  ctx.strokeStyle = cGrid; ctx.lineWidth = 1; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    const yy = y(v);
    ctx.beginPath(); ctx.moveTo(pl, yy); ctx.lineTo(w - pr, yy); ctx.stroke();
    ctx.fillText(fmtNum(v), pl - 6, yy);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left'; ctx.fillText(fmtDate(data[0].date), pl, h - pb + 8);
  if (data.length > 1) { ctx.textAlign = 'right'; ctx.fillText(fmtDate(data[data.length - 1].date), w - pr, h - pb + 8); }

  // line
  ctx.strokeStyle = cLine; ctx.lineWidth = 2;
  ctx.beginPath();
  data.forEach((d, i) => (i ? ctx.lineTo(x(d), y(d.v)) : ctx.moveTo(x(d), y(d.v))));
  ctx.stroke();
  ctx.fillStyle = cLine;
  data.forEach((d) => { ctx.beginPath(); ctx.arc(x(d), y(d.v), 3.5, 0, Math.PI * 2); ctx.fill(); });

  // 最高値ラベル
  const top = data.reduce((a, b) => (b.v > a.v ? b : a));
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.font = 'bold 11px sans-serif';
  ctx.fillText(fmtNum(top.v), Math.min(Math.max(x(top), pl + 14), w - pr - 14), Math.max(y(top.v) - 6, 12));
}

/* 1RM計算機 */
function renderCalc() {
  const w = parseFloat($('#calc-weight').value), r = parseInt($('#calc-reps').value, 10);
  const box = $('#calc-result');
  if (!(w > 0 && r > 0)) { box.innerHTML = '<p class="hint">重量と回数を入力すると推定1RMと各回数の目安重量を表示します（Epley式）</p>'; return; }
  const one = e1rm(w, r);
  const reps = [1, 2, 3, 5, 6, 8, 10, 12, 15];
  box.innerHTML = `<p>推定1RM: <b>${fmtNum(one)}kg</b></p>
    <table><thead><tr><th>回数</th><th class="num">目安重量</th><th class="num">%1RM</th></tr></thead><tbody>
    ${reps.map((n) => { const v = n === 1 ? one : one / (1 + n / 30); return `<tr><td>${n}回</td><td class="num">${fmtNum(v)}kg</td><td class="num">${Math.round((v / one) * 100)}%</td></tr>`; }).join('')}
    </tbody></table>`;
}
$('#calc-weight').addEventListener('input', renderCalc);
$('#calc-reps').addEventListener('input', renderCalc);

/* =========================================================
 *  メニュータブ
 * ========================================================= */
let editingExId = null;
$('#ex-part').innerHTML = PARTS.map((p) => `<option>${p}</option>`).join('');

function renderExerciseList() {
  const box = $('#ex-list');
  const counts = {};
  db.records.forEach((r) => { counts[r.exerciseId] = (counts[r.exerciseId] || 0) + 1; });
  if (!db.exercises.length) { box.innerHTML = '<div class="empty">メニューがありません</div>'; return; }
  box.innerHTML = PARTS.map((p) => {
    const items = db.exercises.filter((e) => e.part === p);
    if (!items.length) return '';
    return `<div class="date-head">${p}</div>` + items.map((e) => {
      const best = bestFor(e.id);
      return `<div class="record">
        <div class="record-head">
          <div><span class="record-title">${esc(e.name)}</span></div>
          <div class="record-actions">
            <button class="btn small ghost" data-exedit="${e.id}">編集</button>
            <button class="btn small ghost" data-exdel="${e.id}">削除</button>
          </div>
        </div>
        <div class="record-meta">
          標準休憩 ${fmtSec(e.rest ?? 90)}
          ${e.target ? ` / 目標 ${fmtNum(e.target)}kg` : ''}
          ${best ? ` / 最大 ${fmtNum(best.max)}kg` : ''}
          / 記録 ${counts[e.id] || 0}件
        </div>
      </div>`;
    }).join('');
  }).join('');
  box.querySelectorAll('[data-exedit]').forEach((b) => b.addEventListener('click', () => {
    const e = exById(b.dataset.exedit);
    editingExId = e.id;
    $('#ex-name').value = e.name;
    $('#ex-part').value = e.part;
    $('#ex-rest').value = e.rest ?? 90;
    $('#ex-target').value = e.target ?? '';
    $('#ex-form-title').textContent = 'メニューを編集';
    $('#ex-cancel').classList.remove('hidden');
    $('#ex-form').scrollIntoView({ behavior: 'smooth' });
  }));
  box.querySelectorAll('[data-exdel]').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.exdel;
    const n = counts[id] || 0;
    const msg = n ? `「${exName(id)}」と関連する記録${n}件を削除しますか？` : `「${exName(id)}」を削除しますか？`;
    if (!confirm(msg)) return;
    db.exercises = db.exercises.filter((e) => e.id !== id);
    db.records = db.records.filter((r) => r.exerciseId !== id);
    persist();
    refreshAll();
    toast('削除しました');
  }));
}

function resetExForm() {
  editingExId = null;
  $('#ex-form').reset();
  $('#ex-rest').value = 90;
  $('#ex-form-title').textContent = 'メニューを追加';
  $('#ex-cancel').classList.add('hidden');
}
$('#ex-cancel').addEventListener('click', resetExForm);
$('#ex-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#ex-name').value.trim();
  if (!name) return;
  const dup = db.exercises.find((x) => x.name === name && x.id !== editingExId);
  if (dup) { toast('同じ名前のメニューがあります'); return; }
  const rest = parseInt($('#ex-rest').value, 10);
  const target = parseFloat($('#ex-target').value);
  const data = {
    name,
    part: $('#ex-part').value,
    rest: isFinite(rest) ? rest : 90,
    target: isFinite(target) && target > 0 ? target : null,
  };
  if (editingExId) Object.assign(exById(editingExId), data);
  else db.exercises.push({ id: uid(), ...data });
  persist();
  toast(editingExId ? 'メニューを更新しました' : 'メニューを追加しました');
  resetExForm();
  refreshAll();
});

/* データ管理 */
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#btn-export').addEventListener('click', () => {
  download(`muscle-manager-${todayStr()}.json`, JSON.stringify({ app: 'muscle-manager', version: 1, ...db }, null, 2), 'application/json');
});
$('#btn-csv').addEventListener('click', () => {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['日付', '種目', '部位', 'セット', '重量(kg)', '回数', '休憩(秒)', 'RPE', 'メモ', '体重(kg)'].map(q).join(',')];
  for (const r of sortedRecords()) {
    const ex = exById(r.exerciseId);
    r.sets.forEach((s, i) => lines.push([r.date, ex?.name, ex?.part, i + 1, s.w, s.r, r.rest, r.rpe, r.note, db.bodyweights[r.date]].map(q).join(',')));
  }
  download(`muscle-manager-${todayStr()}.csv`, '﻿' + lines.join('\r\n'), 'text/csv');
});
$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.exercises) || !Array.isArray(data.records)) throw new Error('invalid');
    const valid = data.records.every((r) => r && typeof r.date === 'string' && Array.isArray(r.sets));
    if (!valid) throw new Error('invalid');
    if (!confirm(`メニュー${data.exercises.length}件・記録${data.records.length}件を復元します。現在のデータは上書きされます。よろしいですか？`)) return;
    db = { exercises: data.exercises, records: data.records, bodyweights: data.bodyweights || {} };
    persist();
    refreshAll();
    toast('復元しました');
  } catch {
    toast('ファイルの形式が正しくありません');
  }
});
$('#btn-reset').addEventListener('click', () => {
  if (!confirm('すべての記録とメニューを削除します。元に戻せません。よろしいですか？')) return;
  if (!confirm('本当に削除しますか？')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(DRAFT_KEY);
  location.reload();
});

/* =========================================================
 *  初期化
 * ========================================================= */
function refreshAll() {
  fillExerciseSelect(logExercise);
  renderPrevInfo();
  applySetPlaceholders();
  renderDay();
  renderExerciseList();
  if ($('#tab-history').classList.contains('active')) renderHistory();
  if ($('#tab-stats').classList.contains('active')) renderStats();
}

logDate.value = todayStr();
fillExerciseSelect(logExercise);
restoreDraft();
renderBodyweight();
renderDay();
renderLaps();
renderCalc();
renderTimers();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
