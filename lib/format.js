// Built from scripts/export/format.ts by apps/export-web/build.ts. Do not edit.
// Turns database rows into the two export files (rules in CLAUDE.md, Export):
//
//   scores.csv       one row per plot x researcher x visit date x berry (or plant),
//                    one column per berry/plant trait. No Comment/Select.
//   plot_visits.csv  one row per plot x researcher x visit date, with plot-level
//                    traits, Comment (all notes, oldest first) and Select.
//
// Both carry Plot_ID (location-block-field_bed-position, e.g. "Balm-S3-74-12")
// and Visit_ID (Plot_ID + date + researcher), so they join without confusing
// the same genotype in another plot.
//
// No database code here, so these rules are unit-tested (format.test.ts).

import { weekNumber } from './selections.js?v=1794517828971';

/** One live (not cleared) score, joined to its plot, bed and trait. */
                           
                                                                       
                                                                                                   
                                                                        
                                                  
                                                                                                          
 

/** One live note, joined the same way. */
                          
                                                                       
                                                        
                                                                         
 

                                
                                                                      
                                                                                           
                                                                    
                                                                                           
                                                                               
                                                                        
 

export const NA = 'NA';

export const plotId = (r                                                                          ) =>
  `${r.location}-${r.block}-${r.field_bed}-${r.position}`;
export const visitId = (r                    ) => `${plotId(r)}_${r.visit_date}_${r.researcher}`;

/** "2026-11-09" -> "11/9/2026" */
export function usDate(isoDate        )         {
  const [y, m, d] = isoDate.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

/** A moment -> "11/9/2026 10:53:43 AM" in the given time zone. */
export function usTimestamp(when      , timeZone        )         {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  }).formatToParts(when).map((p) => [p.type, p.value]));
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second} ${parts.dayPeriod}`;
}

/**
 * Week number, Monday-based: Week_1 is the Monday-to-Sunday week that contains
 * the season start date. NA if the start date isn't set or the visit is before it.
 */
export function weekLabel(visitDate        , seasonStart               )         {
  const week = weekNumber(visitDate, seasonStart);   // same rule the app uses for selection flags
  return week ? `Week_${week}` : NA;
}

/** CSV cell: quoted only when needed; quotes inside are doubled. */
export function csvCell(v                                    )         {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header          , rows                              )         {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const score = (v                    ) => (v === undefined ? NA : String(Number(v)));
const earliest = (dates        ) => new Date(Math.min(...dates.map((d) => d.getTime())));
const fieldOrder = (a                    , b                    ) =>
  a.trials.localeCompare(b.trials) || a.visit_date.localeCompare(b.visit_date) || a.researcher.localeCompare(b.researcher) ||
  a.block.localeCompare(b.block) || a.field_bed - b.field_bed || a.position - b.position;

/** scores.csv: berry- and plant-level scores, one row per berry or plant. */
export function scoresFile(scores            , o               )         {
  const groups = new Map                    ();
  for (const s of scores) {
    if (s.replicate === null && s.plant_number === null) continue;   // plot-level: goes in plot_visits
    const key = `${visitId(s)}|${s.replicate ?? ''}|${s.plant_number ?? ''}`;
    (groups.get(key) ?? groups.set(key, []).get(key) ).push(s);
  }
  const rows = [...groups.values()]
    .sort((a, b) => fieldOrder(a[0] , b[0] ) || (a[0] .replicate ?? 0) - (b[0] .replicate ?? 0) || (a[0] .plant_number ?? 0) - (b[0] .plant_number ?? 0))
    .map((g) => {
      const f = g[0] ;
      const byTrait = new Map(g.map((s) => [s.trait, s.value]));
      return [
        plotId(f), visitId(f), f.stake_label, f.genotype, f.trials,
        usTimestamp(earliest(g.map((s) => s.observed_at)), o.timeZone), usDate(f.visit_date),
        o.season.replace('-', '_'), f.location, weekLabel(f.visit_date, o.seasonStart), f.researcher,
        f.replicate ?? NA, f.plant_number ?? NA,
        ...o.berryPlantTraits.map((t) => score(byTrait.get(t))),
      ];
    });
  return toCsv(['Plot_ID', 'Visit_ID', 'Stake', 'Genotype', 'Trial', 'Timestamp', 'Date', 'Season', 'Location', 'Week',
    'Researcher', 'Berry', 'Plant', ...o.berryPlantTraits], rows);
}

/** plot_visits.csv: one row per plot visit (any score or note), with Comment and Select. */
export function plotVisitsFile(scores            , notes           , o               )         {
  const visits = new Map                                                                                                                                              ();
  const visit = (r                    ) => {
    const id = visitId(r);
    let v = visits.get(id);
    if (!v) visits.set(id, v = { first: r, times: [], plot: new Map(), notes: [], berries: new Set(), plants: new Set() });
    return v;
  };
  for (const s of scores) {
    const v = visit(s);
    v.times.push(s.observed_at);
    if (s.replicate !== null) v.berries.add(s.replicate);
    else if (s.plant_number !== null) v.plants.add(s.plant_number);
    else v.plot.set(s.trait, s.value);
  }
  for (const n of notes) {
    const v = visit(n);
    v.times.push(n.created_at);
    v.notes.push(n);
  }
  const rows = [...visits.values()].sort((a, b) => fieldOrder(a.first, b.first)).map((v) => {
    const f = v.first;
    const select = v.plot.get(o.selectTrait);
    const comment = v.notes.sort((a, b) => a.created_at.getTime() - b.created_at.getTime()).map((n) => n.text.trim()).filter(Boolean).join(' | ');
    return [
      plotId(f), visitId(f), f.stake_label, f.genotype, f.trials,
      usTimestamp(earliest(v.times), o.timeZone), usDate(f.visit_date),
      o.season.replace('-', '_'), f.location, weekLabel(f.visit_date, o.seasonStart), f.researcher,
      v.berries.size, v.plants.size,
      ...o.plotTraits.map((t) => score(v.plot.get(t))),
      comment,
      select === undefined ? '' : Number(select) === 1 ? 'YES' : 'NO',
    ];
  });
  return toCsv(['Plot_ID', 'Visit_ID', 'Stake', 'Genotype', 'Trial', 'Timestamp', 'Date', 'Season', 'Location', 'Week',
    'Researcher', 'Berries_Scored', 'Plants_Scored', ...o.plotTraits, 'Comment', 'Select'], rows);
}

// ---- the whole export, from what the database function export_rows() returns ----
// Used by npm run export and by the export web page (apps/export-web), so both
// write the same files.

/** The JSON from public.export_rows() / public.export_data(). Times are ISO text. */
                             
                                                                  
                                                                                                
                                                                      
                                                                  
 

export const TIME_ZONE = 'America/New_York';
export const SELECT_TRAIT = 'Select';

/** scores.csv and plot_visits.csv, plus counts for the summary line. */
export function buildExport(data            )                                                                                                {
  const scores             = data.scores.map((s) => ({ ...s, observed_at: new Date(s.observed_at) }));
  const notes            = data.notes.map((n) => ({ ...n, created_at: new Date(n.created_at) }));
  // Trait columns: every active trait of that kind, plus any other trait that
  // has scores of that kind (e.g. a legacy trait, or a per-trial override).
  const usedAs = (plot         ) => new Set(scores
    .filter((s) => plot === (s.replicate === null && s.plant_number === null)).map((s) => s.trait));
  const berryPlantUsed = usedAs(false);
  const plotUsed = usedAs(true);
  const berryPlantTraits = data.traits.filter((t) => (t.active && t.scoring_unit !== 'plot') || berryPlantUsed.has(t.name)).map((t) => t.name);
  const plotTraits = data.traits.filter((t) => t.name !== SELECT_TRAIT && ((t.active && t.scoring_unit === 'plot') || plotUsed.has(t.name))).map((t) => t.name);
  const o                = { season: data.season.name, seasonStart: data.season.start_date, berryPlantTraits, plotTraits, selectTrait: SELECT_TRAIT, timeZone: TIME_ZONE };
  return {
    scores: scores.length, notes: notes.length,
    files: { 'scores.csv': scoresFile(scores, o), 'plot_visits.csv': plotVisitsFile(scores, notes, o) },
  };
}
