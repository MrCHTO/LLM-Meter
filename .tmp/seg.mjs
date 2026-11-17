  // 双击分隔条恢复该列自动
  await s.eval("document.querySelector('.col-resize').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))")
  await sleep(200)
  check(
    '双击恢复单列自动',
    /width: 200(px)?/.test(await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none')) &&
      (await s.eval("getComputedStyle(document.querySelector('thead').closest('table')).tableLayout")) === 'fixed',
    await s.eval("document.querySelector('table colgroup col')?.getAttribute('style') ?? 'none'")
  )
  // 再拖一次供重载验证
