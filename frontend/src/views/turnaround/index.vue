<template>
  <section class="page" data-module="turnaround">
    <header class="page-head">
      <div>
        <h2>过站监控管理</h2>
        <p class="page-desc">维护过站记录，围绕过站编号、关联航班、计划到港、实际到港做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记过站记录</button>
        <button class="btn" type="button" @click="exportRows">导出过站监控清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
      <article class="stat-card stat-todo">
        <span class="stat-label">清单待办（同步地勤排班）</span>
        <strong class="stat-value">{{ todoCount }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
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
              <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
        <h3 class="detail-title">过站详情</h3>
        <template v-if="selectedRow">
          <dl class="detail-list">
            <div v-for="column in columns" :key="column" class="detail-row">
              <dt>{{ column }}</dt>
              <dd>{{ selectedRow[column] ?? '—' }}</dd>
            </div>
            <div class="detail-row">
              <dt>当前状态</dt>
              <dd>{{ selectedRow.status }}</dd>
            </div>
          </dl>
        </template>
        <p v-else-if="isFiltering" class="detail-empty">暂无结果，请调整筛选条件后重试</p>
        <p v-else class="detail-empty">点击左侧清单中的过站记录查看详情</p>
      </aside>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条过站监控记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="creating" class="modal-mask" @click.self="closeCreate">
      <form class="modal-card" @submit.prevent="confirmCreate">
        <h3 class="modal-title">登记过站记录</h3>
        <label v-for="field in formFields" :key="field" class="modal-field">
          <span>{{ field }}<em v-if="requiredFields.includes(field)">*</em></span>
          <input v-model="draft[field]" :placeholder="`请输入${field}`" />
        </label>
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

import { downloadEntries, moduleMeta } from '@/api/local-service'
import { useScopedList } from '@/composables/useScopedList'

const meta = moduleMeta('turnaround')
const columns = ['过站编号', '关联航班', '计划到港', '实际到港', '过站时长', '保障进度', '异常事项', '过站状态']
const actions = ['开始监测', '正常完成', '标记超时']
const statuses = ['待监测', '监测中', '正常完成', '已超时']
const formFields = ['过站编号', '关联航班', '计划到港', '实际到港', '过站时长', '保障进度', '异常事项']
const requiredFields = ['过站编号', '关联航班', '计划到港']
const filterFields = columns.slice(0, 3)

const {
  rows,
  total,
  todoCount,
  errorMessage,
  filters,
  selectedId,
  selectedRow,
  isFiltering,
  submitting,
  reload,
  locate,
  resetFilters,
  submitAction,
  submitCreate,
} = useScopedList({
  key: meta.key,
  filterFields,
  idField: '过站编号',
  loadErrorText: '过站监控列表读取失败',
})

const stats = computed(() => [
  { label: '监测中航班', value: rows.value.filter((row) => String(row.status) === '监测中').length },
  { label: '正常完成航班', value: rows.value.filter((row) => String(row.status) === '正常完成').length },
  { label: '超时航班', value: rows.value.filter((row) => String(row.status) === '已超时').length },
])

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const emptyText = computed(() =>
  isFiltering.value ? '暂无结果，没有符合筛选条件的过站记录' : '暂无过站监控数据，可先登记过站记录',
)

function exportRows() {
  downloadEntries(meta.key)
}

const creating = ref(false)
const draft = ref<Record<string, string>>({})

function openCreate() {
  errorMessage.value = ''
  draft.value = Object.fromEntries(formFields.map((field) => [field, '']))
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
