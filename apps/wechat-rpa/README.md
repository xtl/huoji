# 微信本机采集器第一版

采集当前账号启用的独立微信群聊窗口。初始群为 `B300真实交易群`、`真实货源群`，在货记的「微信采集」中可添加、暂停或移除群。实时采集读取可见消息，历史补采按所选群逐屏上翻。采集结果进入微信收件箱，确认入库后才出现在供需资料中。

当前这台机器的微信 **4.1.15.13** 独立群聊窗口只暴露 Window/Pane，UIA 不能读取消息。`UIA_MESSAGE` 是供兼容客户端使用的严格适配骨架；本机使用经过区域校准的 OCR。当前深色主题下，能确认外部昵称与完整文字气泡对应时输出 `OCR_MESSAGE`；其余文字保留为未知作者的 `OCR_SNAPSHOT`，可能含多位发言者、重复片段或截断消息。

## 安装与配置

Windows x64 本机测试版可双击 `Huoji-Capture-Local-Test-x64-Setup.exe` 安装，之后从桌面打开「货记采集助手（本机测试版）」。页面使用本机模拟验证码。将目标群打开为独立微信窗口，在网页点「选择采集群」，勾选后可实时采集或按时段补采。窗口无法识别时会显示具体群名。系统托盘菜单可重新打开页面或退出助手。

测试版监听 `127.0.0.1:5196`，数据存放于当前 Windows 用户的 `%LOCALAPPDATA%\HuojiCaptureTest\Data`。卸载保留该目录。程序和 OCR 模型随安装包分发，普通用户无需配置开发环境。

维护者可在已安装项目 OCR 依赖、前端 npm 依赖及 Inno Setup 6 的 Windows x64 构建机上运行 `apps\wechat-rpa\.venv\Scripts\python.exe apps\wechat-rpa\desktop\build.py --compiler "ISCC.exe 的完整路径"`。产物位于 `apps\wechat-rpa\build\release`。

### 源码运行

Python 3.11+，在本目录执行：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item config.example.json config.local.json
```

使用截图 OCR 时额外安装：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-ocr.txt
```

RapidOCR 首次加载可能下载模型；需能访问其模型下载地址。命令不会自动安装依赖或启动后台服务。

微信 4.1.15.13 的 Qt 窗口在本机使用 Pillow `ImageGrab.grab(window=hwnd)` 时会得到均匀灰色图像，因此单窗采集改用 Windows Graphics Capture（`windows-capture`）。仅按已核验的精确 HWND 捕获，不使用窗口名子串、监视器或全屏回退。每张图由独立子进程取首帧，15 秒超时即杀进程并回收；原生捕获崩溃不会把监听进程留在后台。截图仍只在本机内存中处理，后续 OCR 必须通过标题、窗口尺寸及消息区域校验。

也可以从货记「微信采集」页面下载当前账号配置，保存为本目录的 `config.local.json`。配置含登录令牌，请仅存放在本机。示例默认 `http://localhost:3000`、不启用上传。远程地址必须用 HTTPS；HTTP 仅允许 localhost/回环 IP。上传器禁止 HTTP 重定向转发令牌。

配置字段：

| 字段 | 用途 |
| --- | --- |
| `schemaVersion` | 固定为 `1` |
| `deviceId` | 这台设备的稳定标识，下载配置时生成 |
| `apiBaseUrl` | 服务地址的 origin，不含 `/api` 路径 |
| `token` | 当前账号登录令牌；留空时仅本地采集 |
| `scope.userId` / `scope.workspaceId` | 配置归属账号和空间；与登录接口返回值一致 |
| `groups` | 当前启用的群名列表，对应独立窗口的完整名称。空列表暂停所有群的采集 |
| `pollIntervalSeconds` | 轮询间隔，默认 10 秒 |
| `statePath` | SQLite 路径，相对于配置文件所在目录 |
| `upload.enabled` | 是否允许上传；还需要命令行 `--upload` |
| `upload.batchSize` | 每次最多 50 条 |
| `capture.mode` | `uia` 或 `ocr`，默认 `uia` |
| `capture.profiles` | OCR 每个群独立窗口的实测尺寸和区域 |
| `selectors` | UIA 精确选择器，见下方 |

## 本机 OCR 模式

在微信中把要采集的群打开为独立窗口，保持桌面解锁、窗口正常显示。在货记「微信采集」中添加完整群名并启用，使用校准操作核验窗口。校准只识别窗口标题，读取的窗口尺寸与已有模板一致且布局唯一时可直接复用模板。尺寸不匹配时可调整到提示的已知尺寸，或按下方示例单独配置实测区域。实时监听每次轮询重读本机连接配置，跳过未打开或未校准的群。补采可以只勾选已校准的群。

在配置增加以下段落。此处只演示配置结构，数字必须与对应群窗口截图实测一致，不能直接用于其他尺寸、DPI 或微信版本：

```json
{
  "capture": {
    "mode": "ocr",
    "profiles": {
      "B300真实交易群": {
        "windowSize": [601, 641],
        "titleRegion": [8, 30, 365, 76],
        "messageRegion": [65, 78, 586, 522]
      }
    }
  }
}
```

区域使用单窗口截图像素坐标 `[left, top, right, bottom]`，标题与消息区域不得重叠。每个参与 OCR 采集的群需要有自己的校准记录。窗口改变尺寸、最小化、锁屏、画面空白或标题不匹配都会拒绝该群本次采集。

群名仍要求严格匹配，标题 OCR 低置信度时拒绝采集。正文少量不确定文字完整保留，并以 `【OCR待核对 置信度】` 标记，不能作为确定的价格、数量或来源；超过四分之一的正文行不确定时，整次快照拒绝入队。所有 OCR 结果仍需用户确认。

每条完整文字气泡可携带 `publishedTime`，保存微信界面的时间证据。以原截图的北京时间为准，单独的时分属于当天，「昨天」取前一天，「星期几」取此前最近的对应星期。明确写出的日期按界面读取，只有日期就只显示日期。紧邻气泡的分隔行显示为「微信时间标记」或「微信日期标记」。上下界落在同一分钟时显示「微信发布」，跨分钟时显示「微信发布时间范围」。`observedAt` 单独显示为采集时间。缺少原始时间证据的旧记录显示「微信发布时间未识别」。

`OCR_MESSAGE` 只在昵称完整可见、位于气泡外且符合接收消息列位置、昵称置信度至少 95%、完整气泡正文置信度至少 90% 时使用该昵称。不会沿用上一条消息的作者，也不会把气泡内部的引用或图片文字当成作者。

完整文字气泡若只是昵称缺失、低置信或无法唯一配对，会以 `OCR_SNAPSHOT`、`captureUnit: TEXT_BUBBLE`、固定未知发送人单独保留正文，不继承上一条作者。有明确昵称的 `OCR_MESSAGE` 同样使用 `captureUnit: TEXT_BUBBLE`。

图片、引用、截断气泡和其他无法分离的剩余文字使用 `OCR_SNAPSHOT`、`captureUnit: VIEWPORT_REMAINDER`；它可能混合多条消息，不能按一条消息计数。已分离的完整气泡正文会从剩余快照中排除，避免同屏重复。气泡裁到正文、缺少边角证据或 OCR 盒子跨界时不会放宽完整性规则；浅色主题和混合媒体尚无单泡适配。

深色聊天背景按画面多侧边缘的一致颜色估计，避免后续图片中的大块深灰色把整页误判成气泡。图片、引用和昵称的原有几何/颜色/置信度限制保持；不能确认背景时仍回退未知快照。这项修复不自动改写已经产生的旧混合快照。

短文字气泡（例如 `CX7`）允许较小宽度，仍须通过原有高度、面积、正文完整性、颜色和接收列校验；图片、纯表情或符号不计完整文字泡。昵称同一行被OCR拆成多个片段时不拼接、不取左侧词冒充完整昵称，正文以未知作者保留。剩余快照会用 `【已分离消息】` 标明已移出的泡，防止孤立昵称与后文拼成虚假的连续来源证据。

`incomingBubbleLeft` 可选填写到各群的 profile，值为完整窗口截图中实测的接收消息气泡左坐标；默认以配置消息区域左沿为接收列。消息区域略裁掉气泡左缘时，只有昵称与正文仍完整且列位置匹配才可配对。窗口缩放或布局改变后请重新校准，不能通过放宽范围来猜作者。

本次升级使用 `OCR_SEGMENTS_V1` 整组建立一次新基线：首屏全部消息只记为已见，后续新增才进入队列。消息 ID 使用群名、昵称和正文生成稳定指纹，同一条气泡在重复轮询时不会再次入队。旧整屏记录没有保存昵称与气泡几何，原始发送人字段、原文和旧队列不改写。

服务端读取收件箱时，会逐条检查整屏中的重复内容：只有同账号、空间、设备和群、采集时间相差不超过 30 分钟，且独立昵称行及完整正文与已有 `READY / OCR_MESSAGE` 唯一对应，才返回服务端生成的 `sourceLinks`。允许 OCR 空白/换行差异；不使用 SKU 相似匹配，不采信 AI 自报的来源，存在不同昵称同文、匹配段识别不确定或明确引用上下文时保持未知。整屏其他位置的低置信图标不影响清晰的匹配段。页面按条显示关联来源，并用 `sourceItemAliases` 识别同一条消息的历史导入标识，防止单条、整屏及空白变体重复导入。已保存的草稿和正式记录不会被自动改名；关联仍需人工核对。

也可以把本机校准独立存为 `.data/calibration.json`，保留网页下载的连接配置原样。校准文件只含版本与 profile，不含账号令牌：

```json
{
  "schemaVersion": 1,
  "profiles": {
    "B300真实交易群": {
      "windowSize": [601, 641],
      "titleRegion": [8, 30, 365, 76],
      "messageRegion": [65, 78, 586, 522]
    }
  }
}
```

显式传入校准文件路径可在内存中合并 profile 并启用 OCR。网页校准会保存核验通过的配置；命令行也可以单独检查一个启用的群并输出核验结果：

```powershell
python -X utf8 collector.py --config connection.local.json --calibration .data/calibration.json calibrate --group "示例采购群"
```

先只本地采集：

```powershell
python -X utf8 collector.py --config wechat-rpa.config.json --calibration .data/calibration.json collect --once
```

完成本地检查后，配置允许上传且令牌有效时，才明确开启：

```powershell
python -X utf8 collector.py --config wechat-rpa.config.json --calibration .data/calibration.json collect --upload
```

## UIA 模式与结构探测

UIA 仅读取已经打开的顶层窗口。必须同时唯一匹配独立群窗口、精确群标题、特定消息容器，再从容器内逐个消息行读取独立的发送人和正文控件。没有明确容器时返回 `UNSUPPORTED_UIA`，不使用整个窗口文字拼接代替消息。

`selectors` 支持 `controlType`、`name`、`automationId`、`className` 的精确匹配，以及 `maxDepth`。`{chatName}` 替换为当前群名；标题的 `name` 必须是这个模板。`window` 始终只匹配顶层窗口。示例中的 `REPLACE_WITH_INSPECTED_*` 是占位符，未校准无法采集；不能据此声称兼容本机微信。

只显示控件结构的探测命令，不打印 Name、消息正文、发送人或 token：

```powershell
python -X utf8 collector.py --config config.local.json probe
```

可以显示 controlType、className、automationId 以辅助适配。probe 不产生队列、不截图、不上传。

## 运行

先进行一次本地采集：

```powershell
python -X utf8 collector.py --config config.local.json collect --once
python -X utf8 collector.py --config config.local.json status
```

每个群、每种采集模式的**首次非空成功读取只建立基线**，不会导入首屏历史。下次内容变化时，新识别的记录进入 SQLite 待传队列。空窗口和失败读取不会标记基线。重新执行命令会复用 SQLite 去重状态，不会再次导入已经看过的记录。

持续本地轮询（Ctrl+C 停止）：

```powershell
python -X utf8 collector.py --config config.local.json collect
```

明确开始上传：先确认配置 `upload.enabled: true` 且 token 有效，再执行：

```powershell
python -X utf8 collector.py --config config.local.json collect --upload
```

即使下载的配置 `upload.enabled` 已为 true，省略 `--upload` 仍只本地入队。上传地址固定为 `POST /api/rpa/messages`，请求头 `Authorization: Bearer <token>`，请求体：

```json
{
  "deviceId": "device-id",
  "messages": [{
    "messageId": "stable-content-fingerprint",
    "chatName": "B300真实交易群",
    "sender": "未识别（截图识别）",
    "sentAt": null,
    "observedAt": "2026-10-21T10:00:00.000Z",
    "text": "可见聊天区域的 OCR 文本",
    "captureMode": "OCR_SNAPSHOT",
    "captureUnit": "VIEWPORT_REMAINDER"
  }]
}
```

上传每批正文之前先用当前令牌请求 `GET /api/rpa/config`，确认服务端实际账号/空间与 `scope` 一致。只有服务端 `accepted` 列表明确确认对应 `messageId`、持久化 `id` 和状态后，该条才移出待传集合；部分确认只处理确认的条目。重复上报由服务端幂等处理。网络异常、重定向、无确认、登录过期都会保留队列，并按 5 秒至 1 小时指数退避重试。

原始文本与队列状态存储在本机 SQLite 中，并绑定 `apiBaseUrl + deviceId + scope`。切换账号、空间、服务器或设备标识后必须使用独立 `statePath`，否则拒绝使用旧队列。仅更新同账号同空间的 token 可以继续使用原数据库。旧版无归属元数据的非空数据库也会拒绝直接复用。

## 离线验证

不要求 Windows，不导入 UIAutomation、不访问现场 UI、不访问网络：

```powershell
python -X utf8 -m unittest -v
python -X utf8 collector.py --config fixtures/config.json probe --fixture fixtures/messages.json
python -X utf8 collector.py --config fixtures/config.json replay fixtures/messages.json
```

fixture 第一帧建立基线、第二帧只新增一条、第三帧模拟不支持消息控件的客户端。replay 始终禁用上传，状态保存在 `.data/fixture-replay.sqlite3`。再次 replay 复用去重状态，所以新增数会变化。

## 自动历史补采

将所选群分别打开为独立微信窗口，保持桌面解锁、窗口可见，并沿用已校准的窗口尺寸。在本机货记进入「录入 → 微信采集 → 补采历史消息」，勾选群聊，选择「近 1 天」「近 3 天」或「近 7 天」，点击「开始补采」。三个选项分别从同一次任务开始时往前算 24、72、168 小时。

按天补采使用微信聊天中的时间分隔行判断完整文字气泡所属时段。采集器逐屏上翻、去重并尝试回到最新消息。每群最多上翻 200 次、读取 20 分钟。结果按群显示时段内识别条数、新增条数、停止原因和时间无法确认的跳过数。遇到可见历史开头、上翻或时长上限时，已经确认在范围内的消息可以保留，尚未翻到的时段会标为待核实。命令行也可使用 `backfill --days 1`、`backfill --days 3` 或 `backfill --days 7`。

选择「按上翻次数」可使用原有页数模式，默认每群最多上翻 5 次，允许范围为 1–30。当前两个 467px 消息区实测每个标准滚轮 notch 移动 37px，上翻每步最多 5 个 notch 以保留至少 282px 重叠，快速恢复每步至少 20、最多 40 个 notch；遇到已确认的历史顶端提前停止。

先仅补入本机队列：

```powershell
.\.venv\Scripts\python.exe -X utf8 collector.py --config connection.local.json --calibration .data/calibration.json backfill --pages 5
```

显式选择群并上传，`--group` 可重复指定不同白名单群，省略则处理配置中的所有群：

```powershell
.\.venv\Scripts\python.exe -X utf8 collector.py --config connection.local.json --calibration .data/calibration.json backfill --pages 2 --group B300真实交易群 --group 真实货源群 --upload --cancel-file .data/backfill.cancel
```

命令行还支持每群的完整文字数量目标，例如每群最多补采最近向上遇到的 200 条去重完整文字气泡：

```powershell
.\.venv\Scripts\python.exe -X utf8 collector.py --config connection.local.json --calibration .data/calibration.json backfill --messages-per-group 200 --pages 200 --group B300真实交易群 --group 真实货源群 --upload --cancel-file .data/history200.cancel
```

`--messages-per-group` 范围为 1–200，数量模式默认每群最多上翻 200 次，也可用 `--pages 1..200` 设置更低硬限；不指定数量目标时，原页数模式仍为 1–30。数量模式每群最多读取 20 分钟，达到目标、历史顶端、页限或时间上限都会停止新增上翻，随后有界回最新。恢复预算随实际上翻次数扩展，不会为了凑数无限翻页。

数量只统计 `TEXT_BUBBLE`，有匹配昵称与未知发送人分列；图片、截断片段、混合剩余快照均不计入消息目标。目标末屏按底到顶选取最新的完整气泡，达到目标后不再把更老内容塞进剩余快照上传。未知/已知的同正文重叠观测在本轮保守合并计数，原始未知记录不因此回填作者；两个不同已知昵称的同文仍分别保留。重复轮询、换行或空白变体不应凑出新的消息数量。

结果会明确报告每群目标是否达到、有昵称/未知的完整文字数、未完成识别画面与剩余候选画面数。若只能识别不足 200 条，按实际数量和停止原因展示。这里的“200 条”是去重后的可分离完整文字记录，不包含图片和语音消息。网页支持按天和按上翻次数，指定数量的任务通过命令行运行。

上传仍需配置允许、有效令牌及匹配的账号/空间。补采会补入首次基线中已见但尚未进入 outbox 的记录；已经待传或服务端确认的记录不再重复入队。失败画面不写入已见集合，`skippedScreens` 会明确计数，其他画面仍可继续识别。

任务先定点下滚到稳定画面作为最新锚点，再逐屏上翻、识别和去重。结束或取消后，在 `finally` 中有界下滚恢复；有原生滚动条到底证据，或滚动确实响应且最终回到最初锚点，才报告 `returnedToLatest: true`。仅静止、不响应、窗口变化、尺寸变化或锚点不一致都不能当作已恢复，最终会明确报告失败/未确认。新消息改变锚点时也可能无法确认恢复，请手动核对。

每一步都核验精确 HWND、原微信进程、画面群标题、窗口尺寸、解锁状态以及消息区子窗口。采集器在同一按显示器 DPI 感知的上下文中计算物理屏幕坐标并发送 `WM_MOUSEWHEEL`，避免 Windows 在 150% 等缩放比例下再次缩放坐标。若在发送首个滚动指令前停止，页面会显示对应群名及原因。只有实际尝试过滚动的窗口需要核实是否回到最新消息。

创建 `--cancel-file` 指定的文件即可请求取消；该文件应在新任务前不存在。取消会停止新增上翻，但仍执行安全恢复。直接终止进程、系统锁屏或关闭群窗口可能妨碍恢复，不能保证这类中断后仍停在最新。

实时采集每轮与补采任务共享 `.data/desktop.capture.lock`，并另锁定 `<statePath>.capture.lock`。补采开始时最多等待实时采集释放锁 30 秒，每 200ms 重试并响应取消；取得锁后全程持锁。实时采集遇锁输出 `PAUSED_FOR_BACKFILL` 并等待下轮，账号或设备配置变化也无法绕开同采集目录的桌面锁。进程结束自动释放 OS 锁，不按文件是否存在判断占用。

补采 stdout 仅输出不含正文、昵称或令牌的 JSON 进度：`event: backfill`，状态为 `RUNNING`、`RESTORING`、`COMPLETED`、`CANCELLED` 或 `FAILED`。`pagesRequested` 是每群上限，`pagesCompleted` 为全部群累计上翻次数；`queued`、`uploaded`、`skippedScreens` 为累计计数，`groups` 记录各群进度及恢复结果。正文 OCR 的诊断不影响恢复流程，但跳过数量需要在收件箱中核对。

## 当前边界

- 只采集屏幕上可见的文字；不读取全部历史，不承诺不漏采，也不支持锁屏后台采集。
- UIA 无可靠微信服务端消息 ID，使用群名、发送人、正文和同屏出现次数生成保守指纹。未来独立出现的完全相同文本可能被抑制；同屏重复次数改变可能形成新候选。
- OCR 对完整单泡和剩余视口分别生成指纹；新消息、滚动或版面变化可能带入此前片段，微小识别差异也可能产生新记录。待确认区需人工核对，不应自动成为报价或正式货源。
- 图片、语音、视频、文件与撤回消息没有专门解析器。OCR 无法保证价格、规格和人数准确；识别置信度不是业务正确性的证明。
- 两个群的独立窗口尺寸、DPI、微信版本或布局改变后需要重新校准。校准坐标必须来自采集器的 WGC 原始像素；桌面工具展示的逻辑像素尺寸在 150% 缩放时会有差异。

## 2026-10-31 本机验证

两个指定群已使用实际 WGC 捕获成功建立首屏基线。当前机器的独立校准保存在 `.data/calibration.json`，连接配置保存在 `connection.local.json`，均不提交 Git。首屏历史不会进入收件箱，新出现的可见文字才会入队。

在 `demo_ui` 目录运行以下命令可启动隔离的本机验证页面：

```powershell
npm run build
npm run rpa:local
```

地址为 `http://127.0.0.1:5186`，仅监听本机；使用模拟短信和本地规则解析，不加载生产环境文件。登录验证码显示在页面，配置可在「微信采集 → 连接设置」下载。验证账号与收件箱存放在 `demo_ui/.data/rpa-local/`，与其他运行环境分开。此模式用来验证采集、去重、上传与确认流程，不能代替真实模型的抽取质量验收。

在本目录运行采集器：

```powershell
.\.venv\Scripts\python.exe -X utf8 collector.py --config connection.local.json --calibration .data/calibration.json collect --upload
```

采集程序会持续运行，按 `Ctrl+C` 停止。电脑重启后需重新启动页面服务和采集程序。

实现依据：[Python UIAutomation 官方仓库](https://github.com/yinkaisheng/Python-UIAutomation-for-Windows)、[RapidOCR 官方快速开始](https://rapidai.github.io/RapidOCRDocs/main/quickstart/)、[Windows Capture 官方 API](https://github.com/NiiightmareXD/windows-capture/blob/main/windows-capture-python/windows_capture/__init__.py)、[Pillow ImageGrab 文档](https://pillow.readthedocs.io/en/stable/reference/ImageGrab.html)。
