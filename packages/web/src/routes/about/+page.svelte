<script lang="ts">
  import { localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  $: title = m.about_meta_title();
  $: description = m.about_meta_description();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
  <h1 class="text-2xl font-black text-slate-900 sm:text-4xl">{m.about_heading()}</h1>

  <div class="prose-editorial mt-6 sm:mt-8">
    <p><strong>287(g) Explorer</strong> {m.about_intro_1_after_name()}</p>

    <p>{m.about_intro_2()}</p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.about_why_heading()}</h2>

    <p>{m.about_why_1()}</p>

    <p>{m.about_why_2()}</p>

    <h2 class="mt-8 font-serif text-xl font-bold text-slate-900 sm:mt-10 sm:text-2xl">{m.about_involve_heading()}</h2>

    <p>{m.about_involve_lead()}</p>

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
  </div>
</main>
