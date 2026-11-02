# 年会节目评选系统

年会现场节目评选 Web 系统：手机扫码投票、大屏实时排行、管理后台配置与结果导出。深色红橙主题，无外部 CDN 依赖，Docker 一键部署。

## 功能

- **投票页 `/vote`**：移动端优先，展示节目卡片、实时票数；每人限投 N 票（可配），同一节目不可重复投；浏览器指纹防重复
- **大屏页 `/screen`**：全屏实时排行榜、动态条形图、参与人数；结束投票后烟花/彩带庆祝并公布获奖名单
- **管理后台 `/admin`**：密码登录，节目增删改、拖拽排序、封面上传、投票开始/结束、每人票数与名次奖名额、结果导出 CSV、重置数据

## 技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | Node.js 20 + Express |
| 数据库 | SQLite（WAL，文件持久化） |
| 实时 | WebSocket（`ws`） |
| 前端 | 原生 HTML/CSS/JS，Express 静态托管 |
| 部署 | Docker + docker-compose，单容器 |

## 快速开始（Docker）

```bash
docker compose up --build
```

启动后访问：

| 页面 | 地址 |
| --- | --- |
| 投票页 | http://localhost:3000/vote |
| 大屏页 | http://localhost:3000/screen |
| 管理后台 | http://localhost:3000/admin |

默认管理密码：`admin123`（登录后可在「参数设置」中修改；登录接口同一 IP 15 分钟内最多失败 10 次，管理会话 12 小时过期）

数据持久化在 Docker 命名卷 `gala-data` 中（`votes.db` 与 `uploads/` 封面图）：

```bash
# 备份数据
docker run --rm -v gala-voting_gala-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/gala-backup.tar.gz -C /data .
```

> 想让文件直接出现在宿主机 `./data/` 目录，可把 `docker-compose.yml` 里的卷改回注释掉的绑定挂载；
> Linux 主机上需先 `mkdir -p data && sudo chown -R 1000:1000 data`，否则容器内 node 用户无写权限。

## 本地开发（不使用 Docker）

需要 Node.js 20+：

```bash
npm install
npm start
# 或热重载
npm run dev
```

## 使用流程

1. 打开 **管理后台**，添加节目（可选封面图），拖拽调整顺序
2. 设置「每人可投票数」「名次奖名额」
3. 将 **投票页链接** 分享给观众：大屏左下角自带二维码（按当前访问地址生成，扫码即入），后台也可复制链接
4. 点击「开始投票」
5. 打开 **大屏页** 投影到现场大屏，排行实时刷新
6. 需要结束时点击「结束投票」——大屏触发庆祝动画并展示奖项：
   - 前 N 名 → 名次奖（第一、二、三…名）
   - 其余节目 → 优秀节目奖
7. 在管理后台「评选结果」中导出 CSV

## API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/programs` | 节目列表（含票数） |
| GET | `/api/stats` | 总投票人数、投票状态 |
| GET | `/api/results` | 排名与奖项（结束后可用） |
| GET | `/api/qr` | 投票页二维码 PNG |
| GET | `/api/my-votes?fingerprint=` | 我的已投节目 |
| POST | `/api/vote` | 提交投票 `{ fingerprint, programIds[] }` |
| POST | `/api/admin/login` | 登录 `{ password }` → `{ token }` |
| * | `/api/admin/*` | 管理接口（需 `Authorization: Bearer <token>`） |

WebSocket：`ws://<host>/ws`，服务端广播 `{ type: 'update' | 'started' | 'ended' | 'reset', data }`（票数变化等高频更新按 250ms 合流，`reset` 用于重置后清理各端本地状态）。

## 防重复投票

1. 前端采集浏览器指纹（canvas + UA + screen 等特征哈希 + 每台设备一份 localStorage 随机盐，避免同型号手机特征撞车）
2. 后端校验：投票是否开启、是否达票数上限、是否重复投同一节目；数据库对 `(program_id, voter_fingerprint)` 建唯一索引兜底
3. 成功后写入 `votes` / `vote_records`

> 指纹是尽力而为的去重手段，无法完全防止同一人多设备投票，适用于年会现场信任度较高的场景。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录 |
| `DB_PATH` | `$DATA_DIR/votes.db` | SQLite 路径 |
| `UPLOAD_DIR` | `$DATA_DIR/uploads` | 上传目录 |

## 验收清单

- [x] `docker compose up` 后三个页面均可访问
- [x] 手机端可投票，同一节目不可重复，超出票数上限被拦截
- [x] 大屏票数/排名实时更新，总投票人数正确
- [x] 管理后台节目增删改、拖拽排序、封面上传、开关投票、配置票数与名额、导出 CSV、重置
- [x] 结束投票后大屏庆祝动画并显示获奖名单
- [x] SQLite 持久化，刷新不丢数据
- [x] 深色红橙为主、绿色点缀的主题与流畅动画
