<script lang="ts">
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  $: title = m.methodology_meta_title();
  $: description = m.methodology_meta_description();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-8 sm:py-12 sm:px-6">
  <h1 class="text-2xl font-black text-slate-900 sm:text-4xl">{m.methodology_heading()}</h1>

  <div class="prose-editorial mt-6 sm:mt-8">
    <h2 class="font-serif text-xl font-bold text-slate-900 sm:text-2xl">{m.methodology_sources_heading()}</h2>

    <p class="mt-3">{m.methodology_sources_lead()}</p>

    <ul>
      <li>
        <strong><a href="https://www.ice.gov/identify-and-arrest/287g" target="_blank" rel="noreferrer">ICE 287(g) participants list</a></strong> {m.methodology_source_ice_body()}
      </li>
      <li>
        <strong><a href="https://github.com/appelson/Tracking_287g" target="_blank" rel="noreferrer">appelson/Tracking_287g</a></strong> {m.methodology_source_appelson_body()}
      </li>
      <li>
        <strong><a href="https://bjs.ojp.gov/data-collection/census-state-and-local-law-enforcement-agencies-csllea" target="_blank" rel="noreferrer">FBI Census of State and Local Law Enforcement Agencies (CSLLEA) 2018</a></strong>
        {m.methodology_source_fbi_body()}
      </li>
      <li>
        <strong><a href="https://cde.ucr.cjis.gov/LATEST/webapp/#/pages/explorer/crime/crime-trend" target="_blank" rel="noreferrer">FBI Law Enforcement Explorer (LEE) 2025</a></strong>
        {m.methodology_source_lee_body()}
      </li>
      <li>
        <strong><a href="https://www.wikidata.org/" target="_blank" rel="noreferrer">Wikidata</a></strong>
        {m.methodology_source_wikidata_body()}
      </li>
      <li>
        <strong><a href="https://www.muckrock.com/" target="_blank" rel="noreferrer">MuckRock</a></strong>
        {m.methodology_source_muckrock_body()}
      </li>
    </ul>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_matching_heading()}</h2>

    <p class="mt-3">{m.methodology_matching_body()}</p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_limitations_heading()}</h2>

    <ul class="mt-3">
      <li>{m.methodology_limitations_li_1()}</li>
      <li>{m.methodology_limitations_li_2()}</li>
      <li>{m.methodology_limitations_li_3()}</li>
    </ul>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_updates_heading()}</h2>

    <p class="mt-3">{m.methodology_updates_body()}</p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.methodology_license_heading()}</h2>

    <p class="mt-3">{m.methodology_license_body()}</p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.attribution_heading()}</h2>

    <p class="mt-3">
      {m.attribution_body()}
    </p>
    <ul class="mt-3">
      <li><strong>Recovered Factory</strong> — <a href="https://recoveredfactory.net/en" target="_blank" rel="noreferrer">recoveredfactory.net</a></li>
      <li><strong>Tory Lysik</strong> — <a href="https://tlysik.com" target="_blank" rel="noreferrer">tlysik.com</a></li>
      <li><strong>David Eads</strong></li>
    </ul>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.contact_heading()}</h2>

    <p class="mt-3">{m.contact_body()}</p>
    <ul class="mt-3">
      <li>Tory Lysik — <a href="mailto:lysiktory@gmail.com">lysiktory@gmail.com</a></li>
      <li>David Eads — <a href="mailto:davideads@gmail.com">davideads@gmail.com</a></li>
      <li>Recovered Factory — <a href="https://recoveredfactory.net/en" target="_blank" rel="noreferrer">recoveredfactory.net</a></li>
    </ul>
  </div>
</main>
