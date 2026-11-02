# План на победу — 30 октября 2026

Цель: первое место Security; Privacy — дополнительный трек; grand prize — амбиция. Вероятности победы не оценены. Команда готова к максимальному объёму. 31 октября проверены доступы к NEAR AI Cloud и OutLayer (детали ниже); внешний пилот не подтверждён. Пилот приоритетен, но необязателен.

План реализации по файлам и проверкам: [IMPLEMENTATION_PLAN.ru.md](IMPLEMENTATION_PLAN.ru.md).

Отмечаем пункт выполненным только после проверки результата; наличие кода само по себе не означает готовность.

## Доступы

Где лежат ключи и как их получить: локальный `AGENTS.md` (не публикуется).

- [x] NEAR AI Cloud: аккаунт, API key, credits. Проверено 31.10: TEE-аттестацию (Intel quote + NVIDIA payload) отдают `Qwen/Qwen3.8-27B` и `Qwen/Qwen3.6-35B-A3B-FP8`; tool calling работает на `Qwen/Qwen3.8-27B`; `/v1/signature/{id}` возвращает адрес подписи, совпадающий с аттестованным. Проприетарные модели (openai, google и др.) — anonymised, не TEE; glm/deepseek/kimi/qwen-max аттестацию не отдали.
- [ ] NEAR AI Cloud, осталось: полная криптопроверка quote/NRAS/подписи в нашем коде, фиксация версии модели, лимиты, E2EE, поведение при рестарте и обновлении модели.
- [x] OutLayer: доступ есть (dashboard на mainnet, CLI на testnet под `oxfee1dead.testnet`). Runtime — WASM `wasm32-wasip1`/`wasip2`, выбран Rust. Лимиты по умолчанию: 128 МБ, 60 с, 10^10 инструкций. Пример стоил 0.00157 NEAR. Аттестация прогона проверена (job 1214736: Intel подпись, measurements в `worker.outlayer.near`, binding входа/выхода/кода). Testnet: `outlayer.testnet`, `testnet-api.outlayer.ai`.
- [ ] OutLayer, осталось: исходящий запрос к NEAR AI из нашего WASM (пример ходил в Fireworks открытым текстом — нам не подходит), encrypted ingress, привязка наших ключей к measurement, прогон нашего runner на testnet.
- [ ] Альтернативный TEE-провайдер: не нужен, пока OutLayer проходит проверки.
- [ ] Позже: хостинг UI, ciphertext storage с понятным retention. Testnet: основной `oxfee1dead.testnet` создан; отдельные sponsor/hunter/contract аккаунты ещё нет. Для подачи — mainnet-адрес получателя приза и X-пост человека.

NEAR AI inference не заменяет исполнение нашего checker в TEE. Выбор стека завершён только после проверенного encrypted input → runner → model → checker → signed verdict.

## Полный объём и порядок

- [ ] Ядро: замороженный агент, инвойс как поверхность атаки, изолированный ledger, детерминированный checker, attestation, зашифрованное раскрытие, testnet payout.
- [ ] Надёжность: резерв награды, очередь и deadlines claims, восстановление failed transfers, pinned verifier policy, domain separation, защита commitments от копирования, повторов и exhaustion; отсутствие возможности sponsor изменить funded deployment.
- [ ] Доказательства: vulnerable/patched пары, harmless/junk/duplicate/adversarial-checker случаи; повторные прогоны, стоимость, latency, ошибки и ограничения. Тесты escrow и границ доверия обязательны.
- [ ] Продукт: интерфейс sponsor/hunter/team, receipt links, просмотр evidence, локальная расшифровка; воспроизводимый README, CI, двухминутное видео.
- [ ] Усиление: второй агент с другой политикой; function-call key сценарий; бюджет исполнения и spam controls; onboarding template; внешний пилот при наличии участника.
- [ ] Расширения: исторический Intents exploit до/после патча (отдельная проверка выполнимости nearcore в TEE), NEP-141 rewards, gas sponsorship, второй attested verifier. Cross-chain funding и hunter marketplace включены в backlog; начинать после основного сценария и при ясной пользе для демонстрации.

## Контрольные даты

- [ ] 2 ноября: проверена реальная аттестация.
- [ ] 5 ноября: получена сквозная выплата.
- [ ] 10 ноября: готов пользовательский сценарий и замеры.
- [ ] 12 ноября: завершено добавление функций, проверена воспроизводимость.
- [ ] 13 ноября: опубликовано и подано.


| Дата | Проверяемый результат |
|---|---|
| 30–31 октября | Запрошены доступы, определены policy и trust boundary, подготовлены fixtures |
| 1–2 ноября | Проверена аттестация реального runner и пути к модели; выбран стек |
| 3–5 ноября | Полный приватный проход с настоящей testnet-выплатой и расшифровкой |
| 6–8 ноября | Закрыты escrow gaps, negative cases, replay; второй конфиг и policy enforcement |
| 9–10 ноября | UI, benchmark, operating costs; пилот при наличии; расширения при готовности ядра |
| 11–12 ноября | Независимое воспроизведение, freeze функций, видео и пакет evidence |
| 13 ноября | Целевая публикация и подача после проверки человеком |
| 14 ноября | Резерв до официального дедлайна 23:59 UTC |

Если на 2 ноября нет проверенного TEE-пути — меняем инфраструктуру или честно пересматриваем claims. Если на 5 ноября нет сквозной выплаты — расширения ждут. Максимальный объём не отменяет зависимостей и freeze.

## Текст запроса инфраструктурным командам

Мы создаём Sealed Bounty для NEAR Hackathon: приватную проверку атак на платёжных AI-агентов с автоматической выплатой награды в NEAR. Нужны исполнение собственного runner/checker в аттестованной среде и конфиденциальная модель с вызовом инструментов. Можете предоставить доступ, кредиты и технический контакт для проверки интеграции до 2 ноября? Нужны зашифрованный вход, привязка кода и ключей шифрования/подписи к аттестации, проверяемая конфиденциальность модели и пример проверки доказательств для расчётов в NEAR. Просим уточнить среды исполнения, квоты, testnet и стоимость. Дедлайн подачи — 14 ноября.

Отправка сообщений остаётся за человеком, пока он отдельно не поручит отправить их агенту.

## Источники, проверенные 30 октября

- https://nearhackathon.com/ — треки, deadline, допускается код с момента объявления.
- https://docs.near.ai/cloud/verification — gateway/model evidence, TLS, image provenance, response signatures; direct verification отмечена experimental.
- https://github.com/near-examples/nearai-cloud-verification-example — пример проверки и получение ключа через cloud.near.ai.
- https://outlayer.ai/ — заявлены TDX, run attestation и on-chain проверки; совместимость с нашим runner ещё не доказана.
- 31 октября: https://app.outlayer.ai/docs/tee-attestation и /docs/trust-verification — attestation хранится off-chain у coordinator, контракт доверяет ключу воркера, зарегистрированному через `worker.outlayer.near`; проверка — dashboard «Verify» или `outlayer-verify`.
