// Export web page: an approved researcher signs in, picks trials and weeks,
// and saves scores.csv + plot_visits.csv to a folder of their choosing.
//
// The data comes from the database function export_data()
// (supabase/migrations/20261110000001_export_access.sql), which refuses
// anyone whose researchers.can_export isn't ticked. The files are built by
// the same code as `npm run export` (scripts/export/format.ts, copied in by
// build.ts), so the two always match.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { buildExport, TIME_ZONE } from './lib/format.js';
import { weekDates, weekNumber } from './lib/selections.js';
import { makeZip } from './zip.js';
import { HIGHLIGHT_COLORS, parseHighlightRows } from './lib/highlights.js';
import { parseCsv } from './lib/csv.js';

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
  if (!session) return;

  const [me, seasonRes] = await Promise.all([
    supabase.from('researchers').select('id, name, can_export, is_admin').eq('auth_user_id', session.user.id).maybeSingle(),
    supabase.from('seasons').select('id, name, start_date').eq('is_current', true).maybeSingle(),
  ]);
  $('whoName').textContent = me.data?.name ?? session.user.email;
  season = seasonRes.data;
  $('whoSeason').textContent = season ? `Season ${season.name}` : 'No current season';
  if (me.data && season) {
    // Highlight lists: for every researcher, export approval or not.
    $('hlCard').hidden = false;
    void showLists(me.data);
  }
  if (!me.data?.can_export) {
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
    if (l.created_by === me.id || me.is_admin) {
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
