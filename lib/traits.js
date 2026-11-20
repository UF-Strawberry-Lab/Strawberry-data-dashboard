// Built from packages/shared/src/traits.ts by apps/export-web/build.ts. Do not edit.
// Which traits a researcher sees in a trial, and numbered observations
// (Mark, 2026-11-13; supabase/migrations/20261113000001_traits_dashboard.sql).

/**
 * Where a trait is used: trial ids (trait_trials) and researcher ids
 * (trait_researchers). An empty list = no limit.
 */
                                                                           

/**
 * Does this researcher get the trait in this trial?
 *  - limited to people: only those people;
 *  - limited to trials: only in those trials (even where its group isn't one
 *    of the trial's groups, e.g. Licor_obs in CGS);
 *  - otherwise: wherever its group is one of the trial's groups.
 */
export function traitInTrial(scope            , groupInTrial         , trialId        , researcherId        )          {
  if (scope.researcherIds.length && !scope.researcherIds.includes(researcherId)) return false;
  return scope.trialIds.length ? scope.trialIds.includes(trialId) : groupInTrial;
}

// ---------- numbered observations (value_type 'sequence', e.g. Licor_obs) ----------
// Marking a plant gives it the next number for that person that day:
// observation_1, observation_2, ... Stored as the number.

/** "observation_" + 3 -> "observation_3" */
export const sequenceLabel = (label                           , n        ) => `${label ?? ''}${n}`;

/** The next number: one more than the highest used today (a gap stays a gap). */
export function nextSequence(used          )         {
  return used.length ? Math.max(...used) + 1 : 1;
}

/**
 * Clearing number `cleared` with "shift down": every later number that day
 * moves down one, so there's no gap. Returns the marks to renumber.
 */
export function shiftDown                             (marks     , cleared        )                               {
  return marks.filter((m) => m.value > cleared).map((m) => ({ ...m, newValue: m.value - 1 }));
}

// ---------- tick boxes (value_type 'choices', e.g. PlantHealth) ----------
// traits.value_label lists the boxes, separated by ";" ("PM;Thrip;Other";
// Mark, 2026-11-19). Any number of boxes can be ticked. The score is one
// whole number: box 1 adds 1, box 2 adds 2, box 3 adds 4, ... (PM + Other =
// 5), so scale_max = 2^boxes - 1. Nothing ticked stores nothing.

/** "PM;Thrip;Other" -> ['PM', 'Thrip', 'Other'] */
export const choiceLabels = (label                           )           =>
  (label ?? '').split(';').map((s) => s.trim()).filter(Boolean);

/** Is box `k` (0 = first) ticked in this score? */
export const isTicked = (value                           , k        )          =>
  !!value && (Math.trunc(value) & (1 << k)) !== 0;

/** Tick or untick box `k`. Returns the new score, or null when nothing is left ticked. */
export function toggleChoice(value                           , k        )                {
  const next = Math.trunc(value ?? 0) ^ (1 << k);
  return next === 0 ? null : next;
}

/** A score as text, the ticked labels in box order: 5 -> "PM;Other". */
export function choicesText(label                           , value        )         {
  return choiceLabels(label).filter((_, k) => isTicked(value, k)).join(';');
}

// ---------- a trait in more than one group (trait_group_extras) ----------
// Firmness lives in Fruit Quality and is also shown in CGS quality; Dead
// lives in CGS yield and is also shown in Phyto (Mark, 2026-11-15). It is
// still one trait: one score, one export column.

/** A trait as listed in one group: its home group or another group it is also shown in. */
                                                                                                             

/**
 * The traits of the chosen groups, in group then trait order, each trait
 * once: a trait in two chosen groups is shown in the first of them only.
 */
export function traitsInGroups                        (listings     , chosenGroupIds          )      {
  const chosen = new Set(chosenGroupIds);
  const ordered = listings.filter((l) => chosen.has(l.groupId))
    .sort((a, b) => a.groupSortOrder - b.groupSortOrder || a.groupId.localeCompare(b.groupId) || a.sortOrder - b.sortOrder);
  const seen = new Set        ();
  return ordered.filter((l) => !seen.has(l.traitId) && seen.add(l.traitId));
}

// ---------- a trait that takes another's place for some people ----------
// traits.replaces_trait_id (Mark, 2026-11-20; 20261120000004): Sophie Neo
// replaces NeoLeaf for Sophie. She scores Sophie Neo only; NeoLeaf is not
// scored on her phone but shown read-only: everyone else's latest NeoLeaf on
// the plot, in a closed dropdown under Sophie Neo. Everyone else sees NeoLeaf.

/** The traits a researcher scores: those they see, minus any that another trait they see replaces. */
export function withoutReplaced                                                           (visible     )      {
  const replaced = new Set(visible.map((t) => t.replacesTraitId).filter((x)              => !!x));
  return visible.filter((t) => !replaced.has(t.id));
}

/**
 * The traits whose scores this researcher reads from everyone (what their
 * traits replace): the replaced trait of each trait limited to them, or of
 * one limited to nobody.
 */
export function replacedTraitIds(traits                                                   ,
  people                                             , researcherId        )           {
  const peopleOf = new Map                  ();
  for (const x of people) peopleOf.set(x.traitId, [...(peopleOf.get(x.traitId) ?? []), x.researcherId]);
  const ids = traits.filter((t) => t.replacesTraitId && (!(peopleOf.get(t.id)?.length) || peopleOf.get(t.id) .includes(researcherId)))
    .map((t) => t.replacesTraitId );
  return [...new Set(ids)];
}

/** One score by someone else, as shown read-only. */
                                                                                                                                                 

/** Everyone else's latest score (cleared ones left out), one per person (on a shared crew phone: per name), newest first. */
export function latestPerPerson(scores              , me        )               {
  const latest = new Map                    ();
  for (const x of scores) {
    if (x.researcherId === me) continue;
    const who = `${x.researcherId}|${x.researcher}`;
    const had = latest.get(who);
    if (!had || x.observedAt > had.observedAt) latest.set(who, x);
  }
  return [...latest.values()].filter((x) => !x.deleted)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.researcher.localeCompare(b.researcher));
}
