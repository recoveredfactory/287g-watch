export type Finding = {
  source: string;
  text: string;
};

export type ComparisonRow = {
  label: string;
  jem: string;
  tfm: string;
  wso: string;
};

export type MajorPoint = {
  heading: string;
  body: string; // trusted internal HTML — may contain <a>, <em>, <strong>
};

export type ModelContent = {
  overviewParas: string[];
  officerCan: string[];
  keyDistinction?: string;
  trainingText: string;
  backgroundParas?: string[];
  majorPoints: MajorPoint[];
};

export const PROGRAM_FINDINGS: Finding[] = [
  {
    source: "DHS OIG (2010)",
    text: "More than half of immigrants identified through JEM were arrested for misdemeanors, primarily traffic offenses. ICE and local agencies were not complying with MOA terms. At least 33 recommendations were issued.",
  },
  {
    source: 'ACLU "License to Abuse" (2022)',
    text: "Of 142 participating agencies, 65% had documented patterns of racial profiling, 77% operated detention facilities with documented inhumane conditions.",
  },
  {
    source: "UN Committee on the Elimination of Racial Discrimination (2022)",
    text: 'Called on the Biden administration to terminate the program, describing it as "indirectly promoting racial profiling."',
  },
  {
    source: "Cato Institute (2018)",
    text: "Analysis of North Carolina counties found no causal relationship between 287(g) apprehensions and crime reduction. Unexpectedly found a correlation with increased assaults on law enforcement, attributed to community trust erosion.",
  },
];

export const DETAINER_NOTE =
  "Courts in multiple jurisdictions have held that civil immigration detainers are not binding on local jails, and that holding someone solely on a detainer past their legal release date may violate the Fourth Amendment. ICE maintains they are lawful requests. See <em>Morales v. Chadbourne</em>, 1st Cir. 2015.";

export const COMPARISON_ROWS: ComparisonRow[] = [
  { label: "Setting", jem: "Jail only", tfm: "Anywhere", wso: "Jail only" },
  { label: "Can interrogate suspects", jem: "Yes", tfm: "Yes", wso: "No" },
  { label: "Can initiate removal", jem: "Yes", tfm: "Yes", wso: "No" },
  {
    label: "Can arrest without state charges",
    jem: "Yes (in facility)",
    tfm: "Yes (anywhere)",
    wso: "No — warrant required",
  },
  {
    label: "Training",
    jem: "160 hrs (4 weeks)",
    tfm: "40 hrs online",
    wso: "8 hrs online",
  },
  {
    label: "Compliance inspections",
    jem: "Biennial",
    tfm: "Unclear",
    wso: "None",
  },
];

export const MODEL_RICH_CONTENT: Record<string, ModelContent> = {
  "Jail Enforcement Model": {
    overviewParas: [
      "This model only authorizes officers to investigate immigration status after someone has already been booked into jail — no community patrols, no arrests based on suspected immigration status in the field, and no street stops. Officers need an independent reason to take someone into custody.",
      "Local officers screen and identify people already booked into jail. They can interview detained individuals about their immigration status, run DHS database checks, issue detainers, and hold someone up to 48 hours past their scheduled release so ICE can take custody.",
      "Officers can also serve administrative arrest warrants and initiate immigration removal paperwork.",
    ],
    officerCan: [
      "Interview detained individuals about immigration status",
      "Run DHS database checks (IDENT/IAFIS)",
      "Issue immigration detainers",
      "Hold individuals up to 48 hours past scheduled release for ICE transfer",
      "Serve administrative arrest warrants",
      "Initiate removal proceedings",
    ],
    trainingText:
      "4-week (160-hour) course at the Federal Law Enforcement Training Center (FLETC) in Georgia. Biennial refresher training required (reduced from annual after 2020 MOA changes).",
    backgroundParas: [
      "The first agreement was signed in 2002 by the Florida Department of Law Enforcement (FDLE). The program grew to 72 agencies by 2011, then contracted to 37 under the Obama administration by 2017. Growth stalled until Trump's second term, when numbers climbed to approximately 150 before accelerating further.",
    ],
    majorPoints: [
      {
        heading: "No performance metrics (GAO-21-186, 2021)",
        body: 'ICE "does not have goals or measures to assess program performance." Biennial compliance inspections exist on paper but are inconsistently conducted.',
      },
      {
        heading: "Accountability rollback (2020)",
        body: 'When ICE renewed 75 JEM MOAs in 2020, it quietly removed expiration dates, the requirement for individual officers to commit to a minimum 2-year term, and the entire section describing civil rights complaint procedures — including agency points of contact. <a href="https://ilrc.org/sites/default/files/resources/changes_to_287g_10.20.20.pdf" target="_blank" rel="noreferrer" class="underline">Source: ILRC analysis.</a>',
      },
    ],
  },

  "Task Force Model": {
    overviewParas: [
      "This is the broadest grant of authority. Local officers can question and arrest people for immigration violations at any time — traffic stops, 911 responses, street encounters. Authority is not limited to jail settings.",
      "The key distinction from JEM is that TFM officers make first contact and can arrest based solely on suspected immigration status. JEM officers only encounter people already in custody on state charges.",
    ],
    officerCan: [
      "Question anyone about immigration status during any encounter",
      "Access DHS databases (IDENT/IAFIS)",
      "Make civil immigration arrests (no state criminal charge required)",
      "Issue detainers",
      "Initiate removal proceedings",
    ],
    keyDistinction:
      "Unlike JEM, TFM officers can initiate contact and make arrests in the community based solely on suspected immigration status — not limited to individuals already booked into jail.",
    trainingText:
      "Officers complete a 40-hour online course. Before the program was terminated in 2012, training was a 4-week in-person course at FLETC.",
    majorPoints: [
      {
        heading: "Origins (2006)",
        body: "Program originated in 2006. Maricopa County (Sheriff Arpaio) was among the first and most prominent participants.",
      },
      {
        heading: "Terminated by Obama administration (December 31, 2012)",
        body: "The Obama administration terminated all TFM agreements, citing documented racial profiling in Maricopa County, AZ and Alamance County, NC.",
      },
      {
        heading: "Melendres v. Arpaio",
        body: 'Federal court found Maricopa County deputies arrested people where "roughly 77% of all arrests...with Hispanic surnames" by one deputy. Another "arrested only Latinos during the operations he participated in." Deputies circulated emails "comparing Mexicans to dogs." Total cost to Maricopa County taxpayers: over $300 million. As of 2025, 640+ deputy misconduct claims remain uninvestigated.',
      },
      {
        heading: "Not revived during first Trump term (2017–2021)",
        body: "Even Executive Order 13768 did not restore the Task Force Model.",
      },
      {
        heading: "Revived January 20, 2025 — EO 14159",
        body: "Training requirements cut from 4 weeks in-person to 40 hours online.",
      },
      {
        heading: "Rapid growth (2025)",
        body: "141 agencies in the first 50 days → 338 by June 2025 → 1,182+ agencies in 32 states.",
      },
      {
        heading: "Notable expansions (2025–2026)",
        body: "Florida and Texas National Guard. University campus police (Florida A&M, New College of Florida, others). Texas Attorney General's Office. State environmental and wildlife agencies.",
      },
      {
        heading: "Alamance County, NC",
        body: 'Sheriff ordered deputies to "bring [him] some Mexicans." DOJ found Latino drivers "up to 10 times more likely to be stopped" — described by DOJ\'s own expert as "some of the highest rates of racial profiling ever documented in the United States." DOJ terminated the agreement and filed a civil rights lawsuit.',
      },
      {
        heading: "Law enforcement opposition",
        body: "The International Association of Chiefs of Police, Major Cities Chiefs Association, and a coalition of 63 sheriffs and police chiefs have expressed opposition, citing interference with community policing and trust.",
      },
      {
        heading: "Noem v. Vasquez Perdomo (September 2024)",
        body: 'Held that race/ethnicity can be a "relevant factor" in immigration enforcement stops — removing a key legal barrier that was central to the Obama-era termination.',
      },
    ],
  },

  "Warrant Service Officer": {
    overviewParas: [
      "This is the most limited model. Officers execute ICE administrative warrants on specific named individuals already incarcerated. ICE has already identified the person; WSO officers only serve the warrant and make the arrest.",
      "The main distinction from JEM is investigative authority: JEM officers find potentially removable individuals by screening. WSO officers execute warrants for people ICE has already identified. WSOs have no investigative authority at all.",
    ],
    officerCan: [
      "Execute pre-existing ICE warrants (Form I-200 or I-205) within the facility",
      "Transfer the individual to ICE custody",
    ],
    keyDistinction:
      "Officers cannot interview anyone about immigration status, screen detainees for potential removability, initiate removal proceedings, or issue detainers independently — inside or outside of jail.",
    trainingText:
      "8-hour online course — the lowest training requirement of the three models.",
    majorPoints: [
      {
        heading: "Launch: May 6, 2019 — Pinellas County, Florida",
        body: "Designed for two audiences: agencies in sanctuary jurisdictions whose state laws restricted full 287(g) participation, and small rural agencies without budget for JEM programs.",
      },
      {
        heading: "No oversight mechanism (GAO-21-186, 2021)",
        body: '"ICE did not have an oversight mechanism for participants in the WSO model...ICE did not have clear policies on 287(g) field supervisors\' oversight responsibilities or plan to conduct compliance inspections for WSO participants." Unlike JEM (biennial inspections), WSO has no scheduled compliance inspections at all.',
      },
      {
        heading: "Critics' arguments",
        body: "Generally considered the least invasive model because it involves no interrogation or screening. Critics argue: (1) the absence of inspections means violations at the warrant-execution stage go undetected; (2) it serves as a deliberate mechanism to achieve immigration enforcement in sanctuary jurisdictions that prohibit broader programs.",
      },
    ],
  },
};

export const PRIMARY_SOURCES: Array<{ label: string; url: string }> = [
  {
    label: "ICE 287(g) program page",
    url: "https://www.ice.gov/identify-and-arrest/287g",
  },
  {
    label: "GAO-21-186 (2021)",
    url: "https://www.gao.gov/products/gao-21-186",
  },
  {
    label: 'DHS OIG-18-77 (2018) — "Lack of Planning Hinders Effective Oversight"',
    url: "https://www.oig.dhs.gov",
  },
  {
    label: 'DHS OIG-10-63 (2010) — "The Performance of 287(g) Agreements"',
    url: "https://www.oig.dhs.gov",
  },
  {
    label: 'ACLU "License to Abuse" (2022)',
    url: "https://www.aclu.org/publications/license-abuse-how-ices-287g-program-empowers-racist-sheriffs",
  },
  {
    label: "ILRC — 2020 MOA changes analysis",
    url: "https://ilrc.org/sites/default/files/resources/changes_to_287g_10.20.20.pdf",
  },
  {
    label: "ILRC — Understanding the Warrant Service Officer Program",
    url: "https://ilrc.org/understanding-ices-warrant-service-officer-program",
  },
  {
    label: "Cato Institute crime study (2018)",
    url: "https://www.cato.org/working-paper/do-immigration-enforcement-programs-reduce-crime-evidence-287g-program-north-carolina",
  },
  {
    label: "Lawfare — liability analysis",
    url: "https://www.lawfaremedia.org/article/the-return-of-287(g)--how-trump-s-immigration-plan-may-leave-sheriffs-liable",
  },
  {
    label: "NIF — TFM training explainer",
    url: "https://forumtogether.org/article/explainer-training-under-the-revived-287g-task-force-model/",
  },
  {
    label: "ProPublica — Maricopa County investigation",
    url: "https://www.propublica.org/article/immigration-287g-maricopa-county-arizona",
  },
  {
    label: "ACLU — Melendres v. Arpaio",
    url: "https://www.aclu.org/cases/ortega-melendres-et-al-v-arpaio-et-al",
  },
  {
    label: "CRS IF11898",
    url: "https://congress.gov/crs-product/IF11898",
  },
  {
    label: "American Immigration Council — 287(g) overview",
    url: "https://www.americanimmigrationcouncil.org/fact-sheet/287g-program-immigration",
  },
];
