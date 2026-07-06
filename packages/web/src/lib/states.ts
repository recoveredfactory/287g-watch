export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas",
  CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
  IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia",
  WI: "Wisconsin", WY: "Wyoming", DC: "District of Columbia",
  PR: "Puerto Rico", GU: "Guam", VI: "Virgin Islands",
  AS: "American Samoa", MP: "Northern Mariana Islands",
}

// Jurisdictions that get a /state/<abbr> page and appear in state navigation.
// Every US state + DC + the two territories that actually participate in 287(g)
// (Guam, Northern Mariana Islands). The bare territories — Puerto Rico, Virgin
// Islands, American Samoa — are excluded: no agencies, no state_meta row, and no
// focusable map geometry, so they 404 until we have data + geometry for them.
const NON_NAVIGABLE = new Set(["PR", "VI", "AS"]);
export const NAVIGABLE_STATES: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).filter(([abbr]) => !NON_NAVIGABLE.has(abbr)),
);
