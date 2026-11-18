// Built from packages/shared/src/marks.ts by apps/export-web/build.ts. Do not edit.
// Marks that stay: traits with carries_forward (Dead; Mark, 2026-11-15;
// supabase/migrations/20261115000001_crew_cgs_phyto.sql).
//
// A mark is an ordinary yes/no score on the day it was made. Later visits
// show the latest mark for that plant, by anyone, so a plant marked dead
// stays dead for every phone in the trial until someone revives it
// (a later score of 0, for a plant marked by mistake).

/**
 * Dying (Mark, 2026-11-17): a mark that stays like Dead, but the plant can
 * still be scored. Every other mark that stays (Dead) means the plant is dead.
 */
export const DYING_TRAIT = 'Dying';

/** A mark that stays and means the plant is dead (Dead; not Dying). */
export const marksDead = (t                                            )          =>
  !!t.carriesForward && t.name !== DYING_TRAIT;

/** One Dead score on a plot, by anyone, on any day. */
                       
                  
                                                            
                                                                     
                                                 
                                                                              
                   
 

/** Where a plot stands for one trait and plant: the latest live mark. */
                                                                                                               

/**
 * The latest live mark for each trait and plant. A cleared mark doesn't
 * count, so clearing today's mark brings back whatever was there before.
 */
export function standingMarks(marks        )                 {
  return latestMarks(marks).map(({ traitId, plantNumber, value, visitDate }) => ({ traitId, plantNumber, value, visitDate }));
}

/** The marks that stand (the latest live one per trait and plant), whole, so extra fields (who made it) come along. */
export function latestMarks                (marks     )      {
  const latest = new Map           ();
  for (const m of marks) {
    if (m.deleted) continue;
    const key = `${m.traitId}|${m.plantNumber ?? 0}`;
    const held = latest.get(key);
    const later = !held || m.visitDate > held.visitDate
      || (m.visitDate === held.visitDate && m.observedAt > held.observedAt);
    if (later) latest.set(key, m);
  }
  return [...latest.values()];
}

/**
 * What a tap on a mark row writes into my slot today (null = clear my score).
 *   shown    the value on screen (the standing mark), null = never marked
 *   carried  true when it comes from an earlier day or someone else, not
 *            from a score of mine today
 * My own mark today: the tap clears it (back to how the plant stood before).
 * Otherwise the tap flips the plant: dead -> revived (0), else -> dead (1).
 */
export function markTap(shown               , carried         )                {
  if (!carried && shown !== null) return null;
  return shown === 1 ? 0 : 1;
}
