// Export web page: an approved researcher signs in, picks trials and weeks,
// and saves scores.csv + plot_visits.csv to a folder of their choosing.
//
// The data comes from the database function export_data()
// (supabase/migrations/20261110000001_export_access.sql), which refuses
// anyone who isn't an admin or student (researchers.role), and gives students
// only data collected by students. The files are built by
// the same code as `npm run export` (scripts/export/format.ts, copied in by
// build.ts), so the two always match.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { buildExport, TIME_ZONE } from './lib/format.js';
import { weekDates, weekNumber } from './lib/selections.js';
import { makeZip } from './zip.js';
import { HIGHLIGHT_COLORS, parseHighlightRows } from './lib/highlights.js';
import { parseCsv } from './lib/csv.js';

// Opened from a sign-up or password-reset link (npm run invite / reset-link)?
// The link signs them in; read its type before the Supabase client clears
// the address, so the page can ask for a new password straight away.
const linkParams = new URLSearchParams(location.hash.slice(1));
const arrivedFrom = linkParams.get('type');                 // 'invite' | 'recovery' | null
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
});

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
    $('pwForm').hidden = false;
    show($('pwMsg'), arrivedFrom === 'invite'
      ? 'Welcome! Choose a password. You will use it here and in the field app.'
      : 'Choose a new password. It works here and in the field app.', 'ok');
    history.replaceState(null, '', location.pathname);   // a reload shouldn't show this again
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
  }
  if (meInfo?.isAdmin) {
    $('membersCard').hidden = false;
    void showMembers();
    $('reviewCard').hidden = false;
    void refreshReview();
  }
  setUpTabs(TABS_BY_ROLE[role] ?? []);
  if (role !== 'admin' && role !== 'student') {
    $('notApproved').hidden = false;
    return;
  }
  if (role === 'student') $('studentHint').hidden = false;

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
  // "All trials" and single trials exclude each other.
  box.addEventListener('change', (e) => {
    if (e.target.id === 'allTrials' && e.target.checked) box.querySelectorAll('input[name=trial]').forEach((c) => { c.checked = false; });
    else if (e.target.name === 'trial') $('allTrials').checked = !box.querySelector('input[name=trial]:checked');
  });

  // Weeks so far this season.
  const sel = $('week');
  sel.innerHTML = '<option value="">All weeks</option>';
  const current = weekNumber(floridaNow().today, season.start_date);
  for (let n = current ?? 0; n >= 1; n--) {
    const d = weekDates(n, season.start_date);
    sel.add(new Option(`Week ${n} · ${md(d.monday)} – ${md(d.sunday)}`, String(n)));
  }

  $('saveHint').textContent = canSaveAs
    ? 'Save as… asks where to save. You get one .zip with a folder holding scores.csv and plot_visits.csv.'
    : 'This browser saves the .zip to your Downloads folder (or asks where, if set up that way).';
  $('exportForm').hidden = false;
}

// ---------------- export ----------------
// One .zip per export, holding a folder <name>/ with scores.csv and
// plot_visits.csv. "Save as…" opens the normal Save As box (Chrome/Edge),
// so the researcher picks the folder; "Download" puts it in Downloads.
// (An earlier version wrote into a chosen folder, but Chrome's folder
// permission step failed silently on Mark's computer, 2026-11-10.)

$('exportForm').addEventListener('submit', (e) => { e.preventDefault(); void doExport(canSaveAs); });
$('downloadBtn').addEventListener('click', () => void doExport(false));

// Any error the page didn't expect is shown on the page, not only in the console.
const showUnexpected = (err) => show($('exportMsg'), `Something went wrong: ${err?.message ?? err}`, 'err');
window.addEventListener('error', (e) => showUnexpected(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showUnexpected(e.reason));

const csvRows = (csv) => csv.trimEnd().split('\r\n').length - 1;

/** saveAs: ask where to save (Chrome/Edge); otherwise download to the Downloads folder. */
async function doExport(saveAs) {
  const msg = $('exportMsg');
  const trials = [...document.querySelectorAll('input[name=trial]:checked')].map((c) => c.value);
  const week = $('week').value ? Number($('week').value) : null;
  const range = week ? weekDates(week, season.start_date) : null;
  const name = [...(trials.length ? trials : ['All_trials']), ...(week ? [`Week_${week}`] : []), floridaNow().stamp].join('_');

  // Ask where to save first: the browser only allows it straight after the click.
  let target = null;
  let note = '';
  if (saveAs) {
    show(msg, 'Choose where to save…', 'ok');
    try {
      target = await window.showSaveFilePicker({
        id: 'strawberry-export', suggestedName: `${name}.zip`,
        types: [{ description: 'Zip file', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (err) {
      if (err?.name === 'AbortError') return show(msg, 'Cancelled, nothing was saved.', 'err');
      note = `\n(Save as didn't work: ${err?.name ?? ''} ${err?.message ?? err}. Downloaded instead.)`;
    }
  }

  $('exportBtn').disabled = true;
  $('downloadBtn').disabled = true;
  try {
    show(msg, 'Reading the data…', 'ok');
    const { data, error } = await supabase.rpc('export_data', {
      p_trials: trials, p_from: range?.monday ?? null, p_to: range?.sunday ?? null,
    });
    if (error) throw new Error(error.message);
    show(msg, 'Building the files…', 'ok');
    const result = buildExport(data);
    const summary = `${csvRows(result.files['scores.csv'])} score rows, ${csvRows(result.files['plot_visits.csv'])} plot visits ` +
      `(${result.scores} scores, ${result.notes} notes).`;
    const zip = makeZip(Object.entries(result.files).map(([file, text]) => ({ name: `${name}/${file}`, text })));

    if (target) {
      show(msg, 'Saving…', 'ok');
      const w = await target.createWritable();
      await w.write(zip);
      await w.close();
      show(msg, `Saved ${target.name}: ${summary}\nIt holds a folder ${name} with scores.csv and plot_visits.csv ` +
        '(Windows: right-click the file -> Extract All).', 'ok');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zip], { type: 'application/zip' }));
      a.download = `${name}.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      show(msg, `Downloaded ${name}.zip: ${summary}\nIt holds scores.csv and plot_visits.csv.${note}`, 'ok');
    }
  } catch (err) {
    show(msg, `Export stopped: ${err?.name ?? ''} ${err?.message ?? err}`, 'err');
  } finally {
    $('exportBtn').disabled = false;
    $('downloadBtn').disabled = false;
  }
}

// ---------------- review student selections (admins) ----------------
// A student's Select = YES waits here (observations.needs_review). Approve
// keeps it; Reject deletes it, and phones drop it on their next sync.

// ---------------- tabs ----------------
// One panel per tab (data-panel in index.html). The address keeps the tab
// (#review), so a reload or a bookmark opens the same one.
const TABS_BY_ROLE = {
  admin: ['export', 'review', 'members', 'highlights'],
  student: ['export', 'highlights'],
  crew: [],
};

function setUpTabs(allowed) {
  $('tabs').hidden = !allowed.length;
  $('noTabs').hidden = allowed.length > 0;
  for (const b of document.querySelectorAll('#tabs button')) {
    b.hidden = !allowed.includes(b.dataset.tab);
    b.onclick = () => showTab(b.dataset.tab);
  }
  const wanted = location.hash.slice(1);
  if (allowed.length) showTab(allowed.includes(wanted) ? wanted : allowed[0]);
}

function showTab(name) {
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  history.replaceState(null, '', `#${name}`);
}

// Review tab: both lists, and the number waiting shown on the tab.
const waiting = { selections: 0, edits: 0 };
function showWaiting() {
  const n = waiting.selections + waiting.edits;
  $('reviewCount').hidden = n === 0;
  $('reviewCount').textContent = String(n);
}
async function refreshReview() {
  await Promise.all([showReview(), showMapChanges()]);
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
  wrap.append(table);
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
$('assignBtn').addEventListener('click', () => void assign(true));
$('unassignBtn').addEventListener('click', () => void assign(false));

$('reviewRefresh').addEventListener('click', () => void refreshReview());

async function showReview() {
  const box = $('reviewList');
  const { data, error } = await supabase.rpc('pending_selections');
  box.innerHTML = '';
  $('approveAll').hidden = true;
  waiting.selections = data?.length ?? 0;
  showWaiting();
  if (error) { box.textContent = error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">Nothing waiting for review.</p>'; return; }
  const table = document.createElement('table');
  table.className = 'lists';
  table.innerHTML = '<tr><th>Date</th><th>By</th><th>Where</th><th>Genotype</th><th></th></tr>';
  for (const x of data) {
    const tr = table.insertRow();
    const cell = (text) => { const td = tr.insertCell(); td.textContent = text; return td; };
    cell(md(x.visit_date));
    cell(x.researcher);
    const bed = x.trial_bed ? `bed ${x.trial_bed}` : `${x.block}-${x.field_bed}`;
    cell(`${x.trials ?? ''} · ${bed} · pos ${x.plot_position}`);
    cell(`${x.genotype}${x.stake_label !== x.genotype ? ` (stake ${x.stake_label})` : ''}`);
    const td = tr.insertCell();
    td.style.whiteSpace = 'nowrap';
    const button = (label, approve) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (!approve) b.className = 'quiet';
      b.addEventListener('click', async () => {
        if (!approve && !confirm(`Reject ${x.researcher}'s selection of ${x.genotype}? The YES is deleted.`)) return;
        td.querySelectorAll('button').forEach((y) => { y.disabled = true; });
        const { error: err } = await supabase.rpc('review_selection', { p_observation_id: x.observation_id, p_approve: approve });
        if (err) { show($('reviewMsg'), err.message, 'err'); td.querySelectorAll('button').forEach((y) => { y.disabled = false; }); return; }
        await showReview();
      });
      return b;
    };
    td.append(button('Approve', true), ' ', button('Reject', false));
  }
  box.append(table);
  $('approveAll').hidden = false;
  $('approveAll').onclick = async () => {
    if (!confirm(`Approve all ${data.length} selections shown?`)) return;
    $('approveAll').disabled = true;
    for (const x of data) {
      const { error: err } = await supabase.rpc('review_selection', { p_observation_id: x.observation_id, p_approve: true });
      if (err) show($('reviewMsg'), err.message, 'err');
    }
    $('approveAll').disabled = false;
    await showReview();
  };
}

// Crew field-map edits: already applied; Approve keeps, Reject undoes (review_map_change()).
const CHANGE_LABELS = { change_genotype: 'Changed genotype', add_genotype: 'Added genotype', add_plot: 'Added plot' };

async function showMapChanges() {
  const box = $('mapChangeList');
  const { data, error } = await supabase.rpc('pending_map_changes');
  box.innerHTML = '';
  waiting.edits = data?.length ?? 0;
  showWaiting();
  if (error) { box.textContent = error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">Nothing waiting for review.</p>'; return; }
  const table = document.createElement('table');
  table.className = 'lists';
  table.innerHTML = '<tr><th>Date</th><th>By</th><th>Edit</th><th>Where</th><th></th></tr>';
  for (const x of data) {
    const tr = table.insertRow();
    const cell = (text) => { const td = tr.insertCell(); td.textContent = text; return td; };
    cell(md(x.changed_at.slice(0, 10)));
    cell(x.researcher);
    cell(`${CHANGE_LABELS[x.change_type] ?? x.change_type}: ${x.description ?? ''}`);
    cell(x.block ? `${x.trials ?? ''} · ${x.block}-${x.field_bed} · pos ${x.plot_position} (stake ${x.stake_label})` : '');
    const td = tr.insertCell();
    td.style.whiteSpace = 'nowrap';
    const button = (label, approve) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (!approve) b.className = 'quiet';
      b.addEventListener('click', async () => {
        if (!approve && !confirm('Undo this edit?')) return;
        td.querySelectorAll('button').forEach((y) => { y.disabled = true; });
        const { error: err } = await supabase.rpc('review_map_change', { p_change_id: x.change_id, p_approve: approve });
        if (err) { show($('reviewMsg'), err.message, 'err'); td.querySelectorAll('button').forEach((y) => { y.disabled = false; }); return; }
        await showMapChanges();
      });
      return b;
    };
    td.append(button('Approve', true), ' ', button('Reject', false));
  }
  box.append(table);
}

// ---------------- highlight lists ----------------
// Upload: the CSV is checked here first (lib/highlights.js, the same rules
// the tests cover), then upload_highlight_list() checks genotype and trial
// names and saves the whole list, or nothing.

let meRow = null;

$('hlColors').append(...Object.entries(HIGHLIGHT_COLORS).flatMap(([name, hex]) => {
  const sw = document.createElement('span');
  sw.className = 'sw';
  sw.style.background = hex;
  return [sw, name];
}));

$('hlTemplate').addEventListener('click', () => {
  const csv = 'genotype,color,trial\r\n26.52-14,red,\r\n26.70-1,blue,MainStage1\r\n';
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
  const { rows, errors } = parseHighlightRows(parsed.headers, parsed.rows);
  if (errors.length) return show(msg, `Nothing was uploaded. Fix these and try again:\n${errors.slice(0, 40).join('\n')}`, 'err');
  $('hlUpload').disabled = true;
  show(msg, `Checking ${rows.length} genotypes…`, 'ok');
  const visibility = document.querySelector('input[name=hlVis]:checked').value;
  const { error } = await supabase.rpc('upload_highlight_list', { p_name: $('hlName').value, p_visibility: visibility, p_items: rows });
  $('hlUpload').disabled = false;
  if (error) return show(msg, error.message, 'err');
  $('hlForm').reset();
  show(msg, `Uploaded: ${rows.length} genotypes.`, 'ok');
  await showLists(meRow);
});

/** The season's lists I can see, newest first, with Archive for my own (all, for admins). */
async function showLists(me) {
  meRow = me;
  const box = $('hlLists');
  const { data, error } = await supabase.from('highlight_lists')
    .select('id, name, visibility, created_at, archived_at, created_by, researchers(name), highlight_list_items(count)')
    .eq('season_id', season.id).order('created_at', { ascending: false });
  box.innerHTML = '';
  if (error) { box.textContent = error.message; return; }
  if (!data.length) { box.innerHTML = '<p class="hint">No lists yet.</p>'; return; }
  const table = document.createElement('table');
  table.className = 'lists';
  table.innerHTML = '<tr><th>List</th><th>By</th><th>Seen by</th><th>Genotypes</th><th></th></tr>';
  for (const l of data) {
    const tr = table.insertRow();
    if (l.archived_at) tr.className = 'archived';
    const cell = (text) => { const td = tr.insertCell(); td.textContent = text; return td; };
    cell(`${l.name}${l.archived_at ? ' (archived)' : ''}`);
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
  box.append(table);
}

$('version').textContent =`Page version ${document.querySelector('meta[name=build]')?.content ?? 'dev'}`;
await start();
