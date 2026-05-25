export type GlossaryTerm = {
  term: string;
  definition: string;
  seeAlso?: string[];
};

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  {
    term: "287(g)",
    definition:
      "Section 287(g) of the Immigration and Nationality Act authorizes the Department of Homeland Security to enter into agreements with state and local law enforcement agencies, granting local officers the power to enforce federal immigration law.",
    seeAlso: ["Memorandum of Agreement", "ICE"],
  },
  {
    term: "Administrative warrant",
    definition:
      "A civil warrant issued by an immigration officer, not a federal judge. Unlike criminal warrants, administrative warrants do not authorize entry into a private home.",
    seeAlso: ["Detainer", "Warrant Service Officer"],
  },
  {
    term: "Civil immigration violation",
    definition:
      "Being present in the United States without authorization is a civil violation, not a criminal one. This distinction matters for what local officers can legally do under 287(g).",
  },
  {
    term: "Detainer",
    definition:
      "A request from ICE to a local jail or law enforcement agency to hold a person beyond their scheduled release date so ICE can take custody.",
    seeAlso: ["Jail Enforcement Model"],
  },
  {
    term: "ICE",
    definition:
      "U.S. Immigration and Customs Enforcement, the federal agency within the Department of Homeland Security responsible for civil immigration enforcement.",
  },
  {
    term: "Jail Enforcement Model",
    definition:
      "Under the Jail Enforcement Model (JEM), trained local officers screen people booked into local jails to identify those who may be removable under federal immigration law.",
    seeAlso: ["287(g)", "Task Force Model", "Warrant Service Officer"],
  },
  {
    term: "Memorandum of Agreement",
    definition:
      "The formal contract between ICE and a local law enforcement agency that establishes the terms of a 287(g) partnership, specifying which officers are trained, what authority they have, and oversight requirements.",
    seeAlso: ["287(g)"],
  },
  {
    term: "MOA",
    definition: "Short for Memorandum of Agreement — the formal contract between ICE and a local agency.",
    seeAlso: ["Memorandum of Agreement"],
  },
  {
    term: "Removal",
    definition:
      "The formal process by which a person is ordered to leave the United States by an immigration judge or through expedited procedures.",
  },
  {
    term: "Task Force Model",
    definition:
      "Under the Task Force Model (TFM), trained local officers work alongside ICE agents in the community to make immigration arrests — the broadest authority granted under 287(g).",
    seeAlso: ["287(g)", "Jail Enforcement Model", "Warrant Service Officer"],
  },
  {
    term: "Warrant Service Officer",
    definition:
      "The Warrant Service Officer (WSO) model authorizes local officers to serve administrative warrants on people ICE has already identified for removal. Officers cannot initiate independent enforcement.",
    seeAlso: ["287(g)", "Administrative warrant", "Jail Enforcement Model"],
  },
];

export const TERMS_MAP = new Map(
  GLOSSARY_TERMS.map((t) => [t.term.toLowerCase(), t])
);

export function termSlug(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
