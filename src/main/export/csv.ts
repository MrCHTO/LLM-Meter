import { app, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StatsExportResult, StatsQuery } from '../../shared/types'
import * as db from '../store/db'
import * as repo from '../store/db/repo'

/** 导出行里的列顺序，与表头一一对应 */
const COLUMNS = [
  '时间',
  '来源',
  '模型',
  '上游模型',
  '供应商',
  'Token 备注',
  '地址',
  '状态',
  'ok',
  'TTFT(ms)',
  '耗时(ms)',
  '总输入',
  '未缓存输入',
  '缓存读取',
  '缓存输入',
  '输出',
  '总 token',
  '成本',
  '货币',
  '备注'
] as const

function cell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""')}"`
}

/** 选路径并导出区间明细（带 BOM，Excel 直接可开） */
export async function exportRange(q: StatsQuery): Promise<StatsExportResult> {
  const rows = repo.exportRange(db.get(), q.from, q.to, q.source)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const picked = await dialog.showSaveDialog({
    title: '导出区间明细',
    defaultPath: join(app.getPath('downloads'), `llm-meter-${stamp}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (picked.canceled || !picked.filePath) throw new Error('已取消')
  const lines = [COLUMNS.join(',')]
  for (const r of rows) {
    lines.push(
      [
        new Date(r.ts).toISOString(),
        r.source,
        r.alias,
        r.upstream_model,
        r.provider_name,
        r.token_remark ?? '',
        r.base_url,
        r.status,
        r.ok,
        r.ttft_ms ?? '',
        r.duration_ms,
        r.input_tokens,
        r.uncached_input_tokens,
        Number(r.cache_read_reported) ? r.cache_read_tokens : '',
        r.cache_input_tokens,
        r.output_tokens,
        Number(r.input_tokens) + Number(r.output_tokens),
        r.cost,
        r.currency,
        r.note ?? ''
      ]
        .map(cell)
        .join(',')
    )
  }
  writeFileSync(picked.filePath, `\ufeff${lines.join('\n')}`, 'utf8')
  return { path: picked.filePath, rows: rows.length }
}
