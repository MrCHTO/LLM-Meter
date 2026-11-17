const s={eval:async()=>''};const check=(a,b,c)=>a;
  check(
    'x', /width: 200/.test(await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none')) &&
      (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'x',
    await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")
  )
