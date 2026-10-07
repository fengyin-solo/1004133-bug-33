import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  ActionScope,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 待办口径：状态机里排在前两位的算待办，流转到后面的状态就退出待办清单。
// 与 seed 数据的 pending 口径一致，概览页的「待处理」才不会虚高。
const PENDING_STATUS_COUNT = 2

// 统一定位顺序：列表、动作、导出都按编号升序这一份顺序走，
// 过滤之后从列表入口定位，结果不会再落到别的记录上。
function byIdAsc(a: EntryRow, b: EntryRow): number {
  return Number(a.id) - Number(b.id)
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters)
    .map(([field, value]) => [field, value.trim()] as [string, string])
    .filter(([, value]) => value !== '')
  const ordered = [...rows].sort(byIdAsc)
  if (pairs.length === 0) {
    return ordered
  }
  // 精确匹配：值完全一致才算命中，缺字段（如缺班组归属）的记录自然落空，
  // 不会像子串匹配那样把别的班组的记录带进来。
  return ordered.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '') === value),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  scope?: ActionScope,
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  // 与列表同一份顺序里按编号定位，过滤后的入口不会落到详情范围之外。
  const rows = [...listRows(key)].sort(byIdAsc)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]
  const scopeValue = scope?.value.trim() ?? ''
  if (scope && scopeValue !== '' && String(row[scope.field] ?? '') !== scopeValue) {
    return {
      ok: false,
      message: `已拦截跨班组改动：这条${meta.entity}的${scope.field}是「${String(row[scope.field] ?? '') || '空'}」，当前选择的是「${scopeValue}」`,
    }
  }
  const current = String(row.status)
  if (current === target) {
    // 重复提交只留一份：状态已经到位，后面的重复提交直接拒掉。
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: meta.statuses.indexOf(target) >= 0 && meta.statuses.indexOf(target) < PENDING_STATUS_COUNT,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of [...listRows(key)].sort(byIdAsc)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
