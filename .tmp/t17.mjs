const s={eval:async()=>''};const check=()=>0;
  check(
    'x',
    /width: 200/.test(await s.eval("a")) &&
      (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'fixed',
    await s.eval("b")
  )
