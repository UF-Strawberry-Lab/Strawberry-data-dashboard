// Built from scripts/export/census.ts by apps/export-web/build.ts. Do not edit.
// Dead census (Mark, 2026-11-18; trials.dead_census, on for Phyto): in the raw
// export, every planted plant of the trial gets a Dead value in each week the
// trial was rated.
//
//   * A week counts as rated when anyone scored anything in the trial that
//     week. Every plot is then assumed checked (crew don't mark alive plants).
//   * Real Dead rows stay as they are. Every planted plant without a real
//     Dead row that week gets an added row: 1 if it stands dead at the end of
//     the week (the latest Dead mark per plant, by anyone; a whole-plot Dead
//     counts every planted plant), else 0. Dying doesn't count.
//   * Not-planted plants get a row too: Not_Planted = 1, Dead = NA. Every
//     other plant row of the trial (added or real) has Not_Planted = 0.
//   * An added row takes the rater of the nearest plot someone scored in the
//     same bed that week (by position; a tie goes to the later score): that
//     person, day and time (Timestamp). So a bed two people split is
//     credited half and half. A bed nobody scored that week: the trial's last
//     rating day of the week, blank Researcher and Timestamp NA.
//
// Nothing is stored: rows are built here, from export_rows()'s census part
// (supabase/migrations/20261118000004_census_plot_activity.sql). Tested in census.test.ts.

import { latestMarks, marksDead } from './marks.js?v=1795034313375';
import { weekDates, weekNumber } from './selections.js?v=1795034313375';
                                            

/** The trait the added rows fill, and the column marking not-planted plants. */
export const DEAD_TRAIT = 'Dead';
export const NOT_PLANTED = 'Not_Planted';

                             
                                  
                                                                       
                                                        
                                                           
 
                             
                                                                             
                                          
 
/** Someone scored a plot on a day (last_at = their latest score there that day). */
                                                                                                                                              
                                                                                                    

/** Plants planted in a plot: 1..plants_per_plot, minus the ones not planted. */
export function plantedPlants(p                                                              )           {
  const missing = new Set(p.missing_plants ?? []);
  return Array.from({ length: Math.max(0, p.plants_per_plot) }, (_, k) => k + 1).filter((n) => !missing.has(n));
}

/**
 * The planted plants of one plot that stand dead on a day (marks up to and
 * including that day): the latest Dead mark per plant, by anyone. A whole-plot
 * Dead mark counts every planted plant. Dying and not-planted plants don't count.
 */
export function deadPlants(plot                                                              , marks              , day        )              {
  const standing = latestMarks(marks
    .filter((m) => marksDead({ name: m.trait, carriesForward: true }) && m.visit_date <= day)
    .map((m) => ({ traitId: m.trait, plantNumber: m.plant_number || null, value: Number(m.value), visitDate: m.visit_date, observedAt: m.observed_at, deleted: false })));
  const isDead = (plant               ) => standing.some((s) => s.plantNumber === plant && s.value === 1);
  const planted = plantedPlants(plot);
  return new Set(isDead(null) ? planted : planted.filter((n) => isDead(n)));
}

/**
 * The rater an unscored plot takes: the nearest scored plot in its bed that
 * week, by position; a tie goes to the later score. undefined = nobody scored
 * in the bed that week.
 */
export function nearestRater(position        , bedActivity                  )                             {
  let best                            ;
  for (const a of bedActivity) {
    if (!best) { best = a; continue; }
    const d = Math.abs(a.position - position), bd = Math.abs(best.position - position);
    if (d < bd || (d === bd && a.last_at > best.last_at)) best = a;
  }
  return best;
}

/**
 * The added rows (see the top of this file): a Dead row for every planted
 * plant without a real one that week, a Not_Planted = 1 row for every
 * not-planted plant, and Not_Planted = 0 on the trial's real plant rows.
 * real = the export's own scores. Rows of one plant visit share a key, so
 * scoresFile puts a plant's Dead and Not_Planted on one line.
 */
export function censusRows(c                        , real            , seasonStart               )             {
  if (!c || !c.plots.length) return [];
  const weekOf = (d        ) => weekNumber(d, seasonStart);
  const plots = new Map(c.plots.map((p) => [p.plot_id, p]));

  // Rated weeks: the trial's activity, by week.
  const weeks = new Map                          ();
  for (const a of c.activity) {
    const w = weekOf(a.visit_date);
    if (w !== null) weeks.set(w, [...(weeks.get(w) ?? []), a]);
  }
  const marksBy = new Map                      ();
  for (const m of c.marks) marksBy.set(m.plot_id, [...(marksBy.get(m.plot_id) ?? []), m]);

  const rows             = [];
  // Real plant rows of the trial: Not_Planted 0 (1 if, oddly, the plant isn't planted).
  const hasReal = new Set        ();
  for (const s of real) {
    const p = s.plot_id ? plots.get(s.plot_id) : undefined;
    if (!p || s.plant_number === null || s.replicate !== null) continue;
    if (s.trait === DEAD_TRAIT) hasReal.add(`${p.plot_id}|${s.plant_number}|${weekOf(s.visit_date)}`);
    rows.push({ ...s, trait: NOT_PLANTED, value: (p.missing_plants ?? []).includes(s.plant_number) ? 1 : 0 });
  }

  for (const [w, acts] of [...weeks.entries()].sort(([a], [b]) => a - b)) {
    const sunday = weekDates(w, seasonStart) .sunday;
    const lastDay = acts.map((a) => a.visit_date).sort().at(-1) ;
    const byBed = new Map                          ();
    for (const a of acts) byBed.set(a.bed_id, [...(byBed.get(a.bed_id) ?? []), a]);
    for (const p of c.plots) {
      const near = nearestRater(p.position, byBed.get(p.bed_id) ?? []);
      const who = { researcher: near?.researcher ?? '', visit_date: near?.visit_date ?? lastDay, observed_at: near ? new Date(near.last_at) : null };
      const base = {
        plot_id: p.plot_id, location: p.location, block: p.block, field_bed: p.field_bed, position: p.position,
        stake_label: p.stake_label, genotype: p.genotype, trials: p.trials, ...who, replicate: null,
      };
      const dead = deadPlants(p, marksBy.get(p.plot_id) ?? [], sunday);
      const missing = new Set(p.missing_plants ?? []);
      for (let n = 1; n <= Math.max(0, p.plants_per_plot); n++) {
        if (hasReal.has(`${p.plot_id}|${n}|${w}`)) continue;
        if (missing.has(n)) { rows.push({ ...base, plant_number: n, trait: NOT_PLANTED, value: 1 }); continue; }
        rows.push({ ...base, plant_number: n, trait: DEAD_TRAIT, value: dead.has(n) ? 1 : 0 });
        rows.push({ ...base, plant_number: n, trait: NOT_PLANTED, value: 0 });
      }
    }
  }
  return rows;
}
