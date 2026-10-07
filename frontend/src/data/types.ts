/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 被服务端判重拦下时为 true：同样的提交只留一份，前端据此解除提交锁。 */
  duplicated?: boolean
}

export type ActionOptions = {
  /** 当前筛选班组（作用域）；动作目标不在该班组内时拦截，防止跨班组改动。 */
  scopeField?: string
  scopeValue?: string
}

export type CreateOptions = {
  /** 当前筛选班组：登记时班组必须与之一致，拦截跨班组登记。 */
  scopeField?: string
  scopeValue?: string
  /** 用作唯一编号的字段（如人员编号、过站编号），重复登记判重。 */
  idField?: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
