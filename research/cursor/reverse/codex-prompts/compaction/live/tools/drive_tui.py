#!/usr/bin/env python3
"""Drive the interactive Codex TUI through a pty: turn, turn, /compact, turn, quit.
Synchronises on the proxy log (completed POST /responses entries) plus screen quiet time."""
import os, pty, sys, time, select, json, struct, fcntl, termios, re, signal

HOME = sys.argv[1]; WORK = sys.argv[2]; LOG = sys.argv[3]; OUT = sys.argv[4]
MODEL = sys.argv[5] if len(sys.argv) > 5 else 'gpt-5.6-sol'
CODEX = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'

TURNS = [
    ('turn', 'Pick any one fruit at random and reply with only its name, one word. Do not use tools.'),
    ('turn', 'What is 17 plus 25? Reply with only the number. Do not use tools.'),
    ('compact', '/compact'),
    ('turn', 'Which fruit did you pick earlier? Reply with only its name, one word. Do not use tools.'),
]

pid, fd = pty.fork()
if pid == 0:
    os.chdir(WORK)
    env = dict(os.environ, CODEX_HOME=HOME, TERM='xterm-256color', COLORTERM='truecolor')
    os.execve(CODEX, [CODEX, '-m', MODEL, '--no-alt-screen'], env)

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 170, 0, 0))
raw = bytearray()
last_out = time.time()

def pump(timeout=0.2):
    global last_out
    r, _, _ = select.select([fd], [], [], timeout)
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            return False
        if not data:
            return False
        raw.extend(data); last_out = time.time()
        # answer terminal queries the TUI issues
        if b'\x1b[6n' in data: os.write(fd, b'\x1b[1;1R')
        if b'\x1b[c' in data or b'\x1b[0c' in data: os.write(fd, b'\x1b[?62;c')
        if b'\x1b[?u' in data: os.write(fd, b'\x1b[?0u')
        if b'\x1b]10;?' in data: os.write(fd, b'\x1b]10;rgb:ffff/ffff/ffff\x1b\\')
        if b'\x1b]11;?' in data: os.write(fd, b'\x1b]11;rgb:0000/0000/0000\x1b\\')
    return True

def posts():
    n = 0
    if not os.path.exists(LOG): return 0
    for l in open(LOG):
        try: e = json.loads(l)
        except Exception: continue
        if e.get('method') == 'POST' and 'status' in e: n += 1
    return n

def wait_quiet(q=3.0, maxwait=120):
    t0 = time.time()
    while time.time() - t0 < maxwait:
        pump(0.2)
        if time.time() - last_out > q: return True
    return False

def screen_text():
    t = raw.decode('utf8', 'replace')
    t = re.sub(r'\x1b\[[0-9;?]*[ -/]*[@-~]', '', t)
    t = re.sub(r'\x1b\][^\x07\x1b]*(\x07|\x1b\\)', '', t)
    return t

def send(text, enter=True):
    for ch in text:
        os.write(fd, ch.encode()); pump(0.02)
    time.sleep(0.4)
    if enter: os.write(fd, b'\r')

# startup
wait_quiet(4.0, 40)
print('startup quiet; posts', posts(), flush=True)
for kind, text in TURNS:
    before = posts()
    send(text)
    t0 = time.time()
    while time.time() - t0 < 150:
        pump(0.3)
        if posts() > before and time.time() - last_out > 4: break
    else:
        print('timeout waiting for', kind, flush=True)
    wait_quiet(3.0, 20)
    print(kind, 'done; posts', posts(), flush=True)
    # if a popup swallowed the Enter (slash command), nudge once if nothing happened
    if kind == 'compact' and posts() == before:
        os.write(fd, b'\r'); wait_quiet(5.0, 60); print('nudged; posts', posts(), flush=True)

# quit
send('/quit')
for _ in range(30):
    if not pump(0.3): break
time.sleep(1)
try: os.kill(pid, signal.SIGTERM)
except Exception: pass
open(OUT, 'w').write(screen_text())
print('transcript written', OUT, len(raw), flush=True)
