try {
  const list = await (await fetch('http://127.0.0.1:9333/json/version')).json()
  console.log('CDP OK:', list.Browser)
} catch (e) {
  console.log('CDP ERR:', String(e))
}
