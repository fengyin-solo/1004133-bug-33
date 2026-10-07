import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionOptions,
  ActionResult,
  CreateOptions,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters)
    .filter(([, value]) => value.trim() !== '')
    .map(([field, value]) => [field, value.trim()] as const)
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value)),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 待办量与列表同口径：给同样的筛选条件，页面和其他模块拿到的待办就是同一份。
export function pendingTodos(key: string, filters: Record<string, string> = {}): number {
  return filterRows(listRows(key), filters).filter((row) => row.pending).length
}

// 某字段的候选值（如所属班组）：空值不参与，缺归属的记录不会被当成一个班组。
export function fieldOptions(key: string, field: string): string[] {
  const values = listRows(key)
    .map((row) => String(row[field] ?? '').trim())
    .filter(Boolean)
  return [...new Set(values)].sort()
}

// 跨班组改动统一在这里拦截：页面不做业务判断，避免动作落到当前筛选班组之外的记录上。
function scopeMessage(
  meta: ModuleMeta,
  row: EntryRow,
  options?: ActionOptions,
): string {
  if (!options?.scopeField || !options.scopeValue) {
    return ''
  }
  const actual = String(row[options.scopeField] ?? '').trim()
  if (!actual) {
    return `该${meta.entity}没有${options.scopeField}归属，暂不允许操作`
  }
  if (actual !== options.scopeValue.trim()) {
    return `该${meta.entity}归属「${actual}」，与当前班组「${options.scopeValue.trim()}」不一致，已拦截跨班组改动`
  }
  return ''
}

export function runAction(
  key: string,
  id: number,
  action: string,
  options?: ActionOptions,
): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  // 统一过滤后的定位顺序：先校验记录是否还在当前筛选班组内，再谈状态流转，
  // 否则班组过滤后动作会落到详情页之外的记录，在岗状态也会串到别的班组。
  const blocked = scopeMessage(meta, rows[index], options)
  if (blocked) {
    return { ok: false, message: blocked }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return {
      ok: false,
      duplicated: true,
      message: `${meta.entity}已经是「${target}」，重复提交只保留一份，无需再次操作`,
    }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 登记入口：归属班组必填且不得跨班组；同一编号重复提交只留一份。
export function createEntry(
  key: string,
  draft: Record<string, string>,
  options?: CreateOptions,
): ActionResult {
  const meta = moduleMeta(key)
  const payload: Record<string, string> = {}
  for (const field of meta.fields) {
    payload[field] = String(draft[field] ?? '').trim()
  }

  if (options?.scopeField) {
    const team = payload[options.scopeField]
    if (!team) {
      return { ok: false, message: `缺少${options.scopeField}归属，无法登记` }
    }
    if (options.scopeValue && team !== options.scopeValue.trim()) {
      return {
        ok: false,
        message: `登记归属「${team}」与当前班组「${options.scopeValue.trim()}」不一致，已拦截跨班组登记`,
      }
    }
  }

  const idField = options?.idField ?? meta.fields[0]
  const code = payload[idField]
  if (!code) {
    return { ok: false, message: `请填写${idField}` }
  }
  const rows = listRows(key)
  if (rows.some((row) => String(row[idField] ?? '').trim() === code)) {
    return {
      ok: false,
      duplicated: true,
      message: `${idField}「${code}」已存在，重复提交只保留一份`,
    }
  }

  const initial = meta.statuses[0]
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const row: EntryRow = {
    id: rows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
    status: initial,
    pending: initial !== lastStatus,
    abnormal: false,
    ...payload,
  }
  saveRows(key, [...rows, row])
  return { ok: true, message: `${meta.entity}「${code}」登记成功，当前状态「${initial}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
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
