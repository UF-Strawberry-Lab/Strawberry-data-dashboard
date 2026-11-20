// Built from scripts/export/formatted.ts by apps/export-web/build.ts. Do not edit.
// Formatted trial data (dashboard, Data export; Mark, 2026-11-17): files laid
// out the way a trial's researchers asked for, built from export_formatted()
// (supabase/migrations/20261117000013_export_formatted.sql).
//
// Phyto: one row per plot for the whole trial map, scored or not:
//   Rep, Bed (within the rep), Position, Genotype, Stake,
//   Plants        plants actually planted (plants per plot minus not planted)
//   Dead_Week0, Dead_Week1, ...   plants dead at the end of that week (a Dead
//                 mark stays until someone revives the plant, so the count
//                 only goes down when a plant is revived; not-planted plants
//                 never count; Dying is not counted). One column per season
//                 week up to the current one.
//   Researcher    who scored the plot (Mark, 2026-11-18): the people whose Dead
//                 marks count today (the latest per plant, so a mark someone
//                 later changed drops out) and anyone who left a note; "; "
//                 between names, A-Z. Blank when nobody marked or noted it:
//                 swiping past a plot saves nothing.
//   Comment       the plot's notes, oldest first, joined with "; "
//   Plot_ID       the raw export's key (Location-Block-Field_Bed-Position)
//
// Phyto, Catalina format (Mark, 2026-11-20): the same rows and columns, but
// one column per rating, named by its date (M/D/YYYY), instead of Dead_WeekN:
//   * a rating = a week in which anyone rated the trial: the paper sheet's
//     DeadPlants counts (10/26, 11/4, 11/11-12) or the app's Dead/Dying marks;
//     the column takes the week's most common rating day (by plots rated;
//     a tie goes to the earlier day), so 11/11 and 11/12 make one column;
//   * the first column = plants dead at that rating; every later column = the
//     NEW dead since the rating before (dead then minus dead before). Below
//     zero is kept (Mark: e.g. a revived plant, or a paper count higher than
//     the field), so the columns add up to the plot's dead at the last rating;
//   * dead at a rating: the plot's paper count that week if it has one (the
//     sheet's dead plants so far; the latest that week), else its Dead marks
//     as in the Phyto file (dead at the end of that week).
//
// No database code here, so the rules are unit-tested (formatted.test.ts).

import { latestMarks, marksDead } from './marks.js?v=1795154863465';
import { weekDates, weekNumber } from './selections.js?v=1795154863465';
import { plotId, toCsv, usDate } from './format.js?v=1795154863465';
import { deadPlants, plantedPlants } from './census.js?v=1795154863465';

export { plantedPlants };

                                
                                                                                          
                                                                                            
                                                    
 
                                
                                                                             
                                                              
 
/** A plot-level dead count from the paper sheet (trait DeadPlants: dead plants so far). */
                                                                                                           
                                                                                                                            
                                
                
                                                      
                                                                         
                                                                                       
 

/**
 * The formatted files, by the name listed on the dashboard: which trial's data
 * each one reads (export_formatted), its file name, and the function that writes it.
 */
export const FORMATS                                                                                                                                 = {
  Phyto: { trial: 'Phyto', file: 'Phyto_formatted', build: (d, today) => phytoFile(d, today) },
  'Phyto (Catalina format)': { trial: 'Phyto', file: 'Phyto_Catalina', build: (d, today) => catalinaFile(d, today) },
};

/**
 * Plants dead in one plot on a day (marks up to and including that day): the
 * latest Dead mark per plant, by anyone. A whole-plot Dead mark counts every
 * planted plant. Not-planted plants never count. (Same rule as the raw
 * export's Dead census: deadPlants in census.ts.)
 */
export function deadOn(plot               , marks                 , day        )         {
  return deadPlants(plot, marks.filter((m) => m.plot_id === plot.id), day).size;
}

/**
 * Who scored a plot, up to a day: whoever made the Dead marks that stand
 * (latest per plant, by anyone; a revive counts, Dying doesn't) plus whoever
 * left a non-empty note. Names A-Z, each once, joined "; ".
 */
export function plotResearchers(plot               , marks                 , notes                 , day        )         {
  const dead = marks
    .filter((m) => m.plot_id === plot.id && marksDead({ name: m.trait, carriesForward: true }) && m.visit_date <= day)
    .map((m) => ({ traitId: m.trait, plantNumber: m.plant_number || null, value: m.value, visitDate: m.visit_date,
      observedAt: m.observed_at, deleted: false, researcher: m.researcher }));
  const names = new Set(latestMarks(dead).map((m) => m.researcher));
  for (const n of notes) if (n.plot_id === plot.id && n.visit_date <= day && n.text.trim()) names.add(n.researcher);
  return [...names].sort((a, b) => a.localeCompare(b)).join('; ');
}

/** Season weeks from Week 0 to the current week (none if the start date is unset). */
export function weeksSoFar(seasonStart               , today        )           {
  const now = weekNumber(today, seasonStart);
  return now === null ? [] : Array.from({ length: now + 1 }, (_, k) => k);
}

/** One column of the Catalina format: a rated week and the day that names it. */
                                                     

/**
 * The trial's ratings, oldest first: every week with a paper count or a
 * Dead/Dying mark, named by its most common day (plots rated that day; a tie
 * goes to the earlier day). Weeks unknown (no start date): none.
 */
export function ratings(data               )           {
  const start = data.season.start_date;
  const plotsByDay = new Map                     ();
  const add = (plot        , day        ) => { (plotsByDay.get(day) ?? plotsByDay.set(day, new Set()).get(day) ).add(plot); };
  for (const c of data.counts ?? []) add(c.plot_id, c.visit_date);
  for (const m of data.marks) add(m.plot_id, m.visit_date);
  const best = new Map                                        ();
  for (const [day, plots] of [...plotsByDay].sort(([a], [b]) => a.localeCompare(b))) {
    const week = weekNumber(day, start);
    if (week === null) continue;
    const b = best.get(week);
    if (!b || plots.size > b.plots) best.set(week, { day, plots: plots.size });
  }
  return [...best].sort(([a], [b]) => a - b).map(([week, b]) => ({ week, day: b.day }));
}

/** Phyto, Catalina format: dead at the first rating, then the new dead at each later one. */
export function catalinaFile(data               , today        )                                 {
  const start = data.season.start_date;
  const cols = ratings(data);
  const sunday = (n        ) => weekDates(n, start) .sunday;
  const notesBy = new Map                         ();
  for (const n of data.notes) if (n.text.trim()) notesBy.set(n.plot_id, [...(notesBy.get(n.plot_id) ?? []), n]);
  const marksBy = new Map                         ();
  for (const m of data.marks) marksBy.set(m.plot_id, [...(marksBy.get(m.plot_id) ?? []), m]);
  // Paper count per plot and week: the latest that week.
  const countBy = new Map                        ();
  for (const c of data.counts ?? []) {
    const key = `${c.plot_id}|${weekNumber(c.visit_date, start)}`;
    const had = countBy.get(key);
    if (!had || `${c.visit_date}${c.observed_at}` > `${had.visit_date}${had.observed_at}`) countBy.set(key, c);
  }
  const header = ['Rep', 'Bed', 'Position', 'Genotype', 'Stake', 'Plants', ...cols.map((r) => usDate(r.day)), 'Researcher', 'Comment', 'Plot_ID'];
  const rows = data.plots.map((p) => {
    const marks = marksBy.get(p.id) ?? [];
    const dead = cols.map((r) => {
      const c = countBy.get(`${p.id}|${r.week}`);
      return c ? Number(c.value) : deadOn(p, marks, sunday(r.week));
    });
    const comment = (notesBy.get(p.id) ?? [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((n) => n.text.trim().replace(/\s+/g, ' '))
      .join('; ');
    return [
      p.rep ?? '', p.bed ?? '', p.position, p.genotype, p.stake_label, plantedPlants(p).length,
      ...dead.map((d, k) => (k === 0 ? d : d - dead[k - 1] )),
      plotResearchers(p, marks, notesBy.get(p.id) ?? [], today), comment, plotId(p),
    ];
  });
  return { csv: toCsv(header, rows), plots: rows.length };
}

/** Phyto: one row per plot, the whole trial map. */
export function phytoFile(data               , today        )                                 {
  const weeks = weeksSoFar(data.season.start_date, today);
  const sunday = (n        ) => weekDates(n, data.season.start_date) .sunday;
  const notesBy = new Map                         ();
  for (const n of data.notes) {
    if (!n.text.trim()) continue;
    notesBy.set(n.plot_id, [...(notesBy.get(n.plot_id) ?? []), n]);
  }
  const marksBy = new Map                         ();
  for (const m of data.marks) marksBy.set(m.plot_id, [...(marksBy.get(m.plot_id) ?? []), m]);

  const header = ['Rep', 'Bed', 'Position', 'Genotype', 'Stake', 'Plants', ...weeks.map((n) => `Dead_Week${n}`), 'Researcher', 'Comment', 'Plot_ID'];
  const rows = data.plots.map((p) => {
    const marks = marksBy.get(p.id) ?? [];
    const comment = (notesBy.get(p.id) ?? [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((n) => n.text.trim().replace(/\s+/g, ' '))
      .join('; ');
    return [
      p.rep ?? '', p.bed ?? '', p.position, p.genotype, p.stake_label, plantedPlants(p).length,
      ...weeks.map((n) => deadOn(p, marks, sunday(n))),
      plotResearchers(p, marks, notesBy.get(p.id) ?? [], today), comment, plotId(p),
    ];
  });
  return { csv: toCsv(header, rows), plots: rows.length };
}
