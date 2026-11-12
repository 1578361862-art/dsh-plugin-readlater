#!/bin/bash
# 滴灌导入：小红书按 IP 限流，一次性跑完不通。
# 每轮跑一次导入器（撞墙即停），然后按"冷却还剩多久"决定睡多久，而不是死等。
cd "$(dirname "$0")/.." || exit 1
M="$HOME/Data/readlater/import/inread-manifest.json"
STATE="$HOME/Data/readlater/state/throttle-xhs.json"
LOG="$HOME/Data/readlater/import/drip.log"
prev=-1
stall=0

for i in $(seq 1 12); do
  cur=$(node scripts/import-inread.mjs --manifest "$M" --status | awk '/已导入\/已跳过/{print $2}')
  echo "[$(date '+%H:%M')] 第 $i 轮 · 已处理 ${cur:-0}" | tee -a "$LOG"
  if [ "${cur:-0}" -ge 249 ]; then echo "全部处理完" | tee -a "$LOG"; break; fi

  if [ "$cur" = "$prev" ]; then stall=$((stall+1)); else stall=0; fi
  prev=$cur
  if [ "$stall" -ge 5 ]; then echo "连续 5 轮无进展，退出" | tee -a "$LOG"; break; fi

  node scripts/import-inread.mjs --manifest "$M" --gap 8000 2>&1 | grep -E "^✓|^⏸|^处理" | tee -a "$LOG"

  # 冷却还剩多少秒；没有冷却就等 5 分钟再试
  wait_s=$(node -e '
    try {
      const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const left = Math.ceil((s.cooldownUntil - Date.now()) / 1000) + 45;
      console.log(left > 0 ? left : 300);
    } catch { console.log(300) }
  ' "$STATE" 2>/dev/null)
  [ -z "$wait_s" ] && wait_s=300
  [ "$wait_s" -lt 240 ] && wait_s=240
  [ "$wait_s" -gt 1500 ] && wait_s=1500
  echo "   等待 ${wait_s}s 后再试" | tee -a "$LOG"
  sleep "$wait_s"
done
