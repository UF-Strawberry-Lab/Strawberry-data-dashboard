// Built from packages/shared/src/highlights.ts by apps/export-web/build.ts. Do not edit.
// Highlight lists: genotypes to find in the field, each with a color.
// Uploaded as a CSV on the export page; shown as colored bars in the app.
// The database (supabase/migrations/20261111000002_highlight_lists.sql)
// allows the same color names and re-checks everything on upload.

/** Color name -> how it is drawn. Readable in sun; no yellow (yellow = selected). */
export const HIGHLIGHT_COLORS = {
  red: '#D62828',
  orange: '#F77F00',
  green: '#2A9D3F',
  blue: '#1F6FEB',
  purple: '#7B2CBF',
  pink: '#E0479E',
  brown: '#8B5A2B',
  black: '#222222',
}         ;

                                                           

export const isHighlightColor = (c        )                      => Object.prototype.hasOwnProperty.call(HIGHLIGHT_COLORS, c);

                                                                                         

/**
 * Check an uploaded highlight CSV before sending it. Columns: genotype,
 * color (or colour), and optional trial. Header case doesn't matter.
 * Returns the rows, or every problem found (then nothing should be sent).
 * Genotype and trial names are checked by the database.
 */
export function parseHighlightRows(headers          , rows                          ) 
                                             {
  const find = (...names          ) => headers.find((h) => names.includes(h.trim().toLowerCase()));
  const gCol = find('genotype');
  const cCol = find('color', 'colour');
  const tCol = find('trial');
  const errors           = [];
  if (!gCol) errors.push('Missing column "genotype"');
  if (!cCol) errors.push('Missing column "color"');
  if (errors.length) return { rows: [], errors };

  const out                 = [];
  rows.forEach((r, i) => {
    const line = i + 2;   // line 1 is the header
    const genotype = (r[gCol ] ?? '').trim();
    const color = (r[cCol ] ?? '').trim().toLowerCase();
    const trial = tCol ? (r[tCol] ?? '').trim() : '';
    if (!genotype && !color && !trial) return;   // blank line
    if (!genotype) errors.push(`Line ${line}: genotype is blank`);
    if (!isHighlightColor(color)) {
      errors.push(`Line ${line}: color "${color}" must be one of ${Object.keys(HIGHLIGHT_COLORS).join(', ')}`);
    }
    if (genotype && isHighlightColor(color)) out.push(trial ? { genotype, color, trial } : { genotype, color });
  });
  if (!out.length && !errors.length) errors.push('The file has no genotypes.');
  return { rows: errors.length ? [] : out, errors };
}
