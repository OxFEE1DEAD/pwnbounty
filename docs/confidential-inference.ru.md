# Состояние confidential inference

Обычный Rust/TypeScript NEAR AI transport остаётся development-режимом. WASI runner разрешает его только с `ALLOW_DEVELOPMENT_INFERENCE=true`. Он отправляет plaintext провайдеру по HTTPS и не проверяет model evidence.

`tee-runner/src/model_e2ee.rs` реализует криптографический wire NEAR AI E2EE v2 для Ed25519 и text/payment tools. Источник формата — [официальный SDK на закреплённом commit](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/rs/src/e2ee.rs). Модуль проверяет структуру публичного ключа, но это не подтверждает его происхождение из модели. Он не подключён к сетевому запросу до реализации полной проверки доверия. Caller обязан получать ключ из свежего проверенного attestation, передавать криптографическую энтропию и проверять response receipt перед использованием tool calls. Тестовые векторы пока не прогонялись.

`tee-runner/src/model_attestation.rs` проверяет структуру и привязки отчёта: fresh nonce, `report_data = model key || nonce`, MRTD/RTMR0-2 по закреплённой политике, replay RTMR3 до `compose-hash` и `os-image-hash`. Подпись quote (DCAP) и NRAS JWT не проверяются, поэтому результат не считается доверенным.

Для завершения пути необходимо:

1. Получить model attestation с fresh nonce и явным Ed25519 signing algorithm, проверить Intel/DCAP evidence, nonce/key binding, измерения/compose/event log и необходимую GPU boundary по закреплённой deployment policy.
2. Шифровать сообщения и tool schema/arguments к проверенному model key. Хранить точные зашифрованные request/response bytes; непроверенный ключ из API или env недостаточен.
3. Проверить provider TEE response receipt, hashes и подпись до исполнения платёжного tool call. Gateway receipt сам по себе не доказывает model execution.
4. Подключить это к WASI HTTP и проверить рабочий путь. Готовый Rust SDK использует reqwest/rustls/Tokio; его transport для WASI P2 в проекте не подтверждён. WASI HTTP не предоставляет сертификат peer/SPKI и управляемую TLS connection, поэтому documented TLS pinning flow нельзя просто перенести как есть.

У SDK нет default approved deployment allowlist: ожидаемые measurements/images требуется зафиксировать отдельно. Совпадение signing key не устанавливает конкретный serving instance, если экземпляры модели используют общий ключ. Эти ограничения остаются частью доверия.

Первичные источники: [Rust SDK](https://docs.near.ai/cloud/inference-sdk/rust), [E2EE v2](https://docs.near.ai/cloud/guides/e2ee-chat-completions), [model attestation](https://docs.near.ai/cloud/verification/cloud-api/model-attestations), [response signatures](https://docs.near.ai/cloud/verification/cloud-api/response-signatures), [verification policies](https://github.com/nearai/inference-sdk/blob/8c66d8e2fdea4e99b277201a9ea5e05ea8295ff1/rs/docs/verification-guide.md).
