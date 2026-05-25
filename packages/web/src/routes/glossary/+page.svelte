<script lang="ts">
  import { m } from "$lib/paraglide/messages.js";
  $: title = m.glossary_meta_title();
  $: description = m.glossary_meta_description();

  type Term = {
    term: string;
    definition: string;
    seeAlso?: string[];
  };

  // Fill in definitions — leave term/seeAlso, replace the definition strings.
  const terms: Term[] = [
    {
      term: "287(g)",
      definition:
        "Fill in: Section 287(g) of the Immigration and Nationality Act authorizes the Department of Homeland Security to enter into agreements with state and local law enforcement agencies…",
      seeAlso: ["Memorandum of Agreement", "ICE"],
    },
    {
      term: "Administrative warrant",
      definition:
        "Fill in: A civil warrant issued by an immigration officer, not a federal judge. Unlike criminal warrants, administrative warrants do not authorize entry into a home…",
      seeAlso: ["Detainer", "Warrant Service Officer"],
    },
    {
      term: "Civil immigration violation",
      definition:
        "Fill in: Being present in the United States without authorization is a civil violation, not a criminal one. This distinction matters for what local officers can legally do…",
    },
    {
      term: "Detainer",
      definition:
        "Fill in: A request from ICE to a local jail or law enforcement agency to hold a person beyond their scheduled release date so ICE can take custody…",
      seeAlso: ["Jail Enforcement Model"],
    },
    {
      term: "ICE",
      definition:
        "Fill in: U.S. Immigration and Customs Enforcement, the federal agency within the Department of Homeland Security responsible for civil immigration enforcement…",
    },
    {
      term: "Jail Enforcement Model",
      definition:
        "Fill in: Under the Jail Enforcement Model (JEM), trained local officers screen people booked into local jails to identify those who may be removable…",
      seeAlso: ["287(g)", "Task Force Model", "Warrant Service Officer"],
    },
    {
      term: "Memorandum of Agreement",
      definition:
        "Fill in: The formal contract between ICE and a local law enforcement agency that establishes the terms of a 287(g) partnership. Each MOA specifies which officers are trained, what authority they have, and oversight requirements…",
      seeAlso: ["287(g)"],
    },
    {
      term: "MOA",
      definition: "See Memorandum of Agreement.",
      seeAlso: ["Memorandum of Agreement"],
    },
    {
      term: "Removal",
      definition:
        "Fill in: The formal process by which a person is ordered to leave the United States by an immigration judge or through expedited procedures…",
    },
    {
      term: "Task Force Model",
      definition:
        "Fill in: Under the Task Force Model (TFM), trained local officers work alongside ICE agents in the community to make immigration arrests…",
      seeAlso: ["287(g)", "Jail Enforcement Model", "Warrant Service Officer"],
    },
    {
      term: "Warrant Service Officer",
      definition:
        "Fill in: The Warrant Service Officer (WSO) model authorizes local officers to serve administrative warrants of removal on people ICE has already identified and targeted for arrest…",
      seeAlso: ["287(g)", "Administrative warrant", "Jail Enforcement Model"],
    },
  ];

  // Group alphabetically
  const grouped = terms.reduce<Record<string, Term[]>>((acc, t) => {
    const letter = t.term[0].toUpperCase();
    if (!acc[letter]) acc[letter] = [];
    acc[letter].push(t);
    return acc;
  }, {});

  const letters = Object.keys(grouped).sort();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-3xl px-4 py-12 sm:px-6">

  <h1 class="text-3xl font-black text-slate-900 sm:text-4xl">{m.glossary_heading()}</h1>
  <p class="prose-editorial mt-3 max-w-xl">
    {m.glossary_subtitle()}
  </p>

  <!-- Letter jump nav -->
  <nav class="mt-6 flex flex-wrap gap-2" aria-label={m.glossary_jump_to_letter()}>
    {#each letters as letter}
      <a
        href="#{letter}"
        class="rounded border border-slate-200 bg-white px-2.5 py-1 text-sm font-semibold text-slate-600 no-underline hover:border-slate-300 hover:bg-slate-50"
      >
        {letter}
      </a>
    {/each}
  </nav>

  <!-- Terms -->
  <div class="mt-10 space-y-10">
    {#each letters as letter}
      <section id={letter}>
        <h2 class="font-serif text-xl font-bold text-slate-400">{letter}</h2>
        <dl class="mt-3 space-y-6 border-t border-slate-200 pt-4">
          {#each grouped[letter] as t}
            <div id="term-{t.term.toLowerCase().replace(/[^a-z0-9]+/g, '-')}">
              <dt class="font-semibold text-slate-900">{t.term}</dt>
              <dd class="mt-1 text-slate-600 leading-relaxed">
                {t.definition}
                {#if t.seeAlso?.length}
                  <span class="mt-1 block text-sm text-slate-400">
                    {m.glossary_see_also()}
                    {#each t.seeAlso as related, i}
                      <a
                        href="#term-{related.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"
                        class="underline"
                      >{related}</a>{i < t.seeAlso.length - 1 ? ", " : ""}
                    {/each}
                  </span>
                {/if}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>

</main>
