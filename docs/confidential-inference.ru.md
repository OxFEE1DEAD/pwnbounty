# Состояние confidential inference

TypeScript NEAR AI transport для локального verifier остаётся development-режимом и отправляет plaintext провайдеру по HTTPS. WASI runner требует `MODEL_POLICY` и его `modelPolicyHash` в правилах funded bounty, сверяет хеш, проверяет подписи Intel quote (PCK chain до закреплённого Intel root, QE report, attestation key) и NVIDIA NRAS JWT (ES384 по JWKS), затем использует E2EE. Не проверяются Intel TCB/QE identity collateral, PCK CRL и x5c-цепочка JWKS NVIDIA; время берётся из wall clock хоста.

`tee-runner/src/model_e2ee.rs` реализует криптографический wire NEAR AI E2EE v2 для Ed25519 и text/payment tools. Источник формата — [официальный SDK на закреплённом commit](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/rs/src/e2ee.rs). Модуль подключён к WASI сетевому запросу; native-пример ранее зашифровал запрос и расшифровал ответ модели, но внутри OutLayer путь не запускался. Структурная проверка ключа и E2EE не подтверждают происхождение ключа из модели, пока подписи evidence не проверены. Response receipt до исполнения tool calls также не проверяется.

`tee-runner/src/model_attestation.rs` проверяет структуру и привязки отчёта: fresh nonce, `report_data = model key || nonce`, MRTD/RTMR0-2 по политике, replay RTMR3 до `compose-hash` и `os-image-hash`. Хеш политики закрепляется в `TargetConfig.modelPolicyHash` и включается в on-chain `rules_hash`; runner отвергает изменённый runtime secret до inference. Подпись quote (DCAP) и NRAS JWT не проверяются, поэтому результат не считается доверенным.

Для завершения пути необходимо:

1. Получить model attestation с fresh nonce и явным Ed25519 signing algorithm, проверить Intel/DCAP evidence, nonce/key binding, измерения/compose/event log и необходимую GPU boundary по закреплённой deployment policy.
2. Шифровать сообщения и tool schema/arguments к проверенному model key. Хранить точные зашифрованные request/response bytes; непроверенный ключ из API или env недостаточен.
3. Проверить provider TEE response receipt, hashes и подпись до исполнения платёжного tool call. Gateway receipt сам по себе не доказывает model execution.
4. Подключить это к WASI HTTP и проверить рабочий путь. Готовый Rust SDK использует reqwest/rustls/Tokio; его transport для WASI P2 в проекте не подтверждён. WASI HTTP не предоставляет сертификат peer/SPKI и управляемую TLS connection, поэтому documented TLS pinning flow нельзя просто перенести как есть.

У SDK нет default approved deployment allowlist: ожидаемые measurements/images требуется зафиксировать отдельно. Совпадение signing key не устанавливает конкретный serving instance, если экземпляры модели используют общий ключ. Эти ограничения остаются частью доверия.

Первичные источники: [Rust SDK](https://docs.near.ai/cloud/inference-sdk/rust), [E2EE v2](https://docs.near.ai/cloud/guides/e2ee-chat-completions), [model attestation](https://docs.near.ai/cloud/verification/cloud-api/model-attestations), [response signatures](https://docs.near.ai/cloud/verification/cloud-api/response-signatures), [verification policies](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/rs/docs/verification-guide.md).
