<script lang="ts">
  import { localizeHref, getLocale } from "$lib/paraglide/runtime";
  import { m } from "$lib/paraglide/messages.js";
  import { MODEL_COLORS } from "$lib/colors";

  export let agencies: { slug: string; name: string; model: string; officers: number }[] = [];

  const intFmt = new Intl.NumberFormat(getLocale() === "es" ? "es-MX" : "en-US");
</script>

<div>
  <div class="flex items-baseline justify-between border-b border-slate-200 pb-1">
    <p class="text-xs font-semibold uppercase tracking-wider text-slate-500">
      {m.states_index_top_agencies()}
    </p>
    <p class="text-[10px] uppercase tracking-wider text-slate-400">{m.states_index_officers()}</p>
  </div>
  <ul class="mt-2 space-y-2.5">
    {#each agencies as a}
      <li class="flex items-start gap-2 text-sm">
        <span class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style="background: {MODEL_COLORS[a.model] ?? '#94a3b8'};"></span>
        <a
          href={localizeHref(`/agency/${a.slug}`)}
          class="text-slate-700 no-underline leading-snug hover:underline"
        >{a.name}</a>
        <span class="ml-auto mt-0.5 shrink-0 tabular-nums text-xs text-slate-400">
          {a.officers ? intFmt.format(a.officers) : "—"}
        </span>
      </li>
    {/each}
  </ul>
</div>
