<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  $: title = m.methodology_meta_title();
  $: description = m.methodology_meta_description();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-12 sm:px-6">
  <h1 class="text-3xl font-black text-slate-900 sm:text-4xl">{m.methodology_heading()}</h1>

  <div class="prose-editorial mt-8">
    <h2 class="font-serif text-2xl font-bold text-slate-900">{m.methodology_sources_heading()}</h2>

    <p>{m.methodology_sources_lead()}</p>

    <ul>
      <li>
        <strong>ICE 287(g) participants list</strong> {m.methodology_source_ice_body()}
      </li>
      <li>
        <strong><a href="https://github.com/appelson/Tracking_287g" target="_blank" rel="noreferrer">
          appelson/Tracking_287g
        </a></strong> {m.methodology_source_appelson_body()}
      </li>
      <li>
        <strong>FBI Census of State and Local Law Enforcement Agencies (CSLLEA) 2018</strong>
        {m.methodology_source_fbi_body()}
      </li>
    </ul>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">{m.methodology_matching_heading()}</h2>

    <p>{m.methodology_matching_body()}</p>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">{m.methodology_limitations_heading()}</h2>

    <ul>
      <li>{m.methodology_limitations_li_1()}</li>
      <li>{m.methodology_limitations_li_2()}</li>
      <li>{m.methodology_limitations_li_3()}</li>
    </ul>

    <h2 class="mt-10 font-serif text-2xl font-bold text-slate-900">{m.methodology_updates_heading()}</h2>

    <p>{m.methodology_updates_body()}</p>
  </div>
</main>
