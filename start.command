#!/bin/bash
#
# Claude Crew · Mac double-click launcher
# Starts the local dashboard, opens it in your browser, and stays in the
# foreground so closing this window stops the server.
#

# cd to the directory this script lives in (works even when double-clicked)
cd "$(dirname "$0")" || exit 1

# Make sure Node.js is installed
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  ❌  找不到 Node.js / Node.js not found"
  echo ""
  echo "  Claude Crew 需要 Node.js >= 18。"
  echo "  Claude Crew needs Node.js >= 18."
  echo ""
  echo "  请前往 https://nodejs.org 安装后重试。"
  echo "  Please install it from https://nodejs.org and try again."
  echo ""
  read -r -p "  按回车键关闭 / Press Enter to close…" _
  exit 1
fi

PORT="${PORT:-4242}"

echo ""
echo "  🚀  Claude Crew 启动中… / starting up…"
echo "  你的小 Claude 们都在忙啥 → http://localhost:${PORT}"
echo "  关闭这个窗口即可停止服务 / Close this window to stop the server."
echo ""

# Start the server in the background…
node server.js &
SERVER_PID=$!

# …give it a moment to bind the port…
sleep 1

# …open the dashboard…
open "http://localhost:${PORT}"

# …then bring the server to the foreground so the window stays alive.
# Closing the terminal window will take the server down with it.
wait "$SERVER_PID"
