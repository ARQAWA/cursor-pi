# ReadFile  (S3, first seen in request 44, call_id call_4fee44badec3461f8b135a607905be29, item type function_call)

## Arguments

```
{"path":"/Users/arkadijcukavin/PycharmProjects/superbot-test-Gd9Ld3YH/docker-compose.app.yml","offset":45,"limit":40}
```

## Output

```
... 44 lines not shown ...
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=16m
    cap_drop:
      - ALL
    security_opt:
    50|      - no-new-privileges:true
    stop_grace_period: 30s
    volumes:
      - injector_runtime:/run/superbot
    networks:
      - infra

  wallet_sync:
    logging: *runtime-logging
    image: ${SUPERBOT_APP_IMAGE:?SUPERBOT_APP_IMAGE is required}
    60|    command: ["/app/wallet-sync"]
    working_dir: /app
    environment:
      SUPERBOT_APP_IMAGE_ID: ${SUPERBOT_APP_IMAGE_ID:?SUPERBOT_APP_IMAGE_ID is required}
    init: true
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp:rw,noexec,nosuid,size=16m
    cap_drop:
    70|      - ALL
    security_opt:
      - no-new-privileges:true
    stop_grace_period: 30s
    volumes:
      - wallet_runtime:/run/superbot
    networks:
      - infra
      - steam_auth

    80|  currency_sync:
    logging: *runtime-logging
    image: ${SUPERBOT_APP_IMAGE:?SUPERBOT_APP_IMAGE is required}
    command: ["/app/currency-sync"]
    working_dir: /app
... 157 lines not shown ...
```
