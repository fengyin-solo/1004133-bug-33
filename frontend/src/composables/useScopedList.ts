import { computed, onMounted, ref } from 'vue'

import {
  createEntry,
  listEntries,
  pendingTodos,
  runAction as applyAction,
} from '@/api/local-service'
import type { ActionResult, EntryRow } from '@/data/types'

type ScopedOptions = {
  key: string
  /** 班组归属字段：传入后按该字段过滤并拦截跨班组动作/登记。 */
  teamField?: string
  /** 初始筛选字段（不含班组，班组由 teamField 单独追加）。 */
  filterFields: string[]
  /** 登记判重用的唯一编号字段。 */
  idField?: string
  /** 列表读取失败时的提示文案。 */
  loadErrorText: string
}

// 各模块共用同一条顺序：先过滤，再在过滤结果里定位当前选择，
// 最后才按过滤结果算统计与待办。定位永远不会落到过滤后的详情页之外。
export function useScopedList(options: ScopedOptions) {
  const rows = ref<EntryRow[]>([])
  const total = ref(0)
  const todoCount = ref(0)
  const errorMessage = ref('')
  const filters = ref<Record<string, string>>({})
  // 保留原选择：切换筛选、流转刷新后仍记住上次定位的那条。
  const selectedId = ref<number | null>(null)
  const submitting = ref(false)

  const activeTeam = computed(() =>
    options.teamField ? (filters.value[options.teamField] ?? '').trim() : '',
  )
  const isFiltering = computed(() =>
    Object.values(filters.value).some((value) => value.trim() !== ''),
  )

  const selectedRow = computed<EntryRow | null>(() => {
    if (selectedId.value === null) {
      return null
    }
    return rows.value.find((row) => Number(row.id) === selectedId.value) ?? null
  })

  function reload() {
    errorMessage.value = ''
    try {
      const payload = listEntries(options.key, filters.value)
      rows.value = payload.items
      total.value = payload.total
      // 待办与清单同步：其他模块（如过站监控）拿到的待办口径与本页一致。
      todoCount.value = pendingTodos(options.key, filters.value)
      // 统一过滤后的定位：只认过滤结果里的记录，找不到就置空，详情面板显示暂无结果。
      if (selectedId.value !== null && !selectedRow.value) {
        selectedId.value = null
      }
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : options.loadErrorText
    }
  }

  function locate(row: EntryRow) {
    errorMessage.value = ''
    selectedId.value = Number(row.id)
  }

  function resetFilters() {
    filters.value = {}
    reload()
  }

  function submitAction(action: string, row: EntryRow) {
    // 跨班组记录在过滤后本就不该出现；选择已失效（如已被筛走）时直接拦截。
    if (!rows.value.some((item) => Number(item.id) === Number(row.id))) {
      errorMessage.value = '当前记录不在筛选结果内，已拦截该操作'
      return
    }
    errorMessage.value = ''
    const result = applyAction(options.key, Number(row.id), action, {
      scopeField: options.teamField,
      scopeValue: activeTeam.value,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
  }

  function submitCreate(draft: Record<string, string>): ActionResult {
    if (submitting.value) {
      // 重复提交只留一份：上一笔还没处理完，直接回拒，不再写第二条。
      return { ok: false, duplicated: true, message: '正在提交，请勿重复操作' }
    }
    submitting.value = true
    try {
      const result = createEntry(options.key, draft, {
        scopeField: options.teamField,
        scopeValue: activeTeam.value,
        idField: options.idField,
      })
      if (!result.ok) {
        errorMessage.value = result.message
        return result
      }
      const idField = options.idField
      const code = idField ? String(draft[idField] ?? '').trim() : ''
      const created = listEntries(options.key, filters.value).items.find(
        (row) => !idField || String(row[idField] ?? '').trim() === code,
      )
      if (created) {
        selectedId.value = Number(created.id)
      }
      reload()
      return result
    } finally {
      submitting.value = false
    }
  }

  onMounted(reload)

  return {
    rows,
    total,
    todoCount,
    errorMessage,
    filters,
    selectedId,
    selectedRow,
    activeTeam,
    isFiltering,
    submitting,
    reload,
    locate,
    resetFilters,
    submitAction,
    submitCreate,
  }
}
