const s={eval:()=>''};const check=(a,b,c)=>a;
  check(
    'x',
    /width: 200/.test(s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none')) &&
      (s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'x',
    s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")
  )
