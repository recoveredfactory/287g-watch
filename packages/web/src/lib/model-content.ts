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
        body: 'The Obama administration terminated all TFM agreements, citing documented racial profiling in Maricopa County, AZ and <a href="/en/agency/alamance-county-sheriffs-office-nc" class="underline underline-offset-2">Alamance County, NC</a>.',
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

// ── Spanish content ─────────────────────────────────────────────────────────
// Translated from the English content above, not independently researched —
// every fact, figure, case name, and citation is identical to its English
// counterpart; only the prose is translated. Direct quotes (e.g. the GAO-
// 21-186 findings below) are translated too and kept in quotation marks,
// even though their sources spoke/wrote in English — flagged here as an
// editorial call, not a documented site convention, since no comparable
// precedent could be confirmed elsewhere in the codebase. Worth a second
// look: an alternative would be leaving direct quotes in English with an
// inline "(traducción)" note, or moving the translation outside the quote
// marks entirely. Model names
// (MODEL_RICH_CONTENT_ES's keys) are deliberately left as the English
// official designations — same existing site convention as MODEL_SHORT/
// MODEL_MINI, which never localize either. PRIMARY_SOURCES (citation
// titles) and Finding.source (citation labels) are left untranslated in
// both locales — standard bibliographic practice, not an oversight.

export const PROGRAM_FINDINGS_ES: Finding[] = [
  {
    source: "DHS OIG (2010)",
    text: "Más de la mitad de los inmigrantes identificados a través del JEM fueron arrestados por delitos menores, principalmente infracciones de tránsito. ICE y las agencias locales no cumplían con los términos del MOA. Se emitieron al menos 33 recomendaciones.",
  },
  {
    source: 'ACLU "License to Abuse" (2022)',
    text: "De 142 agencias participantes, el 65% tenía patrones documentados de perfil racial, y el 77% operaba instalaciones de detención con condiciones inhumanas documentadas.",
  },
  {
    source: "Comité de la ONU para la Eliminación de la Discriminación Racial (2022)",
    text: 'Pidió a la administración Biden que terminara el programa, describiéndolo como una práctica que "promueve indirectamente el perfil racial."',
  },
  {
    source: "Cato Institute (2018)",
    text: "Un análisis de condados de Carolina del Norte no encontró relación causal entre las detenciones del 287(g) y la reducción del delito. Inesperadamente, se halló una correlación con un aumento de agresiones contra agentes del orden, atribuido a la erosión de la confianza comunitaria.",
  },
];

export const DETAINER_NOTE_ES =
  "Tribunales de varias jurisdicciones han determinado que los detainers civiles de inmigración no son vinculantes para las cárceles locales, y que retener a alguien únicamente por un detainer más allá de su fecha legal de liberación puede violar la Cuarta Enmienda. ICE sostiene que son solicitudes legales. Véase <em>Morales v. Chadbourne</em>, 1.er Cir. 2015.";

export const COMPARISON_ROWS_ES: ComparisonRow[] = [
  { label: "Entorno", jem: "Solo cárcel", tfm: "Cualquier lugar", wso: "Solo cárcel" },
  { label: "¿Puede interrogar a sospechosos?", jem: "Sí", tfm: "Sí", wso: "No" },
  { label: "¿Puede iniciar la deportación?", jem: "Sí", tfm: "Sí", wso: "No" },
  {
    label: "¿Puede arrestar sin cargos estatales?",
    jem: "Sí (en la instalación)",
    tfm: "Sí (en cualquier lugar)",
    wso: "No: se requiere una orden",
  },
  {
    label: "Capacitación",
    jem: "160 horas (4 semanas)",
    tfm: "40 horas en línea",
    wso: "8 horas en línea",
  },
  {
    label: "Inspecciones de cumplimiento",
    jem: "Bienal",
    tfm: "No está claro",
    wso: "Ninguna",
  },
];

export const MODEL_RICH_CONTENT_ES: Record<string, ModelContent> = {
  "Jail Enforcement Model": {
    overviewParas: [
      "Este modelo solo autoriza a los oficiales a investigar el estatus migratorio después de que alguien ya haya sido ingresado a la cárcel — no hay patrullajes comunitarios, no hay arrestos basados en sospecha de estatus migratorio en el campo, y no hay detenciones callejeras. Los oficiales necesitan un motivo independiente para poner a alguien bajo custodia.",
      "Los oficiales locales examinan e identifican a las personas que ya han sido ingresadas a la cárcel. Pueden entrevistar a las personas detenidas sobre su estatus migratorio, realizar verificaciones en las bases de datos del DHS, emitir detainers, y retener a alguien hasta 48 horas después de su fecha de liberación programada para que ICE pueda tomar custodia.",
      "Los oficiales también pueden ejecutar órdenes de arresto administrativas e iniciar el papeleo de deportación.",
    ],
    officerCan: [
      "Entrevistar a personas detenidas sobre su estatus migratorio",
      "Realizar verificaciones en las bases de datos del DHS (IDENT/IAFIS)",
      "Emitir detainers de inmigración",
      "Retener a personas hasta 48 horas después de su liberación programada para el traslado a ICE",
      "Ejecutar órdenes de arresto administrativas",
      "Iniciar procesos de deportación",
    ],
    trainingText:
      "Curso de 4 semanas (160 horas) en el Centro Federal de Capacitación en Cumplimiento de la Ley (FLETC) en Georgia. Se requiere capacitación de actualización cada dos años (reducida de anual tras los cambios al MOA de 2020).",
    backgroundParas: [
      "El primer acuerdo fue firmado en 2002 por el Departamento de Cumplimiento de la Ley de Florida (FDLE). El programa creció a 72 agencias para 2011, y luego se redujo a 37 bajo la administración Obama para 2017. El crecimiento se estancó hasta el segundo mandato de Trump, cuando las cifras subieron a aproximadamente 150 antes de acelerarse aún más.",
    ],
    majorPoints: [
      {
        heading: "Sin métricas de desempeño (GAO-21-186, 2021)",
        body: 'ICE "no tiene metas ni medidas para evaluar el desempeño del programa." Las inspecciones de cumplimiento bienales existen en papel, pero se realizan de manera inconsistente.',
      },
      {
        heading: "Retroceso en la rendición de cuentas (2020)",
        body: 'Cuando ICE renovó 75 MOA del JEM en 2020, eliminó discretamente las fechas de vencimiento, el requisito de que los oficiales individuales se comprometieran a un mínimo de 2 años, y toda la sección que describía los procedimientos de quejas de derechos civiles — incluidos los puntos de contacto de las agencias. <a href="https://ilrc.org/sites/default/files/resources/changes_to_287g_10.20.20.pdf" target="_blank" rel="noreferrer" class="underline">Fuente: análisis de ILRC.</a>',
      },
    ],
  },

  "Task Force Model": {
    overviewParas: [
      "Esta es la concesión de autoridad más amplia. Los oficiales locales pueden interrogar y arrestar a personas por violaciones migratorias en cualquier momento — paradas de tránsito, respuestas al 911, encuentros callejeros. La autoridad no se limita al entorno carcelario.",
      "La distinción clave con el JEM es que los oficiales del TFM hacen el primer contacto y pueden arrestar basándose únicamente en la sospecha de estatus migratorio. Los oficiales del JEM solo tienen contacto con personas que ya están bajo custodia por cargos estatales.",
    ],
    officerCan: [
      "Interrogar a cualquier persona sobre su estatus migratorio durante cualquier encuentro",
      "Acceder a las bases de datos del DHS (IDENT/IAFIS)",
      "Realizar arrestos civiles de inmigración (no se requiere cargo penal estatal)",
      "Emitir detainers",
      "Iniciar procesos de deportación",
    ],
    keyDistinction:
      "A diferencia del JEM, los oficiales del TFM pueden iniciar contacto y realizar arrestos en la comunidad basándose únicamente en la sospecha de estatus migratorio — no se limita a personas que ya han sido ingresadas a la cárcel.",
    trainingText:
      "Los oficiales completan un curso en línea de 40 horas. Antes de que el programa fuera terminado en 2012, la capacitación era un curso presencial de 4 semanas en el FLETC.",
    majorPoints: [
      {
        heading: "Orígenes (2006)",
        body: "El programa se originó en 2006. El condado de Maricopa (alguacil Arpaio) estuvo entre los primeros participantes y los más prominentes.",
      },
      {
        heading: "Terminado por la administración Obama (31 de diciembre de 2012)",
        body: 'La administración Obama terminó todos los acuerdos del TFM, citando perfil racial documentado en el condado de Maricopa, AZ, y el <a href="/es/agency/alamance-county-sheriffs-office-nc" class="underline underline-offset-2">condado de Alamance, NC</a>.',
      },
      {
        heading: "Melendres v. Arpaio",
        body: 'Un tribunal federal determinó que los agentes del condado de Maricopa arrestaban a personas donde "aproximadamente el 77% de todos los arrestos... tenían apellidos hispanos" realizados por un agente. Otro "arrestó únicamente a latinos durante los operativos en los que participó." Los agentes hicieron circular correos electrónicos "comparando a los mexicanos con perros." Costo total para los contribuyentes del condado de Maricopa: más de $300 millones. Hasta 2025, más de 640 quejas de mala conducta de agentes permanecen sin investigar.',
      },
      {
        heading: "No fue reactivado durante el primer mandato de Trump (2017–2021)",
        body: "Ni siquiera la Orden Ejecutiva 13768 restableció el Modelo de Fuerza de Tarea.",
      },
      {
        heading: "Reactivado el 20 de enero de 2025 — OE 14159",
        body: "Los requisitos de capacitación se redujeron de 4 semanas presenciales a 40 horas en línea.",
      },
      {
        heading: "Crecimiento acelerado (2025)",
        body: "141 agencias en los primeros 50 días → 338 para junio de 2025 → más de 1,182 agencias en 32 estados.",
      },
      {
        heading: "Expansiones notables (2025–2026)",
        body: "Guardia Nacional de Florida y Texas. Policía de campus universitarios (Florida A&M, New College of Florida, entre otros). Oficina del Fiscal General de Texas. Agencias estatales de medio ambiente y vida silvestre.",
      },
      {
        heading: "Condado de Alamance, NC",
        body: 'El alguacil ordenó a los agentes "traerle algunos mexicanos." El DOJ determinó que los conductores latinos tenían "hasta 10 veces más probabilidades de ser detenidos" — descrito por el propio experto del DOJ como "algunas de las tasas más altas de perfil racial jamás documentadas en Estados Unidos." El DOJ terminó el acuerdo y presentó una demanda de derechos civiles.',
      },
      {
        heading: "Oposición de las fuerzas del orden",
        body: "La Asociación Internacional de Jefes de Policía, la Asociación de Jefes de las Grandes Ciudades, y una coalición de 63 alguaciles y jefes de policía han expresado su oposición, citando interferencia con la vigilancia comunitaria y la confianza.",
      },
      {
        heading: "Noem v. Vasquez Perdomo (septiembre de 2024)",
        body: 'Determinó que la raza/etnia puede ser un "factor relevante" en las detenciones de cumplimiento migratorio — eliminando una barrera legal clave que fue central en la terminación de la era Obama.',
      },
    ],
  },

  "Warrant Service Officer": {
    overviewParas: [
      "Este es el modelo más limitado. Los oficiales ejecutan órdenes administrativas de ICE sobre personas específicas ya identificadas por su nombre que se encuentran encarceladas. ICE ya ha identificado a la persona; los oficiales del WSO solo ejecutan la orden y realizan el arresto.",
      "La principal distinción con el JEM es la autoridad investigativa: los oficiales del JEM identifican a personas potencialmente deportables mediante exámenes. Los oficiales del WSO ejecutan órdenes para personas que ICE ya ha identificado. Los WSO no tienen ninguna autoridad investigativa.",
    ],
    officerCan: [
      "Ejecutar órdenes preexistentes de ICE (Formulario I-200 o I-205) dentro de la instalación",
      "Trasladar a la persona a la custodia de ICE",
    ],
    keyDistinction:
      "Los oficiales no pueden entrevistar a nadie sobre su estatus migratorio, evaluar a las personas detenidas para determinar su posible deportabilidad, iniciar procesos de deportación, ni emitir detainers de forma independiente — dentro o fuera de la cárcel.",
    trainingText:
      "Curso en línea de 8 horas — el requisito de capacitación más bajo de los tres modelos.",
    majorPoints: [
      {
        heading: "Lanzamiento: 6 de mayo de 2019 — Condado de Pinellas, Florida",
        body: "Diseñado para dos públicos: agencias en jurisdicciones santuario cuyas leyes estatales restringían la participación total en el 287(g), y agencias rurales pequeñas sin presupuesto para programas del JEM.",
      },
      {
        heading: "Sin mecanismo de supervisión (GAO-21-186, 2021)",
        body: '"ICE no contaba con un mecanismo de supervisión para los participantes del modelo WSO... ICE no tenía políticas claras sobre las responsabilidades de supervisión de los supervisores de campo del 287(g) ni planes para realizar inspecciones de cumplimiento para los participantes del WSO." A diferencia del JEM (inspecciones bienales), el WSO no tiene ninguna inspección de cumplimiento programada.',
      },
      {
        heading: "Argumentos de los críticos",
        body: "Generalmente considerado el modelo menos invasivo porque no implica interrogatorios ni exámenes. Los críticos argumentan: (1) la ausencia de inspecciones significa que las violaciones en la etapa de ejecución de órdenes pasan sin detectarse; (2) sirve como un mecanismo deliberado para lograr el cumplimiento migratorio en jurisdicciones santuario que prohíben programas más amplios.",
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
