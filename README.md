# Wiki Demo 启动脚本

一键启动 Wiki Demo 项目的前端和后端服务器。

## 功能特性

- 同时启动前端（Vite）和后端（FastAPI）服务器
- 支持 Markdown 文件转换为 JSON 格式
- 实时显示两个服务器的日志输出
- 统一的进程管理，Ctrl+C 可同时停止所有服务
- 自动错误处理和进程清理

## 前置要求

### 后端依赖
- Python 3.7+
- 安装所需的 Python 包：
  ```bash
  pip install fastapi uvicorn
  ```

### 前端依赖
- Node.js 16+
- 安装前端依赖：
  ```bash
  cd frontend
  npm install
  ```

## 使用方法

### 基本用法

```bash
python start.py <wiki_root_path> [c]
```

### 参数说明

- `<wiki_root_path>` (必需): Wiki 内容的根目录路径
- `c` (可选): 如果提供此参数，会先将所有 Markdown/wiki结果的json 文件转换为 JSON 格式

**注意：如果wiki结果为json，请以.meta.json结尾**

### 使用示例

#### 1. 直接启动服务器

```bash
python start.py /path/to/wiki
```

这将：
- 使用 `/path/to/wiki/wiki_result` 作为服务器根目录
- 启动后端服务器在 http://localhost:11219
- 启动前端开发服务器（通常在 http://localhost:3000）

#### 2. 转换后启动服务器

```bash
python start.py /path/to/wiki c
```

这将：
1. 扫描 `/path/to/wiki` 目录下的所有 `.md` 文件
2. 将它们转换为 JSON 格式并保存到 `/path/to/wiki/wiki_result` 目录
3. 保持原有的目录结构
4. 启动前端和后端服务器



### 查看结果
**浏览器打开 http://localhost:3000
随意选择一个聊天框输入随意内容，在扩展语句部分也选择随意内容，即可看到目标目录的所有wiki的显示结果**

## 目录结构

转换后的目录结构示例：

```
/path/to/wiki/
├── guide.md                    # 原始 Markdown 文件
├── docs/
│   ├── api.md
│   └── tutorial.md
└── wiki_result/                # 转换后的 JSON 文件目录（服务器使用）
    ├── guide.json
    └── docs/
        ├── api.json
        └── tutorial.json
```

## 服务器地址

启动后可以访问：

- **后端 API**: http://localhost:11219
- **前端界面**: http://localhost:3000 (Vite 默认端口)

## 日志输出

脚本会实时显示两个服务器的日志，格式如下：

```
[Backend] Starting wiki server with root: /path/to/wiki/wiki_result
[Backend] Server will run at http://localhost:11219
[Frontend] VITE v6.2.0  ready in 500 ms
[Frontend] ➜  Local:   http://localhost:3000/
```

## 停止服务器

按 `Ctrl+C` 可以同时停止所有服务器。脚本会自动清理所有进程。

## 清理 JSON 文件

`clear.py` 是一个独立的通用工具，用于清理指定目录下的所有 JSON 文件。

### 基本用法

```bash
python clear.py <target_path> [选项]
```

### 参数说明

- `<target_path>` (必需): 要清理 JSON 文件的目标目录
- `-f, --force`: 强制删除，不需要确认
- `-r, --recursive`: 递归删除子目录中的 JSON 文件（默认启用）
- `--no-recursive`: 仅删除目标目录中的 JSON 文件，不包括子目录

### 使用示例

#### 1. 递归删除所有 JSON 文件（需要确认）

```bash
python clear.py /path/to/directory
```

这将：
- 扫描目标目录及其所有子目录
- 列出所有找到的 JSON 文件
- 要求用户确认后删除
- 自动清理空目录

#### 2. 强制删除（无需确认）

```bash
python clear.py /path/to/directory -f
```

#### 3. 仅删除当前目录的 JSON 文件（不包括子目录）

```bash
python clear.py /path/to/directory --no-recursive
```

#### 4. 清理 wiki_result 目录

```bash
python clear.py /path/to/wiki/wiki_result -f
```

### 清理示例输出

```
Target directory: /path/to/directory
Found 15 JSON file(s)

Files to be deleted:
  - guide.json
  - docs/api.json
  - docs/tutorial.json
  ...

Are you sure you want to delete these files? (yes/no): yes

Deleting JSON files...
  Deleted 1/15: guide.json
  Deleted 2/15: api.json
  ...
  Deleted 15/15: tutorial.json

✓ Successfully deleted 15 JSON file(s)
✓ Removed 3 empty directories
```

## 单独启动脚本

如果需要单独启动后端或前端：

### 仅启动后端

```bash
python demo.py /path/to/wiki [c]
```

### 仅启动前端

```bash
cd frontend
npm run dev
```

## 故障排除

### 端口被占用

如果端口 11219 或 3000 已被占用：

1. 后端端口修改：编辑 [demo.py](demo.py#L77)，修改 `port=11219`
2. 前端端口修改：编辑 `frontend/vite.config.ts`，添加：
   ```typescript
   export default defineConfig({
     server: {
       port: 3001  // 修改为其他端口
     }
   })
   ```

### 转换失败

如果 Markdown 转换失败，检查：
- `markdown_parser.py` 文件是否存在
- Markdown 文件格式是否正确
- 是否有文件权限问题

### 前端启动失败

如果前端无法启动：
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

## 环境变量

后端服务器使用以下环境变量：

- `WIKI_ROOT_PATH`: Wiki 内容的根目录（自动设置为 `<root_path>/wiki_result`）
