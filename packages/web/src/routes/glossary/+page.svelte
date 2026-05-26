<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  import { GLOSSARY_TERMS, termSlug } from "$lib/glossary/terms";

  $: title = m.glossary_meta_title();
  $: description = m.glossary_meta_description();

  const terms = GLOSSARY_TERMS;

</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">

  <h1 class="text-2xl font-black text-slate-900 sm:text-4xl">{m.glossary_heading()}</h1>
  <p class="prose-editorial mt-3 max-w-xl">
    {m.glossary_subtitle()}
  </p>

  <!-- Terms -->
  <dl class="mt-6 space-y-6 border-t border-slate-200 pt-6 sm:mt-8">
    {#each terms as t}
      <div id="term-{termSlug(t.term)}">
        <dt class="font-semibold text-slate-900">{t.term}</dt>
        <dd class="mt-1 text-sm leading-relaxed text-slate-600 sm:text-base">
          {t.definition}
          {#if t.seeAlso?.length}
            <span class="mt-1 block text-sm text-slate-400">
              {m.glossary_see_also()}
              {#each t.seeAlso as related, i}
                <a
                  href="#term-{termSlug(related)}"
                  class="underline"
                >{related}</a>{i < t.seeAlso.length - 1 ? ", " : ""}
              {/each}
            </span>
          {/if}
        </dd>
      </div>
    {/each}
  </dl>

</main>
