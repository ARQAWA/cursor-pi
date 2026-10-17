"""The TUI session of this capture (tui/ directories), driven through ../../scripts/drive-tui.py.

The proxy was started with the response-saving version (./capture-proxy.mjs) on a random port; the process environment was
  DISABLE_AUTOUPDATER=1, HTTPS_PROXY/HTTP_PROXY=http://127.0.0.1:<port>, NODE_TLS_REJECT_UNAUTHORIZED=0, NODE_EXTRA_CA_CERTS=<cert.pem>,
  CLAUDECODE unset, TERM=xterm-256color, 45 rows x 140 columns, a fresh empty directory as the working directory.
Claude Code 2.1.301 was started as `claude --model claude-opus-5-5`.
"""
import importlib.util
import time

spec = importlib.util.spec_from_file_location("drive_tui", "../../scripts/drive-tui.py")
drive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(drive)


def run(workdir, env, claude="claude"):
    tui = drive.Tui(workdir, env, args=(claude, "--model", "claude-opus-5-5"))
    tui.read(8)                    # trust-folder dialog
    tui.send("\x1b[B")             # Down: "Yes, I trust this folder"
    time.sleep(0.5)
    tui.send("\r")
    tui.read(8)

    def say(text, wait):
        tui.send(text)
        time.sleep(0.4)
        tui.send("\r")
        return tui.read(wait)

    say("say ok", 15)
    say("What is 17 plus 25? Answer with the number only.", 12)
    say("Name one primary color of light. One word.", 12)
    say("/compact", 5)             # the slash-command menu is open; Enter runs it
    tui.read(10)                   # compaction takes about 6 s
    say("What was the very first thing I asked you in this session, and what were your answers? Be brief.", 15)
    time.sleep(10)                 # let the helper requests (prompt suggestion) finish
    tui.send("\x03")
    time.sleep(0.5)
    tui.send("\x03")
    time.sleep(1.5)
    tui.kill()
