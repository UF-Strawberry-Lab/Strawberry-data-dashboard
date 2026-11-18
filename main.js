// Export web page: an approved researcher signs in, picks trials and weeks,
// and saves scores.csv + plot_visits.csv to a folder of their choosing.
//
// The data comes from the database function export_data()
// (latest: supabase/migrations/20261118000001_student_export_all.sql), which
// refuses anyone who isn't an admin or student (researchers.role); students
// get everyone's data in the trials they may open. The files are built by
// the same code as `npm run export` (scripts/export/format.ts, copied in by
// build.ts), so the two always match.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js?v=1795034313375';
import { buildExport, selectionsFile, TIME_ZONE } from './lib/format.js?v=1795034313375';
import { buildInfoExport, mapFile } from './lib/info.js?v=1795034313375';
import { FORMATS } from './lib/formatted.js?v=1795034313375';
import { weekDates, weekNumber } from './lib/selections.js?v=1795034313375';
import { makeZip } from './zip.js?v=1795034313375';
import { HIGHLIGHT_COLORS, dedupeHighlightRows, parseHighlightRows } from './lib/highlights.js?v=1795034313375';
import { parseCsv } from './lib/csv.js?v=1795034313375';

// Opened from a sign-up or password-reset link? Read the address before the
// Supabase client clears it, so the page can ask for a password straight away.
//  - Lab members links (#setup_token=...&setup_type=invite|recovery): the page
//    shows "Continue" and uses the one-time token only when it's tapped, so
//    Teams/Outlook link previews and scanners can't use it up first.
//  - Older links straight from Supabase (#access_token=...&type=invite, e.g.
//    npm run invite): already signed in by the time the page opens.
const linkParams = new URLSearchParams(location.hash.slice(1));
const setupToken = linkParams.get('setup_token');
const setupType = linkParams.get('setup_type') === 'recovery' ? 'recovery' : 'invite';
let arrivedFrom = linkParams.get('type');                   // 'invite' | 'recovery' | null
const linkError = linkParams.get('error_description');     // e.g. the link expired
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const $ = (id) => document.getElementById(id);
const canSaveAs = typeof window.showSaveFilePicker === 'function';   // Chrome and Edge on a computer

function show(el, text, kind) {
  el.hidden = !text;
  el.textContent = text ?? '';
  if (kind) el.className = `msg ${kind}`;
}

/** Today in Florida as YYYY-MM-DD, and a "2026-11-10_1530" stamp (same as npm run export). */
function floridaNow() {
  const now = new Date();
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, dateStyle: 'short' }).format(now);
  const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, dateStyle: 'short', timeStyle: 'short' })
    .format(now).replace(' ', '_').replace(':', '');
  return { today, stamp };
}
const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// ---------------- sign in ----------------

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginBtn').disabled = true;
  show($('loginMsg'), null);
  const { error } = await supabase.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  $('loginBtn').disabled = false;
  if (error) show($('loginMsg'), error.message, 'err');
  else await start();
});

$('logoutBtn').addEventListener('click', async () => {
  await supabase.auth.signOut();
  location.reload();
});

// ---------------- set up from a link ----------------

function showSetup() {
  $('setup').hidden = false;
  $('login').hidden = true;
  $('app').hidden = true;
  if (setupType === 'recovery') {
    $('setupTitle').textContent = 'Choose a new password';
    $('setupText').textContent = 'Tap Continue to choose a new password. It works here and in the field app.';
  }
}

$('setupBtn').addEventListener('click', async () => {
  $('setupBtn').disabled = true;
  show($('setupMsg'), null);
  // Signs in as the person the link was made for (and uses the link up).
  const { error } = await supabase.auth.verifyOtp({ token_hash: setupToken, type: setupType });
  history.replaceState(null, '', location.pathname);   // the link works once: don't keep it in the address
  if (error) {
    $('setupBtn').hidden = true;
    show($('setupMsg'), 'This link has already been used or has expired. Ask a lab admin for a new one (Lab members → Reset link).', 'err');
    $('login').hidden = false;
    return;
  }
  $('setup').hidden = true;
  arrivedFrom = setupType;   // start() then asks for the password
  await start();
});

// ---------------- change password ----------------
// Signed in already, so no email is needed. The same password works in the field app.

$('pwBtn').addEventListener('click', () => {
  $('pwForm').hidden = false;
  show($('pwMsg'), null);
  $('pw1').focus();
});
$('pwCancel').addEventListener('click', () => { $('pwForm').reset(); $('pwForm').hidden = true; });
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('pw1').value;
  if (pw !== $('pw2').value) return show($('pwMsg'), 'The two passwords are different.', 'err');
  $('pwSave').disabled = true;
  const { error } = await supabase.auth.updateUser({ password: pw });
  $('pwSave').disabled = false;
  if (error) return show($('pwMsg'), error.message, 'err');
  $('pwForm').reset();
  show($('pwMsg'), 'Password changed. Use it next time you sign in here or in the field app.', 'ok');
  if ($('app').classList.contains('password-only')) {
    // From a link: the form's job is done; hide it and offer the dashboard.
    for (const id of ['pw1', 'pw2', 'pwSave']) $(id).disabled = true;
    $('pwDoneRow').hidden = false;
  }
});
// Reload into the normal dashboard (the link is already gone from the address).
$('pwDone').addEventListener('click', () => location.reload());

// ---------------- after sign in ----------------

let season = null;

async function start() {
  const { data: { session } } = await supabase.auth.getSession();
  $('login').hidden = !!session;
  $('app').hidden = !session;
  if (!session) {
    if (arrivedFrom || linkError) show($('loginMsg'), `That link didn't work (${linkError ?? 'expired or already used'}). Ask an admin for a new one.`, 'err');
    return;
  }
  if (arrivedFrom === 'invite' || arrivedFrom === 'recovery') {
    // Opened from a sign-up or reset link: just the password form, nothing
    // else of the dashboard, until the password is saved and they choose
    // "Go to the dashboard" (Mark, 2026-11-12).
    $('app').classList.add('password-only');
    $('pwForm').hidden = false;
    show($('pwMsg'), arrivedFrom === 'invite'
      ? 'Welcome! Choose a password. You will use it here and in the field app.'
      : 'Choose a new password. It works here and in the field app.', 'ok');
    history.replaceState(null, '', location.pathname);   // a reload shouldn't show this again
    const { data: me } = await supabase.from('researchers').select('name').eq('auth_user_id', session.user.id).maybeSingle();
    $('whoName').textContent = me?.name ?? session.user.email;
    $('whoSeason').textContent = '';
    $('pw1').focus();
    return;
  }

  const [me, seasonRes] = await Promise.all([
    supabase.from('researchers').select('id, name, role').eq('auth_user_id', session.user.id).maybeSingle(),
    supabase.from('seasons').select('id, name, start_date').eq('is_current', true).maybeSingle(),
  ]);
  // Roles (docs/spec/access.md): admin and student export and upload
  // highlight lists; admins also review student selections; crew do neither.
  const role = me.data?.role ?? 'crew';
  const meInfo = me.data ? { id: me.data.id, isAdmin: role === 'admin' } : null;
  $('whoName').textContent = me.data?.name ?? session.user.email;
  season = seasonRes.data;
  $('whoSeason').textContent = season ? `Season ${season.name} · ${role}` : 'No current season';
  if (meInfo && season && role !== 'crew') {
    $('hlCard').hidden = false;
    void showLists(meInfo);
    void loadHlOptions();
    traitsMe = meInfo;
    void loadTraits();
  }
  if (meInfo?.isAdmin) {
    $('membersCard').hidden = false;
    void showMembers();
    void showCrewNames();
    $('reviewCard').hidden = false;
    void refreshReview();
  }
  setUpTabs(TABS_BY_ROLE[role] ?? []);
  if (role !== 'admin' && role !== 'student') {
    $('notApproved').hidden = false;
    return;
  }

  // Trials of the current season.
  const { data: trials, error } = await supabase.rpc('export_trials');   // every trial, for approved exporters
  if (error) return show($('exportMsg'), error.message, 'err');
  const box = $('trials');
  box.innerHTML = '';
  const all = document.createElement('label');
  all.className = 'all';
  all.innerHTML = '<input type="checkbox" id="allTrials" checked> All trials';
  box.append(all);
  for (const t of trials) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.name = 'trial';
    cb.value = t.name;
    l.append(cb, ` ${t.name}`);
    box.append(l);
  }
  if (role === 'admin') showInfoFiles(trials.map((t) => t.name));

  // "All trials" and single trials exclude each other.
  box.addEventListener('change', (e) => {
    if (e.target.id === 'allTrials' && e.target.checked) box.querySelectorAll('input[name=trial]').forEach((c) => { c.checked = false; });
    else if (e.target.name === 'trial') $('allTrials').checked = !box.querySelector('input[name=trial]:checked');
  });

  // Formatted trial data: the trials with a format that this account may export.
  const mine = new Set(trials.map((t) => t.name));
  const formatted = Object.keys(FORMATS).filter((name) => mine.has(name));
  $('fmtTrial').innerHTML = '';
  for (const name of formatted) $('fmtTrial').add(new Option(name, name));

  // Weeks so far this season, in both week lists (Raw trial data, Selections).
  const current = weekNumber(floridaNow().today, season.start_date);
  for (const sel of [$('week'), $('selWeek')]) {
    sel.innerHTML = '<option value="">All weeks</option>';
    for (let n = current ?? -1; n >= 0; n--) {   // down to Week 0, the week before the start
      const d = weekDates(n, season.start_date);
      sel.add(new Option(`Week ${n}${n === current ? ' (current)' : ''} · ${md(d.monday)} – ${md(d.sunday)}`, String(n)));
    }
  }

  $('saveHint').textContent = canSaveAs
    ? 'Save as… asks where to save. You get one .zip with a folder holding scores.csv and plot_visits.csv.'
    : 'This browser saves the .zip to your Downloads folder (or asks where, if set up that way).';
  // Admins: Raw and Formatted trial data, Trial/Genotype info and Selections.
  // Students: Raw and Formatted trial data (Mark, 2026-11-18); Formatted only
  // when one of their trials has a format.
  const subs = role === 'admin' ? ['data', 'formatted', 'info', 'selections']
    : formatted.length ? ['data', 'formatted'] : [];
  if (subs.length) setUpExportTabs(subs);
  else $('exportForm').hidden = false;
}

// ---------------- export ----------------
// One .zip per export, holding a folder <name>/ with the files. "Save as…"
// opens the normal Save As box (Chrome/Edge), so the researcher picks the
// folder; "Download" puts it in Downloads. (An earlier version wrote into a
// chosen folder, but Chrome's folder permission step failed silently on
// Mark's computer, 2026-11-10.)

/** Data export's own tabs (only the ones in subs). The address keeps the choice: #export/info. */
function setUpExportTabs(subs) {
  $('exportTabs').hidden = false;
  for (const b of document.querySelectorAll('#exportTabs button')) {
    b.hidden = !subs.includes(b.dataset.sub);
    b.onclick = () => showExportTab(b.dataset.sub);
  }
  const wanted = location.hash.split('/')[1];
  showExportTab(subs.includes(wanted) ? wanted : 'data');
}
function showExportTab(name) {
  for (const f of document.querySelectorAll('[data-sub-panel]')) f.hidden = f.dataset.subPanel !== name;
  for (const b of document.querySelectorAll('#exportTabs button')) b.classList.toggle('active', b.dataset.sub === name);
  history.replaceState(null, '', name === 'data' ? '#export' : `#export/${name}`);
}

$('exportForm').addEventListener('submit', (e) => { e.preventDefault(); void doExport(canSaveAs); });
$('downloadBtn').addEventListener('click', () => void doExport(false));
$('fmtForm').addEventListener('submit', (e) => { e.preventDefault(); void doFormattedExport(canSaveAs); });
$('fmtDownloadBtn').addEventListener('click', () => void doFormattedExport(false));
$('infoForm').addEventListener('submit', (e) => { e.preventDefault(); void doInfoExport(canSaveAs); });
$('infoDownloadBtn').addEventListener('click', () => void doInfoExport(false));
$('selForm').addEventListener('submit', (e) => { e.preventDefault(); void doSelectionsExport(canSaveAs); });
$('selDownloadBtn').addEventListener('click', () => void doSelectionsExport(false));

// Any error the page didn't expect is shown on the page, not only in the console.
const showUnexpected = (err) => show($('exportMsg'), `Something went wrong: ${err?.message ?? err}`, 'err');
window.addEventListener('error', (e) => showUnexpected(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showUnexpected(e.reason));

const csvRows = (csv) => csv.trimEnd().split('\r\n').length - 1;

/**
 * Save one export as <name>.zip. saveAs: ask where to save (Chrome/Edge);
 * otherwise download to the Downloads folder. build() reads the data and
 * returns { files: { path: text }, summary }.
 */
async function saveZip({ saveAs, name, msg, buttons, build, single = null }) {
  // single: the one file wanted ("genotypes.csv"): saved as <name>.csv, no zip.
  const ext = single ? 'csv' : 'zip';
  const type = single ? 'text/csv' : 'application/zip';
  // Ask where to save first: the browser only allows it straight after the click.
  let target = null;
  let note = '';
  if (saveAs) {
    show(msg, 'Choose where to save…', 'ok');
    try {
      target = await window.showSaveFilePicker({
        id: 'strawberry-export', suggestedName: `${name}.${ext}`,
        types: [single
          ? { description: 'CSV file', accept: { 'text/csv': ['.csv'] } }
          : { description: 'Zip file', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (err) {
      if (err?.name === 'AbortError') return show(msg, 'Cancelled, nothing was saved.', 'err');
      note = `\n(Save as didn't work: ${err?.name ?? ''} ${err?.message ?? err}. Downloaded instead.)`;
    }
  }

  for (const b of buttons) b.disabled = true;
  try {
    show(msg, 'Reading the data…', 'ok');
    const { files, summary } = await build();
    const zip = single
      ? new TextEncoder().encode(files[single] ?? '')
      : makeZip(Object.entries(files).map(([file, text]) => ({ name: `${name}/${file}`, text })));
    const top = Object.keys(files).filter((f) => !f.includes('/'));
    const holds = single ? null : Object.keys(files).some((f) => f.includes('/'))
      ? (top.length ? `${top.join(', ')} and a maps folder` : 'a maps folder')
      : top.join(' and ');

    if (target) {
      show(msg, 'Saving…', 'ok');
      const w = await target.createWritable();
      await w.write(zip);
      await w.close();
      show(msg, single ? `Saved ${target.name}: ${summary}` : `Saved ${target.name}: ${summary}\nIt holds a folder ${name} with ${holds} ` +
        '(Windows: right-click the file -> Extract All).', 'ok');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip], { type }));
      a.download = `${name}.${ext}`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      show(msg, `Downloaded ${name}.${ext}: ${summary}${holds ? `\nIt holds ${holds}.` : ''}${note}`, 'ok');
    }
  } catch (err) {
    show(msg, `Export stopped: ${err?.name ?? ''} ${err?.message ?? err}`, 'err');
  } finally {
    for (const b of buttons) b.disabled = false;
  }
}

/** export_data() for some trials (none = all) and a week (null = all weeks). */
async function readExportData(trials, week) {
  const range = week !== null ? weekDates(week, season.start_date) : null;
  const { data, error } = await supabase.rpc('export_data', {
    p_trials: trials, p_from: range?.monday ?? null, p_to: range?.sunday ?? null,
  });
  if (error) throw new Error(error.message);
  return data;
}

/** Raw trial data: scores.csv and plot_visits.csv. */
function doExport(saveAs) {
  const trials = [...document.querySelectorAll('input[name=trial]:checked')].map((c) => c.value);
  const week = $('week').value ? Number($('week').value) : null;
  return saveZip({
    saveAs, msg: $('exportMsg'), buttons: [$('exportBtn'), $('downloadBtn')],
    name: [...(trials.length ? trials : ['All_trials']), ...(week !== null ? [`Week_${week}`] : []), floridaNow().stamp].join('_'),
    build: async () => {
      const result = buildExport(await readExportData(trials, week));
      return {
        files: result.files,
        summary: `${csvRows(result.files['scores.csv'])} score rows, ${csvRows(result.files['plot_visits.csv'])} plot visits ` +
          `(${result.scores} scores, ${result.notes} notes).`,
      };
    },
  });
}

/** Formatted trial data (admins and students): one CSV for one trial, laid out for that trial (lib/formatted.js). */
function doFormattedExport(saveAs) {
  const trial = $('fmtTrial').value;
  const file = `${trial}_formatted.csv`;
  return saveZip({
    saveAs, msg: $('fmtMsg'), buttons: [$('fmtBtn'), $('fmtDownloadBtn')], single: file,
    name: `${trial}_formatted_${floridaNow().stamp}`,
    build: async () => {
      const { data, error } = await supabase.rpc('export_formatted', { p_trial: trial });
      if (error) throw new Error(error.message);
      const result = FORMATS[trial](data, floridaNow().today);
      return { files: { [file]: result.csv }, summary: `${result.plots} plots.` };
    },
  });
}

/** Trial/Genotype info (admins): genotypes.csv, trial_traits.csv, maps/<Trial>_map.csv. */
/** The file boxes: All files, the genotype table, the trial settings, then a map per trial. */
function showInfoFiles(trialNames) {
  const box = $('infoFiles');
  box.innerHTML = '';
  const add = (value, text, all = false) => {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    if (all) { l.className = 'all'; cb.id = 'infoAll'; cb.checked = true; } else { cb.name = 'info'; cb.value = value; }
    l.append(cb, ` ${text}`);
    box.append(l);
  };
  /** A header across the whole grid: "Other info", "Maps" (Mark, 2026-11-16). */
  const header = (text) => {
    const h = document.createElement('div');
    h.className = 'filegroup';
    h.textContent = text;
    box.append(h);
  };
  add('', 'All files', true);
  header('Other info');
  add('genotypes.csv', 'Genotype table');
  add('trial_traits.csv', 'Trial settings and traits');
  header('Maps');
  for (const t of trialNames) add(mapFile(t), t);
  // "All files" and single files exclude each other, like the trial boxes.
  box.onchange = (e) => {
    if (e.target.id === 'infoAll' && e.target.checked) box.querySelectorAll('input[name=info]').forEach((c) => { c.checked = false; });
    else if (e.target.name === 'info') $('infoAll').checked = !box.querySelector('input[name=info]:checked');
  };
}

function doInfoExport(saveAs) {
  const wanted = [...document.querySelectorAll('input[name=info]:checked')].map((c) => c.value);   // none = all files
  const single = wanted.length === 1 ? wanted[0] : null;
  const base = single ? single.replace(/^maps\//, '').replace(/\.csv$/, '') : 'Trial_genotype_info';
  return saveZip({
    saveAs, msg: $('infoMsg'), buttons: [$('infoBtn'), $('infoDownloadBtn')], single,
    name: `${base}_${floridaNow().stamp}`,
    build: async () => {
      const { data, error } = await supabase.rpc('export_info');
      if (error) throw new Error(error.message);
      const result = buildInfoExport(data);
      const files = wanted.length ? Object.fromEntries(Object.entries(result.files).filter(([f]) => wanted.includes(f))) : result.files;
      if (!Object.keys(files).length) throw new Error('None of the chosen files has any rows yet.');
      const maps = Object.keys(files).filter((f) => f.startsWith('maps/')).length;
      const parts = [
        ...(files['genotypes.csv'] ? [`${result.genotypes} genotypes`] : []),
        ...(files['trial_traits.csv'] ? ['trial settings'] : []),
        ...(maps ? [`${maps} trial map${maps === 1 ? '' : 's'}`] : []),
      ];
      return { files, summary: `${parts.join(', ')}.` };
    },
  });
}

/** Selections (admins): selections.csv, one row per genotype with Select = YES. */
function doSelectionsExport(saveAs) {
  const week = $('selWeek').value ? Number($('selWeek').value) : null;
  return saveZip({
    saveAs, msg: $('selMsg'), buttons: [$('selBtn'), $('selDownloadBtn')], single: 'selections.csv',
    name: ['Selections', ...(week !== null ? [`Week_${week}`] : []), floridaNow().stamp].join('_'),
    build: async () => {
      const result = selectionsFile(await readExportData([], week));
      return { files: { 'selections.csv': result.csv }, summary: `${result.genotypes} genotypes selected.` };
    },
  });
}

// ---------------- review student selections (admins) ----------------
// A student's Select = YES waits here (observations.needs_review). Approve
// keeps it; Reject deletes it, and phones drop it on their next sync.

// ---------------- tabs ----------------
// One panel per tab (data-panel in index.html). The address keeps the tab
// (#review), so a reload or a bookmark opens the same one.
const TABS_BY_ROLE = {
  admin: ['export', 'review', 'members', 'highlights', 'traits', 'crew'],
  student: ['export', 'highlights', 'traits'],
  crew: [],
};

function setUpTabs(allowed) {
  $('tabs').hidden = !allowed.length;
  $('noTabs').hidden = allowed.length > 0;
  for (const b of document.querySelectorAll('#tabs button')) {
    b.hidden = !allowed.includes(b.dataset.tab);
    b.onclick = () => showTab(b.dataset.tab);
  }
  const wanted = location.hash.slice(1).split('/')[0];   // #export/info: the tab, then Data export's own tab
  if (allowed.length) showTab(allowed.includes(wanted) ? wanted : allowed[0]);
}

function showTab(name) {
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  // Keep Data export's own tab in the address (#export/info) when staying on it.
  if (!(name === 'export' && location.hash.startsWith('#export/'))) history.replaceState(null, '', `#${name}`);
}

// Review tab: both lists, and the number waiting shown on the tab.
const waiting = { selections: 0, edits: 0, traits: 0 };
function showWaiting() {
  const n = waiting.selections + waiting.edits + waiting.traits;
  $('reviewCount').hidden = n === 0;
  $('reviewCount').textContent = String(n);
}
async function refreshReview() {
  await Promise.all([showReview(), showMapChanges(), loadTraits()]);
}

// ---------------- lab members (admins) ----------------
// Listing and name/role changes: database functions list_lab_members() and
// set_lab_member(). Creating accounts, links and crew passwords: the Edge
// Function "lab-members", which holds the secret key on Supabase's servers
// and checks the caller is an admin.

/** Call the lab-members Edge Function; returns its reply or throws its error message. */
async function labMembers(body) {
  const { data, error } = await supabase.functions.invoke('lab-members', { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error ?? msg; } catch { /* keep the generic message */ }
    throw new Error(msg);
  }
  return data;
}

function showLink(link) {
  $('linkBox').hidden = !link;
  $('linkText').value = link ?? '';
}
$('copyLink').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('linkText').value); $('copyLink').textContent = 'Copied'; }
  catch { $('linkText').select(); }
  setTimeout(() => { $('copyLink').textContent = 'Copy link'; }, 2000);
});

$('addRole').addEventListener('change', () => { $('crewPwBox').hidden = $('addRole').value !== 'crew'; });

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const role = $('addRole').value;
  const password = role === 'crew' ? $('addPw').value : '';
  if (role === 'crew' && password.length < 8) return show($('memberMsg'), 'Give the crew phone a password of at least 8 characters.', 'err');
  $('addBtn').disabled = true;
  showLink(null);
  const who = $('addName').value.trim();
  const email = $('addEmail').value.trim();
  try {
    const r = await labMembers({ action: 'invite', email, name: who, role, password });
    if (r.link) { show($('memberMsg'), `Account made for ${who} (${role}). Send them this link to choose a password:`, 'ok'); showLink(r.link); }
    else if (r.sent) show($('memberMsg'), `Account made for ${who} (${role}). Supabase emailed them a sign-up link.`, 'ok');
    else show($('memberMsg'), `Crew account ready: sign in on the phone with ${email} and the password you set. Now give it trials below.`, 'ok');
    $('addForm').reset();
    $('crewPwBox').hidden = true;
    await showMembers();
  } catch (err) {
    show($('memberMsg'), err.message, 'err');
  } finally {
    $('addBtn').disabled = false;
  }
});

async function showMembers() {
  const box = $('memberList');
  const { data, error } = await supabase.rpc('list_lab_members');
  box.innerHTML = '';
  if (error) { box.textContent = error.message; return; }
  const table = document.createElement('table');
  table.className = 'lists';
  table.innerHTML = '<tr><th>Name</th><th>Role</th><th>Email</th><th>Trials</th><th>Last sign-in</th><th></th></tr>';
  for (const m of data) {
    const tr = table.insertRow();
    // Names are set at invite and not edited here (they are the Researcher column in exports).
    tr.insertCell().textContent = m.name;
    // Admins are changed only in Supabase: their role shows as text here.
    // Everyone else can be switched between student and crew.
    const roleSel = document.createElement('select');
    if (m.role === 'admin') {
      const td = tr.insertCell();
      td.textContent = 'admin';
      td.title = 'Admin roles are changed only in Supabase (Table editor -> researchers).';
    } else {
      for (const r of ['student', 'crew']) roleSel.add(new Option(r, r, false, r === m.role));
      tr.insertCell().append(roleSel);
    }
    const cell = (text) => { const td = tr.insertCell(); td.textContent = text; return td; };
    cell(m.email ?? '');
    cell(m.role === 'crew' ? (m.trials ?? 'none') : 'all');
    cell(m.last_sign_in ? md(m.last_sign_in.slice(0, 10)) : 'never');
    const td = tr.insertCell();
    td.style.whiteSpace = 'nowrap';
    const btn = (label, quiet, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (quiet) b.className = 'quiet';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await onClick(); } catch (err) { show($('memberMsg'), err.message, 'err'); }
        b.disabled = false;
      });
      td.append(b, ' ');
      return b;
    };
    // Save appears only once the role has been changed (not for admins, whose role is set in Supabase).
    if (m.role !== 'admin') {
      const save = btn('Save', false, async () => {
        const { error: err } = await supabase.rpc('set_lab_member_role', { p_researcher_id: m.researcher_id, p_role: roleSel.value });
        if (err) throw new Error(err.message);
        show($('memberMsg'), `${m.name} is now ${roleSel.value}. They see the change next time the app or page loads.`, 'ok');
        await showMembers();
      });
      save.hidden = true;
      roleSel.addEventListener('change', () => { save.hidden = roleSel.value === m.role; });
    }
    if (m.role === 'crew') {
      btn('Set password', true, async () => {
        const pw = prompt(`New password for ${m.name} (at least 8 characters):`);
        if (!pw) return;
        await labMembers({ action: 'set_password', researcher_id: m.researcher_id, password: pw });
        show($('memberMsg'), `Password changed for ${m.name}. Sign the phone in again with it.`, 'ok');
      });
    } else if (m.email) {
      btn('Reset link', true, async () => {
        const r = await labMembers({ action: 'reset', email: m.email });
        if (r.link) { show($('memberMsg'), `Password reset link for ${m.name}:`, 'ok'); showLink(r.link); }
        else show($('memberMsg'), `Supabase emailed ${m.name} a reset link.`, 'ok');
      });
    }
  }
  const wrap = document.createElement('div');
  wrap.className = 'scroll';   // narrow screens scroll the table, not the page
  wrap.append(stackable(table));
  box.append(wrap);

  // Crew trial assignment: crew accounts and this season's trials.
  const who = $('assignWho');
  who.innerHTML = '';
  for (const m of data.filter((x) => x.role === 'crew')) who.add(new Option(m.name, m.email ?? m.name));
  if (!who.options.length) who.add(new Option('(no crew accounts yet)', ''));
  const { data: trials } = await supabase.from('trials').select('name, seasons!inner(is_current)').eq('seasons.is_current', true).order('name');
  const tsel = $('assignTrial');
  tsel.innerHTML = '';
  for (const t of trials ?? []) tsel.add(new Option(t.name, t.name));
}

async function assign(give) {
  if (!$('assignWho').value) return show($('memberMsg'), 'Make a crew account first.', 'err');
  const { data, error } = await supabase.rpc('assign_trial', {
    p_researcher: $('assignWho').value, p_trial: $('assignTrial').value,
    p_assign: give, p_sampling_only: $('assignSampling').checked,
  });
  if (error) return show($('memberMsg'), error.message, 'err');
  show($('memberMsg'), `${data}. The phone sees it after "Refresh trial list".`, 'ok');
  await showMembers();
}
// Crew names (crew_names): the "Who is rating?" buttons on crew phones.
// Only admins add and delete them (RLS); scores keep the name as text, so
// deleting a name changes nothing already saved.
async function showCrewNames() {
  const box = $('crewNameList');
  const { data, error } = await supabase.from('crew_names').select('id, name').order('name');
  box.innerHTML = '';
  if (error) { box.textContent = error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">No names yet: crew phones have nobody to choose.</p>'; return; }
  for (const n of data) {
    const row = document.createElement('div');
    row.className = 'namerow';
    const name = document.createElement('span');
    name.textContent = n.name;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'quiet';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      if (!confirm(`Delete ${n.name} from the crew names? Scores already saved keep the name.`)) return;
      del.disabled = true;
      const { error: err } = await supabase.from('crew_names').delete().eq('id', n.id);
      if (err) { show($('crewNameMsg'), err.message, 'err'); del.disabled = false; return; }
      show($('crewNameMsg'), `${n.name} deleted.`, 'ok');
      await showCrewNames();
    });
    row.append(name, del);
    box.append(row);
  }
}
$('crewNameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('crewNameNew').value.trim().replace(/\s+/g, ' ');
  if (!name) return;
  $('crewNameAdd').disabled = true;
  const { error } = await supabase.from('crew_names').insert({ name });
  $('crewNameAdd').disabled = false;
  if (error) {
    return show($('crewNameMsg'), error.code === '23505' ? `${name} is already on the list.` : error.message, 'err');
  }
  $('crewNameNew').value = '';
  show($('crewNameMsg'), `${name} added. Phones get it the next time they open a trial with signal.`, 'ok');
  await showCrewNames();
});

$('assignBtn').addEventListener('click', () => void assign(true));
$('unassignBtn').addEventListener('click', () => void assign(false));

$('reviewRefresh').addEventListener('click', () => void refreshReview());

/**
 * Items waiting for review, one collapsible group per person and day (Mark,
 * 2026-11-17), newest day first. Each group has Approve all / Reject all,
 * after an "are you sure"; each row keeps its own Approve / Reject.
 *   who, day     the person and the YYYY-MM-DD day an item is grouped under
 *   noun         [one, many]: "selection", "selections"
 *   heads/cells  the table columns (no Date or By: those are the group)
 *   review       approve (true) or reject (false) one item; returns the error, if any
 *   rejectAsk    the question before rejecting one item
 *   rejectAll    what rejecting a whole group does, for its question
 *   order        optional: the order a group is rejected in (map edits: newest first)
 *   redraw       draws the list again from the database
 */
const openGroups = new Set();   // groups left open stay open after a redraw
function reviewGroups(box, items, o) {
  const groups = new Map();
  for (const x of items) {
    const key = `${o.day(x)}|${o.who(x)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(x);
  }
  const keys = [...groups.keys()].sort((a, b) => b.localeCompare(a));   // newest day first
  for (const key of keys) {
    const list = groups.get(key);
    const [day, who] = [o.day(list[0]), o.who(list[0])];
    const count = `${list.length} ${list.length === 1 ? o.noun[0] : o.noun[1]}`;
    const details = document.createElement('details');
    details.className = 'rgroup';
    const id = `${box.id}|${key}`;
    details.open = openGroups.has(id);
    details.addEventListener('toggle', () => { if (details.open) openGroups.add(id); else openGroups.delete(id); });
    const summary = document.createElement('summary');
    summary.textContent = `${who} · ${md(day)} · ${count}`;
    details.append(summary);

    const buttons = [];
    const busy = (on) => buttons.forEach((b) => { b.disabled = on; });
    const button = (label, quiet, onClick) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (quiet) b.className = 'quiet';
      b.addEventListener('click', onClick);
      buttons.push(b);
      return b;
    };
    /** Review several items, one by one; stop at the first refusal and say why. */
    const reviewAll = async (xs, approve) => {
      busy(true);
      let done = 0;
      for (const x of xs) {
        const err = await o.review(x, approve);
        if (err) { show($('reviewMsg'), `${done} of ${xs.length} done, then: ${err.message}`, 'err'); break; }
        done++;
      }
      if (done === xs.length) show($('reviewMsg'), `${approve ? 'Approved' : 'Rejected'} ${done} ${done === 1 ? o.noun[0] : o.noun[1]} by ${who} (${md(day)}).`, 'ok');
      await o.redraw();
    };

    const bulk = document.createElement('div');
    bulk.className = 'row';
    bulk.style.marginTop = '8px';
    bulk.append(
      button(`Approve all ${list.length}`, false, () => {
        if (confirm(`Approve all ${count} by ${who} on ${md(day)}?`)) void reviewAll(list, true);
      }),
      button(`Reject all ${list.length}`, true, () => {
        if (confirm(`Reject all ${count} by ${who} on ${md(day)}? ${o.rejectAll}`)) void reviewAll(o.order ? o.order(list) : list, false);
      }),
    );
    details.append(bulk);

    const table = document.createElement('table');
    table.className = 'lists';
    const head = table.insertRow();
    for (const h of [...o.heads, '']) { const th = document.createElement('th'); th.textContent = h; head.append(th); }
    for (const x of list) {
      const tr = table.insertRow();
      for (const text of o.cells(x)) tr.insertCell().textContent = text;
      const td = tr.insertCell();
      td.style.whiteSpace = 'nowrap';
      td.append(
        button('Approve', false, () => void reviewAll([x], true)),
        ' ',
        button('Reject', true, () => { if (confirm(o.rejectAsk(x))) void reviewAll([x], false); }),
      );
    }
    details.append(stackable(table));
    box.append(details);
  }
}

async function showReview() {
  const box = $('reviewList');
  const { data, error } = await supabase.rpc('pending_selections');
  box.innerHTML = '';
  waiting.selections = data?.length ?? 0;
  showWaiting();
  if (error) { box.textContent = error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">Nothing waiting for review.</p>'; return; }
  reviewGroups(box, data, {
    who: (x) => x.researcher,
    day: (x) => x.visit_date,
    noun: ['selection', 'selections'],
    heads: ['Where', 'Genotype'],
    cells: (x) => [
      `${x.trials ?? ''} · ${x.trial_bed ? `bed ${x.trial_bed}` : `${x.block}-${x.field_bed}`} · pos ${x.plot_position}`,
      `${x.genotype}${x.stake_label !== x.genotype ? ` (stake ${x.stake_label})` : ''}`,
    ],
    review: async (x, approve) =>
      (await supabase.rpc('review_selection', { p_observation_id: x.observation_id, p_approve: approve })).error,
    rejectAsk: (x) => `Reject ${x.researcher}'s selection of ${x.genotype}? The YES is deleted.`,
    rejectAll: 'Their YES scores are deleted.',
    redraw: showReview,
  });
}

// Field-map edits waiting for review (crew; students' not-planted fixes): already applied; Approve keeps, Reject undoes (review_map_change()).
const CHANGE_LABELS = { change_genotype: 'Changed genotype', add_genotype: 'Added genotype', add_plot: 'Added plot', set_planted: 'Planted', change_stake: 'Changed stake' };

async function showMapChanges() {
  const box = $('mapChangeList');
  const { data, error } = await supabase.rpc('pending_map_changes');
  box.innerHTML = '';
  waiting.edits = data?.length ?? 0;
  showWaiting();
  if (error) { box.textContent = error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">Nothing waiting for review.</p>'; return; }
  reviewGroups(box, data, {
    who: (x) => x.researcher,
    day: (x) => x.changed_at.slice(0, 10),
    noun: ['edit', 'edits'],
    heads: ['Edit', 'Where'],
    cells: (x) => [
      `${CHANGE_LABELS[x.change_type] ?? x.change_type}: ${x.description ?? ''}`,
      x.block ? `${x.trials ?? ''} · ${x.block}-${x.field_bed} · pos ${x.plot_position} (stake ${x.stake_label})` : '',
    ],
    review: async (x, approve) =>
      (await supabase.rpc('review_map_change', { p_change_id: x.change_id, p_approve: approve })).error,
    rejectAsk: () => 'Undo this edit?',
    rejectAll: 'Each edit is undone (scores follow the plot back to its original genotype).',
    // Undo the newest edit first, so two edits on one plot unwind in order.
    order: (xs) => [...xs].sort((a, b) => b.changed_at.localeCompare(a.changed_at)),
    redraw: showMapChanges,
  });
}

// ---------------- highlight lists ----------------
// Upload: where the list applies is chosen on the page (All trials, or some
// trials and, for trials with reps, some reps); the CSV is genotype, color.
// The CSV is checked here first (lib/highlights.js, the same rules the tests
// cover), then upload_highlight_list() checks genotypes, trials and reps and
// saves the whole list, or nothing.

let meRow = null;
let hlOptions = [];   // this season's trials with plots: [{ trial, reps: ['1', '2'] }]
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

/**
 * "Where": every trial is listed and ticked to start, with its reps (2+)
 * below it, also ticked. Unticking anything unticks "All trials"; ticking
 * everything again ticks it. A trial's box ticks/unticks all its reps; a rep
 * box keeps its trial ticked while any of its reps is. (Mark, 2026-11-12)
 */
async function loadHlOptions() {
  const { data, error } = await supabase.rpc('highlight_trial_reps');
  hlOptions = error ? [] : data.map((t) => ({ trial: t.trial, reps: [...(t.reps ?? [])].sort(natural) }));
  const box = $('hlTrials');
  box.innerHTML = '';
  if (error) { box.textContent = error.message; return; }
  if (!hlOptions.length) { box.innerHTML = '<p class="hint">No trials with plots yet.</p>'; return; }
  const check = (attrs) => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = $('hlAll').checked;
    Object.assign(cb.dataset, attrs);
    return cb;
  };
  for (const o of hlOptions) {
    const div = document.createElement('div');
    div.className = 'trial';
    const label = document.createElement('label');
    label.append(check({ trial: o.trial }), o.trial);
    div.append(label);
    if (o.reps.length > 1) {
      const reps = document.createElement('div');
      reps.className = 'reps';
      for (const rep of o.reps) {
        const l = document.createElement('label');
        l.append(check({ trial: o.trial, rep }), `Rep ${rep}`);
        reps.append(l);
      }
      div.append(reps);
    }
    box.append(div);
  }
}

const trialBox = (trial) => $('hlTrials').querySelector(`input[data-trial="${CSS.escape(trial)}"]:not([data-rep])`);
const repBoxes = (trial) => [...$('hlTrials').querySelectorAll(`input[data-trial="${CSS.escape(trial)}"][data-rep]`)];

$('hlAll').addEventListener('change', () => {
  for (const cb of $('hlTrials').querySelectorAll('input')) cb.checked = $('hlAll').checked;
});
$('hlTrials').addEventListener('change', (e) => {
  const cb = e.target;
  if (!(cb instanceof HTMLInputElement)) return;
  if (cb.dataset.rep === undefined) for (const r of repBoxes(cb.dataset.trial)) r.checked = cb.checked;
  else trialBox(cb.dataset.trial).checked = repBoxes(cb.dataset.trial).some((r) => r.checked);
  $('hlAll').checked = [...$('hlTrials').querySelectorAll('input')].every((i) => i.checked);
});

/** What to send as p_scope: [] = all trials (also later ones); else [{ trial, reps? }]. */
function hlScope() {
  if ($('hlAll').checked) return { scope: [] };
  const scope = [];
  for (const o of hlOptions) {
    if (!trialBox(o.trial)?.checked) continue;
    const boxes = repBoxes(o.trial);
    const reps = boxes.filter((i) => i.checked).map((i) => i.dataset.rep);
    scope.push(boxes.length && reps.length < boxes.length ? { trial: o.trial, reps } : { trial: o.trial });
  }
  if (!scope.length) return { error: 'Tick at least one trial (or All trials).' };
  return { scope };
}

/**
 * Genotypes listed with different colors: one row each with a radio per
 * color; the pick goes into hlChosen and the next Upload uses it.
 */
let hlChosen = {};   // lowercase genotype -> color
function showConflicts(conflicts) {
  const box = $('hlConflicts');
  box.innerHTML = '';
  box.hidden = !conflicts.length;
  if (!conflicts.length) return;
  const p = document.createElement('p');
  p.innerHTML = '<strong>Listed more than once with different colors.</strong> Pick one color for each, then press Upload list again.';
  box.append(p);
  for (const c of conflicts) {
    const k = c.genotype.trim().toLowerCase();
    const row = document.createElement('div');
    row.className = 'clash';
    const name = document.createElement('strong');
    name.textContent = c.genotype;
    row.append(name);
    for (const color of c.colors) {
      const l = document.createElement('label');
      const rb = document.createElement('input');
      rb.type = 'radio';
      rb.name = `clash-${k}`;
      rb.checked = hlChosen[k] === color;
      rb.addEventListener('change', () => { hlChosen[k] = color; });
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = HIGHLIGHT_COLORS[color];
      l.append(rb, sw, color);
      row.append(l);
    }
    box.append(row);
  }
}
// A new file starts over: earlier color picks were for the old one.
$('hlFile').addEventListener('change', () => { hlChosen = {}; showConflicts([]); });

/** "All trials" or "GSFlavor; Phyto rep 2" for the table of lists. */
function whereText(rows) {
  if (!rows?.length) return 'All trials';
  const byTrial = new Map();
  for (const r of rows) {
    const name = r.trials?.name ?? '?';
    if (!byTrial.has(name)) byTrial.set(name, []);
    if (r.rep) byTrial.get(name).push(r.rep);
  }
  return [...byTrial].sort(([a], [b]) => natural(a, b))
    .map(([t, reps]) => (reps.length ? `${t} rep${reps.length > 1 ? 's' : ''} ${reps.sort(natural).join(', ')}` : t)).join('; ');
}

$('hlColors').append(...Object.entries(HIGHLIGHT_COLORS).flatMap(([name, hex]) => {
  const sw = document.createElement('span');
  sw.className = 'sw';
  sw.style.background = hex;
  return [sw, name];
}));

$('hlTemplate').addEventListener('click', () => {
  const csv = 'genotype,color\r\n26.52-14,red\r\n26.70-1,blue\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'highlight_list_template.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
});

$('hlForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('hlMsg');
  const file = $('hlFile').files[0];
  if (!file) return show(msg, 'Choose a CSV file.', 'err');
  const parsed = parseCsv(await file.text());
  const parsedRows = parseHighlightRows(parsed.headers, parsed.rows);
  if (parsedRows.errors.length) return show(msg, `Nothing was uploaded. Fix these and try again:\n${parsedRows.errors.slice(0, 40).join('\n')}`, 'err');
  // Repeats: same color = kept once; different colors = ask (lib/highlights.js, tested).
  const { rows, conflicts, dropped } = dedupeHighlightRows(parsedRows.rows, hlChosen);
  showConflicts(conflicts);
  if (conflicts.length) {
    return show(msg, `${conflicts.length} genotype(s) are listed with different colors. Pick one color for each below, then press Upload list again.`, 'err');
  }
  const where = hlScope();
  if (where.error) return show(msg, where.error, 'err');
  $('hlUpload').disabled = true;
  show(msg, `Checking ${rows.length} genotypes…`, 'ok');
  const visibility = document.querySelector('input[name=hlVis]:checked').value;
  const { error } = await supabase.rpc('upload_highlight_list',
    { p_name: $('hlName').value, p_visibility: visibility, p_items: rows, p_scope: where.scope });
  $('hlUpload').disabled = false;
  if (error) return show(msg, error.message, 'err');
  $('hlForm').reset();
  hlChosen = {};
  showConflicts([]);
  for (const cb of $('hlTrials').querySelectorAll('input')) cb.checked = true;   // form reset ticks All trials again
  show(msg, `Uploaded: ${rows.length} genotypes${dropped ? ` (${dropped} repeated line${dropped > 1 ? 's' : ''} merged)` : ''}.`, 'ok');
  await showLists(meRow);
});

/** The season's lists I can see, newest first, with Archive for my own (all, for admins). */
async function showLists(me) {
  meRow = me;
  const box = $('hlLists');
  const { data, error } = await supabase.from('highlight_lists')
    .select('id, name, visibility, created_at, archived_at, created_by, researchers(name), highlight_list_items(count), highlight_list_scope(rep, trials(name))')
    .eq('season_id', season.id).order('created_at', { ascending: false });
  box.innerHTML = '';
  if (error) { box.textContent = error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">No lists yet.</p>'; return; }
  const table = document.createElement('table');
  table.className = 'lists';
  table.innerHTML = '<tr><th>List</th><th>Where</th><th>By</th><th>Seen by</th><th>Genotypes</th><th></th></tr>';
  for (const l of data) {
    const tr = table.insertRow();
    if (l.archived_at) tr.className = 'archived';
    const cell = (text) => { const td = tr.insertCell(); td.textContent = text; return td; };
    cell(`${l.name}${l.archived_at ? ' (archived)' : ''}`);
    cell(whereText(l.highlight_list_scope));
    cell(l.researchers?.name ?? '');
    cell(l.visibility === 'everyone' ? 'Everyone' : 'Just them');
    cell(String(l.highlight_list_items?.[0]?.count ?? ''));
    const td = tr.insertCell();
    if (l.created_by === me.id || me.isAdmin) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'quiet';
      b.textContent = l.archived_at ? 'Restore' : 'Archive';
      b.addEventListener('click', async () => {
        b.disabled = true;
        const { error: err } = await supabase.rpc('archive_highlight_list', { p_list_id: l.id, p_archive: !l.archived_at });
        if (err) { b.disabled = false; return show($('hlMsg'), err.message, 'err'); }
        await showLists(me);
      });
      td.append(b);
    }
  }
  box.append(stackable(table));
}

// ---------------- traits ----------------
// Every group and trait, read only (Mark, 2026-11-15): new traits are added
// by Mark in a migration. A group lists the trials that use it; a trait
// limited to some trials (trait_trials) or people (trait_researchers) says
// so. A trait shown in a second group (trait_group_extras: Firmness in CGS
// quality) is listed there too. The same data draws the Crew Phones tab
// (admins): crew_trials (trials every crew phone opens) and
// crew_trial_groups (the groups crew score in each), written directly (RLS).

let traitsMe = null;
let tr = { traits: [], groups: [], trials: [], people: [], groupTrials: new Map(), extras: [], crewTrials: new Set(), crewGroups: [] };
const UNIT = { berry: 'berry', plant: 'plant', plot: 'plot' };
const COUNT_WHEEL = ['MktNo', 'Cull'];   // packages/shared controls.ts COUNT_WHEEL_TRAITS

function kindText(t) {
  if (t.value_type === 'yes_no') return t.carries_forward ? 'Yes / No, stays on later visits' : 'Yes / No';
  if (t.value_type === 'sequence') return `Numbered: ${t.value_label ?? ''}1, ${t.value_label ?? ''}2, …`;
  if (t.value_type === 'decimal') return `Number ${Number(t.scale_min).toFixed(1)}–${Number(t.scale_max).toFixed(1)} (digit wheels)`;
  if (COUNT_WHEEL.includes(t.name)) return `Count ${Number(t.scale_min)}–${Number(t.scale_max)} (wheel, starts at 0)`;
  return `Score ${Number(t.scale_min)}–${Number(t.scale_max)}`;
}
const trialName = (id) => tr.trials.find((x) => x.id === id)?.name;
/** The trials (this season) a group is used in. */
const groupTrialNames = (groupId) => (tr.groupTrials.get(groupId) ?? []).map(trialName).filter(Boolean).sort(natural);
/** Who a trait is limited to (trait_researchers), or null for everyone. */
function traitWho(t) {
  const ids = (t.trait_researchers ?? []).map((x) => x.researcher_id);
  return ids.length ? ids.map((id) => tr.people.find((p) => p.id === id)?.name ?? '?').join(', ') : null;
}

async function loadTraits() {
  if (!traitsMe || !season) return;
  const admin = traitsMe.isAdmin;
  const none = Promise.resolve({ data: [], error: null });
  const results = await Promise.all([
    supabase.from('traits').select('id, name, display_name, description, value_type, scale_min, scale_max, scoring_unit, sort_order, active, status, value_label, carries_forward, trait_group_id, creator:researchers!traits_created_by_fkey(name), trait_trials(trial_id), trait_researchers(researcher_id)'),
    supabase.from('trait_groups').select('id, name, sort_order, always_on').order('sort_order'),
    supabase.from('trials').select('id, name, expected_plots_per_bed, offer_to_crew, seasons!inner(is_current)').eq('seasons.is_current', true).order('name'),
    supabase.from('researchers').select('id, name, role').order('name'),
    supabase.from('trial_trait_groups').select('trait_group_id, trial_id'),
    supabase.from('trait_group_extras').select('trait_group_id, trait_id, sort_order'),
    admin ? supabase.from('crew_trials').select('trial_id') : none,
    admin ? supabase.from('crew_trial_groups').select('trial_id, trait_group_id') : none,
  ]);
  const err = results.find((r) => r.error)?.error;
  if (err) { $('traitList').textContent = err.message; return; }
  const [traits, groups, trials, people, ttg, extras, crewTrials, crewGroups] = results.map((r) => r.data);
  tr = {
    traits, groups, trials, people, groupTrials: new Map(),
    extras, crewTrials: new Set(crewTrials.map((x) => x.trial_id)), crewGroups,
  };
  const current = new Set(trials.map((t) => t.id));
  for (const x of ttg) {
    if (!current.has(x.trial_id)) continue;
    if (!tr.groupTrials.has(x.trait_group_id)) tr.groupTrials.set(x.trait_group_id, []);
    tr.groupTrials.get(x.trait_group_id).push(x.trial_id);
  }
  showTraitList();
  if (admin) { showCrewSetup(); showTraitReview(); }
}

/** One block per group: its trials as tags, then each trait with what it means, in the app's order. */
function showTraitList() {
  const box = $('traitList');
  box.innerHTML = '';
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  for (const g of tr.groups) {
    // Its own traits, plus traits shown here from another group (trait_group_extras).
    const own = tr.traits.filter((t) => t.trait_group_id === g.id).map((t) => ({ t, order: t.sort_order ?? 0, shared: false }));
    const shared = tr.extras.filter((x) => x.trait_group_id === g.id)
      .map((x) => ({ t: tr.traits.find((t) => t.id === x.trait_id), order: x.sort_order, shared: true }))
      .filter((x) => x.t);
    const list = [...own, ...shared].filter(({ t }) => t.status !== 'rejected').sort((a, b) => a.order - b.order);
    if (!list.length) continue;

    const block = el('div', 'tgroup');
    block.append(el('h3', null, g.name));
    const tags = el('div', 'tags');
    if (g.always_on) tags.append(el('span', 'tag', 'Every trial (always on; not on crew phones)'));
    else if (g.name === 'Done') tags.append(el('span', 'tag', 'Crew phones, every trial (added automatically, last)'));
    else {
      const names = groupTrialNames(g.id);
      for (const n of names) tags.append(el('span', 'tag', n));
      if (!names.length) tags.append(el('span', 'tag none', 'No trial uses this group yet'));
    }
    block.append(tags);

    for (const { t, shared: isShared } of list) {
      const item = el('div', `trait${!t.active || t.status === 'pending' ? ' retired' : ''}`);
      const name = el('div', 'tname', t.display_name);
      name.append(el('code', null, t.name));
      item.append(name);
      const meta = [kindText(t), `per ${UNIT[t.scoring_unit] ?? t.scoring_unit}`];
      if (isShared) meta.push(`also in ${tr.groups.find((x) => x.id === t.trait_group_id)?.name ?? 'another group'} (same export column)`);
      const limited = t.trait_trials ?? [];
      if (limited.length) {
        const names = limited.map((x) => trialName(x.trial_id)).filter(Boolean).sort(natural);
        meta.push(`only in ${names.length ? names.join(', ') : 'earlier seasons'}`);
      }
      const who = traitWho(t);
      if (who) meta.push(`only on ${who}'s phone`);
      if (!t.active) meta.push('retired');
      if (t.status === 'pending') meta.push('waiting for an admin');
      item.append(el('div', 'tmeta', meta.join(' · ')));
      if (t.description) item.append(el('div', 'tdesc', t.description));
      block.append(item);
    }
    box.append(block);
  }
}

// ---------------- Crew Phones tab (admins) ----------------
// One setup for every crew phone (Mark, 2026-11-15): tick a trial to give it
// to crew phones, then tick the groups they score there. Selection is never
// on crew phones and Done is added by the app, so neither is listed.

/** The groups a trial offers: its trial_trait_groups, plus groups with a trait limited to it (LI-COR in CGS). */
function trialGroups(trialId) {
  const ids = new Set();
  for (const [g, trials] of tr.groupTrials) if (trials.includes(trialId)) ids.add(g);
  for (const t of tr.traits) if ((t.trait_trials ?? []).some((x) => x.trial_id === trialId)) ids.add(t.trait_group_id);
  return tr.groups.filter((g) => ids.has(g.id) && !g.always_on && g.name !== 'Done');
}

function showCrewSetup() {
  $('crewSetupCard').hidden = false;
  const box = $('crewSetup');
  box.innerHTML = '';
  /** Save a change; say what happened. Returns false (and shows why) if the database refused. */
  const save = async (request, said) => {
    const { error } = await request;
    if (error) { show($('crewMsg'), error.message, 'err'); return false; }
    if (said) show($('crewMsg'), said, 'ok');
    return true;
  };
  const checkbox = (checked, onChange) => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.addEventListener('change', async () => {
      cb.disabled = true;
      await onChange(cb.checked);
      await loadTraits();   // redraw from the database, so the boxes show what was saved
    });
    return cb;
  };
  // Only the trials offered to crew: trials.offer_to_crew, ticked in Supabase (Mark,
  // 2026-11-17: CGS, MainStage1, MainStage3, Phyto). One already on crew phones stays
  // listed, so it can be switched off.
  const shown = tr.trials.filter((t) => t.offer_to_crew || tr.crewTrials.has(t.id));
  if (!shown.length) {
    box.innerHTML = '<p class="hint">No trials offered to crew. Tick offer_to_crew on a trial in Supabase (Table Editor → trials).</p>';
  }
  for (const t of shown) {
    const on = tr.crewTrials.has(t.id);
    const row = document.createElement('div');
    row.className = 'trial';
    const label = document.createElement('label');
    label.append(checkbox(on, async (want) => {
      if (want) return save(supabase.from('crew_trials').insert({ trial_id: t.id }), `Crew phones now open ${t.name}. Tick the groups they score there.`);
      if (!confirm(`Take ${t.name} off crew phones? Scores already made there stay.`)) return false;
      return await save(supabase.from('crew_trial_groups').delete().eq('trial_id', t.id), null)
        && save(supabase.from('crew_trials').delete().eq('trial_id', t.id), `${t.name} is off crew phones.`);
    }), ` ${t.name}`);
    row.append(label);
    if (on) {
      const groups = trialGroups(t.id);
      const chosen = new Set(tr.crewGroups.filter((x) => x.trial_id === t.id).map((x) => x.trait_group_id));
      const list = document.createElement('div');
      list.className = 'reps';
      if (!groups.length) list.append('This trial has no trait groups yet.');
      for (const g of groups) {
        const gl = document.createElement('label');
        gl.append(checkbox(chosen.has(g.id), (want) => (want
          ? save(supabase.from('crew_trial_groups').insert({ trial_id: t.id, trait_group_id: g.id }), `Crew score ${g.name} in ${t.name}.`)
          : save(supabase.from('crew_trial_groups').delete().eq('trial_id', t.id).eq('trait_group_id', g.id), `Crew no longer score ${g.name} in ${t.name}.`))), ` ${g.name}`);
        list.append(gl);
      }
      if (groups.length && !chosen.size) {
        const warn = document.createElement('span');
        warn.className = 'hint';
        warn.style.margin = '0';
        warn.textContent = 'Nothing ticked: crew phones have nothing to score here.';
        list.append(warn);
      }
      row.append(list);
    }
    box.append(row);
  }
  if (!shown.length) box.innerHTML = '<p class="hint">No trial is loaded with trait groups yet.</p>';
}

// Admins: students' new traits (Review changes).
function showTraitReview() {
  const box = $('traitReviewList');
  const pending = tr.traits.filter((t) => t.status === 'pending');
  waiting.traits = pending.length;
  showWaiting();
  box.innerHTML = '';
  if (!pending.length) { box.innerHTML = '<p class="hint">Nothing waiting for review.</p>'; return; }
  const table = document.createElement('table');
  table.className = 'lists';
  table.innerHTML = '<tr><th>By</th><th>Trait</th><th>Kind</th><th>Per</th><th>Where</th><th>Who</th><th></th></tr>';
  for (const t of pending) {
    const row = table.insertRow();
    const cell = (text) => { const td = row.insertCell(); td.textContent = text; return td; };
    cell(t.creator?.name ?? '');
    cell(`${t.display_name} (${t.name}) · ${tr.groups.find((g) => g.id === t.trait_group_id)?.name ?? ''}${t.description ? ` · ${t.description}` : ''}`);
    cell(kindText(t));
    cell(UNIT[t.scoring_unit] ?? t.scoring_unit);
    const limited = (t.trait_trials ?? []).map((x) => trialName(x.trial_id)).filter(Boolean).sort(natural);
    cell(limited.length ? limited.join(', ') : groupTrialNames(t.trait_group_id).join(', ') || '(no trials yet)');
    cell(traitWho(t) ?? 'Everyone');
    const td = row.insertCell();
    td.style.whiteSpace = 'nowrap';
    const button = (label, approve) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (!approve) b.className = 'quiet';
      b.addEventListener('click', async () => {
        if (!approve && !confirm(`Reject the trait ${t.display_name}? It won't reach phones.`)) return;
        td.querySelectorAll('button').forEach((y) => { y.disabled = true; });
        const { error: err } = await supabase.rpc('review_trait', { p_trait_id: t.id, p_approve: approve });
        if (err) { show($('reviewMsg'), err.message, 'err'); td.querySelectorAll('button').forEach((y) => { y.disabled = false; }); return; }
        await loadTraits();
      });
      return b;
    };
    td.append(button('Approve', true), ' ', button('Reject', false));
  }
  box.append(stackable(table));
}

$('version').textContent =`Page version ${document.querySelector('meta[name=build]')?.content ?? 'dev'}`;
if (setupToken) showSetup();
else await start();

/**
 * Give each cell its column's header as a label, so on a phone (narrow
 * screen CSS in index.html) the stacked rows read "By: Vance_Whitaker".
 */
function stackable(table) {
  table.rows[0].classList.add('head');   // hidden on phones; group-title rows (Traits) stay
  const heads = [...table.rows[0].cells].map((c) => c.textContent.trim());
  for (const row of [...table.rows].slice(1)) {
    [...row.cells].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; });
  }
  return table;
}
