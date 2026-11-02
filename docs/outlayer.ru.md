# Интеграция OutLayer

Внешний worker поддерживает `TRUST_MODE=outlayer`. На каждую заявку он отправляет только зашифрованный report в закреплённую WASM-версию проекта. Транспорт, проверка результата и исполняемый Rust/WASI runner реализованы и компилируются. Публикация и реальный TEE-прогон не выполнялись.

Длинный HTTPS run отправляется с `async: true`. После ответа API `call_id` записывается в job store до polling, и после рестарта worker опрашивает тот же call без нового платного POST. Временная ошибка polling может повторить чтение того же call. При неизвестном исходе самого POST, ошибке proof или отсутствии сохранённого ID после аварийного завершения job переходит в `failed`; оператор сверяет Executions перед повторной заявкой. Остаётся короткое окно между принятием POST сервисом и записью ID на диск; в этом случае автоматическое восстановление невозможно, но второй платный вызов не отправляется.

## Конфигурация

Нужны `NEAR_NETWORK`, `OUTLAYER_PROJECT` (`owner/project`), `OUTLAYER_VERSION_HASH` (SHA-256 WASM), `OUTLAYER_SIGNER_PUBLIC_KEY` (32 байта Ed25519 в base64) и `OUTLAYER_PAYMENT_KEY`. `ATTESTATION_HASH` должен совпадать с `OUTLAYER_VERSION_HASH`. Остальные настройки RPC, очереди, ingress и settlement используются те же, что в локальном worker.

Средств NEAR на mainnet-кошельке недостаточно для HTTPS-вызовов `OutLayerClient`: этому пути нужен отдельный payment key с доступным балансом на той же сети. Текущий `.env.outlayer` указывает testnet project/key, а локальный `outlayer whoami` — testnet аккаунт `oxfee1dead.testnet`; mainnet payment key и его баланс не подтверждены. Проверять их следует в OutLayer dashboard → Payment keys под `oxfee1dead.near`, затем указать mainnet project/version/key в окружении worker. Секрет payment key не публиковать.

При `TRUST_MODE=outlayer` команды `program-create` и `runner` проверяют `OUTLAYER_PROVISIONING_FILE`: повторно запрашивают исходный execution и chain approval через независимый verifier, сверяют WASM/project/network и публичные ключи с attested output. Create использует эти ключи в bounty. Локальный режим требует `TRUST_MODE=local-development`. Сохранённый offline bundle содержит ответ chain approval, поэтому его проверки недостаточно перед funding: CLI заново читает сеть.

Перед funding и запуском OutLayer worker CLI дополнительно требует `BOUNTY_CONTRACT_CODE_HASH` и на одном finalized snapshot сверяет code hash escrow контракта, отсутствие global contract и пустой список access keys. Значение — `code_hash` в формате base58 из NEAR RPC `view_account` для проверенного deployment; hex checksum из `near account view-account-summary` не подходит без преобразования. Если аккаунт всё ещё имеет ключ обновления, создание bounty останавливается. Эта проверка не исключает уже отправленные receipts и не заменяет аудит собственного кода контракта.

## Контракт данных WASI-программы

API получает `input: {action: "verify", report: {...}, config: {...}}`. `report` содержит `network`, `contract`, `bounty`, `hunter`, `submission`, `report_hash` и `ciphertext` в каноническом base64. В открытом виде атака не передаётся. WASI-программа должна сама проверить hash переданного публичного config по bounty и прочитать finalized commitment, расшифровать report, проверить commitment и исполнить агент/checker внутри TEE.

Результат WASI — JSON `{verdict, signature, disclosure_ciphertext}`. `signature` — Ed25519-подпись `verdictMessage` в base64; `disclosure_ciphertext` — envelope команды в base64. Внешний worker проверяет контекст verdict, правила, верхнюю границу срока, подпись и хеш ciphertext, сохраняет ciphertext и только затем создаёт durable checkpoint очереди перед settlement.

## Проверка доказательства

Клиент запускает установленный `outlayer-verify call` без shell, с явным `--api https://api.outlayer.ai` либо `--api https://testnet-api.outlayer.ai` и сохранёнными stdin/stdout WASM (поля `input` и `output`, без обёрток HTTP API). Требуются успешные authenticity, identity, binding, input и output. Проверяются формат V1 и отсутствие неподписанных identity fields. WASM digest, project и call ID читаются из того же proof bundle, который создал verifier. Второй ответ API для этой проверки не используется. Успешный bundle сохраняется в `.evidence/outlayer`; повторная проверка: `outlayer-verify bundle FILE --offline`.

Проверка внешнего worker не заменяет on-chain attestation policy: контракт всё ещё принимает предоставленный sponsor ключ. Привязка ключа к изменяемому OutLayer project также не делает ключ привязанным к одному бинарнику. Полный путь требует WASI runner, provisioning evidence, закрепления неизменяемой политики ключа и проверки конфиденциального соединения с моделью. Ограничения размера stdout OutLayer нужно учесть при реализации выдачи disclosure.

## Аудит политики проекта

`npm run cli -- outlayer-policy-audit` проверяет на одном finalized snapshot единственную версию с ожидаемым hash и WASI P2 target, owner/project/UUID, пустой список access keys и отсутствие executable local/global code владельца. Аудит включён в `program-create` и `runner` при outlayer mode. Если owner остаётся управляемым, funding через этот CLI отклоняется. Команда ничего не удаляет и не блокирует: подготовка отдельного owner аккаунта и финальное отключение его управления ещё не выполнялись.

Это аудит обычных update paths владельца. Он сохраняет в выводе hash кода provider contract, но не доказывает соответствие этого кода проверенному исходнику. Governance/upgrade authority OutLayer и возможные ранее отправленные owner receipts остаются доверенными условиями. По [официальному исходнику project methods](https://github.com/out-layer/outlayer/blob/aaf60a26855e30bc3318126382903df92dea7d3d/contract/src/projects.rs) изменения версий требуют owner как predecessor; абсолютная неизменяемость key policy этим аудитом не доказана.

## Первичные источники

- [WASI runtime и ограничения](https://app.outlayer.ai/docs/wasi).
- [HTTPS API и version_key](https://app.outlayer.ai/docs/https-api).
- [Signing keys и привязка к проекту или WASM](https://app.outlayer.ai/docs/signing-keys).
- [Независимый verifier](https://github.com/out-layer/outlayer-verify).

Схема proof bundle сверена с локально установленным исходным кодом `outlayer-verify`, commit `90c27d9`. 31.10.2026 установленный verifier без `--api` получил HTTP 410 от устаревшего `api.outlayer.fastnear.com`; с текущим [официальным mainnet API](https://app.outlayer.ai/docs/https-api) и `--api` существующая execution 1214736 дала `PROVEN`. Это проверяет инструмент на чужом существующем job; оплаченный запуск Sealed Bounty по-прежнему не выполнялся. Публичный testnet FastFS URL закреплённой версии `3418bca4…06ab` в тот же день вернул HTTP 502 и на HEAD, и на ограниченный GET; worker не сможет загрузить его с этого адреса. [OutLayer допускает любой HTTPS URL для опубликованного WASM с закреплённым SHA-256](https://app.outlayer.ai/docs/getting-started), поэтому нужен доступный immutable URL и новая on-chain запись проекта/версии до живого прогона.

GitHub репозиторий `OxFEE1DEAD/sealed-bounty` сейчас private и releases отсутствуют; его raw URL не подходит как публичный источник для OutLayer worker. Публиковать нужно только release WASM `tee-runner/target/wasm32-wasip2/release/sealed-bounty-tee-runner.wasm` (SHA-256 `3418bca4326a7eff68da4cce2b30b762a73ea66929ac761486784f11fbc106ab`) на доступном HTTPS хосте. Перед on-chain регистрацией URL проверить полный GET и SHA-256 скачанных байтов. Возможность заменить URL существующей версии с тем же hash не проверена; отдельный новый проект позволит однозначно указать URL, затем потребует нового provisioning и ключей bounty. После регистрации повторить `outlayer-policy-audit` и закрыть owner upgrade paths. Создание публичного хоста, on-chain update и оплаченный run пока не выполнялись.
