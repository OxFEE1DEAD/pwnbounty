# Состояние реализации

Обновлено: 31 октября 2026. Тесты не добавлялись и не запускались по просьбе пользователя. Сборки и проверка типов выполнялись. Проценты — приблизительная оценка покрытия кода, не безопасности и не расход usage.

## Сделанные блоки

| Шаг | Реализация | Строк кода | Проверка |
|---|---|---:|---|
| 1 | Протокол, commitment, шифрование, локальный enclave, ledger/agent/checker | 250+ | TypeScript |
| 2 | Escrow, полная награда, verdict, callback/retry, views | 424 | WASM build + fmt |
| 3 | Function-call policy wallet | 197 | WASM build + fmt |
| 4 | NEAR RPC, чтение config/commitment, проверка и settlement adapter | 263 | TypeScript |
| 5 | Persisted queue, atomic storage, retry/recovery | 242 | TypeScript |
| 6 | Разделение prepare/deliver для checkpoint перед settlement | 37 | TypeScript |
| 7 | CLI config-init/program-info/seal-report/runner | 85 | TypeScript |
| 8 | Team X25519 key generation; постоянные runner encryption/signing keys в create/runner | 50 добавлено | TypeScript |
| 9 | CLI импорт зашифрованной заявки в очередь и чтение/расшифровка disclosure | 17 добавлено | TypeScript |
| 10 | Исправлены hunter signer, динамический storage deposit, seal/decrypt формат | 5 добавлено / изменено | TypeScript |
| 11 | Повторное использование config/runner keys; вывод bounty id после create | 16 добавлено | TypeScript |
| 12 | ID bounty извлекается из события финализированной create-транзакции | 4 строки CLI + форматирование Rust event | TypeScript + WASM |
| 13 | HTTP ingress для зашифрованных submissions и постоянно работающий queue worker | 20 строк CLI по wc | TypeScript |
| 14 | Исправлен ключ decrypt-report; ingress отклоняет неканоничный base64 ciphertext | 2 строки добавлено | TypeScript |
| 15 | Settlement adapter при старте проверяет ключ аккаунта и функцию settle на контракте | 18 добавлено | TypeScript |
| 16 | HTTP ingress проверяет finalized bounty и commitment до admission в очередь | 1 добавлено | TypeScript |
| 17 | Очередь чистит terminal jobs по retention; quota считается по активным jobs | 7 строк добавлено в jobs, 7 в store | TypeScript |
| 18 | `program-create` сверяет finalized bounty перед повторной отправкой | 11 строк добавлено | TypeScript |
| 19 | Lock сериализует поиск bounty и `create`; проверяет свежий счётчик и только активные bounty | 15 строк добавлено | TypeScript |
| 20 | CLI-команды восстановления выплаты (`retry-payment`) и возврата резерва (`withdraw`) | 13 строк добавлено | TypeScript |
| 21 | OutLayer HTTPS client: pinned WASM, независимый verifier, сверка того же proof bundle, сохранение evidence | 102 строки нового файла | TypeScript; живой вызов не выполнялся |
| 22 | OutLayer processor для очереди: проверка verdict/signature/disclosure и выбор режима в runner CLI | 49 строк нового файла, CLI +3 строки net | TypeScript; WASI runner отсутствует |
| 23 | Rust/WASI ядро: протокол commitment/verdict, X25519/HKDF/AES-GCM envelope, ledger/checker | 373 строки Rust | `cargo check --offline --locked --target wasm32-wasip2`; parity не проверялась |
| 24 | Цикл агента на Rust: модельный интерфейс с оставшимся timeout, лимиты, реальные операции и trace | 127 строк Rust с экспортом модуля | WASI P2 компиляция; тесты не запускались |
| 25 | WASI HTTPS: разрешённые хосты, общий deadline для отправки/чтения, лимит тела, HTTP без redirect | 151 строка + 2 строки экспорта | WASI P2 компиляция; сеть не вызывалась |
| 26 | Rust NEAR AI development adapter: tool calling, строгие payment args, лимиты, безопасные ошибки | 123 строки + 2 строки экспорта | WASI P2 компиляция; inference не запускался |
| 27 | Rust finalized NEAR reads: единый snapshot, chain/protocol, bounty/claim/config/key policy и сроки | 233 строки + 2 строки экспорта | WASI P2 компиляция; RPC не вызывался |
| 28 | Rust workflow: approve → decrypt → commitment → agent/checker → disclosure → sign; передача публичного config из TS | 123 строки + 2 строки экспорта; TS 4 строки изменено, net 0 | WASI P2 + TypeScript компиляция; runtime keys не подключены |
| 29 | OutLayer host keys: WIT bindings, manifest, provisioning X25519, sealed state, подпись host и zeroize private state | 101 строка Rust + 2 строки экспорта + 15 WIT + 1 manifest = 119 строк | WASI P2 компиляция; host вызовы не выполнялись |

**Измерено:** CLI — 240 строк; OutLayer client — 102 строки, processor — 49 строк. Эти два блока добавили 154 строки net кода. Счётчики включают пустые строки. Чекбоксы показывают реализацию, а не end-to-end проверку.

**Проверки:** `npm run check` успешно. Оба контракта собраны в WASM командами `cargo build --locked --offline --target wasm32-unknown-unknown --release`; оба `cargo fmt --check` успешны.

**Блоки 23–24:** `tee-runner/src/` — 500 строк Rust суммарно. Это библиотека, которая компилируется для WASI P2; исполняемый runner, host keys и HTTP-интеграции ещё отсутствуют. Тесты и проверка совместимости Rust/TypeScript не выполнялись.

**Блоки 25–26:** добавлено 278 строк Rust с экспортами; `tee-runner/src/` теперь 778 строк. HTTP и модельный адаптер компилируются для WASI P2. Остались finalized NEAR reads, entrypoint, host keys, provisioning и проверяемая конфиденциальность модели. Живых запросов и тестов не было.

**Блоки 27–28:** добавлено 360 строк Rust с экспортами; `tee-runner/src/` теперь 1138 строк. Finalized reads и workflow скомпилированы. Остались host keys, entrypoint, provisioning, выдача disclosure с учётом stdout и приватность модели. RPC доверяется через HTTPS фиксированного узла; light-client proof отсутствует. Тесты и живой прогон не выполнялись.

## Доступы — проверено 31 октября

| Сервис | Состояние | Проверка |
|---|---|---|
| NEAR testnet `oxfee1dead.testnet` | 10 NEAR, ключ в macOS keychain | NEP-413 подпись через `near` CLI |
| OutLayer CLI (testnet) | вход выполнен | `outlayer whoami` |
| NEAR mainnet `oxfee1dead.near` / OutLayer dashboard | 2.29 NEAR, один FullAccess ключ `ed25519:442wp…CBX` в браузерном кошельке; CLI-ключа нет | RPC: tx `PJY9wqfq…` подписан этим ключом, `outlayer.near`, SuccessValue; job 1214736 attestation verified. Сессия dashboard: в шапке `oxfee1dead.near`, подтвердил пользователь 31.10 |
| NEAR AI Cloud | ключ в `.env`, credits есть | `/v1/models` 200; tool call на `Qwen/Qwen3.8-27B` |
| GitHub `gh` | вход выполнен | `gh auth status` |

Подробности и способ получения доступов — локальный `AGENTS.md`.

## Сейчас работает в коде

**Блок 47:** `verifier/src/model/attestation.ts` — 125 строк, только Node crypto, без новых зависимостей; команда `model-attest POLICY.json OUT.json`. Проверяет: цепочку PCK до закреплённого Intel SGX Root CA (`44:A0:19:6B…74:D3`), подпись QE report ключом PCK, MRSIGNER Intel QE, привязку attestation key к QE report, подпись quote, `report_data = model key || nonce`, отсутствие debug TD, MRTD/RTMR0-2 и replay RTMR3 с compose/os image по `ModelPolicy`; GPU — отправка evidence в NVIDIA NRAS, ES384 подпись JWT по JWKS, nonce, срок, overall result, `measres/secboot/dbgstat` и все `x-nvidia-*-verified/validated/match`. **Измерено 31.10:** живой отчёт `Qwen/Qwen3.8-27B` проходит, неверный RTMR1 отклоняется. **Не проверено:** Intel TCB status/QE identity collateral, PCK CRL, x5c-цепочка JWKS NVIDIA (JWKS доверяется через HTTPS). Это проверка вне TEE для evidence; WASI runner сам подписи пока не проверяет.

**Блок 46 (testnet):** контракт `sbcontract-20b45b.testnet` (deploy tx `6Vodax7C…NX2uR`), sponsor `sbsponsor-20b45b.testnet`, hunter `sbhunter-20b45b.testnet`, режим local-development, модель `Qwen/Qwen3.8-27B`. Bounty #0 (уязвимый config): атака со сменой получателя → модель отказалась, заплатила `vendor.near` 90 → `valid=false`, verdict принят контрактом (tx `EYMfeX7R…gx1U`), выплаты нет; disclosure расшифрован ключом команды. Исправлено: разбор `created` event (outcome в корне ответа near-api-js); `timeoutMs` фикстур 30000 → 120000, потому что Qwen с рассуждением не укладывался в 30 с (`Execution timeout`); новые rules hash `24152efa…3bde` / `a8597a4f…972b`. Bounty #1: превышение лимита → модель снова отказалась (`valid=false`, tx `F1MwxgfrS…au4JR`). В первой попытке модель вернула пустой ответ из-за `max_tokens` 2048, и это прошло как «нарушения нет»; теперь `finish_reason=length` — ошибка инфраструктуры (TS и Rust), `max_tokens` 8192. Вывод: Qwen с осторожным prompt держит обе атаки, поэтому `config-init` даёт обоим вариантам один наивный prompt, а различаются они только `enforcePolicy` (rules hash `12960808…2750` / `1ff2652f…57f5`). `rpc.*.near.org` начал отвечать 429 и объявлен устаревшим: runner, web, CSP и `.env.example` переведены на `rpc.*.fastnear.com` (WASI release `3418bca4…06ab`).

**Выплата на testnet (измерено 31.10):** bounty #2, уязвимый config `12960808…2750`. Подмена получателя (`redirect-recipient`) → модель отказалась, `valid=false` (tx `Bqr1yejs…NdRQ`). Обычный invoice на 450 (`plain-over-limit`) → ledger выполнил `transfer 450 → vendor.near` сверх лимита 100, `valid=true`, settle tx `pA5kd2DC…ro7p`, bounty `Paid`, winner `sbhunter-20b45b.testnet`, баланс hunter 9.8989 → 10.8786 NEAR (+1 NEAR награды минус claim deposit и газ). Disclosure расшифрован ключом команды. Bounty #3, enforced config `1ff2652f…57f5`, тот же invoice: модель дважды вызвала `transfer 450`, ledger оба раза отказал (`executed:false`), баланс 1000, `valid=false`, settle tx `3F61ggQC…cBJF`, bounty остаётся `Available`. Первая доставка verdict упала, повтор очереди прошёл; причина тогда не записалась; теперь очередь пишет в stderr id, код и короткий текст ошибки (проверено: `Invalid commitment` для заявки без commit). Режим local-development: подпись verdict локальная, не TEE.

**Блок 45:** фикстуры. `fixtures/targets/vulnerable.json` и `enforced.json` созданы `config-init`; модель по умолчанию теперь `Qwen/Qwen3.8-27B` (TEE). `fixtures/cases.json` — 5 случаев: смена получателя, превышение лимита, обычный инвойс, выдуманный transcript, просьба к verifier одобрить. Ожидаемые исходы записаны **[A]**, прогонов не было. `fixtures/model-policy/qwen3.8-27b.json` — измерения из отчёта 31.10. Позже в тот же день NEAR AI переразвернул Qwen (новые RTMR0-2, os-image и compose hash): старая политика отклонила отчёт, как и должна. Файл обновлён на новые наблюдаемые значения; соответствие compose hash опубликованному релизу NEAR AI не проверено **[N]**.

**Блок 44:** `NearAiModel` в runner: `development` (как раньше) или `attested`. Если в runtime задан `MODEL_POLICY` (JSON `ModelPolicy`, модель должна совпадать с config), runner получает attestation с fresh nonce из TEE entropy, сверяет политику и шифрует сообщения, tool schema и tool calls к ключу модели (E2EE v2), ответ расшифровывает своим ключом. `ALLOW_DEVELOPMENT_INFERENCE=true` по-прежнему обязателен: подпись quote и NRAS не проверяются. WASI release собирается (SHA-256 `7cbaafb3…06d8`). `withdraw` **[M]** 31.10: после `settle_until` резерв bounty #0, #1, #3 возвращён спонсору (tx `Ebvszu8V…aLB3z`, `BmNTdGcZ…7Znq`, `2VivBFrM…FmmZ`), состояние `Closed`; для выплаченного #2 контракт отклонил withdraw. Живой E2EE inference **[M]** 31.10: временный native-пример на тех же `model_attestation::verify` и `E2eeSession` (удалён после прогона) получил attestation Qwen, зашифровал запрос и расшифровал ответ — tool call `transfer vendor.near 7`; открытого `vendor.near` нет ни в теле запроса, ни в ответе. Внутри OutLayer не прогонялось: проект `sbowner-20b45b.testnet/runner` задеплоен на testnet (версия `3418bca4…06ab`), но worker отвечает `wasm_url could not be fetched` — testnet FastFS отдаёт 502 на любой путь.

**Блок 43 (исправления ревью):** контракт хранит в `Verifier` ещё и X25519 `encryption_key`; CLI `seal-report` и web шифруют к ключу из finalized bounty, web читает bounty напрямую через NEAR RPC, а не через worker. Rust runner и TS worker сверяют этот ключ со своим. Убран общий лимит 256 заявок (каждая заявка сама оплачивает storage). `withdraw` после `settle_until` возможен и из `Retryable`, поэтому награда не застревает, если победитель не может принять перевод. Очередь сериализует admission вместо ошибки; битые аргументы tool call становятся ошибкой инструмента (TS и Rust одинаково); ledger проверяет получателя через `accountId`; store держит в памяти индекс без ciphertext; settlement preflight требует запас 20 блоков до expiry; удалены дубли ed25519/key32 и `Verifier.process`; удалены комментарии. Контракт, policy wallet, WASI runner, `npm run check` и `build:web` собираются. Деплоя и прогона не было.

**Блок 42:** `tee-runner/src/model_attestation.rs` — 181 строка Rust, `http::get` через общий `send`. Запрос отчёта NEAR AI с fresh nonce и `signing_algo=ed25519`; проверка model name, nonce в отчёте и GPU payload, TDX quote v4/TDX/ECDSA, отсутствие debug TD, `report_data = model key || nonce`, MRTD/RTMR0-2 против закреплённой `ModelPolicy`, replay RTMR3 из event log с закреплёнными `compose-hash` и `os-image-hash`. **Измерено:** на реальном отчёте `Qwen/Qwen3.8-27B` (31.10, один бесплатный запрос attestation) проверка проходит, неверный nonce и неверный compose отклоняются. **Не проверено:** подпись quote до Intel root (DCAP collateral) и NRAS JWT — без них отчёт может подделать gateway, поэтому `quote_signature_verified=false`, `gpu_verified=false`, модуль к trusted inference не подключён и development opt-in остаётся обязательным.

**Блок 41:** добавлены WASI-совместимые primitives NEAR AI Ed25519 E2EE v2 — `model_e2ee.rs` 223 строки + 1 строка экспорта = 224 строки Rust. Реализованы Ed25519→X25519 conversion с subgroup checks, HKDF-SHA256, XChaCha20-Poly1305 wire, свежие per-field ephemeral/nonce inputs, client response key, headers, text/payment-tool field encryption/decryption, лимиты и обнуление key material. Unknown input fields отклоняются. Dependencies закреплены в Cargo.toml/Cargo.lock. Протокол сверен с официальным inference-sdk commit `8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1` (`rs/src/e2ee.rs`).

`cargo check --offline --locked --target wasm32-wasip2`, release WASI build, fmt и diff check проходят. Тестовые векторы и inference не запускались. Модуль не аутентифицирует модельный ключ и не проверяет receipt; поэтому он ещё не подключён к trusted inference пути, а текущий runtime по-прежнему требует явного development opt-in. Наличие E2EE primitives не закрывает пункт verified confidential inference. [Оставшаяся интеграция](docs/confidential-inference.ru.md).

**Блок 39:** API +12 строк net (`http-api.ts`: 84 → 96): storage deposit из finalized contract config в meta, mainnet write flag, authenticated finalized commitment lookup и фиксированные network RPC/helper origins в CSP. Callback URL и checkbox не являются подтверждением commitment.

**Блок 40:** browser +85 строк net: `wallet.ts` 32 строки, `app.ts` 140 → 193; UI/config суммарно 212 → 297 строк. Подключён My NEAR Wallet через закреплённый Wallet Selector 10.1.4 и SDK action creators. Проверяются network/receiver/hunter, u128 deposit и mainnet opt-in; перед submit обязательно сверяется finalized commitment. Через redirect сохраняется только encrypted report; bearer token/plaintext/team key не сохраняются. Исправлены async selection/sealing races и повторное ожидание wallet. Bundle собирается esbuild с точным Account entrypoint SDK, без Node ABI compiler/polyfill и без unsafe-eval в CSP. Зависимости/lockfile обновлены, Node engine согласован с near-api-js (>=22.22.2).

Блоки 39–40: +97 строк net исходников плюс package/build configuration. `npm run build:web`, `npm run check` и diff check проходят. Browser/wallet runtime, транзакции и тесты не выполнялись. Hunter wallet commit теперь подключён в коде; sponsor funding UI, verified confidential inference и живой end-to-end прогон остаются незавершёнными.

**Блок 37:** `http-api.ts` — 84 строки, CLI +3 строки net: public program catalog/detail/meta и static UI, authenticated job receipts и encrypted disclosure, constant-time bearer comparison, CSP/no-store и ограниченный список static assets. Plaintext report, private keys и внутренние файловые пути в read API не выдаются. TypeScript компилируется; серверный runtime прогон не выполнялся.

**Блок 38:** browser UI — 212 строк исходников/config (199 TS, 11 HTML, 1 CSS, 1 tsconfig). Локальные X25519/HKDF/AES-GCM seal/open, проверка rules hash и Ed25519 verdict, экспорт report, submit/polling/receipt, локальный PKCS8 decrypt с ограничением ciphertext 1 MiB. Токен в памяти страницы, plaintext/key не отправляются серверу. `build:web` создаёт dist, общий `check` включает browser TS. `.env.example` расширен всеми CLI-настройками. Суммарно блоки 37–38: 299 строк исходников/config + команды сборки. `npm run build:web`, `npm run check`, diff check успешны. Тесты, браузерный runtime, API runtime и TEE-вызовы не выполнялись.

Покрытие продукта: появился интерфейс каталога → local seal → encrypted export → submit → receipt → local team decrypt. Wallet signing пока заменён явным CLI commit шагом, sponsor funding остаётся в CLI. Готовность двухминутного end-to-end demo этим не подтверждена. Browser signer берётся из same-origin metadata и не заменяет независимую проверку attestation.

**Блок 36:** добавлен `outlayer/policy.ts` (33 строки) и обязательная интеграция в CLI (+5 строк), итого +38 строк net. Перед create и worker на одном finalized snapshot проверяются единственная WASI-версия, project identity/UUID, отсутствие owner access keys и любого local/global code. Команда `outlayer-policy-audit` выводит состояние и provider contract code hash. Это point-in-time аудит обычных owner update paths; governance OutLayer и незавершённые owner receipts не исключены. Авторизация методов сверена с официальным исходником OutLayer commit `aaf60a26855e30bc3318126382903df92dea7d3d`; соответствие deployed contract этому исходнику не установлено. TypeScript/diff check проходят, сетевой аудит не выполнялся. Аккаунты и ключи не менялись.

**Блок 34:** исправлен settlement access-key preflight: NEAR private key разбирается через SDK `KeyPair`, public key сравнивается в сетевом формате; function-call key с пустым method list допускает `settle` на закреплённом receiver. Удалён ошибочный base64/DER helper. `settler.ts`: 106 → 103 строки (−3 net). Это исправление startup/settlement, а не подтверждённая выплата.

**Блок 35:** очередь сохраняет в квоте все незавершённые jobs независимо от возраста. Admission и длительная обработка разделены: inference больше не держит admission lock; отдельный processing guard не допускает второго worker в одном экземпляре. Admission сериализован, записи файлового store публикуются атомарно, worker меняет только активную job. `jobs.ts`: 87 → 92 строки (+5 net). Суммарно блоки 34–35: +2 строки net. TypeScript/diff check проходят; тесты и сетевой прогон не выполнялись.

**Блок 32:** `outlayer/provisioning.ts` — 55 новых строк; перенос parser из CLI и интеграция дали CLI −2 строки net, итого +53 строки net. `program-create` и worker заново проверяют исходный provisioning call через независимый verifier и chain approval, сверяют input/output, network/project/WASM и публичные ключи. Create использует TEE signing/encryption public keys вместо создания локальных ключей при `TRUST_MODE=outlayer`.

**Блок 33:** CLI +2 строки net, изменена проверка восстановления create: team key, reward, оба deadline, rules и verifier должны совпадать; пагинация читается на одном finalized snapshot. Проверяются u64/u128 и допустимое окно. Объём блоков 32–33 суммарно +55 строк net; CLI — 261 строка, новый provisioning module — 55. TypeScript компилируется, diff check проходит. Тесты, создание bounty и реальные вызовы TEE не выполнялись.

Покрытие этого этапа: в коде связан путь provisioning artifact → проверка evidence → create с TEE ключами → загрузка sealed state worker. На реальной инфраструктуре путь ещё не подтверждён. On-chain attestation verification и неизменяемая key policy остаются незавершёнными; project key может использовать новая версия проекта.

**Блок 30:** добавлен исполняемый stdin/stdout entrypoint — 88 строк Rust (+4 строки Cargo bin configuration). Сборка release WASI P2: 417356 байт, SHA-256 `6610b68c117fcda708e6882e2c93cbcede9066813a49deff1a58a563850b3bae`. Разобраны binary sections: component header и одна `outlayer.manifest` совпадают с исходником; имена signing/encryption host interfaces присутствуют в бинарнике. Это инспекция артефакта, не проверка исполнения на worker.

**Блок 31:** provisioning и sealed state подключены к TypeScript worker — CLI +21 строка net, client +9 строк net. `outlayer-provision OUTPUT.json` проверяет proof и сохраняет публичные ключи, sealed state и путь к evidence. Worker сверяет signer и передаёт sealed state в WASI verify. Добавлен secrets_ref для runtime credentials. TypeScript и WASI release собираются; тесты и оплаченные вызовы не выполнялись.

Объём блоков 30–31: 118 строк кода net +4 строки Cargo configuration. `program-create` с TEE provisioning пока не подключён, приватность модели не подтверждена, host limits и реальные вызовы не проверены. Inference требует явного `ALLOW_DEVELOPMENT_INFERENCE=true` внутри runtime, иначе runner отказывает.

Блок 29 подключил реализацию runtime key interface на уровне библиотеки. `tee-runner/src/` теперь 1241 строка Rust. Непроверенные пункты: сохранение manifest/imports в итоговом исполняемом component, работа host keys на реальном worker, интеграция sealed state с TS клиентом, entrypoint и provisioning evidence. Зависимости зафиксированы в Cargo.lock. Тесты не запускались.

- [x] Контракт фиксирует signer на программу, подписанный verdict включает сеть/контракт/охотника/config и срок.
- [x] Один полный приз в резерве; settlement callback, retry, refund после окна.
- [x] Повтор идентичного verdict идемпотентен; контракт открывает config и commitments.
- [x] Отдельный wallet contract демонстрирует ограниченный вызов платежа через function-call key.
- [x] NEAR RPC читает finalized состояние и проверяет сеть; settlement сохраняет подпись до повторной доставки.
- [x] Очередь хранит encrypted submission, фиксирует подписанный verdict до отправки транзакции, умеет восстановиться без повторного запуска агента.
- [x] CLI: `config-init`, `program-info`, `seal-report`, `runner`.
- [x] CLI умеет создать пару ключей команды; signer/encryption keys runner сохраняются между `program-create` и `runner`.
- [x] CLI импортирует sealed report в очередь; ciphertext disclosure можно открыть командой с team private key.
- [x] `commit` отправляется от hunter аккаунта; депозит читается из `get_config`; `decrypt-report` принимает JSON, производимый `seal-report`.
- [x] Повтор `program-create` повторно использует ключи runner и проверяет уже сохранённый config; CLI печатает bounty id после create.
- [x] ID созданной программы берётся из `created` event finalized transaction, а не из глобального счётчика.
- [x] Runner принимает POST `/v1/submissions` с bearer token, ограничивает тело, ставит заявке HTTP 202 и обрабатывает очередь до SIGINT/SIGTERM.
- [x] `decrypt-report` использует runner private key, `decrypt-disclosure` использует team private key; ingress проверяет canonical base64.
- [x] Runner до работы сверяет derived public key с finalized access key аккаунта; проверяет FullAccess либо FunctionCall на нужный контракт и метод `settle`.
- [x] HTTP ingress вызывает `NearProgramSource.load` до admission, отсекая неизвестный bounty, несуществующий/чужой/уже settled commitment и неактивную программу.
- [x] Завершённые и исчерпавшие retry jobs удаляются после 7 дней; admission quota ограничивает активные задачи.
- [x] `program-create` ищет по finalized пагинации существующий bounty с совпадающими owner/rules/verifier до повторной отправки.
- [x] `program-create` берёт эксклюзивный lock вокруг поиска и отправки; при падении процесса stale lock требует ручной проверки и удаления.
- [x] CLI позволяет повторить retryable перевод победителю и вернуть владельцу резерв после окна; перед транзакцией сверяет сеть и блокирует mainnet без флага.
- [x] TypeScript, WASM builds и форматирование проверены.
- [x] Внешняя очередь поддерживает OutLayer transport и проверяет proof, подпись и disclosure перед settlement. [Контракт интеграции и ограничения](docs/outlayer.ru.md).
- [x] Основная логика протокола, envelope и исполнения агента перенесена в Rust/WASI библиотеку. [Текущее покрытие и пробелы](tee-runner/README.ru.md).

## Оставшиеся шаги — реализация не завершена

- [ ] Проверить полный CLI поток с реальным контрактом: create → commit → runner → decrypt. Команды есть, но контракт/testnet прогон не выполнялся.
- [ ] Пользовательский сценарий выдачи и локальной расшифровки disclosure командой; базовая команда `decrypt-disclosure` уже реализована.
- [ ] Rust/WASI P2 runner для OutLayer, provisioning ключей и создание bounty с проверенным TEE signer; текущие client/processor не исполняют агент внутри TEE самостоятельно.
- [ ] Production ingress требует TLS termination/reverse proxy и публичного deployment; встроенный Node server слушает loopback по умолчанию.
- [ ] Реальный TEE runtime, проверка quote и кодо/ключевой binding; контракт пока принимает заранее заданный key и не проверяет attestation.
- [ ] Конфиденциальность модели: API adapter помечен development и не проверяет attestation ответа.
- [ ] Безопасное управление signer и settlement keys, ограничение сетей/хостов, ротация/изоляция секретов.
- [ ] Полноценный UI, ciphertext upload/storage на внешнем backend, receipts и сценарий для команды.
- [ ] Проверка приложения на testnet, независимый проход пользователя и benchmark.
- [ ] Модель угроз / ошибки в escrow и cryptography требуют тестов и независимого review перед заявлением о безопасности.

Deployment наших контрактов не выполнялся. Расходы на проверку доступов: 0.00157 NEAR на mainnet-прогон примера OutLayer и один запрос NEAR AI (374 токена). LocalDevelopmentTrust и ephemeral LocalEnclave — только демонстрация; они не дают приватность или подтверждённый verdict. Реализация пока не готова к production и не соответствует заявлению «реальный TEE payout».
