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
//   Comment       the plot's notes, oldest first, joined with "; "
//   Plot_ID       the raw export's key (Location-Block-Field_Bed-Position)
//
// No database code here, so the rules are unit-tested (formatted.test.ts).

import { marksDead, standingMarks,           } from './marks.js?v=1794968737199';
import { weekDates, weekNumber } from './selections.js?v=1794968737199';
import { plotId, toCsv } from './format.js?v=1794968737199';

                                
                                                                                          
                                                                                            
                                                    
 
                                
                                                                             
                                          
 
                                                                                                        
                                
                
                                                      
                                                                         
 

/** Trials with a formatted file, and the function that writes it. */
export const FORMATS                                                                                         = {
  Phyto: phytoFile,
};

/** Plants planted in a plot: 1..plants_per_plot, minus the ones not planted. */
export function plantedPlants(p                                                           )           {
  const missing = new Set(p.missing_plants ?? []);
  return Array.from({ length: Math.max(0, p.plants_per_plot) }, (_, k) => k + 1).filter((n) => !missing.has(n));
}

/**
 * Plants dead in one plot on a day (marks up to and including that day): the
 * latest Dead mark per plant, by anyone. A whole-plot Dead mark counts every
 * planted plant. Not-planted plants never count.
 */
export function deadOn(plot               , marks                 , day        )         {
  const asMarks         = marks
    .filter((m) => m.plot_id === plot.id && marksDead({ name: m.trait, carriesForward: true }) && m.visit_date <= day)
    .map((m) => ({ traitId: m.trait, plantNumber: m.plant_number, value: m.value, visitDate: m.visit_date, observedAt: m.observed_at, deleted: false }));
  const standing = standingMarks(asMarks);
  const isDead = (plant               ) => standing.some((s) => (s.plantNumber || null) === plant && s.value === 1);
  const planted = plantedPlants(plot);
  return isDead(null) ? planted.length : planted.filter((n) => isDead(n)).length;
}

/** Season weeks from Week 0 to the current week (none if the start date is unset). */
export function weeksSoFar(seasonStart               , today        )           {
  const now = weekNumber(today, seasonStart);
  return now === null ? [] : Array.from({ length: now + 1 }, (_, k) => k);
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

  const header = ['Rep', 'Bed', 'Position', 'Genotype', 'Stake', 'Plants', ...weeks.map((n) => `Dead_Week${n}`), 'Comment', 'Plot_ID'];
  const rows = data.plots.map((p) => {
    const marks = marksBy.get(p.id) ?? [];
    const comment = (notesBy.get(p.id) ?? [])
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((n) => n.text.trim().replace(/\s+/g, ' '))
      .join('; ');
    return [
      p.rep ?? '', p.bed ?? '', p.position, p.genotype, p.stake_label, plantedPlants(p).length,
      ...weeks.map((n) => deadOn(p, marks, sunday(n))),
      comment, plotId(p),
    ];
  });
  return { csv: toCsv(header, rows), plots: rows.length };
}
