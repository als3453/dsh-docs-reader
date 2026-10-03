/**
 * DSH 开发文档插件 — Host 端
 *
 * 提供 `docsReader` 远程服务: 扫描 / 读取 / 搜索仓库 docs 目录下的开发文档。
 * 数据源默认取插件包所在仓库的 docs 目录(custom-plugins/dsh-docs-reader/../../docs),
 * 可在 cordis.patch.yml 的 config.root 覆盖。
 *
 * 远程方法元数据通过 Typert Gateway 的反射协议挂载(REMOTE_METHOD_DESCRIPTOR),
 * Client 端在 `dsh-docs-reader/client` 中 $mount 同名贡献。
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'
const TITLE_RE = /^#\s+(.+?)\s*$/m
const NAV_RE = /^(English\s*\|\s*\[[^\]]*\]\([^)]*\.zh\.md\)|\[English\]\([^)]*\.md\)\s*\|\s*中文)\s*$/m

/** 提取摘要: 跳过 frontmatter / 标题 / 语言导航行, 优先取 概述/Overview/Summary 章节, 否则取正文首段。 */
function makeSummary(text) {
  let t = text.replace(/^---[\s\S]*?---\s*/m, '')
  t = t.replace(TITLE_RE, '')
  t = t.replace(NAV_RE, '')
  const sec = t.match(/^##\s*(?:概述|Overview|Summary)\s*\n+([\s\S]*?)(?=\n##\s|\n*$)/m)
  const src = sec ? sec[1] : t
  return src.replace(/\s+/g, ' ').trim().slice(0, 260)
}

/** 解析站内 .md 链接为文档 id(相对当前文档目录 / 仓库 docs 根)。 */
function resolveRef(relNoExt, raw) {
  if (/^(https?:)?\/\//.test(raw) || raw.startsWith('#') || raw.startsWith('mailto:')) return null
  const target = raw.split('#')[0].trim()
  if (!target.endsWith('.md')) return null
  let t = target
  if (t.startsWith('../docs/')) t = t.slice('../docs/'.length)
  const base = relNoExt.includes('/') ? relNoExt.slice(0, relNoExt.lastIndexOf('/')) : ''
  const full = path.posix.normalize(path.posix.join(base, t))
  if (full === '..' || full.startsWith('../')) return null
  return full.endsWith('.md') ? full.slice(0, -3) : full
}

/** 解析 persistence-change 声明中的裸 id(如 previous: "2026-09-11-initial")为文档 id。 */
function resolveBareId(relNoExt, raw) {
  if (!raw || /^(https?:)?\/\//.test(raw)) return null
  const base = relNoExt.includes('/') ? relNoExt.slice(0, relNoExt.lastIndexOf('/')) : ''
  const full = path.posix.normalize(path.posix.join(base, raw)).replace(/\.md$/, '')
  if (full === '..' || full.startsWith('../')) return null
  return full
}

/** 提取正文中的站内 .md 引用链接。 */
function extractRefs(text, relNoExt) {
  const refs = []
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g
  let m
  while ((m = re.exec(text)) !== null) {
    const resolved = resolveRef(relNoExt, m[1])
    if (resolved) refs.push(resolved)
  }
  const bare = /(?:^|[^(\w])((?:\.[\w-]+)?\/[\w./-]+\.md)(?:#[\w-]+)?/g
  while ((m = bare.exec(text)) !== null) {
    const resolved = resolveRef(relNoExt, m[1])
    if (resolved && !refs.includes(resolved)) refs.push(resolved)
  }
  // ```yaml persistence-change 声明中的 previous 链视为引用
  const block = /```yaml\s+persistence-change\s*\n([\s\S]*?)```/g
  while ((m = block.exec(text)) !== null) {
    const pm = /previous:\s*"?([\w./-]+)"?/.exec(m[1])
    if (pm) {
      const resolved = resolveBareId(relNoExt, pm[1])
      if (resolved && !refs.includes(resolved)) refs.push(resolved)
    }
  }
  return [...new Set(refs)]
}

export default class DocsReader extends TypertRemoteService {
  constructor(ctx, config = {}) {
    super(ctx, 'docsReader')
    /** docs 目录: 默认插件包 ../../docs; 可在 config.root 覆盖。 */
    this.root = config.root || fileURLToPath(new URL('../../docs/', import.meta.url))
    /** skills 目录: 默认插件包 ../../packages/preset/agent-preset/skills; 可在 config.skillsRoot 覆盖。 */
    this.skillsRoot = config.skillsRoot || fileURLToPath(new URL('../../packages/preset/agent-preset/skills/', import.meta.url))
    this.cache = null
    this.cacheAt = 0
  }

  /**
   * 列出全部文档与分组。
   * @returns {Promise<{groups: Record<string, number>, docs: Array<object>, total: number}>}
   */
  async list() {
    return this.scan()
  }

  /**
   * 读取一篇文档正文(含中文版本)。
   * @param id 相对 docs 根的文档 id(不带 .md), 如 "AGENTS" / "subsystems/tools"; 技能库文档以 "skills/" 开头。
   */
  async read(id) {
    if (typeof id !== 'string' || !id) throw new Error('docs-reader: 非法文档 id')
    const parts = id.split('/')
    for (const p of parts) {
      if (!p || p === '..' || p === '.') throw new Error(`docs-reader: 非法文档 id "${id}"`)
    }
    if (id.startsWith('skills/')) {
      const rel = id.slice('skills/'.length) + '.md'
      const full = path.join(this.skillsRoot, ...rel.split('/'))
      const text = await readFile(full, 'utf8')
      const title = (text.match(TITLE_RE) || [])[1]?.trim() || id.split('/').pop()
      return { id, title, body: text, zhBody: null, zhPath: null, bilingual: false, path: 'skills/' + rel }
    }
    const rel = id + '.md'
    const full = path.join(this.root, ...rel.split('/'))
    const text = await readFile(full, 'utf8')
    const title = (text.match(TITLE_RE) || [])[1]?.trim() || id.split('/').pop()
    let zhBody = null
    let zhPath = null
    const zrel = rel.slice(0, -3) + '.zh.md'
    try {
      zhBody = await readFile(path.join(this.root, ...zrel.split('/')), 'utf8')
      zhPath = zrel
    } catch {
      /* 无中文版 */
    }
    return {
      id,
      title,
      body: text,
      zhBody,
      zhPath,
      bilingual: zhBody !== null,
      path: rel,
    }
  }

  /**
   * 按标题 / 路径检索文档。
   * @param query 检索关键词
   */
  async search(query) {
    const q = String(query ?? '').toLowerCase()
    const { docs } = await this.scan()
    return docs
      .filter((d) => d.title.toLowerCase().includes(q) || d.path.toLowerCase().includes(q))
      .slice(0, 20)
  }

  /** 递归扫描 docs 目录(含子目录)与 skills 目录, 60s 内缓存。 */
  async scan() {
    const now = Date.now()
    if (this.cache && now - this.cacheAt < 60000) return this.cache
    const groups = {}
    const docs = []
    let rootEntries = []
    try {
      rootEntries = await readdir(this.root, { withFileTypes: true })
    } catch {
      /* docs 目录缺失 */
    }
    const rootMds = rootEntries.filter((e) => e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.zh.md'))
    for (const e of rootMds) {
      const doc = await this.buildDoc(this.root, e.name, 'top', '')
      if (doc) docs.push(doc)
    }
    for (const e of rootEntries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue
      if (e.name === 'user' || e.name === 'persistence-changes') {
        const sub = await this.scanDirRecursive(path.join(this.root, e.name), e.name, e.name)
        docs.push(...sub)
      } else {
        const dir = path.join(this.root, e.name)
        let files = []
        try {
          files = await readdir(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith('.md') || f.name.endsWith('.zh.md')) continue
          const doc = await this.buildDoc(dir, f.name, e.name, '')
          if (doc) docs.push(doc)
        }
      }
    }
    // skills: 递归 packages/preset/agent-preset/skills/<skill>/(SKILL.md + references/*.md)
    try {
      const sk = await readdir(this.skillsRoot, { withFileTypes: true })
      for (const s of sk) {
        if (!s.isDirectory()) continue
        const sp = path.join(this.skillsRoot, s.name)
        const files = await this.walkMds(sp)
        for (const f of files) {
          const rel = path.relative(this.skillsRoot, f).replace(/\\/g, '/')
          const id = 'skills/' + rel.replace(/\.md$/, '')
          const st = await readFile(f, 'utf8')
          const base = path.basename(f)
          let title
          if (base === 'SKILL.md') {
            const nm = (st.match(/^name:\s*(.+)$/m) || [])[1]?.trim()
            title = nm || s.name
          } else {
            title = (st.match(TITLE_RE) || [])[1]?.trim() || base.replace(/\.md$/, '')
          }
          docs.push({
            id,
            group: 'skills',
            title,
            zhTitle: null,
            dir: '',
            summary: makeSummary(st),
            refs: extractRefs(st, id),
            path: 'skills/' + rel,
            zhPath: null,
            bilingual: false,
            body: st,
            zhBody: null,
          })
        }
      }
    } catch {
      /* skills 目录缺失 */
    }
    for (const d of docs) groups[d.group] = (groups[d.group] ?? 0) + 1
    const result = { groups, docs, total: docs.length }
    this.cache = result
    this.cacheAt = now
    return result
  }

  /** 递归收集目录下所有 .md 文件。 */
  async walkMds(dirAbs) {
    const out = []
    const entries = await readdir(dirAbs, { withFileTypes: true })
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = path.join(dirAbs, e.name)
      if (e.isDirectory()) {
        out.push(...(await this.walkMds(p)))
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(p)
      }
    }
    return out
  }

  /** 递归扫描子目录(如 user / persistence-changes), 记录相对 topDir 的 dir 用于目录缩进。 */
  async scanDirRecursive(dirAbs, gname, topDir) {
    const out = []
    const entries = await readdir(dirAbs, { withFileTypes: true })
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const p = path.join(dirAbs, e.name)
      if (e.isDirectory()) {
        out.push(...(await this.scanDirRecursive(p, gname, topDir)))
      } else if (e.isFile() && e.name.endsWith('.md') && !e.name.endsWith('.zh.md')) {
        const dirPart = path.relative(path.join(this.root, topDir), path.dirname(p)).replace(/\\/g, '/')
        const doc = await this.buildDoc(dirAbs, e.name, gname, dirPart)
        if (doc) out.push(doc)
      }
    }
    return out
  }

  async buildDoc(dir, name, gname, dirPart = '') {
    const full = path.join(dir, name)
    let text
    try {
      text = await readFile(full, 'utf8')
    } catch {
      return null
    }
    const rel = path.relative(this.root, full).replace(/\\/g, '/')
    const id = rel.replace(/\.md$/, '')
    const title = (text.match(TITLE_RE) || [])[1]?.trim() || name.replace(/\.md$/, '')
    let zhPath = null
    let bilingual = false
    let zhTitle = null
    let zhBody = null
    try {
      const zrel = rel.slice(0, -3) + '.zh.md'
      const ztext = await readFile(path.join(this.root, ...zrel.split('/')), 'utf8')
      zhPath = zrel
      bilingual = true
      const zm = ztext.match(TITLE_RE)
      if (zm) zhTitle = zm[1].trim()
      zhBody = ztext
    } catch {
      /* 无中文版 */
    }
    return {
      id,
      group: gname,
      title,
      zhTitle,
      dir: dirPart,
      summary: makeSummary(text),
      refs: extractRefs(text, id),
      path: rel,
      zhPath,
      bilingual,
      body: text,
      zhBody,
    }
  }
}

/* 手动挂载 Remote 方法反射元数据(等价于 @Remote 装饰器产物)。 */
Object.defineProperty(DocsReader.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      Object.freeze({ method: 'list', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'read', invocation: Object.freeze({ kind: 'direct' }) }),
      Object.freeze({ method: 'search', invocation: Object.freeze({ kind: 'direct' }) }),
    ]),
  }),
})
