<script lang="ts">
  // Static, WebGL-free state map: a light outline, a hint of highways clipped to
  // the border, and agency dots — all pre-projected server-side into the w×h
  // viewBox. Cheap enough to render as 53 small-multiples. See $lib/stateGeometry.
  export let w: number;
  export let h: number;
  export let outline: string;
  export let highways: string[] = [];
  // `c` = dot color, `o` = sworn-officer count (radius). `n`/`s` are only set by
  // the surge graphic (new/old coloring): n = "signed since threshold", s = the
  // dot's normalized signing order in [0,1] for the reveal sweep.
  export let dots: { x: number; y: number; c: string; o: number; n?: boolean; s?: number }[] = [];
  export let id: string; // unique per card, for the clipPath
  export let label = "";
  // Dark theme — for the surge graphic's dark composite. Off (default) keeps the
  // /states index card look byte-for-byte.
  export let dark = false;
  // Reveal progress 0→1 (surge graphic). At 0 only old dots show; at 1 every new
  // dot is fully in. Ignored for dots without an `n` flag (they stay fully on).
  export let reveal = 1;
  // Flat viewBox-unit bump added to every dot's radius (surge graphic "pop").
  // 0 = the /states index card look is unchanged byte-for-byte.
  export let dotBump = 0;

  // Radius by sworn-officer count, à la the homepage map: sqrt scale, domain
  // capped at ~1,000 officers (sqrt ≈ 32). Big departments pop; rural sheriffs
  // stay a legible floor. A stand-in until county/jurisdiction shapes land.
  const R_MIN = 0.9;
  const R_MAX = 5;
  // dotBump lifts the floor (and therefore every dot uniformly, since the span
  // R_MAX − R_MIN is unchanged) so the whole field gains the same flat pop.
  const radius = (officers: number) =>
    R_MIN + dotBump + Math.min(1, Math.sqrt(Math.max(0, officers)) / 32) * (R_MAX - R_MIN);

  // Reveal sweep (mirrors NationalMap's newOld reveal): a soft leading edge in
  // signing order. p1 is referenced directly in the template so Svelte re-renders
  // the dots when `reveal` changes.
  const REVEAL_BAND = 0.32;
  const NEW_MIN_SCALE = 0.4;
  $: p1 = reveal * (1 + REVEAL_BAND);

  // Pre-April (old) dots recede to a low opacity so the new orange pops; new
  // dots fade to full as the reveal sweeps past them.
  const OLD_OPACITY = 0.65;

  // Dark theme (the expansion graphic, colorMode="newOld" — bake-only, kept
  // exactly as published) vs. the default light theme, matching
  // NationalMap.svelte/AgencyMap.svelte's cool-gray basemap palette. The
  // light path is currently unused (the /states rebuild dropped this
  // component's only light-mode consumer; /video/surge always passes
  // dark) — kept in sync anyway rather than left stale, in case it's
  // revived.
  $: landFill = dark ? "#182331" : "#F8F8F9";
  $: landStroke = dark ? "#48607f" : "#656C75";
  $: hwStroke = dark ? "#354661" : "#7D8A99";
  $: oldDotStroke = dark ? "rgba(10,14,20,0.5)" : "#FDFDFD";
  $: newDotStroke = dark ? "rgba(255,214,170,0.65)" : "#FDFDFD";
</script>

<svg
  viewBox="0 0 {w} {h}"
  class="block h-full w-full"
  role="img"
  aria-label={label}
  preserveAspectRatio="xMidYMid meet"
>
  <!-- Land — also the clip source (referenced via <use> so the outline path
       isn't serialized twice). -->
  <path id="statemap-land-{id}" d={outline} fill={landFill} stroke={landStroke} stroke-width={dark ? 1 : 0.8} stroke-linejoin="round" />
  <defs>
    <clipPath id="statemap-{id}"><use href="#statemap-land-{id}" /></clipPath>
  </defs>

  <!-- Highways, trimmed to the outline -->
  <g clip-path="url(#statemap-{id})">
    {#each highways as d}
      <path
        {d}
        fill="none"
        stroke={hwStroke}
        stroke-width="0.8"
        stroke-opacity="0.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {/each}
  </g>

  <!-- Agency locations, sized by sworn-officer count. New (orange) dots pop with
       a warm rim and reveal in signing order; old dots recede at low opacity. -->
  {#each dots as dot}
    {@const isNew = dot.n === true}
    {@const lr = isNew ? Math.max(0, Math.min(1, (p1 - (dot.s ?? 0)) / REVEAL_BAND)) : 1}
    <circle
      cx={dot.x}
      cy={dot.y}
      r={radius(dot.o) * (isNew ? NEW_MIN_SCALE + (1 - NEW_MIN_SCALE) * lr : 1)}
      fill={dot.c}
      fill-opacity={isNew ? lr : OLD_OPACITY}
      stroke={isNew ? newDotStroke : oldDotStroke}
      stroke-width={isNew ? 0.55 : 0.3}
      stroke-opacity={isNew ? lr : 1}
    />
  {/each}
</svg>
