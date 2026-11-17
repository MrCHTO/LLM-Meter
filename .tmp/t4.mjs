const s={eval:async()=>''};const check=()=>0;async function m(){
  check(
    '双击恢复单列自动',
    /width: 200(px)?/.test(await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none')) &&
      (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'fixed',
    await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")
  )
}
