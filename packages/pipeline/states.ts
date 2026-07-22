/**
 * The news pipeline's notion of "a state".
 *
 * Shared by build-news-summaries.ts (which states get a summary) and
 * diff-states.ts (which states the daily runner may refresh), so the two can't
 * drift apart — a state in one and not the other would either never get a
 * summary or silently never get refreshed. See #233.
 *
 * This is the abbr → name map the PromptQL program is called with. It is NOT
 * the name → abbr table ingest and the MOA builders each carry for parsing
 * upstream directory names; those serve a different job and stay put.
 */
export const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  // Territories present in the roster data — included so every agency's state
  // gets a summary (the homepage "states" count still excludes them elsewhere).
  GU: 'Guam', MP: 'Northern Mariana Islands',
}
