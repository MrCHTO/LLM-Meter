const s={eval:async()=>'x'};const check=()=>0; async function m(){check('x',
/a(b)?/.test(await s.eval("document.querySelector('td')?.id ?? 'none'")))}
