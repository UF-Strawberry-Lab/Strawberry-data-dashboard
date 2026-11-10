// Built from packages/shared/src/selections.ts by apps/export-web/build.ts. Do not edit.
// Selection flags: when a plot was selected (Select = YES) this season.
// In the field a selected plot gets a yellow flag with the week number that
// stays up all season, so the app shows the same thing: every YES on the
// plot, by anyone, with its week and date, and the plot shaded yellow.
//
// A later NO does not take an earlier flag down (the physical flag stays);
// clearing a YES (tap it again) does remove it, because that score is gone.

/**
 * Week number, Monday-based: week 1 is the Monday-to-Sunday week that
 * contains the season start date. null if the start date isn't set or the
 * date is before it. Dates are YYYY-MM-DD. The export uses the same rule.
 */
export function weekNumber(date        , seasonStart               )                {
  if (!seasonStart) return null;
  const day = (iso        ) => {            // a date as milliseconds at UTC midnight
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return Date.UTC(y , m  - 1, d );
  };
  const start = day(seasonStart);
  const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * 86_400_000;
  const week = Math.floor((day(date) - monday) / (7 * 86_400_000)) + 1;
  return week >= 1 ? week : null;
}

/** First and last day (Monday, Sunday) of season week n, as YYYY-MM-DD. null if the start date isn't set. */
export function weekDates(n        , seasonStart               )                                            {
  if (!seasonStart || n < 1) return null;
  const [y, m, d] = seasonStart.slice(0, 10).split('-').map(Number);
  const start = Date.UTC(y , m  - 1, d );
  const monday = start - ((new Date(start).getUTCDay() + 6) % 7) * 86_400_000 + (n - 1) * 7 * 86_400_000;
  const iso = (ms        ) => new Date(ms).toISOString().slice(0, 10);
  return { monday: iso(monday), sunday: iso(monday + 6 * 86_400_000) };
}

/** One Select score as stored (observations row for the Select trait). */
                              
             
                 
                         
                                           
                                                
                   
 

                                
                    
                      
                                                         
 

/**
 * Selection flags per plot, oldest first. One flag per visit date; if two
 * researchers selected the same plot on the same day, both names are listed.
 */
export function selectionFlags(scores               , seasonStart               )                               {
  const byPlot = new Map                                  ();
  for (const s of scores) {
    if (s.deleted || s.value !== 1) continue;
    const days = byPlot.get(s.plotId) ?? new Map                     ();
    days.set(s.visitDate, (days.get(s.visitDate) ?? new Set()).add(s.researcherName));
    byPlot.set(s.plotId, days);
  }
  const out = new Map                         ();
  for (const [plotId, days] of byPlot) {
    out.set(plotId, [...days].sort(([a], [b]) => a.localeCompare(b)).map(([visitDate, who]) => ({
      visitDate, week: weekNumber(visitDate, seasonStart), researchers: [...who].sort(),
    })));
  }
  return out;
}

/** "Week 2 · 11/17" (or just the date when weeks are unknown). */
export function flagLabel(f               )         {
  const [, m, d] = f.visitDate.split('-').map(Number);
  const date = `${m}/${d}`;
  return f.week ? `Week ${f.week} · ${date}` : date;
}
