<script lang="ts">
  import type { TimelineData } from "./+page.server";
  import { getLocale, localizeHref } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { MODEL_COLORS, MODEL_SHORT } from "$lib/colors";
  import { ogImage } from "$lib/ogImage";

  export let data: TimelineData;

  const localeTag = getLocale() === "es" ? "es-MX" : "en-US";
  const intFmt = new Intl.NumberFormat(localeTag);
  const signedIntFmt = new Intl.NumberFormat(localeTag, { signDisplay: "always" });
  const dateFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const monthFmt = new Intl.DateTimeFormat(localeTag, { year: "numeric", month: "long", timeZone: "UTC" });
  const monthLabel = (ym: string) => monthFmt.format(new Date(`${ym}-01T00:00:00Z`));

  $: title = m.timeline_meta_title();
  $: description = m.timeline_meta_description();

  $: maxAbsDelta = Math.max(1, ...data.months.map((mo) => Math.abs(mo.delta)));
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
  <p class="mt-3 max-w-prose text-sm text-ink-700 sm:text-base">{m.timeline_subtitle()}</p>
  {#if data.snapshotDate}
    <p class="mt-2 text-xs italic text-ink-500">{m.timeline_as_of({ date: dateFmt.format(new Date(data.snapshotDate)) })}</p>
  {/if}

  <ol class="mt-10 space-y-0 border-l-2 pl-5" style="border-color: var(--color-paper-200);">
    {#each data.months as mo (mo.ym)}
      {@const highlighted = data.highlightYms.has(mo.ym)}
      {@const barPct = Math.round((Math.abs(mo.delta) / maxAbsDelta) * 100)}
      <li class="relative pb-7 last:pb-0">
        <span
          class="absolute -left-[1.6875rem] top-0.5 h-3.5 w-3.5 rounded-full border-2"
          style="background: {highlighted ? '#BE6079' : 'var(--color-paper-200)'}; border-color: var(--color-paper-50);"
          aria-hidden="true"
        ></span>

        <time class="block font-mono text-xs font-semibold uppercase tracking-wider text-ink-500">
          {monthLabel(mo.ym)}
        </time>

        <div class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p class="font-serif text-lg font-bold text-ink-900">
            {intFmt.format(mo.total)} <span class="text-sm font-normal text-ink-500">{m.timeline_total_label()}</span>
          </p>
          {#if highlighted}
            <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white" style="background: #BE6079;">{m.timeline_highlight_label()}</span>
          {/if}
        </div>

        <p class="mt-0.5 text-sm text-ink-700">
          {#if mo.delta > 0}
            {m.timeline_delta_up({ count: signedIntFmt.format(mo.delta) })}
          {:else if mo.delta < 0}
            {m.timeline_delta_down({ count: signedIntFmt.format(mo.delta) })}
          {:else}
            {m.timeline_delta_flat()}
          {/if}
        </p>

        <!-- Delta bar: quick visual read of magnitude, direction by color. -->
        <div class="mt-1.5 h-1.5 w-full max-w-[12rem] overflow-hidden rounded-full" style="background: var(--color-paper-100);">
          <div
            class="h-full rounded-full"
            style="width: {barPct}%; background: {mo.delta >= 0 ? MODEL_COLORS['Warrant Service Officer'] : '#BE6079'};"
          ></div>
        </div>
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
