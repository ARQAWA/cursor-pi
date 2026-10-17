"""Helper used to drive the interactive Claude Code TUI through a pty while capture-proxy.mjs records its requests.

This is the class that was used, saved for reference. The session itself was driven step by step by hand:
  1. start the TUI, press Enter on the theme and security-notes screens,
  2. choose "Yes, I trust this folder" (Down, Enter) for the empty working directory,
  3. type `say ok` and Enter,
  4. type the subagent prompt (see README.md) and Enter,
  5. wait until the subagents finish, then Ctrl-C and kill the process.

Environment given to the Claude Code process (the proxy listened on 127.0.0.1:18438):
  HTTPS_PROXY=http://127.0.0.1:18438  HTTP_PROXY=http://127.0.0.1:18438
  NODE_TLS_REJECT_UNAUTHORIZED=0      NODE_EXTRA_CA_CERTS=<self-signed cert used by the proxy>
  CLAUDECODE unset, TERM=xterm-256color, terminal size 45 rows x 140 columns.
"""

import fcntl
import os
import pty
import re
import select
import signal
import struct
import termios
import time

ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Za-z0-9]|\x1b[=>]")


class Tui:
    def __init__(self, cwd, env_extra, args=("claude",)):
        env = {k: v for k, v in os.environ.items() if k != "CLAUDECODE"}
        env.update(env_extra)
        env["TERM"] = "xterm-256color"
        pid, fd = pty.fork()
        if pid == 0:
            os.chdir(cwd)
            os.execvpe(args[0], list(args), env)
        self.pid, self.fd = pid, fd
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 45, 140, 0, 0))
        self.buf = ""

    def read(self, secs):
        """Collect output for `secs` seconds and return it with ANSI escapes removed."""
        end = time.time() + secs
        out = b""
        while time.time() < end:
            ready, _, _ = select.select([self.fd], [], [], 0.2)
            if ready:
                try:
                    data = os.read(self.fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                out += data
        text = ANSI.sub("", out.decode("utf8", "replace"))
        self.buf += text
        return text

    def send(self, s):
        os.write(self.fd, s.encode())

    def kill(self):
        try:
            os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
