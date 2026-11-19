// Built from scripts/export/info.ts by apps/export-web/build.ts. Do not edit.
// Trial/Genotype info export (dashboard, Data export -> Trial/Genotype info;
// admins only; Mark, 2026-11-16). Turns what the database function
// export_info() returns (supabase/migrations/20261116000002_export_info.sql)
// into CSV files:
//
//   genotypes.csv          the genotype master, with pedigree
//   maps/<Trial>_map.csv   one per trial: every live plot in field order
//   trial_traits.csv       per trial: its settings and each trait it scores
//
// Plot_ID is the same as in scores.csv and plot_visits.csv, so a map joins
// to the scores. Empty values are blank; yes/no columns are YES / NO.
// No database code here, so the rules are unit-tested (info.test.ts).

import { plotId, toCsv } from './format.js?v=1795096406072';

                          

/** The JSON from public.export_info(). */
                           
              
                                                                                       
                                                                                                                   
                                                                          
      
          
                                                                                                  
                                                                                                                           
      
           
                                                                                                           
                                                                                                          
                                                                                                                    
      
 

const yesNo = (b                            ) => (b ? 'YES' : 'NO');
/** A trial's map in the export: maps/<Trial>_map.csv, the name made safe for a file ("A/B" -> "A_B"). */
export const mapFile = (trial        ) => `maps/${trial.replace(/[^A-Za-z0-9._-]+/g, '_')}_map.csv`;

/** All the files, by path inside the export folder. */
export function buildInfoExport(data          )                                                                                      {
  const files                         = {};

  files['genotypes.csv'] = toCsv(
    ['Genotype', 'Category', 'Family', 'Female_Parent', 'Male_Parent', 'Maternal_Grandmother', 'Maternal_Grandfather',
      'Paternal_Grandmother', 'Paternal_Grandfather', 'Pedigree_Source', 'Select_Criteria', 'Added_In_Field'],
    data.genotypes.map((g) => [g.name, g.category, g.family, g.female_parent, g.male_parent, g.maternal_grandmother,
      g.maternal_grandfather, g.paternal_grandmother, g.paternal_grandfather, g.pedigree_source, g.select_criteria,
      yesNo(g.added_in_field)]));

  // One map per trial, in field order (block, bed, position).
  const byTrial = new Map                           ();
  for (const p of data.plots) (byTrial.get(p.trial) ?? byTrial.set(p.trial, []).get(p.trial) ).push(p);
  for (const [trial, plots] of [...byTrial.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    plots.sort((a, b) => a.block.localeCompare(b.block) || a.field_bed - b.field_bed || a.position - b.position);
    files[mapFile(trial)] = toCsv(
      ['Plot_ID', 'Trial', 'Location', 'Block', 'Field_Bed', 'Trial_Bed', 'Rep', 'Position', 'Stake', 'Genotype',
        'Plants_Per_Plot', 'Note', 'Added_In_Field'],
      plots.map((p) => [plotId(p), trial, p.location, p.block, p.field_bed, p.trial_bed, p.rep, p.position, p.stake,
        p.genotype, p.plants_per_plot, p.note, yesNo(p.added_in_field)]));
  }

  // Settings repeat on each trait row, so one file answers "what does this trial score, and how".
  files['trial_traits.csv'] = toCsv(
    ['Trial', 'Location', 'Expected_Plots_Per_Bed', 'Plants_Per_Plot', 'Family_Dividers', 'Full_Length_Beds',
      'Trait_Group', 'Trait', 'Display_Name', 'Value_Type', 'Scale_Min', 'Scale_Max', 'Scoring_Unit', 'Description'],
    data.traits.map((t) => [t.trial, t.location, t.expected_plots_per_bed, t.plants_per_plot, yesNo(t.family_dividers),
      yesNo(t.full_length_beds), t.group, t.trait, t.display_name, t.value_type, t.scale_min, t.scale_max,
      t.scoring_unit, t.description]));

  return { files, genotypes: data.genotypes.length, plots: data.plots.length, trials: byTrial.size };
}
