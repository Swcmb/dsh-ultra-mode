# DeepSeek Harness Apex Mode

Apex（**巅峰模式**）是 DeepSeek Harness 的**虚拟最高推理档位**。它不新增任何官方推理等级，也不引入开关：

$$
\text{Apex} = \text{当前模型最高的官方推理档} + \text{Apex 高预算提示词}
$$

选择 Apex 后，上游收到的仍是该模型**自己的**最高官方档（DeepSeek 上是 `max`，其他模型可能是 `xhigh`/`high`/…），提示词额外注入 Apex 指令。字符串 `apex` 永远不会发给上游。

- 显示名：**Apex**
- 中文名：巅峰模式
- 完整名：DeepSeek Harness Apex Mode
- 内部标识：`apex`
- 定位：高预算 Agent 执行与评估（High-Budget Agent Execution & Evaluation）

## 它做什么

| 用户选择 | 发给上游的推理档 | Apex 提示词 |
| --- | --- | --- |
| 任一官方档（Off / Low / High / Max / …） | 原样透传 | 不注入 |
| **Apex** | 该模型**官方最高档** | 注入 |

档位选择完全复用官方推理等级选择器：Apex 作为一条额外的档位出现在同一个列表里（列表按「由低到高」渲染，所以 Apex 在最底部、也就是最高处）。没有独立开关、没有设置页、没有自定义 chip。

模型若只声明了一个档位（例如只支持 `off`）或不支持推理档，就不会出现 Apex —— 不伪造能力。

## 实现：三个官方扩展点，零客户端代码

插件是**纯 host 半端**（没有 `client.js`）。三处都走 DSH 自己的服务，不碰 DOM、不改核心：

1. **上架档位** —— 包装 `ctx.llm.resolveModelInfo()`：当某个 provider/model 的适配器声明了 ≥2 个真实档位时，在 `reasoning.efforts` 末尾追加 `{ id: 'apex', name: 'Apex' }`。浏览器端模型目录（`buildModelCatalog`）正是由这个调用投影出来的，因此官方选择器会原生渲染它，无需任何 UI 注入。
2. **映射回来** —— 包装 `ctx.llm.prepareCall()`：看到 `reasoningEffort === 'apex'` 时，先用**未包装的** `resolveModelInfo()` 读该模型官方档位，取最后一个（DSH 约定：数组由低到高）替换后再交给原实现。因此后续的 `UNSUPPORTED_REASONING_EFFORT` 校验、`preparedCall` 的配置一致性检查、以及上游请求都是合法官方值。`ctx.llm.stream()` 也做了同样的兜底映射。
3. **注入提示词** —— `ctx.systemPrompt.section()` 的 `text(context)` 读取 `context.modelSelection.reasoningEffort`（每一步的权威选择），只有在等于 `apex` 时返回提示词，其余情况返回空字符串；DSH 的 `renderPrompt` 会丢弃空段。会话未选中、模型无档位、上下文缺失，一律不注入（fail-closed）。

会话状态里保存的仍是 `apex` 这个选择值，所以切走再切回、或换到另一个支持推理的模型，Apex 会保持在选中状态，并按新模型的官方最高档执行——这正是「元档位」的语义。

## 安装

`package.json` 是 bundle 清单，`cordis.patch.yml` 是插件行。把这个目录放进 profile（或用 `link:` 指向它），然后**完整重启 Host**：bundle 只在 Host 启动时纳入加载图，刷新页面不够。

## 验证

```bash
npm test
```

`tests/smoke.mjs` 用假的 Cordis 上下文驱动真实的 `apply()`，覆盖：

- 元数据与服务注入（`llm`、`systemPrompt`）
- 目录投影：DeepSeek 模型得到 `off, low, high, max, apex`；无推理 / 单档位模型不追加
- `prepareCall`：`apex → max`（DeepSeek）、`apex → xhigh`（自定义多档模型）；`off` 与省略值原样透传
- `stream` 兜底映射与透传
- 提示词门控：选中 apex 才返回提示词，其余为空
- 释放后 `resolveModelInfo` 与 section 都恢复原状

真机诊断（可选）：设置环境变量 `DSH_APEX_TRACE=1` 后重启 Host，插件会把关键事件追加到 `$DSH_HOME/dsh-apex-trace.log`：

- `apply` —— 三个方法补丁是否成功、section 名称
- `catalog` —— 某模型被追加了 Apex，附带最终档位 id 列表
- `map` —— `apex` 被映射成了哪个官方档
- `prompt` —— Apex 提示词确实被注入的会话

默认不写日志。

## License

MIT — 见 [LICENSE](LICENSE)。
