const norm = (id) => {
  const l = id.trim().toLowerCase()
  const t = l.includes('/') ? l.slice(l.lastIndexOf('/') + 1) : l
  return { tail: t, compact: t.replace(/[-_.\s]/g, '') }
}

const j = await (await fetch('https://openrouter.ai/api/v1/models')).json()
const list = j.data
  .filter((m) => m.pricing && (Number(m.pricing.prompt) > 0 || Number(m.pricing.completion) > 0))
  .map((m) => ({ id: m.id, ...norm(m.id) }))

for (const wanted of ['DeepSeek-V4-Flash-0731', 'DeepSeek-V4.1-Flash', 'GLM-5.3-Flash']) {
  const w = norm(wanted)
  const plain = list.filter((e) => !e.id.includes(':'))
  const exact = list.find((e) => e.id.toLowerCase() === wanted.toLowerCase())
  const tailEq = plain.find((e) => e.tail === w.tail)
  const compactEq = plain.find((e) => e.compact === w.compact)
  const prefix = [...plain.filter((e) => e.tail.startsWith(w.tail))].sort((a, b) => a.tail.length - b.tail.length)[0]
  const hit = exact ?? tailEq ?? compactEq ?? prefix
  console.log(wanted, '->', hit?.id, '| exact', exact?.id, 'tail', tailEq?.id, 'compact', compactEq?.id, 'prefix', prefix?.id)
}
