# Magpie 用量与成本看板

[Magpie](https://github.com/nicepkg/magpie) 本地 LLM 网关的轻量用量看板。零依赖（仅 Node.js 内置模块），一个命令跑起来，展示你在各供应商 / 各模型上的花费、Token 消耗、额度余额与性能指标。

## 功能

- **KPI 总览**：总花费、调用次数、输入 / 输出 Token、缓存读写、流量
- **费用趋势**：按小时 / 天 / 周聚合的柱状图（今天 / 近 7 天 / 近 30 天 / 全部）
- **Token 趋势**：输入、输出、缓存读取三色堆叠柱状图
- **模型成本排名**：按花费排序，含占比条、调用次数、Token 数
- **按 Agent / 按账号**：每个 AI 客户端与订阅账号的用量拆分
- **额度面板**：各供应商订阅额度窗口（已用 / 剩余 / 重置时间）与余额
- **性能指标**：平均首 Token 延迟、解码速度、缓存命中率、失败与无法定价次数
- **CSV 导出**：调用 Magpie CLI 导出当前时间段的明细，带 BOM，Excel 直接打开不乱码
- **自动刷新**：60 秒轮询，切回浏览器标签页时自动拉取最新数据
- **连接状态**：页头实时显示网关名称、版本与地址，网关不在线时给出明确提示

## 环境要求

- Node.js 20+
- 本机已安装并运行 [Magpie](https://github.com/nicepkg/magpie) 网关（默认监听 `127.0.0.1:3425`）

## 快速开始

```bash
git clone https://github.com/<your-name>/magpie-dashboard.git
cd magpie-dashboard
npm start
```

打开 <http://localhost:5180>。

## 配置

全部通过环境变量配置，均有默认值，不配置也能直接跑：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `5180` | 看板服务监听端口 |
| `MAGPIE_ADDR` | `127.0.0.1:3425` | Magpie 网关地址 |
| `MAGPIE_KEY` | `magpie-dashboard` | Magpie 网关 API Token，与你的 Magpie 配置保持一致 |
| `MAGPIE_EXE` | `%LOCALAPPDATA%\Programs\magpie\magpie.exe` | magpie 可执行文件路径，仅 CSV 导出用 |

PowerShell 示例（配置不同端口与网关 Token）：

```powershell
$env:PORT = "5181"
$env:MAGPIE_ADDR = "127.0.0.1:3425"
$env:MAGPIE_KEY = "你的网关Token"
npm start
```

> `MAGPIE_KEY` 是 Magpie 本机网关的访问令牌，只在本机回环地址上使用，不会上传到任何地方。若你在 Magpie 配置里改过 Token，这里要同步修改。
> 看板默认只监听 `127.0.0.1`，局域网内其他设备无法访问。

## CSV 导出说明

导出功能通过调用 `magpie usage --csv <period>` 命令行实现。如果 Magpie 没有安装在默认位置，或导出报错，请设置 `MAGPIE_EXE` 指向实际的 `magpie.exe`。

## 开机自启（Windows，可选）

创建 `启动看板.vbs` 放进「启动」文件夹（`Win+R` → `shell:startup`）：

```vbs
Set ws = CreateObject("Wscript.Shell")
ws.Run "cmd /c cd /d E:\path\to\magpie-dashboard && node server.js", 0, False
```

## 目录结构

```
magpie-dashboard/
├─ server.js         # HTTP 服务：代理 Magpie API、静态文件、CSV 导出
├─ package.json
└─ public/
   ├─ index.html     # 看板页面
   ├─ app.js         # 渲染与交互（原生 JS，无框架）
   └─ style.css
```

## 数据来源

看板只读 Magpie 网关的以下接口：

- `GET /api/hello` — 网关名称、版本（用于页头展示）
- `GET /v1/magpie/usage?period=…` — 用量汇总与时间序列
- `GET /v1/magpie/quotas` — 供应商额度与余额

看板自身不存储任何数据，Magpie 不在线时展示最后一次成功的缓存结果并给出提示。

## 常见问题

**Q：打开看板提示「连接不上 Magpie 网关」？**
先确认 Magpie 正在运行：`magpie status` 或直接看 Magpie 托盘。若网关地址不是默认值，设置 `MAGPIE_ADDR`。

**Q：额度面板是空的？**
只有配置了订阅账号（如 Claude Pro、ChatGPT Plus）或可查询余额的 API Key 才会出现数据；纯按量计费且无法查询余额的 Key 不展示。

**Q：花费金额准确吗？**
费用按 Magpie 记录的各模型单价计算；个别供应商返回不了价格信息时会计入「无法定价」次数，这部分不计入总花费。

## License

[MIT](./LICENSE)
