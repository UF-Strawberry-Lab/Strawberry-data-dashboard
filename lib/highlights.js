// Built from packages/shared/src/highlights.ts by apps/export-web/build.ts. Do not edit.
// Highlight lists: genotypes to find in the field, each with a color.
// Uploaded as a CSV on the export page; shown as colored bars in the app.
// The database (supabase/migrations/20261111000002_highlight_lists.sql)
// allows the same color names and re-checks everything on upload.

/** Color name -> how it is drawn. Readable in sun. No yellow (= selected) and no green
 *  (= scored today in the app; removed 2026-11-13, 20261113000002_highlight_no_green.sql). */
export const HIGHLIGHT_COLORS = {
  red: '#D62828',
  orange: '#F77F00',
  blue: '#1F6FEB',
  purple: '#7B2CBF',
  pink: '#E0479E',
  brown: '#8B5A2B',
  black: '#222222',
}         ;

                                                           

export const isHighlightColor = (c        )                      => Object.prototype.hasOwnProperty.call(HIGHLIGHT_COLORS, c);

                                                                         

/**
 * Check an uploaded highlight CSV before sending it. Columns: genotype and
 * color (or colour); header case doesn't matter. Where the list applies
 * (trials, reps) is chosen on the page, not in the file (Mark, 2026-11-12),
 * so a "trial" column is an error rather than being silently ignored.
 * Returns the rows, or every problem found (then nothing should be sent).
 * Genotype names are checked by the database.
 */
export function parseHighlightRows(headers          , rows                          ) 
                                             {
  const find = (...names          ) => headers.find((h) => names.includes(h.trim().toLowerCase()));
  const gCol = find('genotype');
  const cCol = find('color', 'colour');
  const errors           = [];
  if (!gCol) errors.push('Missing column "genotype"');
  if (!cCol) errors.push('Missing column "color"');
  if (find('trial', 'rep')) errors.push('Remove the "trial" / "rep" column: choose trials and reps on the page instead');
  if (errors.length) return { rows: [], errors };

  const out                 = [];
  rows.forEach((r, i) => {
    const line = i + 2;   // line 1 is the header
    const genotype = (r[gCol ] ?? '').trim();
    const color = (r[cCol ] ?? '').trim().toLowerCase();
    if (!genotype && !color) return;   // blank line
    if (!genotype) errors.push(`Line ${line}: genotype is blank`);
    if (!isHighlightColor(color)) {
      errors.push(`Line ${line}: color "${color}" must be one of ${Object.keys(HIGHLIGHT_COLORS).join(', ')}`);
    }
    if (genotype && isHighlightColor(color)) out.push({ genotype, color });
  });
  if (!out.length && !errors.length) errors.push('The file has no genotypes.');
  return { rows: errors.length ? [] : out, errors };
}

/** A genotype listed more than once with different colors: the uploader picks one. */
                                                                             

/**
 * Repeated genotypes (same name, ignoring case and spaces): with the same
 * color, keep the first and drop the rest; with different colors, report a
 * conflict so the page can ask which color to use (Mark, 2026-11-12).
 * `chosen` (genotype -> color, keyed by lowercase name) settles conflicts.
 */
export function dedupeHighlightRows(rows                , chosen                                 = {}) 
                                                                        {
  const byName = new Map                        ();
  for (const r of rows) {
    const k = r.genotype.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), r]);
  }
  const out                 = [];
  const conflicts                  = [];
  for (const [k, group] of byName) {
    const colors = [...new Set(group.map((r) => r.color))];
    if (colors.length === 1) out.push(group[0] );
    else if (chosen[k] && colors.includes(chosen[k] )) out.push({ genotype: group[0] .genotype, color: chosen[k]  });
    else conflicts.push({ genotype: group[0] .genotype, colors });
  }
  return { rows: out, conflicts, dropped: rows.length - out.length - conflicts.reduce((n, c) => n + byName.get(c.genotype.trim().toLowerCase()) .length, 0) };
}

/**
 * Where a list applies, as chosen on the dashboard: one entry per trial,
 * rep null = every rep of that trial. No entries at all = every trial.
 * (Lists from before 2026-11-12 have no entries; their items may still
 * name one trial each, which the app also honours.)
 */
                                                                       

/** Same rep? Ignores case and spaces ("Rep 2" isn't used; reps are "1", "2", ...). */
const sameRep = (a        , b        ) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Does a list apply to a plot in `trialId` whose rep is `rep`?
 * The plot's rep is its own (trial file) if it has one, else its bed's (field map).
 * A plot with no rep matches a trial chosen with all reps, not one limited to reps.
 */
export function scopeIncludes(scope                  , trialId        , rep               )          {
  if (!scope.length) return true;
  return scope.some((s) => s.trialId === trialId && (s.rep === null || (rep !== null && sameRep(s.rep, rep))));
}
