<script lang="ts">
  // Static, WebGL-free state map: a light outline, a hint of highways clipped to
  // the border, and agency dots — all pre-projected server-side into the w×h
  // viewBox. Cheap enough to render as 53 small-multiples. See $lib/stateGeometry.
  export let w: number;
  export let h: number;
  export let outline: string;
  export let highways: string[] = [];
  export let dots: { x: number; y: number; c: string; o: number }[] = [];
  export let id: string; // unique per card, for the clipPath
  export let label = "";

  // Radius by sworn-officer count, à la the homepage map: sqrt scale, domain
  // capped at ~1,000 officers (sqrt ≈ 32). Big departments pop; rural sheriffs
  // stay a legible floor. A stand-in until county/jurisdiction shapes land.
  const R_MIN = 0.9;
  const R_MAX = 5;
  const radius = (officers: number) =>
    R_MIN + Math.min(1, Math.sqrt(Math.max(0, officers)) / 32) * (R_MAX - R_MIN);
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
  <path id="statemap-land-{id}" d={outline} fill="#eef2f6" stroke="#cbd5e1" stroke-width="0.8" stroke-linejoin="round" />
  <defs>
    <clipPath id="statemap-{id}"><use href="#statemap-land-{id}" /></clipPath>
  </defs>

  <!-- Highways, trimmed to the outline -->
  <g clip-path="url(#statemap-{id})">
    {#each highways as d}
      <path
        {d}
        fill="none"
        stroke="#94a3b8"
        stroke-width="0.8"
        stroke-opacity="0.9"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {/each}
  </g>

  <!-- Agency locations, sized by sworn-officer count -->
  {#each dots as dot}
    <circle cx={dot.x} cy={dot.y} r={radius(dot.o)} fill={dot.c} stroke="#ffffff" stroke-width="0.45" />
  {/each}
</svg>
