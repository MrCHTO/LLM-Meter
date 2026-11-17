const s={eval:async()=>''};const check=()=>0;
check(
  'x',
  /width: 200/.test(await s.eval("a ?.b ?? 'none'"))
)
