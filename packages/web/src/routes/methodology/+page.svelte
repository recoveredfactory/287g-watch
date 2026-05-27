<script lang="ts">
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import Gloss from "$lib/components/Gloss.svelte";
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
  <meta property="og:image" content="{siteUrl}/og/methodology.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content="{siteUrl}/og/methodology.png" />
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
    </ul>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_matching_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_matching_body()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_limitations_heading()}</h2>

    <ul class="mt-3">
      <li><Gloss text={m.methodology_limitations_li_1()} {seen} /></li>
      <li><Gloss text={m.methodology_limitations_li_2()} {seen} /></li>
      <li><Gloss text={m.methodology_limitations_li_3()} {seen} /></li>
    </ul>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_updates_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_updates_body()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_license_heading()}</h2>

    <p class="mt-3"><Gloss text={m.methodology_license_body()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.contact_heading()}</h2>

    <p class="mt-3">{m.contact_body()}</p>
    <ul class="mt-3">
      <li>Tory Lysik — <a href="mailto:lysiktory@gmail.com">lysiktory@gmail.com</a> · <a href="https://tlysik.com" target="_blank" rel="noreferrer">tlysik.com</a></li>
      <li>David Eads — <a href="mailto:davideads@gmail.com">davideads@gmail.com</a> · <a href="https://davideads.com" target="_blank" rel="noreferrer">davideads.com</a></li>
      <li>Recovered Factory — <a href="https://recoveredfactory.net/en" target="_blank" rel="noreferrer">recoveredfactory.net</a></li>
    </ul>
  </div>
</main>
