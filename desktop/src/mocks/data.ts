/**
 * Mock data for all pages — matches the UI prototypes exactly.
 * Replace with real API calls once server integration is done.
 */

// ─── Sessions ─────────────────────────────────────────────────────
export const mockSessions = {
  today: [
    { id: 's1', title: '重构登录流程', modifiedAt: new Date().toISOString() },
    { id: 's2', title: '修复 CSS 响应式布局', modifiedAt: new Date().toISOString() },
  ],
  previous7Days: [
    { id: 's3', title: '添加用户认证', modifiedAt: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: 's4', title: '数据库迁移脚本', modifiedAt: new Date(Date.now() - 5 * 86400000).toISOString() },
  ],
  older: [
    { id: 's5', title: '初始化项目配置', modifiedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
  ],
}

// ─── Active Session Messages ──────────────────────────────────────
export const mockActiveMessages = [
  {
    id: 'm1',
    role: 'user' as const,
    content: '我想重构 `auth.ts` 里的登录流程，把 JWT 签名逻辑移到独立 helper，并为用户 payload 添加校验。',
  },
  {
    id: 'm2',
    role: 'assistant' as const,
    content: '明白。我会先分析 `auth.ts` 当前实现，然后抽出 JWT 工具函数，并按要求补上校验层。',
    thinking: '正在查看 auth.ts：JWT 签名目前内联在登录 handler 里。需要：\n1. 抽出 signToken() helper\n2. 为 LoginPayload 添加 Zod 校验\n3. 更新 handler 同时使用两者',
  },
  {
    id: 'm3',
    role: 'tool' as const,
    toolName: 'edit_file',
    toolStatus: 'success',
    filePath: 'src/lib/auth.ts',
    content: `export const validatePayload = (user) => { ... }
export const signToken = (payload) => jwt.sign(payload, SECRET);
// 8 OLD LINES REMOVED`,
  },
]

// ─── Agent Teams ──────────────────────────────────────────────────
export const mockTeam = {
  name: 'session-dev',
  memberCount: 4,
  members: [
    { id: 'a1', role: '架构师', status: 'completed' as const, color: '#16a34a' },
    { id: 'a2', role: '前端开发', status: 'running' as const, color: '#dc2626' },
    { id: 'a3', role: '后端开发', status: 'running' as const, color: '#2563eb' },
    { id: 'a4', role: '测试工程师', status: 'idle' as const, color: '#9333ea' },
  ],
}

export const mockTeamMessages = {
  userMessage: '重构认证中间件，让它同时支持 JWT 和 OAuth2，并确保边界场景有足够测试覆盖。',
  assistantMessage: '我已经为这个任务启动 Agent 团队。架构师正在设计接口，开发成员正在准备新策略的基础代码。',
  systemInfo: `信息：正在为并行开发启动 child_processes
活跃：session-dev 集群已启动
就绪：已分配 4 个 Agent`,
}

// ─── Agent Transcript ─────────────────────────────────────────────
export const mockTranscript = {
  agentName: '前端开发',
  messages: [
    {
      id: 't1',
      role: 'agent' as const,
      timestamp: 'P1:42:11',
      content: '我已经分析组件结构。接下来需要更新 `Navigation.tsx`，加入新的响应式断点，并启动本地文件系统审计。',
    },
    {
      id: 't2',
      role: 'tool' as const,
      toolName: 'BASH',
      status: 'SUCCESS' as const,
      command: '$ grep -r "breakpoint" .\n./Navigation.tsx: const [isMobile, setIsMobile] = useState(false);\n./Navigation.tsx: // TODO: Add mobile breakpoint check\n./Header.tsx: @media (max-width: 768px) {',
    },
    {
      id: 't3',
      role: 'progress' as const,
      label: '正在修补 Navigation.tsx',
      progress: 67,
    },
    {
      id: 't4',
      role: 'agent' as const,
      timestamp: 'P1:44:35',
      content: '断点逻辑已实现。现在正在验证 CSS-in-JS 注入，确保不会和现有主题产生样式冲突。',
      images: ['/placeholder-code-1.jpg', '/placeholder-code-2.jpg'],
    },
  ],
  teamBar: [
    { id: 'lead', role: '主控 Beya', active: false, color: '#87736D' },
    { id: 'a2', role: '前端开发', active: true, color: '#dc2626' },
    { id: 'a3', role: '后端架构师', active: false, color: '#2563eb' },
  ],
}

// ─── Scheduled Tasks ──────────────────────────────────────────────
export const mockScheduledTasks = {
  stats: {
    totalTasks: 12,
    activeHealthy: 9,
    nextRun: { name: '夜间 lint 检查', time: '今天 23:30' },
    systemHealth: 99.8,
    healthPeriod: '最近 30 天执行率',
  },
  tasks: [
    {
      id: 'task1',
      name: '夜间 lint 检查',
      frequency: '每天',
      lastResult: '成功' as const,
      nextExecution: '今天 23:30',
    },
    {
      id: 'task2',
      name: '清理临时文件',
      description: 'Clean TempOutput/**',
      frequency: '每周',
      lastResult: '成功' as const,
      nextExecution: '周日 02:00',
    },
    {
      id: 'task3',
      name: '数据库 Vacuum',
      description: 'Postgres 维护',
      frequency: '每月',
      lastResult: '失败（磁盘已满）' as const,
      nextExecution: '12 月 01 日 09:01',
    },
  ],
}

// ─── Session Controls ─────────────────────────────────────────────
export const mockPermissionModes = [
  { id: 'ask', label: '询问权限', description: '每次文件编辑或终端命令都需要确认。', icon: 'lock' },
  { id: 'auto', label: '自动接受编辑', description: 'Beya 写入磁盘时不再询问。', icon: 'edit_note' },
  { id: 'plan', label: '计划模式', description: '只做架构和推理，不写入文件。', icon: 'architecture' },
  { id: 'bypass', label: '跳过权限', description: '对 Shell 和文件系统拥有完整访问权限。', icon: 'warning' },
]

export const mockModels = [
  { id: 'powerful', name: '强力模型', active: false },
  { id: 'balanced', name: '均衡模型', active: true },
  { id: 'fast', name: '快速模型', active: false },
]

export const mockEffortLevels = ['低', '中', '高', '最大']

// ─── Tool Inspection (edit_file diff) ─────────────────────────────
export const mockToolInspection = {
  toolType: '工具调用',
  toolName: 'edit_file',
  description: '正在更新登录逻辑以使用新 SDK',
  filePath: 'src/lib/auth.ts',
  dryRunStatus: '预演成功',
  linesChanged: { added: 12, removed: 8 },
  diffLines: [
    { type: 'context' as const, lineNo: 1, content: 'export async function loginCredentials: LoginCredentials): Promise<LoginResponse> {' },
    { type: 'context' as const, lineNo: 2, content: '  try {' },
    { type: 'removed' as const, lineNo: 3, content: '    const response = await legacyHttpClient.authenticate()' },
    { type: 'added' as const, lineNo: 3, content: '    const response = await httpClient.authenticate({' },
    { type: 'added' as const, lineNo: 4, content: '      user: credentials.username,' },
    { type: 'added' as const, lineNo: 5, content: '      pass: credentials.password,' },
    { type: 'context' as const, lineNo: 6, content: '    })' },
    { type: 'context' as const, lineNo: 7, content: '' },
    { type: 'removed' as const, lineNo: 8, content: '    const client = await createClient();' },
    { type: 'added' as const, lineNo: 8, content: '    const client = await newSdkClient.create({' },
    { type: 'added' as const, lineNo: 9, content: '      identifier: credentials.username,' },
    { type: 'added' as const, lineNo: 10, content: '      secret: credentials.password,' },
    { type: 'context' as const, lineNo: 11, content: '' },
    { type: 'added' as const, lineNo: 12, content: '      options: { persistent: true }' },
    { type: 'context' as const, lineNo: 13, content: '    })' },
    { type: 'context' as const, lineNo: 14, content: '' },
    { type: 'context' as const, lineNo: 15, content: '    if (response.status === 200) {' },
    { type: 'context' as const, lineNo: 16, content: '      return response.data;' },
  ],
}

// ─── New Task Modal ───────────────────────────────────────────────
export const mockNewTaskDefaults = {
  models: ['Beya 主力模型', 'Beya 快速模型', 'Beya 深度模型'],
  frequencies: ['每小时', '每天 09:00', '每周', '每月', '自定义 cron'],
}

// ─── Footer / Status Bar ──────────────────────────────────────────
export const mockStatusBar = {
  user: '用户头像',
  username: 'username',
  plan: 'Pro 计划',
  branch: 'main-branch',
  worktreeToggle: 'worktree-toggle',
  localSwitch: 'local-switch',
  status: '就绪',
}
