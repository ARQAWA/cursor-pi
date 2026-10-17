# AskQuestion  (S4, first seen in request 59, call_id call_b888c5ad304e4ccaadd71073785cc8de, item type function_call)

## Arguments

```
{"questions":[{"id":"scope","prompt":"Что должно происходить после исчерпания лимита повторов для аккаунта? Сейчас есть полные проходы по аккаунтам и отдельные retry-проходы.","options":[{"id":"cycle","label":"Прекратить retry до следующего полного прохода; в нём начать новый цикл (рекомендуется)"},{"id":"success","label":"Прекратить retry, но в полных проходах пробовать снова; сбросить счётчик только после успеха"},{"id":"manual","label":"Больше не обрабатывать аккаунт до ручного сброса"}]},{"id":"policy","prompt":"Какие параметры повторов заложить в план? Лимит ниже означает дополнительные попытки после первоначальной.","options":[{"id":"default","label":"5 повторов: 30, 60, 120, 240, 480 секунд; потолок задержки 15 минут; параметры настраиваемые (рекомендуется)"},{"id":"custom","label":"Укажу свои значения"}]}]}
```

## Output

```
[{"text": "User questions responses:\nQuestion scope: Selected option(s) success\nQuestion policy: Selected option(s) default", "type": "input_text"}]
```
