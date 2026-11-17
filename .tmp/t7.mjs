const s={eval:async()=>'x'};const check=()=>0; async function m(){check('x',
await s.eval("document.querySelector('td')?.id ?? 'none'"))}
