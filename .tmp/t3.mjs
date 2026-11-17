const s={eval:async()=>'x'};
const ok = /width: 200(px)?/.test(await s.eval('width: 200px'));
console.log(ok)
