export type GlossaryTerm = {
  term: string;
  definition: string;
  seeAlso?: string[];
  learnMoreHref?: string;
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
      "A civil warrant issued by an immigration officer rather than a federal judge. Unlike criminal warrants, administrative warrants don't authorize entry into a private home — but they do let 287(g) officers, especially under the Warrant Service Officer model, detain named individuals for ICE pickup.",
    seeAlso: ["Detainer", "Warrant Service Officer"],
  },
  {
    term: "Civil immigration violation",
    definition:
      "Being present in the United States without authorization is a civil violation, not a criminal one. This distinction matters for what local officers can legally do under 287(g).",
    seeAlso: ["287(g)", "Detainer"],
  },
  {
    term: "Detainer",
    definition:
      "A request from ICE asking a local jail to hold a person — typically up to 48 hours past their scheduled release — so ICE can take custody. Federal courts have found that complying with a detainer without an independent legal basis can violate the Fourth Amendment, and a number of jurisdictions decline them for that reason.",
    seeAlso: ["Jail Enforcement Model", "Civil immigration violation"],
  },
  {
    term: "ICE",
    definition:
      "U.S. Immigration and Customs Enforcement, the federal agency within the Department of Homeland Security responsible for civil immigration enforcement.",
    seeAlso: ["287(g)"],
  },
  {
    term: "Jail Enforcement Model",
    definition:
      "The most common 287(g) model. Trained local officers screen people booked into the jail, run them against immigration databases, and flag those who may be removable so ICE can lodge a detainer. Activity is confined to the jail — no community arrests.",
    seeAlso: ["287(g)", "Task Force Model", "Warrant Service Officer"],
    learnMoreHref: "/model/jail",
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
      "The official term for being deported. Removal happens either through an immigration judge's order or — far more often — through expedited procedures that bypass the courts entirely. ICE carries out the physical removal.",
    seeAlso: ["ICE", "Detainer", "287(g)"],
  },
  {
    term: "Task Force Model",
    definition:
      "The broadest 287(g) authority. Trained local officers ride along with ICE field agents to stop, question, and arrest people for immigration violations in the community — not just those already in custody.",
    seeAlso: ["287(g)", "Jail Enforcement Model", "Warrant Service Officer"],
    learnMoreHref: "/model/taskforce",
  },
  {
    term: "Warrant Service Officer",
    definition:
      "The narrowest 287(g) model. Local officers — typically in a jail setting — execute ICE administrative warrants on people ICE has already named. They can't decide who's targeted and can't make independent immigration arrests.",
    seeAlso: ["287(g)", "Administrative warrant", "Jail Enforcement Model"],
    learnMoreHref: "/model/wso",
  },
];

export const TERMS_MAP = new Map(
  GLOSSARY_TERMS.map((t) => [t.term.toLowerCase(), t])
);

export function termSlug(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
