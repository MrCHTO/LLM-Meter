const s={eval:async()=>''};const check=()=>0; async function m(){
  check(
    'x',
    /width: 200/.test(await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'"))
  )
}
