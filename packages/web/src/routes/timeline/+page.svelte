<script lang="ts">
  import type { TimelineData } from "./+page.server";
  import { getLocale, localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { MODEL_COLORS, MODEL_SHORT, MODEL_ORDER } from "$lib/colors";
  import { STATE_NAMES } from "$lib/states";
  import { ogImage } from "$lib/ogImage";
  import Gloss from "$lib/components/Gloss.svelte";

  export let data: TimelineData;

  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const signedIntFmt = new Intl.NumberFormat(localeTag, { signDisplay: "always" });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const monthFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", timeZone: "UTC" });
  const monthLabel = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));
  // Short form ("Sep '26") for the row label, which needs to stay on one
  // line for the bar row to stay vertically aligned — the long form (used
  // in the section headings elsewhere) wraps in Spanish ("SEPTIEMBRE DE
  // 2026") and throws the bar off-center against the label.
  const monthShortFmt = new Intl.DateTimeFormat(localeTag, { year: "2-digit", month: "short", timeZone: "UTC" });
  const monthLabelShort = (ym: string) => monthShortFmt.format(new Date(`${ym}-01T00:00:00Z`));

  $: title = m.timeline_meta_title();
  $: description = m.timeline_meta_description();

  const modelCounts = (mo: TimelineData["months"][number]): Record<string, number> => ({
    "Jail Enforcement Model": mo.jail,
    "Task Force Model": mo.taskforce,
    "Warrant Service Officer": mo.wso,
  });
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:image" content={ogImage('timeline.png')} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="twitter:card" content="summary_large_image" />
  <meta property="twitter:image" content={ogImage('timeline.png')} />
</svelte:head>

<main id="main-content" class="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
  <p class="text-xs font-semibold uppercase tracking-widest text-ink-500">{m.timeline_eyebrow()}</p>
  <h1 class="mt-1 text-2xl font-black text-ink-900 sm:text-3xl">{m.timeline_title()}</h1>
  <p class="mt-3 max-w-prose text-sm text-ink-700 sm:text-base"><Gloss text={m.timeline_subtitle()} /></p>
  {#if data.snapshotDate}
    <p class="mt-2 text-xs italic text-ink-500">{m.timeline_as_of({ date: dateFmt.format(new Date(data.snapshotDate)) })}</p>
  {/if}
  <p class="mt-2 text-xs italic leading-snug text-ink-500"><Gloss text={m.timeline_data_caveat()} /></p>

  <p class="mt-6 border-y border-paper-200 py-4 font-serif text-lg font-bold text-ink-900 sm:text-xl">
    {m.timeline_growth_headline({ baseline: intFmt.format(data.baselineTotal), current: intFmt.format(data.currentTotal) })}
  </p>

  <ol class="mt-10 space-y-1">
    {#each data.months as mo (mo.ym)}
      <li id={mo.ym} class="scroll-mt-24 border-b border-paper-100 py-2.5 last:border-0">
        <div class="flex items-baseline justify-between gap-3">
          <a
            href="#{mo.ym}"
            title={monthLabel(mo.ym)}
            class="font-mono text-xs font-semibold uppercase tracking-wider text-ink-500 no-underline hover:underline"
          >{monthLabelShort(mo.ym)}</a>

          <span class="font-mono text-xs font-semibold tabular-nums sm:text-sm" style="color: {mo.delta === 0 ? 'var(--color-ink-500)' : 'var(--color-ink-900)'};">
            {mo.delta === 0 ? m.timeline_delta_flat_short() : signedIntFmt.format(mo.delta)}
          </span>
        </div>

        <div class="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span class="font-serif text-sm font-bold text-ink-900">{intFmt.format(mo.total)}</span>
          <span class="text-xs text-ink-500">{m.timeline_total_label()}</span>
        </div>

        {#if mo.delta !== 0}
          <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {#each MODEL_ORDER as model}
              {@const count = modelCounts(mo)[model]}
              {#if count}
                <span class="flex items-center gap-1 font-mono text-[11px] tabular-nums text-ink-700">
                  <span class="inline-block h-2 w-2 rounded-full" style="background: {MODEL_COLORS[model]};" aria-hidden="true"></span>
                  {MODEL_SHORT[model]} {intFmt.format(count)}
                </span>
              {/if}
            {/each}
          </div>
        {/if}

        {#if mo.states.length > 0}
          <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {#each mo.states as s (s.abbr)}
              <a
                href={localizeHref(`/state/${s.abbr.toLowerCase()}`)}
                class="font-mono text-[11px] tabular-nums text-ink-700 no-underline hover:underline"
              >{STATE_NAMES[s.abbr] ?? s.abbr} {signedIntFmt.format(s.net)}{#if s.stateAgencyNet !== 0}&nbsp;<span class="text-ink-500">({m.timeline_statewide_tag({ count: Math.abs(s.stateAgencyNet) })})</span>{/if}</a>
            {/each}
          </div>
        {/if}
      </li>
    {/each}
  </ol>

  <p class="mt-8 border-t border-paper-200 pt-6 text-sm">
    <a
      href={localizeHref("/states")}
      class="font-semibold text-ink-900 underline underline-offset-2 hover:text-ink-700"
    >{m.timeline_browse_cta()} →</a>
  </p>
</main>
