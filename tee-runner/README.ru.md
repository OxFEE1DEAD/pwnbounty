# Ядро WASI runner

Rust-библиотека для будущего OutLayer WASI P2 executable. Содержит протокол, шифрование envelope, ledger, checker и цикл агента с ограничениями шагов, размера и времени. API модели получает оставшийся timeout и обязан ограничить им HTTP-вызов. Ошибка модели или timeout возвращаются как ошибка исполнения, без отрицательного verdict.

Компиляция: `cargo check --offline --locked --target wasm32-wasip2 --manifest-path tee-runner/Cargo.toml`.

Публичные структуры и формат envelope перенесены из TypeScript. Тестовый vector `fixtures/interop-report.json` подтверждает TypeScript → Rust decrypt; Browser WebCrypto и Node verifier также проходят взаимное открытие report с тем же commitment. Это проверка формата, не проверка TEE runtime. Четыре unit-теста проверяют, что награду определяет только выполненная операция ledger: модельный текст без tool call не засчитывается, а enforced policy блокирует нарушение. При шифровании caller обязан передать 76 свежих случайных байт из криптографического RNG внутри TEE.

HTTP-слой использует WASI P2 напрямую: HTTPS на разрешённые хосты, общий monotonic deadline для записи запроса, ожидания заголовков и чтения тела, ограничение размера ответа. Redirect не обрабатывается. `NearAiDevelopmentModel` реализует tool calling и строгий разбор платежных аргументов; API key не выводится, ошибки провайдера не включают тело ответа. Это development transport без проверки конфиденциальности модели.

Это ещё не развёртываемый OutLayer executable: отсутствуют stdin/stdout entrypoint, выдача ciphertext disclosure, host signing/encryption keys и provisioning. Библиотека не генерирует доказательство аттестации. Приватность удалённой модели отдельно требует проверки. HTTP и inference не запускались, выполнена только компиляция.

Модуль `near` читает bounty, commitment и protocol на одном finalized block hash и сверяет snapshot каждого view. Ключ verifier, policy hash и hash конфигурации проверяются до исполнения. RPC доверяется через HTTPS фиксированного узла; light-client proof отсутствует.

`workflow::verify` связывает цепочку approve → decrypt → commitment → agent/checker → encrypted disclosure → sign. Ключи и энтропия запрашиваются через интерфейс `Enclave`, реализованный библиотечным адаптером OutLayer ниже. Policy hash должен поступать из доверенного runtime, а не из входа. Сквозной RPC/inference прогон не выполнялся.

`outlayer::OutLayerEnclave` реализует key interface через официальные `outlayer:signing-keys@0.1.0` и `outlayer:encryption-keys@0.1.0`. Подпись выполняется host-ключом `verdicts`. Provisioning генерирует X25519 keypair внутри WASI, шифрует private key host-ключом `runner-state` и возвращает только публичные ключи и `sealed_state`. Для последующей проверки нужен тот же sealed state, тот же проект и caller; открытый private key обнуляется после использования. State можно хранить снаружи TEE как ciphertext.

Manifest фиксирует `bind: project` и `caller: signer`: обновления проекта могут получить те же host keys. Поэтому это ещё не привязка ключа к неизменяемому коду. WIT проверены по официальному исходнику OutLayer (`worker/wit/deps/{signing-keys,encryption-keys}.wit`) и сохранены в репозитории; живые host-вызовы не выполнялись. Проверка компиляции не проверяет imports/custom sections конечного executable.

## Исполняемый компонент (блоки 30–31)

`cargo build --offline --locked --release --target wasm32-wasip2 --manifest-path tee-runner/Cargo.toml` создаёт `target/wasm32-wasip2/release/sealed-bounty-tee-runner.wasm`. Прежние заметки об отсутствии entrypoint относятся к предыдущим блокам; теперь stdin принимает `action: provision` либо `action: verify` с report, config и sealed_state. Ошибка завершает процесс с кодом 1 без выдачи результата и без plaintext в журнале.

`npm run cli -- outlayer-provision OUTPUT.json` вызывает опубликованный компонент, проверяет proof и сохраняет provisioning artifact. Перед worker задать `OUTLAYER_PROVISIONING_FILE` и соответствующий `OUTLAYER_SIGNER_PUBLIC_KEY`. Runtime credentials выбираются через `OUTLAYER_SECRETS_ACCOUNT` / `OUTLAYER_SECRETS_PROFILE`; внутри профиля нужны `ATTESTATION_HASH`, `NEAR_AI_APIKEY` и `MODEL_POLICY`. Config создаётся командой `npm run cli -- config-init OUTPUT.json vulnerable fixtures/model-policy/qwen3.8-27b.json` (или `enforced`): она добавляет `modelPolicyHash` в funded rules. Runtime отвергает отсутствующую или изменённую политику до inference, проверяет подписи Intel quote и NVIDIA NRAS и только потом использует E2EE.

Вывод ограничен 1,4 MB. В [официальном worker source](https://github.com/out-layer/outlayer/blob/aaf60a26855e30bc3318126382903df92dea7d3d/worker/src/executor/mod.rs#L227) default stdout составляет 10 MiB; deployment может переопределить MAX_OUTPUT_BYTES. Предел hosted deployment не проверен живым вызовом. Указанные в старой документации 900 байт относятся к NEAR callback, поэтому этот runner предназначен для HTTPS-вызовов.

Структура собранного артефакта проверена: component header, manifest custom section и имена обоих host interfaces. Исполнение на TEE worker не выполнялось. Создание bounty из provisioning artifact ещё требует интеграции; project key остаётся доступным будущим версиям того же проекта.
