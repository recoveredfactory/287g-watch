<script lang="ts">
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import Gloss from "$lib/components/Gloss.svelte";
  import { ogImage } from "$lib/ogImage";
  $: title = m.about_meta_title();
  $: description = m.about_meta_description();
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? "https://287g.recoveredfactory.net";
  const seen = new Set<string>();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={ogImage('about.png')} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content={ogImage('about.png')} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
  <h1 class="text-2xl font-black text-slate-900 sm:text-4xl">{m.about_heading()}</h1>

  <div class="prose-editorial mt-6 sm:mt-8">
    <p><strong>287(g) Explorer</strong> <Gloss text={m.about_intro_1_after_name()} {seen} /></p>

    <p><Gloss text={m.about_intro_2()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.about_why_heading()}</h2>

    <p><Gloss text={m.about_why_1()} {seen} /></p>

    <p><Gloss text={m.about_why_2()} {seen} /></p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.about_involve_heading()}</h2>

    <p><Gloss text={m.about_involve_lead()} {seen} /></p>

    <ul>
      <li>
        {m.about_involve_corrections_prefix()}
        <a href="https://www.muckrock.com/" target="_blank" rel="noreferrer">MuckRock</a>
      </li>
      <li>
        {m.about_involve_records()}
      </li>
      <li>
        {m.about_involve_methodology_prefix()}
        <a href={localizeHref("/methodology")}>{m.about_involve_methodology_link()}</a>
        {m.about_involve_methodology_suffix()}
      </li>
    </ul>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.contact_heading()}</h2>

    <p class="mt-3">{m.contact_body()}</p>
    <ul class="mt-3">
      <li>Tory Lysik — <a href="mailto:lysiktory@gmail.com">lysiktory@gmail.com</a> · <a href="https://tlysik.com" target="_blank" rel="noreferrer">tlysik.com</a></li>
      <li>David Eads — <a href="mailto:davideads@gmail.com">davideads@gmail.com</a> · <a href="https://davideads.com" target="_blank" rel="noreferrer">davideads.com</a></li>
      <li>Recovered Factory — <a href="https://recoveredfactory.net/en" target="_blank" rel="noreferrer">recoveredfactory.net</a></li>
    </ul>
  </div>
</main>
