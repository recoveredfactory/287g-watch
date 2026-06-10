// svelte-virtual-list ships no type declarations. Minimal ambient shim so
// svelte-check can resolve the .svelte import; props/slots fall back to `any`.
declare module "svelte-virtual-list/VirtualList.svelte" {
  const VirtualList: any;
  export default VirtualList;
}
