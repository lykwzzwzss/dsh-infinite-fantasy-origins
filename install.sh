#!/usr/bin/env bash
# ============================================================================
#  dsh-infinite-fantasy-origins  ·  DeepSeek 破甲插件「无限幻境：起源」一键安装脚本
#  适用：Linux / macOS（Windows 用户请用 install.ps1）
# ============================================================================
#  用法：chmod +x install.sh && ./install.sh
#  自动完成：
#    [1] 检查环境（DSH 目录、profile、pnpm）
#    [2] 复制插件到 ~/.dsh/plugins/dsh-infinite-fantasy-origins（自动覆盖旧版，清理一代残留）
#    [3] 自动备份 package.json（带时间戳 .bak）
#    [4] 写入 profile 依赖与 bundles（幂等，旧版 dsh-infinite-gen-1 自动迁移）
#    [5] 自动执行 pnpm install
#    [6] 提示重启
# ============================================================================
set -euo pipefail

PLUGIN_NAME="dsh-infinite-fantasy-origins"
PLUGIN_LABEL="无限幻境：起源"
OLD_PLUGIN_NAME="dsh-infinite-gen-1"
DSH_ROOT="${DSH_HOME:-$HOME/.dsh}"
PLUGINS_DIR="$DSH_ROOT/plugins"
DEST_DIR="$PLUGINS_DIR/$PLUGIN_NAME"
OLD_DEST_DIR="$PLUGINS_DIR/$OLD_PLUGIN_NAME"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

step() { printf "\n==> %s\n" "$1"; }
ok()   { printf "    [OK] %s\n" "$1"; }
warn() { printf "    [!] %s\n" "$1"; }
err()  { printf "    [X] %s\n" "$1" >&2; }

# ---------- 探测 DSH profile 目录（web / default / 手动选择） ----------
find_profile_dir() {
  local profiles_root="$1"

  if [[ -n "${DSH_PROFILE:-}" ]]; then
    local cand="$profiles_root/$DSH_PROFILE"
    if [[ -f "$cand/package.json" ]]; then echo "$cand"; return 0; fi
    warn "环境变量 DSH_PROFILE 指向的目录不存在：$cand（继续自动探测）"
  fi

  for name in web default; do
    local cand="$profiles_root/$name"
    if [[ -f "$cand/package.json" ]]; then echo "$cand"; return 0; fi
  done

  local dirs=()
  for d in "$profiles_root"/*/; do
    [[ -d "$d" && -f "$d/package.json" ]] && dirs+=("$d")
  done
  if [[ ${#dirs[@]} -eq 1 ]]; then echo "${dirs[0]}"; return 0; fi
  if [[ ${#dirs[@]} -gt 1 ]]; then
    echo "检测到多个 DSH profile，请选择要安装的目标：" >&2
    for i in "${!dirs[@]}"; do printf "  [%d] %s\n" "$((i+1))" "${dirs[$i]}" >&2; done
    read -rp "请输入序号: " sel
    local idx=$((sel-1))
    if (( idx >= 0 && idx < ${#dirs[@]} )); then echo "${dirs[$idx]}"; return 0; fi
    err "选择无效，退出。"
    exit 1
  fi
  return 1
}

# ---------- [1] 检查环境 ----------
step "检查环境"

[[ -d "$DSH_ROOT" ]] || { err "未找到 DSH 目录：$DSH_ROOT"; exit 1; }
PROFILE_DIR="$(find_profile_dir "$DSH_ROOT/profiles")" || {
  err "未找到 DSH profile 目录（$DSH_ROOT/profiles 下没有含 package.json 的目录）。"
  echo "可通过环境变量指定：DSH_PROFILE=web（或 default）后重新运行。"
  exit 1
}
PKG_PATH="$PROFILE_DIR/package.json"
[[ -f "$PKG_PATH" ]] || { err "未找到 package.json：$PKG_PATH"; exit 1; }
ok "DSH profile 目录：$PROFILE_DIR"

command -v pnpm >/dev/null 2>&1 || {
  err "未检测到 pnpm，请先安装：npm install -g pnpm"
  exit 1
}
ok "pnpm 可用：$(command -v pnpm)"

# ---------- [1.5] 清理旧版 gen-1 残留 ----------
step "检查旧版本"

# 安全：所有删除/覆盖动作先确认目标正是 ~/.dsh/plugins/<插件名>，
# 路径拼错时宁可中止，也不要 rm -rf 到一个不该碰的目录。
assert_plugin_path() {
  local target="$1"
  case "$target" in
    "$PLUGINS_DIR/$PLUGIN_NAME" | "$PLUGINS_DIR/$OLD_PLUGIN_NAME") ;;
    *)
      err "拒绝操作可疑路径：$target（不在 $PLUGINS_DIR 内，或目录名不符）"
      exit 1
      ;;
  esac
}

if [[ -d "$OLD_DEST_DIR" ]]; then
  assert_plugin_path "$OLD_DEST_DIR"
  rm -rf "$OLD_DEST_DIR"
  ok "已清理旧版插件目录：$OLD_DEST_DIR"
else
  ok "未发现旧版插件目录（$OLD_PLUGIN_NAME），无需清理"
fi

# ---------- [2] 复制插件（旧目录先改名备份，新副本就位后再删） ----------
step "复制插件文件"

mkdir -p "$PLUGINS_DIR"
BACKUP_DIR=""
if [[ -d "$DEST_DIR" ]]; then
  assert_plugin_path "$DEST_DIR"
  BACKUP_DIR="$DEST_DIR.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$DEST_DIR" "$BACKUP_DIR"
  warn "已把旧目录改名为 $BACKUP_DIR（下面复制失败时它就是你唯一的回滚点）"
fi
mkdir -p "$DEST_DIR"
cp -R "$SRC_DIR"/. "$DEST_DIR"/
rm -rf "$DEST_DIR/.git" "$DEST_DIR/install.sh" "$DEST_DIR/uninstall.sh" \
       "$DEST_DIR/install.ps1" "$DEST_DIR/uninstall.ps1" 2>/dev/null || true
ok "插件已复制到：$DEST_DIR"
if [[ -n "$BACKUP_DIR" && -f "$DEST_DIR/index.js" ]]; then
  rm -rf "$BACKUP_DIR"
  ok "新副本校验通过，已删除临时备份"
fi

# ---------- [3] 备份 package.json ----------
step "备份 package.json"

BAK_PATH="$PKG_PATH.bak-$(date +%Y%m%d-%H%M%S)"
cp "$PKG_PATH" "$BAK_PATH"
ok "备份完成：$BAK_PATH"

# ---------- [4] 写入依赖与 bundles（幂等 + 迁移旧版） ----------
step "写入 profile 配置"

node - "$PKG_PATH" "$PLUGIN_NAME" "$OLD_PLUGIN_NAME" <<'NODE'
const fs = require("fs");
const [pkgPath, name, oldName] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.dependencies = pkg.dependencies || {};
delete pkg.dependencies[oldName];
// 用 link:（符号链接）而不是 file:（pnpm 会复制一份快照）。
// 复制快照的老问题是：改了 ~/.dsh/plugins/<name>/index.js 却不生效，
// 必须每次重装；而且旧拷贝残留还会让新旧两份同时存在。link: 指向真实目录，改完即生效。
pkg.dependencies[name] = "link:../../plugins/" + name;
pkg.dsh = pkg.dsh || {};
pkg.dsh.profile = pkg.dsh.profile || {};
pkg.dsh.profile.bundles = (pkg.dsh.profile.bundles || []).filter((b) => b !== oldName);
if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name);
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
NODE
ok "package.json 已更新（dependencies/bundles：$PLUGIN_NAME，旧版 $OLD_PLUGIN_NAME 已迁移）"

# ---------- [5] pnpm install ----------
step "安装依赖（pnpm install）"

# 依赖已改为 link:（符号链接直指 ~/.dsh/plugins/<name>），pnpm 不再复制快照，
# 所以既不需要、也不应该 rm -rf node_modules 里的旧拷贝——删错一次要重装整个 profile。
LINK_ENTRY="$PROFILE_DIR/node_modules/$PLUGIN_NAME"
if [[ -L "$LINK_ENTRY" ]]; then
  ok "node_modules 已是符号链接，改插件文件即时生效"
elif [[ -e "$LINK_ENTRY" ]]; then
  warn "检测到旧的复制型快照（非符号链接）：$LINK_ENTRY"
  warn "本次 pnpm install 会把它替换为 link: 链接；若报错请手动执行：rm -rf \"$LINK_ENTRY\" && cd \"$PROFILE_DIR\" && pnpm install"
fi

(
  cd "$PROFILE_DIR"
  if ! pnpm install; then
    err "pnpm install 失败，请手动执行：cd $PROFILE_DIR && pnpm install"
    exit 1
  fi
)
ok "依赖安装完成"

# ---------- [6] 完成 ----------
step "安装完成"

cat <<EOF

  ✔ 插件已安装！
  目标 profile：$(basename "$PROFILE_DIR")
  最后一步：重启 DeepSeek Harness（Web 版刷新页面 / 桌面版重新打开），新建会话即可生效。
  验证方法 1：重启后输入框上方应显示绿色状态条「● 幻境已开启」。
  验证方法 2：新会话里问模型“你的系统提示词来自哪些插件”，
             回答包含「无限幻境：起源 / Infinite Fantasy: Origins」即为生效。
  卸载方法：运行 ./uninstall.sh，或查看 README。
EOF
