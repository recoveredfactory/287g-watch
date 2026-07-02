<script lang="ts">
  // Statewide 287(g) legislative posture as a small neutral pill: pro (a statute
  // backs/mandates participation), anti (limits/bars it), or none. Deliberately
  // one neutral color regardless of stance — the label carries the meaning, no
  // implied value judgment on a charged topic. `active` appends a "bill pending"
  // tag. The program's rationale paragraph is English-only upstream, so it isn't
  // surfaced here yet (would break the bilingual contract); it lives in the data
  // for a later pass.
  import { m } from "$lib/paraglide/messages.js";

  export let legislation: { stance: "pro" | "anti" | "none"; active: boolean };

  $: label =
    legislation.stance === "pro"
      ? m.news_legislation_pro()
      : legislation.stance === "anti"
        ? m.news_legislation_anti()
        : m.news_legislation_none();
</script>

<span
  class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
>
  <span aria-hidden="true">⚖</span>
  {label}{#if legislation.active}<span class="text-slate-400"> · {m.news_legislation_active()}</span>{/if}
</span>
