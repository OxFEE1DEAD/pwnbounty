# Интеграция OutLayer

Внешний worker поддерживает `TRUST_MODE=outlayer`. На каждую заявку он отправляет только зашифрованный report в закреплённую WASM-версию проекта. Транспорт, проверка результата и исполняемый Rust/WASI runner реализованы и компилируются. Публикация и реальный TEE-прогон не выполнялись.

## Конфигурация

Нужны `NEAR_NETWORK`, `OUTLAYER_PROJECT` (`owner/project`), `OUTLAYER_VERSION_HASH` (SHA-256 WASM), `OUTLAYER_SIGNER_PUBLIC_KEY` (32 байта Ed25519 в base64) и `OUTLAYER_PAYMENT_KEY`. `ATTESTATION_HASH` должен совпадать с `OUTLAYER_VERSION_HASH`. Остальные настройки RPC, очереди, ingress и settlement используются те же, что в локальном worker.

При `TRUST_MODE=outlayer` команды `program-create` и `runner` проверяют `OUTLAYER_PROVISIONING_FILE`: повторно запрашивают исходный execution и chain approval через независимый verifier, сверяют WASM/project/network и публичные ключи с attested output. Create использует эти ключи в bounty. Локальный режим требует `TRUST_MODE=local-development`. Сохранённый offline bundle содержит ответ chain approval, поэтому его проверки недостаточно перед funding: CLI заново читает сеть.

## Контракт данных WASI-программы

API получает `input: {action: "verify", report: {...}, config: {...}}`. `report` содержит `network`, `contract`, `bounty`, `hunter`, `submission`, `report_hash` и `ciphertext` в каноническом base64. В открытом виде атака не передаётся. WASI-программа должна сама проверить hash переданного публичного config по bounty и прочитать finalized commitment, расшифровать report, проверить commitment и исполнить агент/checker внутри TEE.

Результат WASI — JSON `{verdict, signature, disclosure_ciphertext}`. `signature` — Ed25519-подпись `verdictMessage` в base64; `disclosure_ciphertext` — envelope команды в base64. Внешний worker проверяет контекст verdict, правила, верхнюю границу срока, подпись и хеш ciphertext, сохраняет ciphertext и только затем создаёт durable checkpoint очереди перед settlement.

## Проверка доказательства

Клиент запускает установленный `outlayer-verify call` без shell, с сохранёнными stdin/stdout WASM (поля `input` и `output`, без обёрток HTTP API). Требуются успешные authenticity, identity, binding, input и output. Проверяются формат V1 и отсутствие неподписанных identity fields. WASM digest, project и call ID читаются из того же proof bundle, который создал verifier. Второй ответ API для этой проверки не используется. Успешный bundle сохраняется в `.evidence/outlayer`; повторная проверка: `outlayer-verify bundle FILE --offline`.

Проверка внешнего worker не заменяет on-chain attestation policy: контракт всё ещё принимает предоставленный sponsor ключ. Привязка ключа к изменяемому OutLayer project также не делает ключ привязанным к одному бинарнику. Полный путь требует WASI runner, provisioning evidence, закрепления неизменяемой политики ключа и проверки конфиденциального соединения с моделью. Ограничения размера stdout OutLayer нужно учесть при реализации выдачи disclosure.

## Аудит политики проекта

`npm run cli -- outlayer-policy-audit` проверяет на одном finalized snapshot единственную версию с ожидаемым hash и WASI P2 target, owner/project/UUID, пустой список access keys и отсутствие executable local/global code владельца. Аудит включён в `program-create` и `runner` при outlayer mode. Если owner остаётся управляемым, funding через этот CLI отклоняется. Команда ничего не удаляет и не блокирует: подготовка отдельного owner аккаунта и финальное отключение его управления ещё не выполнялись.

Это аудит обычных update paths владельца. Он сохраняет в выводе hash кода provider contract, но не доказывает соответствие этого кода проверенному исходнику. Governance/upgrade authority OutLayer и возможные ранее отправленные owner receipts остаются доверенными условиями. По [официальному исходнику project methods](https://github.com/out-layer/outlayer/blob/aaf60a26855e30bc3318126382903df92dea7d3d/contract/src/projects.rs) изменения версий требуют owner как predecessor; абсолютная неизменяемость key policy этим аудитом не доказана.

## Первичные источники

- [WASI runtime и ограничения](https://app.outlayer.ai/docs/wasi).
- [HTTPS API и version_key](https://app.outlayer.ai/docs/https-api).
- [Signing keys и привязка к проекту или WASM](https://app.outlayer.ai/docs/signing-keys).
- [Независимый verifier](https://github.com/out-layer/outlayer-verify).

Схема proof bundle сверена с локально установленным исходным кодом `outlayer-verify`, commit `90c27d9`. Живой оплаченный вызов не выполнялся.
