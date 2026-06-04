import { useState } from 'react'
import { mockNewTaskDefaults, mockSessions, mockStatusBar } from '../mocks/data'

/**
 * NewTaskModal page -- pixel-perfect replica of the HTML prototype.
 * Renders the full app chrome (header, sidebar, content, footer) dimmed/blurred
 * behind a centered "New Scheduled Task" modal overlay.
 *
 * Everything lives in this single file.  Mock data is imported from ../mocks/data.
 */
export default function NewTaskModal() {
  /* ── form state ─────────────────────────────────────────────────── */
  const [taskName, setTaskName] = useState('')
  const [description, setDescription] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [model, setModel] = useState(mockNewTaskDefaults.models[0])
  const [rootFolder, setRootFolder] = useState('')
  const [frequency, setFrequency] = useState(mockNewTaskDefaults.frequencies[1])
  const [worktree, setWorktree] = useState(false)

  return (
    <div className="bg-[var(--color-background)] text-[var(--color-on-surface)] font-[var(--font-body)] min-h-screen flex flex-col">
      {/* ─── TopAppBar / Header ──────────────────────────────────── */}
      <header className="bg-[var(--color-background)] flex justify-between items-center px-6 h-12 w-full z-40">
        <div className="flex items-center gap-6">
          <span className="text-sm font-bold text-[var(--color-text-primary)] uppercase tracking-tighter font-[var(--font-headline)]">
            Beya
          </span>
          <nav className="hidden md:flex gap-4 font-[var(--font-headline)] font-semibold tracking-wide text-sm">
            <a className="text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)] transition-colors cursor-pointer">代码</a>
            <a className="text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)] transition-colors cursor-pointer">终端</a>
            <a className="text-[var(--color-text-tertiary)] hover:text-[var(--color-brand)] transition-colors cursor-pointer">历史</a>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[var(--color-brand)]">
            <span className="material-symbols-outlined cursor-pointer active:opacity-70 text-sm">arrow_back_ios</span>
            <span className="material-symbols-outlined cursor-pointer active:opacity-70 text-sm">arrow_forward_ios</span>
          </div>
          <span className="font-[var(--font-headline)] font-semibold tracking-wide text-sm text-[var(--color-text-tertiary)] cursor-pointer hover:text-[var(--color-brand)] transition-colors">
            设置
          </span>
        </div>
      </header>

      {/* header divider */}
      <div className="bg-[var(--color-surface-container-low)] h-px w-full" />

      {/* ─── Main area (sidebar + content + overlay) ──────────────── */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* ── Sidebar (dimmed) ────────────────────────────────────── */}
        <aside className="hidden md:flex flex-col p-4 gap-2 bg-[var(--color-surface-container-low)] h-full w-[280px] opacity-30 pointer-events-none">
          {/* project selector */}
          <div className="flex items-center gap-3 px-2 py-3 mb-2">
            <div className="w-8 h-8 rounded bg-[var(--color-surface-dim)] flex items-center justify-center">
              <span className="material-symbols-outlined text-[var(--color-outline)]">filter</span>
            </div>
            <div>
              <div className="text-[var(--color-on-surface)] font-semibold text-xs">所有项目</div>
              <div className="text-[10px] text-[var(--color-outline)]">活跃会话</div>
            </div>
          </div>

          {/* nav items -- session counts derived from mockSessions */}
          <div className="font-[var(--font-body)] text-sm font-medium space-y-1">
            <div className="flex items-center gap-3 px-3 py-2 text-[var(--color-text-tertiary)]">
              <span className="material-symbols-outlined">add</span>新建会话
            </div>
            <div className="flex items-center gap-3 px-3 py-2 bg-[var(--color-background)] text-[var(--color-text-primary)] rounded-lg relative before:content-[''] before:absolute before:left-[-8px] before:w-1 before:h-4 before:bg-[var(--color-brand)] before:rounded-full">
              <span className="material-symbols-outlined">calendar_today</span>定时任务
            </div>
            <div className="flex items-center gap-3 px-3 py-2 text-[var(--color-text-tertiary)]">
              <span className="material-symbols-outlined">history</span>今天
              {mockSessions.today.length > 0 && (
                <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{mockSessions.today.length}</span>
              )}
            </div>
            <div className="flex items-center gap-3 px-3 py-2 text-[var(--color-text-tertiary)]">
              <span className="material-symbols-outlined">event_note</span>最近 7 天
              {mockSessions.previous7Days.length > 0 && (
                <span className="ml-auto text-[10px] text-[var(--color-text-tertiary)]">{mockSessions.previous7Days.length}</span>
              )}
            </div>
          </div>
        </aside>

        {/* ── Content area (dimmed canvas) ────────────────────────── */}
        <div className="flex-1 bg-[var(--color-surface-container-low)] flex flex-col p-8 overflow-y-auto relative">
          {/* faded background content */}
          <div className="max-w-4xl mx-auto w-full space-y-6 opacity-20">
            <h1 className="font-[var(--font-headline)] text-3xl font-bold tracking-tight">
              定时任务
            </h1>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="h-40 bg-[var(--color-surface-container-lowest)] rounded-xl border border-[var(--color-outline-variant)]/20 p-4" />
              <div className="h-40 bg-[var(--color-surface-container-lowest)] rounded-xl border border-[var(--color-outline-variant)]/20 p-4" />
            </div>
          </div>

          {/* ═══ MODAL OVERLAY ═══════════════════════════════════════ */}
          <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-on-surface)]/40 backdrop-blur-sm">
            <div
              className="bg-[var(--color-surface-container-lowest)] w-full max-w-lg rounded-xl overflow-hidden flex flex-col"
              style={{
                boxShadow:
                  '0 4px 20px rgba(27,28,26,0.04), 0 12px 40px rgba(27,28,26,0.08)',
              }}
            >
              {/* ── Modal Header ─────────────────────────────────── */}
              <div className="px-6 py-4 flex items-center justify-between border-b border-[var(--color-outline-variant)]/10">
                <h2 className="font-[var(--font-headline)] font-bold text-lg text-[var(--color-on-surface)]">
                  新建定时任务
                </h2>
                <span className="material-symbols-outlined text-[var(--color-outline)] cursor-pointer hover:text-[var(--color-on-surface)] transition-colors">
                  close
                </span>
              </div>

              {/* ── Modal Body ───────────────────────────────────── */}
              <div
                className="p-6 overflow-y-auto space-y-5"
                style={{
                  maxHeight: 768,
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                }}
              >
                {/* Info Banner */}
                <div className="bg-[var(--color-surface-container-high)]/50 rounded-lg p-3 flex gap-3 items-start">
                  <span className="material-symbols-outlined text-[var(--color-primary)] text-sm mt-0.5">
                    info
                  </span>
                  <p className="text-xs text-[var(--color-on-surface-variant)] font-medium">
                    本地任务仅在电脑唤醒时运行。
                  </p>
                </div>

                {/* ── Form ───────────────────────────────────────── */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4">
                    {/* Task Name */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-outline)] px-1">
                        任务名称
                      </label>
                      <input
                        type="text"
                        value={taskName}
                        onChange={(e) => setTaskName(e.target.value)}
                        placeholder="例如：每周代码审计"
                        className="w-full bg-[var(--color-surface-container)] rounded-lg border-none focus:ring-1 focus:ring-[var(--color-primary)] text-sm placeholder:text-[var(--color-outline)]/50 px-4 py-2.5 transition-all outline-none"
                      />
                    </div>

                    {/* Description */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-outline)] px-1">
                        描述
                      </label>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="简要说明这个计划的用途..."
                        className="w-full bg-[var(--color-surface-container)] rounded-lg border-none focus:ring-1 focus:ring-[var(--color-primary)] text-sm placeholder:text-[var(--color-outline)]/50 px-4 py-2.5 transition-all outline-none"
                      />
                    </div>

                    {/* System Prompt */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-outline)] px-1">
                        系统提示词
                      </label>
                      <textarea
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        placeholder="定义 Agent 的目标和行为..."
                        rows={3}
                        className="w-full bg-[var(--color-surface-container)] rounded-lg border-none focus:ring-1 focus:ring-[var(--color-primary)] text-sm placeholder:text-[var(--color-outline)]/50 px-4 py-2.5 transition-all resize-none outline-none"
                      />
                    </div>
                  </div>

                  {/* Two-column row: Permission Mode + Model */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Permission Mode */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-outline)] px-1">
                        权限模式
                      </label>
                      <div className="w-full bg-[var(--color-surface-container)] rounded-lg border-none text-sm px-4 py-2.5 outline-none flex items-center gap-2 text-[var(--color-on-surface)]">
                        <span className="material-symbols-outlined text-[16px] text-[var(--color-error)]">
                          gavel
                        </span>
                        完全访问
                      </div>
                    </div>

                    {/* Model */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-outline)] px-1">
                        模型
                      </label>
                      <div className="relative">
                        <select
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          className="w-full bg-[var(--color-surface-container)] rounded-lg border-none focus:ring-1 focus:ring-[var(--color-primary)] text-sm px-4 py-2.5 appearance-none cursor-pointer outline-none"
                        >
                          {mockNewTaskDefaults.models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                        <span className="material-symbols-outlined absolute right-3 top-2.5 pointer-events-none text-[var(--color-outline)] text-sm">
                          unfold_more
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Root Folder Path */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-outline)] px-1">
                      根目录路径
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={rootFolder}
                        onChange={(e) => setRootFolder(e.target.value)}
                        placeholder="/users/projects/beya-app"
                        className="flex-1 bg-[var(--color-surface-container)] rounded-lg border-none focus:ring-1 focus:ring-[var(--color-primary)] text-sm placeholder:text-[var(--color-outline)]/50 px-4 py-2.5 transition-all outline-none"
                      />
                      <button className="bg-[var(--color-surface-container-high)] px-3 rounded-lg flex items-center justify-center hover:bg-[var(--color-surface-variant)] transition-colors">
                        <span className="material-symbols-outlined text-[var(--color-on-surface-variant)] text-sm">
                          folder_open
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Frequency */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-outline)] px-1">
                      频率
                    </label>
                    <div className="relative">
                      <select
                        value={frequency}
                        onChange={(e) => setFrequency(e.target.value)}
                        className="w-full bg-[var(--color-surface-container)] rounded-lg border-none focus:ring-1 focus:ring-[var(--color-primary)] text-sm px-4 py-2.5 appearance-none cursor-pointer outline-none"
                      >
                        {mockNewTaskDefaults.frequencies.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined absolute right-3 top-2.5 pointer-events-none text-[var(--color-outline)] text-sm">
                        schedule
                      </span>
                    </div>
                  </div>

                  {/* Worktree Checkbox */}
                  <div className="flex items-center gap-3 pt-2">
                    <div className="relative flex items-center">
                      <input
                        id="worktree"
                        type="checkbox"
                        checked={worktree}
                        onChange={(e) => setWorktree(e.target.checked)}
                        className="w-4 h-4 rounded text-[var(--color-primary)] focus:ring-[var(--color-primary)] border-[var(--color-outline-variant)] bg-[var(--color-surface-container)] accent-[var(--color-primary)]"
                      />
                    </div>
                    <label
                      htmlFor="worktree"
                      className="text-sm text-[var(--color-on-surface)] font-medium cursor-pointer"
                    >
                      为执行创建独立 worktree
                    </label>
                  </div>
                </div>
              </div>

              {/* ── Modal Footer ─────────────────────────────────── */}
              <div className="px-6 py-4 bg-[var(--color-surface-container-low)]/50 flex items-center justify-end gap-3">
                <button className="px-5 py-2 text-sm font-semibold text-[var(--color-outline)] hover:text-[var(--color-on-surface)] transition-colors">
                  取消
                </button>
                <button
                  className="px-6 py-2 rounded-lg text-sm font-bold text-[var(--color-on-primary)] shadow-sm hover:opacity-90 active:scale-95 transition-all"
                  style={{
                    backgroundImage:
                      'linear-gradient(to bottom, var(--color-primary), var(--color-primary-container))',
                  }}
                >
                  创建任务
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ─── Footer / Status Bar ─────────────────────────────────── */}
      <footer className="bg-[var(--color-background)] flex items-center justify-between px-4 z-50 fixed bottom-0 left-0 w-full h-8 border-t border-[var(--color-border)]/20 font-[var(--font-body)] text-xs tracking-tight">
        <div className="flex items-center gap-3">
          <span className="text-[var(--color-text-tertiary)]">
            {mockStatusBar.user} &bull; {mockStatusBar.username} &bull; {mockStatusBar.plan}
          </span>
          <div className="flex items-center gap-4 ml-4">
            <span className="text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded cursor-pointer transition-colors">
              {mockStatusBar.branch}
            </span>
            <span className="text-[var(--color-text-tertiary)] hover:bg-[var(--color-surface-container-low)] px-2 py-0.5 rounded cursor-pointer transition-colors">
              {mockStatusBar.worktreeToggle}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[var(--color-brand)] font-bold cursor-pointer">
            {mockStatusBar.localSwitch}
          </span>
          <div className="flex items-center gap-1 text-[var(--color-text-tertiary)]">
            <span className="material-symbols-outlined text-[14px]">terminal</span>
            <span>{mockStatusBar.status === '就绪' ? '活跃' : mockStatusBar.status}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
