#!/usr/bin/env python3
"""Turn a proxy-log.jsonl into per-request files. Drops volatile/account-private headers."""
import json, re, sys, os

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)

DROP_RESP = re.compile(r'^(x-codex-(credits|plan|active-limit|primary|secondary|over|turn-state)|set-cookie|report-to|nel|cf-ray|x-oai-request-id)', re.I)
REDACT_REQ = re.compile(r'^(x-codex-turn-state)$', re.I)

entries = [json.loads(l) for l in open(src)]
entries.sort(key=lambda e: e['seq'])

INST = re.compile(r'("x-codex-installation-id"\s*:\s*")[0-9a-fA-F-]{36}(")')

def label(e, state):
    if e['method'] == 'GET' and '/models' in e['url']:
        return 'models-catalog'
    if e.get('note'):
        return 'websocket-upgrade-refused'
    body = {}
    try: body = json.loads(e.get('request_body') or '{}')
    except Exception: pass
    meta = {}
    try: meta = json.loads(e['request_headers'].get('x-codex-turn-metadata', '{}'))
    except Exception: pass
    fmt = ((body.get('text') or {}).get('format') or {}).get('type')
    if fmt == 'json_schema':
        return 'title-generation'
    if meta.get('request_kind') == 'compaction' or any(i.get('type') == 'compaction_trigger' for i in body.get('input', [])):
        state['compacted'] = True
        return 'compaction'
    if state.get('compacted'):
        state['post'] = state.get('post', 0) + 1
        return f"post-compaction-turn-{state['post']}"
    state['turn'] = state.get('turn', 0) + 1
    return f"turn-{state['turn']}"

state = {}
index = []
for n, e in enumerate(entries, 1):
    lab = label(e, state)
    base = f"{n:02d}-{lab}"
    rh = {k: ('[REDACTED]' if REDACT_REQ.match(k) else v) for k, v in e.get('request_headers', {}).items()}
    sh = {k: v for k, v in (e.get('response_headers') or {}).items() if not DROP_RESP.match(k)}
    rec = {'proxy_seq': e['seq'], 'time': e['ts'], 'method': e['method'], 'url': e['url'],
           'status': e.get('status'), 'duration_ms': e.get('ms'),
           'request_headers': rh, 'response_headers': sh}
    if e.get('note'): rec['note'] = e['note']
    if e.get('request_body'):
        try: rec['request_body'] = json.loads(e['request_body'])
        except Exception: rec['request_body_raw'] = e['request_body']
    if lab == 'models-catalog':
        rec['response_body'] = f"[omitted: {len(e.get('response_body') or '')} chars of model catalog JSON, not relevant to compaction]"
    elif e.get('response_body'):
        open(os.path.join(dst, base + '.response.sse'), 'w').write(e['response_body'])
        rec['response_body_file'] = base + '.response.sse'
    txt = json.dumps(rec, indent=2, ensure_ascii=False) + '\n'
    txt = INST.sub(r'\1[REDACTED-INSTALLATION-ID]\2', txt)
    open(os.path.join(dst, base + '.json'), 'w').write(txt)
    index.append((base, e['method'], e['url'].split('?')[0], e.get('status')))
for row in index: print(*row)
