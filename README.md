# dsh-docs-reader

DSH 开发文档阅读器与知识图谱插件：在 DSH Web **左侧边栏**提供「开发文档」入口——目录树 + 文档阅读 + 检索 + 知识图谱。

数据**动态读取运行环境中 dsh 仓库的 `docs/` 目录**（不随插件打包），仓库文档更新后重启 dsh web 即生效。

## 功能预览

> 截图即将补充。图片统一放在仓库根目录 `img/` 文件夹,提交后 GitHub 自动渲染。

<!-- 预留截图位(建议): -->
<!-- ![侧边栏入口](img/sidebar-entry.png)     侧边栏「开发文档」入口 -->
<!-- ![主面板](img/main-panel.png)            文档阅读主面板 -->
<!-- ![知识图谱](img/knowledge-graph.png)     知识图谱弹窗 -->

## 功能

- 左侧边栏入口「开发文档」（底部，`sidebar.panellist` 槽位）
- 文档目录树（分组折叠、层级缩进、中英文标题按文档语言显示）
- Markdown 渲染阅读（代码块 / 表格 / 标题层级 / 中英切换）
- 全文搜索（标题 / 路径）
- 知识图谱（ECharts 5.5.1 内联、离线可用）：总览力导向 → 点击节点高亮节点与边 → 右侧预览摘要 → 引用关系浏览
- 右侧栏：本页目录 / 路径 / 引用文档 / 被以下文档引用（点击即跳转定位）

## 文件结构

```
dsh-docs-reader/
├── package.json        # dsh.bundle.patch + dsh.client(注入 @deepseek-ai/dsh-api-gateway)
├── cordis.patch.yml    # 插件行: id=dsh-docs-reader / name=dsh-docs-reader
├── index.js            # Host: DocsReader 服务类(default export), 扫描/读取/搜索 docs
├── client.js           # Client: __ModuleLoader__ 懒工厂, 侧边栏入口 + 主面板 + 图谱(内联 ECharts)
├── icon.svg            # 插件卡片图标
├── img/                # 项目截图(功能预览)
├── LICENSE             # MIT
└── locale/
    ├── zh.json
    └── en.json
```

## 安装

> **说明**:当前仅支持 GitHub / 本地路径安装。插件**尚未发布到 npm registry**,因此 `dsh plugin add dsh-docs-reader`(npm 包名方式)暂不可用;待后续发布 npm 后开放。

### 方式 A：从 GitHub 安装（推荐）

```
dsh plugin --profile <name> add github:als3453/dsh-docs-reader
```

插件为纯 JavaScript、无构建脚本，git 安装即用，无需 pnpm 构建授权。安装后重启 dsh web。

### 方式 B：本地源码路径（开发中）

```
dsh plugin --profile <name> add link:<仓库绝对路径>/custom-plugins/dsh-docs-reader
```

### 方式 C：DSH 内 install_bundle

在 DSH 中调用插件管理工具：

```
plugin_manager → action: install_bundle → target: <插件包绝对路径>
```

安装后确认行激活（`application: applied`），侧边栏底部出现「开发文档」入口。

## 数据源与配置

插件默认读取**插件包所在仓库的 `docs/` 目录**。通过 `config.root` 可覆盖数据源路径（相对/绝对均可），在插件行的 patch 层或 profile 的 `cordis.patch.yml` 中配置：

```yaml
- override:
    - id: dsh-docs-reader
      config:
        root: /path/to/deepseek-harness/docs
```

## 兼容性说明

- 依赖的 `@deepseek-ai/dsh-typert-protocol`、`@deepseek-ai/dsh-api-gateway` 均为 dsh 内置包，从 dsh 安装解析，插件包**不声明依赖**（符合官方 bundle 范式）。
- 样式使用 `--dsw-alias-*` 主题 token + 深色兜底，适配宿主明暗主题；未引入任何 Harness Client 包。

## 卸载

```
dsh plugin --profile <name> remove dsh-docs-reader
```

或 DSH 内 `plugin_manager → remove_bundle`。
