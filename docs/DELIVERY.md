# WeBox 交付文档 / Delivery Document

> 企业员工订餐平台 · AI Coding 测试交付
> 全部界面均为英文(符合 PRD 要求),本文档面向评审,使用中英对照。

## 1. 项目概览

| 项 | 内容 |
|---|---|
| 技术栈 | Java 17 · Spring Boot 3.2.5 · MySQL 8.0(独立服务)· 零构建原生 ES Module SPA |
| 访问入口 | http://localhost:8080(API 与前端由同一进程提供) |
| 启动方式 | `scripts/run-backend.sh`(自动拉起 MySQL、加载 `.env`)或 `cd backend && mvn spring-boot:run` |
| 演示账号 | 员工 `employee@webox.com` / `Employee123`;管理员 `admin@webox.com` / `Admin12345` |
| 配套文档 | [README.md](../README.md) · [API.md](API.md) · [ARCHITECTURE.md](ARCHITECTURE.md) |
| 测试 | 31 个单元测试(`mvn test`)+ 42 断言冒烟脚本(`scripts/smoke-test.sh`) |
| AI 原始会话 | `ai-conversations/`(JSONL 原始导出) |

所有截图位于 `docs/screenshots/`,均为真实浏览器对运行中系统的截图(2026-09-17)。

---

## 2. Tier 1(必做功能)

### 2.1 注册 / 登录

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 邮箱格式校验 | ✅ | `02-register-validation.png` | 前后端双重校验 |
| 密码 ≥8 位且含字母+数字 | ✅ | `02-register-validation.png` | 截图中密码 "short" 被拒:`Password must be at least 8 characters.` |
| 密码不明文存储 | ✅ | — | BCrypt 哈希,见 `AuthService` |
| 登录会话 | ✅ | `01-login.png` | 不透明 token 存 DB,`AuthInterceptor` 统一鉴权 |

### 2.2 菜单浏览 / 搜索 / 分类筛选

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 菜单列表(分页/排序) | ✅ | `03-menu.png` | 20 道菜,12/页,4 种排序 |
| 关键词搜索 | ✅ | `04-menu-search.png` | "chicken" → 5 results,服务端搜索(防 LIKE 注入) |
| 多选分类筛选 | ✅ | `05-menu-multi-category-filter.png` | Chinese + Korean 双选 → 6 dishes,facet 计数联动 |
| 个性化推荐标记 | ✅ | `03-menu.png` | "Recommend for me" 开关,匹配偏好标记 ★ |

### 2.3 菜品详情 + 自定义选项

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 必选/可选、单选/多选选项组 | ✅ | `06-dish-options-live-price.png` | "Add-ons" 多选组;单选组(如汉堡主菜)在 Burger 菜单 |
| 加价实时计算 | ✅ | `06-dish-options-live-price.png` | 基价 ¥28.50 + Grilled Chicken ¥6 + Avocado ¥4 = **¥38.50**,含明细行 |
| 库存展示 | ✅ | `03-menu.png` | 卡片显示 "30 left" / "Only 3 left" / "Sold out" |

### 2.4 购物车 / 结算 / 幂等下单 / 订单历史

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 购物车增删改 | ✅ | `08-cart.png` | 行级数量调整、选项明细、合计 |
| 配送日期/餐段选择 | ✅ | `09-checkout-budget-warning.png` | Lunch/Dinner 单选,显示截单时间 |
| 地址簿/历史地址 | ✅ | `09-checkout-budget-warning.png` | "Saved addresses" 下拉,新地址下单后自动记住 |
| 幂等下单 | ✅ | `10-order-success.png` | 三层防护:客户端 `Idempotency-Key` + 服务端预查 + DB 唯一索引;重放返回原单 `replayed:true` |
| 订单历史 | ✅ | `11-order-history.png` | 按时间倒序,状态徽章,7 天种子数据 |
| 订单详情 | ✅ | `12-order-detail.png` | 逐行单价/小计/选项明细 |
| 取消(仅 Pending) | ✅ | `13-cancel-confirm.png` `14-order-cancelled.png` | 确认弹窗 → Cancelled;取消后按钮消失(Only pending orders can be cancelled) |

---

## 3. Tier 2(主要评估点)

### 3.1 过敏原提醒(§4.1)

| 要求 | 状态 | 截图 |
|---|---|---|
| 加购时弹窗警告,不隐藏菜品 | ✅ | `07-allergen-warning.png` |

弹窗文案与 PRD 完全一致:**"This dish contains an allergen you flagged: Egg. Add anyway?"**
菜单中含过敏原菜品始终可见(仅标注 "Allergens: …"),符合"提醒不过滤"要求。

### 3.2 口味偏好 + 推荐(§4.1)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 菜系/辣度/口味偏好设置 | ✅ | `15-preferences.png` | 过敏原、偏好菜系、辣度、口味、预算区间 |
| "Recommend for me" | ✅ | `03-menu.png` | 匹配菜品标 ★ Recommended + "Preferred cuisine" |

### 3.3 预算提醒(§4.1)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 超预算提醒,不阻断下单 | ✅ | `09-checkout-budget-warning.png` | "This order is above your per-meal budget of ¥40.00." 按钮仍可点击,截图后成功下单 |

### 3.4 截单时间 + 自动切换(§4.2)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 午餐 10:00 / 晚餐 15:00 截单 | ✅ | `09-checkout-budget-warning.png` | 表单明示两条截单规则 |
| 过期自动切换最近可订时段 | ✅ | `03-menu.png` `09-checkout-budget-warning.png` | 当前 17:00 已过双截单点 → 标题 "Tomorrow's menu"、结算页 "Next bookable slot: Tomorrow Lunch" |
| 服务端裁决 | ✅ | — | `MealSlotService` 注入 `Clock`(Asia/Shanghai),前端展示与服务端一致 |

### 3.5 同时段唯一订单(§4.2)

| 要求 | 状态 | 说明 |
|---|---|---|
| 同一 user+date+meal 仅一活跃订单 | ✅ | `orders.active_slot` 可空唯一索引;重复下单返回 `ACTIVE_ORDER_EXISTS`(409);UI 按钮变 "View Existing Order"。已通过冒烟测试验证 |

### 3.6 单量上限(§4.2)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 每单最多 5 份 | ✅ | `08-cart.png` | "2 of 5 servings · Max 5 per order" 进度提示;超限服务端返回 `MAX_QUANTITY_EXCEEDED` |

### 3.7 Console 管理端(§4.3)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 菜品 CRUD | ✅ | `19-console-dishes.png` `20-console-dish-edit.png` | 列表 + 搜索/分类/状态筛选 + 编辑抽屉(名称/价格/描述/分类/辣度/过敏原) |
| 图片上传 | ✅ | `20-console-dish-edit.png` | "Upload image"(JPEG/PNG/WebP ≤5MB),UUID 文件名 + 类型校验 |
| 上下架 | ✅ | `19-console-dishes.png` | 行内 "ON MENU" 开关 |
| 每日菜单配置 | ✅ | `21-console-daily-menu.png` | 日期切换 + 勾选 + 每菜份数;有销量的菜品不可删除(防数据丢失) |

---

## 4. Tier 3(加分项)

### 4.1 库存防超卖(§5.1)

| 要求 | 状态 | 说明 |
|---|---|---|
| 扣减不超卖 | ✅ | 守护式原子更新 `UPDATE daily_menu SET sold = sold + n WHERE sold + n <= total`;冒烟测试 3 并发争抢最后 1 份 → 仅 1 单成功 |
| 取消恢复库存 | ✅ | 本次截图过程实证:下单后 Kung Pao 30→29,取消后回 30 |
| 库存前端展示 | ✅ | `03-menu.png`(含 "Only 3 left" 低库存、"Sold out" 售罄态) |

### 4.2 SSE 实时库存(§5.2)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 不刷新实时更新 | ✅ | `17-sse-live-stock.png` | 另一账号(employee4)下单 Kung Pao Chicken 后,浏览器页面**未刷新**即从 30 left 变 29 left("Live" 徽标常亮) |
| 事务安全 | ✅ | — | 事务提交后(`TransactionSynchronization`)才推送;20s 心跳;EventSource token 走 query 参数 |

### 4.3 AI 助手流式推荐(§5.3)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 真实 LLM 流式输出 | ✅ | `16-ai-assistant-deepseek.png` | **DeepSeek `deepseek-chat`** 经 OpenAI 兼容协议流式接入;推荐理由为 LLM 逐 token 生成(如 "A light Greek chicken salad that fits your balanced taste and stays within budget.") |
| 候选安全过滤 | ✅ | 同上 | 候选先过滤:用户过敏原、售罄、近 7 天已点;LLM 只做排序+理由,幻觉 menuId 直接丢弃 |
| 降级兜底 | ✅ | — | 未配 Key/超时自动切本地规则排序,SSE 事件序列一致,UI 明示 |
| 配置 | ✅ | — | `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL` 环境变量,任何 OpenAI 兼容端点可用(当前 `webox/.env` 指向 DeepSeek) |

### 4.4 Console 仪表盘(§5.3)

| 要求 | 状态 | 截图 | 说明 |
|---|---|---|---|
| 今日 KPI | ✅ | `18-console-dashboard.png` | Orders / Revenue / Completed / Pending / Confirmed / Cancelled 六卡 |
| Top-10 菜品条形图 | ✅ | 同上 | "Top 10 dishes · by servings" |
| 午/晚餐占比 | ✅ | 同上 | "Lunch vs Dinner" 双条 + 百分比 |
| 7 天趋势 | ✅ | 同上 | "Last 7 days" 订单+营收双折线 |
| 低库存(≤3)预警 | ✅ | 同上 | "Low stock" 列表:Sushi Deluxe(Sold out)、Tom Yum Soup(Only 2 left) |
| 30s 自动刷新 | ✅ | 同上 | "Auto-refreshing every 30 s" |

---

## 5. 工程质量(交付标准 §7)

| 交付项 | 状态 | 位置 |
|---|---|---|
| 可运行代码 | ✅ | `backend/` + `frontend/`,单进程同时服务 API 与 UI |
| README | ✅ | `README.md`(启动、环境变量、账号) |
| API 文档 | ✅ | `docs/API.md`(全端点、错误码、幂等/截单语义) |
| 架构文档 | ✅ | `docs/ARCHITECTURE.md`(分层、幂等三层、防超卖、SSE、缓存) |
| 单元测试 | ✅ | 31 个:MealSlotService(9)、Money(4)、MenuQuery(6)、RecommendationRanker(7)、PreferenceService(5) |
| 冒烟测试 | ✅ | `scripts/smoke-test.sh`,42 断言,含幂等重放、3 并发抢库存、取消回补 |
| AI 原始会话 | ✅ | `ai-conversations/`(JSONL 原始导出,非摘要) |
| 英文界面 | ✅ | 全部 UI/菜单数据/错误信息/AI 理由均为英文 |
| 独立 MySQL | ✅ | 无 H2/SQLite;金额整型分存储,DECIMAL(10,2) 落库 |
| SQL 注入/XSS 防护 | ✅ | JPQP 绑定参数 + LIKE 转义;前端 `escapeHtml` |

## 6. 验证环境说明

- 截图数据为真实运行态:MySQL 8.0.29(本地 tarball 安装)、JDK 17.0.20.1(Temurin)、Spring Boot 3.2.5
- 期间实际走通完整业务闭环:注册校验 → 登录 → 搜索/筛选 → 详情加价 → 过敏原弹窗 → 购物车 → 超预算提醒 → 下单(WB20260918837366)→ 取消(库存 30→29→30 回补)→ 偏好 → AI 推荐(DeepSeek 流式)→ SSE 无刷新库存变化(30→29)→ Console 三页
- 截图过程中发现并修复 1 个前端缺陷:菜单搜索框 input 事件未同步 `view.q` 导致搜索不生效(`frontend/js/pages/menu.js`),已修复并复验
