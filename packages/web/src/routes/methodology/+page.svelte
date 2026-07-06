<script lang="ts">
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import Gloss from "$lib/components/Gloss.svelte";
  import { ogImage } from "$lib/ogImage";
  $: title = m.methodology_meta_title();
  $: description = m.methodology_meta_description();
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  const seen = new Set<string>();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={ogImage('methodology.png')} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content={ogImage('methodology.png')} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-8 sm:py-12 sm:px-6">
  <h1 class="text-2xl font-black text-slate-900 sm:text-4xl">{m.methodology_heading()}</h1>

  <div class="prose-editorial mt-6 sm:mt-8">
    <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">{m.methodology_sources_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_sources_lead()} {seen} /></p>

    <ul>
      <li>
        <strong><a href="https://www.ice.gov/identify-and-arrest/287g" target="_blank" rel="noreferrer">ICE 287(g) participants list</a></strong> <Gloss text={m.methodology_source_ice_body()} {seen} />
      </li>
      <li>
        <strong><a href="https://github.com/appelson/Tracking_287g" target="_blank" rel="noreferrer">appelson/Tracking_287g</a></strong> <Gloss text={m.methodology_source_appelson_body()} {seen} />
      </li>
      <li>
        <strong><a href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/downloads" target="_blank" rel="noreferrer">FBI Law Enforcement Employees (LEE)</a></strong>
        <Gloss text={m.methodology_source_lee_body()} {seen} />
      </li>
      <li>
        <strong><a href="https://www.wikidata.org/" target="_blank" rel="noreferrer">Wikidata</a></strong>
        <Gloss text={m.methodology_source_wikidata_body()} {seen} />
      </li>
      <li>
        <strong><a href="https://www.muckrock.com/" target="_blank" rel="noreferrer">MuckRock</a></strong>
        <Gloss text={m.methodology_source_muckrock_body()} {seen} />
      </li>
      <li>
        <strong><a href="https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html" target="_blank" rel="noreferrer">U.S. Census Bureau Gazetteer</a></strong>
        <Gloss text={m.methodology_source_census_body()} {seen} />
      </li>
      <li>
        <strong><a href="https://www.geocod.io/" target="_blank" rel="noreferrer">Geocod.io</a></strong>
        <Gloss text={m.methodology_source_geocodio_body()} {seen} />
      </li>
    </ul>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_matching_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_matching_body()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_mapping_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_mapping_body()} {seen} /></p>
    <p class="mt-3"><Gloss text={m.methodology_mapping_statewide()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_population_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_population_body_1()} {seen} /></p>
    <p class="mt-3"><Gloss text={m.methodology_population_body_2()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_limitations_heading()}</h2>

    <ul class="mt-3">
      <li><Gloss text={m.methodology_limitations_li_1()} {seen} /></li>
      <li><Gloss text={m.methodology_limitations_li_2()} {seen} /></li>
    </ul>

    <h2 id="ai" class="mt-8 scroll-mt-24 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_ai_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_ai_body_1()} {seen} /></p>
    <p class="mt-3"><Gloss text={m.methodology_ai_body_2()} {seen} /></p>

    <h3 class="mt-6 font-serif text-lg font-bold text-slate-900 sm:mt-8 sm:text-xl">{m.methodology_news_gather_heading()}</h3>

    <p class="mt-3"><Gloss text={m.methodology_news_gather_body()} {seen} /></p>

    <p class="mt-3"><Gloss text={m.methodology_news_perplexity_body()} {seen} /></p>
    <!-- Verbatim Perplexity angle prompts: the literal English strings sent to the
         API, so they are intentionally NOT run through i18n (a Spanish reader sees
         the real query, same as the hardcoded URLs/emails below). [STATE] and
         [AFTER to BEFORE] are the per-state / date-window placeholders. -->
    <div class="my-4 space-y-3 border-l-2 border-slate-200 pl-4 text-sm italic text-slate-600">
      <p>"Find news [from AFTER to BEFORE] about the ICE 287(g) program in the state of [STATE]: which local law enforcement agencies signed, expanded, or ended 287(g) agreements, and any reporting or controversy about immigration enforcement cooperation with ICE. Name specific agencies and counties, with sources."</p>
      <p>"[AFTER to BEFORE], what are people saying on social media, Substack, blogs, podcasts, YouTube, and from independent content creators, advocates, and local commentators about the ICE 287(g) program in the state of [STATE]? Include 'discourse' beyond mainstream hard news — activist threads, creator commentary, community reaction. Name specific agencies/counties and link sources where possible."</p>
      <p>"[AFTER to BEFORE], are there any lawsuits, court filings, legal challenges, ACLU/advocacy legal actions, or settlements related to the ICE 287(g) program in the state of [STATE]? Name the agencies/counties involved, the nature of the legal action, and cite sources."</p>
    </div>

    <p class="mt-3"><Gloss text={m.methodology_news_perplexity_note()} {seen} /></p>

    <p class="mt-3"><Gloss text={m.methodology_news_google_body()} {seen} /></p>
    <!-- Verbatim Google News query variants — literal search strings, not translated. -->
    <div class="my-4 flex flex-wrap gap-2 text-sm">
      <code class="rounded bg-slate-100 px-2 py-1 font-mono text-slate-700">"287(g)" [STATE]</code>
      <code class="rounded bg-slate-100 px-2 py-1 font-mono text-slate-700">287g [STATE] ICE</code>
      <code class="rounded bg-slate-100 px-2 py-1 font-mono text-slate-700">[STATE] sheriff immigration enforcement ICE agreement</code>
      <code class="rounded bg-slate-100 px-2 py-1 font-mono text-slate-700">[STATE] police 287g immigration</code>
      <code class="rounded bg-slate-100 px-2 py-1 font-mono text-slate-700">ICE 287(g) [STATE] county jail</code>
      <code class="rounded bg-slate-100 px-2 py-1 font-mono text-slate-700">[STATE] immigration enforcement local law enforcement ICE</code>
    </div>

    <p class="mt-3"><Gloss text={m.methodology_news_google_note()} {seen} /></p>

    <h3 class="mt-6 font-serif text-lg font-bold text-slate-900 sm:mt-8 sm:text-xl">{m.methodology_news_relevance_heading()}</h3>

    <p class="mt-3"><Gloss text={m.methodology_news_relevance_body()} {seen} /></p>

    <h3 class="mt-6 font-serif text-lg font-bold text-slate-900 sm:mt-8 sm:text-xl">{m.methodology_news_grounding_heading()}</h3>

    <p class="mt-3"><Gloss text={m.methodology_news_grounding_body()} {seen} /></p>
    <p class="mt-3"><Gloss text={m.methodology_news_legislation_body()} {seen} /></p>
    <p class="mt-3"><Gloss text={m.methodology_news_output_body()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_updates_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_updates_body()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_license_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_license_body()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.contact_heading()}</h2>

    <p class="mt-3">{m.contact_body()}</p>
    <ul class="mt-3">
      <li>Tory Lysik — <a href="mailto:lysiktory@gmail.com">lysiktory@gmail.com</a> · <a href="https://tlysik.com" target="_blank" rel="noreferrer">tlysik.com</a></li>
      <li>David Eads — <a href="mailto:davideads@grupovisual.org">davideads@grupovisual.org</a> · <a href="https://davideads.com" target="_blank" rel="noreferrer">davideads.com</a></li>
      <li>Recovered Factory — <a href="https://recoveredfactory.net/en" target="_blank" rel="noreferrer">recoveredfactory.net</a></li>
    </ul>
  </div>
</main>
