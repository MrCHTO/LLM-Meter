const s={eval:async()=>''};const check=()=>0; async function m(){
  check(
    'x',
    /width: 200/.test(await s.eval("document.querySelector('td')?.id ?? 'none'")) &&
      (await s.eval("1")) === 'x',
    await s.eval("document.querySelector('td')?.id ?? 'none'")
  )
}
