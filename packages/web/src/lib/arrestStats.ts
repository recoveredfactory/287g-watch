// Minimum matched arrest total before the arrests section renders at all.
// Coverage from the Deportation Data Project's event_landmark field is much
// patchier than detainers, so a low count reads as noise rather than
// signal — see packages/pipeline/build-arrest-stats.ts.
export const MIN_ARREST_STATS_TOTAL = 5;
