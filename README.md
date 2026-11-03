# 互助集·车队助力 — Loon 多账号自动化

在 **huzhuji.com（互助集 / 好价集）** 上自动化「加抵金车队互助」(jdj-crew) 的多账号日常流程：

- **攒分阶段**（账号 < Lv.2，即积分 < 200）：在开放频道（`pdd` 拼多多福袋 / `jdj` 加抵金 / `tb` 淘金币）自动助力他人 → 攒积分到 Lv.2（解锁车队频道）
- **车队阶段**（Lv.2+）：在 `jdj-crew` 自动助力他人（每天上限 6 次，赚「被助力」名额 + 积分）→ 自动发布自己的车队口令（有被助力名额或待助力列表 < 6 条时）

每个账号一套独立的「环境」：
- 独立会话 cookie（`aid`，express-session）
- 独立设备指纹（`x-device-install-id` / `x-device-fingerprint` / `x-device-access` / `x-device-fingerprint-parts`，首次生成后持久化，跨次运行稳定）
- 可选独立出口节点（账号 JSON 里的 `node` 字段 → `$httpClient` 的 `node` 参数，走不同代理 = 不同 IP）

## 文件
| 文件 | 说明 |
|---|---|
| `hzj_crew.js` | 主脚本（Loon Script，经典 API，3.5.1(978)+ 可跑） |
| `互助集_车队助力.lpx` | 插件（[Argument] 参数 + cron/generic 触发） |
| `hzj_waf_solver.js` | WAF 挑战纯 JS 解算（已并入主脚本，单独留档） |
| `test_loon.js` | Node 测试桩（在 iSH 里验证过全流程） |

## 安装
1. 把 `hzj_crew.js` 与 `README.md` 传到 https://github.com/harmonizr/huzhuji-crew （或你任何可公开访问的 raw 地址）。
2. 安装插件 `互助集_车队助力.lpx`（Loon → 插件 → 本地/URL 导入）。
   若 JS 托管地址不同，改 .lpx 里两处 `script-path=` 即可。
3. 填参数（Loon → 插件参数）：
   - **accounts**：
     ```json
     [
       {"n":"主号","c":"s%3A<uuid>.<sig>"},
       {"n":"小号1","c":"","node":"HK","code":"本号专属口令(可空)"},
       {"n":"小号2","c":"s%3A<uuid>.<sig>"}
     ]
     ```
     - `c` 留空 = 首次运行自动开一个新匿名号（设备指纹/身份持久化在 Loon 存储里，之后复用）
     - `node` = 出口节点名或策略组名（空 = 当前路由），**强烈建议不同账号配不同出口**
   - **crew_code**：淘宝车队活动页「复制链接」得到的完整口令（形如 `38₴Glhf6ZvUq1Q🔐 https://m.tb.cn/h.jT7xhFS HU006 为我的车队助力，一起向前冲`）。**每日 0 点失效**，需每天更新；留空则只做助力不做发布。
4. 先用 **dry_run=开** 手动跑一次确认计划无误，再关掉。

### 怎么拿 `aid` cookie 值
Loon 开 HAR 日志（或抓包）→ 在 Quark 里打开一次 huzhuji.com → 导出请求 → 找任意 `/api/...` 请求头里 `cookie: ... aid=s%3Axxxx.yyyy ...`，把 `s%3Axxxx.yyyy` 这段（保持 URL 编码原样）填进对应账号的 `c`。

## 调度
默认 cron `0 8,14,20 * * *`（每天 8/14/20 点各一轮），可在 .lpx 里改。
一次全量运行时长 ≈ 账号数 × (助力次数 × 间隔 + 账号间隔)。5 个号全量约 10–20 分钟，故 timeout=1800。

## 协议要点（逆向自 2026-11-03 HAR + 实机探测）
- 身份：`GET /api/identity/context` → `csrfToken` + 积分/等级；无 `aid` 时自动签发新匿名身份（Set-Cookie）
- 设备校验：所有 API 请求必须带 `x-device-*` + `x-client-app: web` + `x-client-protocol: 2`（缺失 → 403 E1005）；指纹**只查格式不验哈希**（随机 64hex 即可通过）
- 助力：`POST /api/invites/{id}/help` → 201 立即 CONFIRMED + 积分（pdd 20/次、jdj 10/次、tb 10/次）
- 发布：`POST /api/invites` body `{channelSlug:"jdj-crew", code}`（2~500 字符；body 里放其他字段会 400）
- 额度：jdj-crew 日限助力 6 / 被助力 6（助力他人赚被助力名额；列表 <6 条时可免费发布）；pdd 3 / jdj 10 / tb 5
- 准入：jdj-crew 需 **Lv.2+（≥200 积分）或正式用户**（403 CREW_ACCESS_DENIED）
- 限流：429 `DEVICE_REQUEST_BURST_EXCEEDED`（burst ~10s，脚本自动按 retryAfter 等待重试）
- 防重：`pairUsedToday`/`ownerLinkedToMe`/`withdrawnByMe`/`reportedByMe` 过滤 + 当日已发布检测（`/api/me/submissions`）
- WAF：HTML 页有阿里云 acw 挑战（`acw_sc__v2`，本脚本内嵌纯 JS 解算器兜底）；**/api/* 不带 cookie 也能过 WAF**（实测）

## 风险（务必知悉）
1. **平台明令禁止虚假助力**（11-03 公告：「本次识别算法非常严格，请勿虚假助力！」+ 截图核验 + 举报「助力未满」→ 封号）。本插件只做 huzhuji 侧的记账助力；对应淘宝侧的真实助力需要你手动打开口令链接完成。只记账不完成 → 被举报/识别后账号会被限制（站点会封「虚假助力者」，且封禁期内的关联发布也会受影响）。
2. **多账号同 IP 是主要风险点**。务必给不同账号配不同出口节点（`node`）；IP 高度重叠 + 高频操作容易触发站点风控。
3. 车队口令**每日 0 点失效**，cron 前记得更新 `crew_code`，否则当轮自动跳过发布（无口令/无名额时只记日志不报错）。
4. 新匿名号第一套指纹/身份由 Loon 持久化（`hzj_dev_<账号名>`），删插件后自动号会重开。

## 测试记录（iSH Node 桩，2026-11-03）
- dry-run × 2 自动新号：流程/过滤/日志 OK
- dry-run 用户真实号（270 分）：crew 准入/名额/已发布去重 OK
- 实跑 1 次助力（一次性号 c3j5gn）：`POST /help` 201 → +10 分 OK
