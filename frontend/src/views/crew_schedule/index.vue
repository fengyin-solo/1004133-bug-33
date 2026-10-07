<template>
  <section class="page" data-module="crew_schedule">
    <header class="page-head">
      <div>
        <h2>地勤排班管理</h2>
        <p class="page-desc">维护地勤人员，围绕人员编号、姓名、岗位类别、所属班组做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地勤人员</button>
        <button class="btn" type="button" @click="exportRows">导出地勤排班清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
      <article class="stat-card stat-todo">
        <span class="stat-label">清单待办（同步过站监控）</span>
        <strong class="stat-value">{{ todoCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>所属班组</span>
        <input v-model="filters['所属班组']" placeholder="按所属班组检索" list="crew-team-options" />
        <datalist id="crew-team-options">
          <option v-for="team in teamOptions" :key="team" :value="team" />
        </datalist>
      </label>
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="scoped-layout">
      <div class="scoped-list">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              :class="{ 'is-selected': Number(row.id) === selectedId }"
              @click="locate(row)"
            >
              <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions" @click.stop>
                <button
                  v-for="action in actions"
                  :key="action"
                  class="link"
                  type="button"
                  @click="submitAction(action, row)"
                >
                  {{ action }}
                </button>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td :colspan="columns.length + 2" class="empty-state">{{ emptyText }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="detail-panel">
        <h3 class="detail-title">人员详情</h3>
        <template v-if="selectedRow">
          <dl class="detail-list">
            <div v-for="column in columns" :key="column" class="detail-row">
              <dt>{{ column }}</dt>
              <dd>{{ display(selectedRow, column) }}</dd>
            </div>
            <div class="detail-row">
              <dt>当前状态</dt>
              <dd>{{ selectedRow.status }}</dd>
            </div>
          </dl>
        </template>
        <p v-else-if="isFiltering" class="detail-empty">暂无结果，请调整筛选条件后重试</p>
        <p v-else class="detail-empty">点击左侧清单中的地勤人员查看详情</p>
      </aside>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条地勤排班记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="confirmCreate">
        <h3 class="modal-title">登记地勤人员</h3>
        <label v-for="field in formFields" :key="field" class="modal-field">
          <span>{{ field }}<em v-if="requiredFields.includes(field)">*</em></span>
          <input v-model="draft[field]" :placeholder="`请输入${field}`" />
        </label>
        <p class="modal-hint">
          所属班组必填；当前筛选班组为「{{ activeTeam || '不限' }}」，跨班组登记会被拦截。
        </p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeCreate">取消</button>
          <button class="btn primary" type="submit" :disabled="submitting">
            {{ submitting ? '提交中…' : '确认登记' }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries, fieldOptions, moduleMeta } from '@/api/local-service'
import { useScopedList } from '@/composables/useScopedList'

const meta = moduleMeta('crew_schedule')
const columns = ['人员编号', '姓名', '岗位类别', '所属班组', '排班日期', '值班时段', '在岗状态', '联络方式']
const actions = ['安排排班', '确认在岗', '登记离岗']
const statuses = ['待排班', '已排班', '在岗', '已离岗']
const formFields = ['人员编号', '姓名', '岗位类别', '所属班组', '排班日期', '值班时段', '联络方式']
const requiredFields = ['人员编号', '姓名', '所属班组']
const filterFields = ['人员编号', '姓名', '岗位类别']

const {
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
} = useScopedList({
  key: meta.key,
  teamField: '所属班组',
  filterFields,
  idField: '人员编号',
  loadErrorText: '地勤排班列表读取失败',
})

// 数据面板只统计过滤后的人员，从根上避免在岗状态串到别的班组。
const stats = computed(() => {
  const onDuty = rows.value.filter((row) => String(row.status) === '在岗').length
  const waiting = rows.value.filter((row) => String(row.status) === '待排班').length
  const arrived = rows.value.filter((row) => ['在岗', '已离岗'].includes(String(row.status))).length
  return [
    { label: '在岗人员', value: onDuty },
    { label: '待排班人员', value: waiting },
    { label: '今日到岗率', value: total.value === 0 ? '—' : `${Math.round((arrived / total.value) * 100)}%` },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 班组下拉候选取自数据本身，缺班组归属（空值）的人员不会进入任何班组候选。
const teamOptions = computed(() => fieldOptions(meta.key, '所属班组'))

const emptyText = computed(() => {
  if (!isFiltering.value) {
    return '暂无地勤排班数据，可先登记地勤人员'
  }
  if (activeTeam.value) {
    return `暂无结果：班组「${activeTeam.value}」下没有匹配的地勤人员`
  }
  return '暂无结果，没有符合筛选条件的地勤人员'
})

function display(row: (typeof rows.value)[number], column: string): string {
  const value = row[column]
  if (column === '所属班组' && String(value ?? '').trim() === '') {
    return '未分配班组'
  }
  return value === undefined || value === '' ? '—' : String(value)
}

function exportRows() {
  downloadEntries(meta.key)
}

const creating = ref(false)
const draft = ref<Record<string, string>>({})

function todayLabel(): string {
  return new Date().toISOString().slice(0, 10)
}

function openCreate() {
  errorMessage.value = ''
  draft.value = Object.fromEntries(formFields.map((field) => [field, '']))
  // 已按班组过滤时，默认带上当前班组并保留这个选择，减少跨班组误填。
  draft.value['所属班组'] = activeTeam.value
  draft.value['排班日期'] = todayLabel()
  creating.value = true
}

function closeCreate() {
  creating.value = false
}

function confirmCreate() {
  for (const field of requiredFields) {
    if (!String(draft.value[field] ?? '').trim()) {
      errorMessage.value = `请填写${field}`
      return
    }
  }
  const result = submitCreate(draft.value)
  if (result.ok) {
    closeCreate()
  }
}
</script>
