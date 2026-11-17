const s={eval:async()=>'x'};
console.log(/a(b)?/.test(await s.eval('x')))
