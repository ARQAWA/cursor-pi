# HistoryOther working checkpoint (not final)

Partition: 270 sessions; all parsed (0 parse errors, 67224 records, 1153 user message records). superbot-test-Gd9Ld3YH = 151 sessions/155 user msgs = synthetic benchmark/tool probes (verify). Non-test = 119 sessions / 998 user msgs (some synthetic probes inside: S1,S13-18,S34-36,S43-46,S49-50,S52-54,S56,S64-70,S72,S79-92 etc).
In eval: globalThis.sess (all), globalThis.rest (119 non-test, sorted by created), dump(i0,i1,max), ctx(si,ln,before,after,maxT). rest index S<n> used below.
User msg flag steering:true = typed while agent running (133 msgs). Titles in rest list.

## Confirmed episodes so far (S idx, line)
- S0 L88 "понимаешь, о чём я?" -> agent edited prompt (L92) + ran reviewer gate; owner L126 "вообще я тебе не говорил с ними ничего делать. ты не должен был сейчас никак менять вообще ничего. мы это пока только обсуждали" (discussion/clarifying question treated as order). Also S0 L48 "что-то ты, блядь, простыню какую-то написал. давай кратенько", S3 L29 "что за простыня? кратко распиши".
- S4 L114 agent "Данных достаточно. Пишу отчёт." -> owner steer L115 "погоди, блядь, какой ты отчет там пишешь нахуй?" (unrequested artifact); L125 "транслитом больше не пиши"; S5 L132 "перестань транслитом писать. мы уже это правило удалили".
- S5 L928/932 + S6 L472/476: declarative sentence was a check-question ("это, блядь, был вопрос нахуй?", "нет, это был вопрос, лол"); agent replied with acknowledgment + extra rollback info; later answered with verified/not verified (S6 L478 accepted).
- S6 L1045/1061/1103/1168: Claude quota leaked via subagent without explicit model (agent L1046 admits `scout` default model -> Anthropic 429). Owner rule: GPT main -> only GPT subagents; Claude main -> Claude subs; matrix (Luna medium/high, Sol low/medium; Sonnet low/med/high, Opus low).
- S8 L162 (2026-10-05) key: "самое главное — это скорость и получение конечного результата ... минимальное количество действий — это ... именно про конечный результат. что мы не пишем дохуя кода ненужного"; origin: GPT-5.6 Sol overengineering (tests, stands, 50 fixtures, benchmarks). S8 L164 low TPS: each tool call big latency. S8 L186/L217 cursor-like wide greps, globs first. S8 L420 owner flips to allow running existing checks ("переобуваюсь в воздухе"), prior answer 'Keep the ban' (L417).
- S8 L639/657/675: owner pings "ты продолжаешь выполнение плана?"/"какой сейчас статус выполнения плана? я не вижу туду" / "погоди, стой. ты сейчас выполняешь наш план.md" -> agent confirmed (L677) plan file lives in local session folder; owner L679 "продолжай работу по плану, не отвлекайся".
- S9 L85 "Нахуй ты фаст меряешь? я хотел что бы ты замерял мин обычный не фаст через омп"; L115 "какой нахуй курсор? cloud code, anthropic".
- S10 L191/194 "нет, не я запускай, а ты запускай"/"ты не sub-агента запускаешься... давай не тупи"; L261 "суперминимальную микронаноправку... и больше ничего, кроме этого, никаких правок делать нельзя".
- S11 L54 "почему ты закрыл задачу, но ты её не протестировал?"; L70 "мы проверяем compaction... тебе нужно заполнить контекстное окно... ты что тупишь-то".
- S5 L1982 "всё. кроме этого больше мне ничего не надо ... остальное out of scope. нужно по золотому стандарту всё сделать"; S5 L2191/2194 "ты подзавис немножечко, нет?" (agent in plan mode, long planning, L2195 admits 'подготовка затянулась').
- S38/S73 (superbot) L117/L125 wrong repo ("какой нахуй my mp harness? ... вся работа проходит исключительно и только в нем"); S75 L1062 "я ж тебе другую поставил задачу изначально"; L5235 "ты уже второй раз на паузу ставишься"; L6531 "уже полтора часа прошло, я не вижу никакого результата"; S75 L7393 approve policy: approve only if deviation from plan; otherwise release/close.
- S59 L1434 "ОМП пересобирать — это крит, это запрет"; S71 L337 "Я же сказал, чтобы он все сводки делал на extra high" (lost agreement).
- S113 L8 subagent refusal "Агент отказывается запускать специальных саб-агентов..."; L462 "доёбывает меня как владельца постоянными планированиями каждого пука... подтверждения Go"; S113 L2546/L2794 + S115 L10/L580 + S118: "Мне нужна более глубокая версия этой задачи, а не более масштабная." macro (4-point rewrite prompt) recurring.
- S76 L830 haiku delegate for computer/browser use; L952 "стоп"; S111 L200 "можешь поднять 40 sub-агентов, 50. Ускоряй процесс".
- S30 L458 reviewers each separate "никаких не должно быть цепочек ревьюеров".
- S42 L49 "почему ты постоянно так спамишь дохуя текста в ответе?"
- Secrets present in S97 (sentry token) and S98 (Soniox key): DO NOT quote.
