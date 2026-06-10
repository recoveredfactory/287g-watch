<script lang="ts">
  import { mapPalette, type PaletteKey } from "$lib/map/paletteStore";

  const OPTIONS: Array<{ key: PaletteKey; label: string }> = [
    { key: "slate", label: "Slate" },
    { key: "dark",  label: "Dark" },
  ];
</script>

<div class="flex items-center gap-2 text-xs text-slate-500">
  <span class="hidden sm:inline">Map tone:</span>
  <div class="inline-flex rounded-md border border-slate-300 bg-white p-0.5 shadow-sm">
    {#each OPTIONS as opt}
      <button
        type="button"
        class="rounded px-2.5 py-1 text-xs font-medium transition-colors {$mapPalette === opt.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}"
        on:click={() => mapPalette.set(opt.key)}
        aria-pressed={$mapPalette === opt.key}
      >{opt.label}</button>
    {/each}
  </div>
</div>
